"use strict";
(() => {
  const t = (key, substitutions) => browser.i18n.getMessage(key, substitutions);
  let scanTimer = null, scanning = false, scanAgain = false, disposed = false;
  let panel, panelOwner, toastTimer;
  const articleSelector = 'article[data-testid="tweet"]';
  function postId(article) {
    // The outer tweet timestamp precedes any quoted tweet timestamp.
    for (const time of article.querySelectorAll("time")) {
      const a = time.closest('a[href*="/status/"]');
      if (a) {
        const match = new URL(a.href).pathname.match(/\/status\/(\d+)/);
        if (match) return match[1];
      }
    }
    // Expanded tweet view may not use <time>.
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      const match = new URL(a.href).pathname.match(/\/status\/(\d+)$/);
      if (match) return match[1];
    }
    return null;
  }
  function notify(text) {
    if (disposed || !document.body) return;
    document.querySelector(".xfd-toast")?.remove();
    clearTimeout(toastTimer);
    const toast = document.createElement("div");
    toast.className = "xfd-toast";
    toast.setAttribute("role", "status");
    toast.textContent = text;
    document.body.append(toast);
    toastTimer = setTimeout(() => toast.remove(), 6500);
  }
  function closePanel(restore = false) {
    panel?.remove(); panel = null;
    panelOwner?.setAttribute("aria-expanded","false");
    if (restore) panelOwner?.focus();
    panelOwner = null;
  }
  function downloadIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("aria-hidden","true");
    const path = document.createElementNS(svg.namespaceURI,"path");
    path.setAttribute("d","M11 3h2v10.586l4.293-4.293 1.414 1.414L12 17.414l-6.707-6.707 1.414-1.414L11 13.586V3z M4 16h2v3.5c0 .276.224.5.5.5h11a.5.5 0 0 0 .5-.5V16h2v3.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5V16z");
    path.setAttribute("fill","currentColor"); svg.append(path); return svg;
  }
  function menuTheme(button) {
    let node = button.closest(articleSelector), background;
    while (node) {
      const color = getComputedStyle(node).backgroundColor;
      const channels = color.match(/[\d.]+/g)?.map(Number);
      if (channels && channels.length >= 3 && (channels.length < 4 || channels[3] > 0.9)) { background = {color,channels}; break; }
      node = node.parentElement;
    }
    const dark = background ? background.channels[0] * .2126 + background.channels[1] * .7152 + background.channels[2] * .0722 < 128
      : matchMedia("(prefers-color-scheme: dark)").matches;
    panel.dataset.theme = dark ? "dark" : "light";
    panel.style.setProperty("--xfd-menu-bg",background?.color || (dark ? "#000" : "#fff"));
    panel.style.fontFamily = getComputedStyle(button.closest(articleSelector)).fontFamily;
  }
  async function download(button, id, index) {
    closePanel();
    button.disabled = true;
    try {
      const reply = await browser.runtime.sendMessage({type: "xfd:download", id, index});
      notify(reply?.ok ? t("downloadStarted") : reply?.error || t("videoFailed"));
    } catch { notify(t("extensionRestarted")); }
    finally { button.disabled = false; }
  }
  async function clicked(event) {
    event.preventDefault(); event.stopPropagation();
    if (!event.isTrusted) return;
    const button = event.currentTarget;
    if (panelOwner === button) { closePanel(true); return; }
    const id = postId(button.closest(articleSelector));
    if (!id) return;
    try {
      const kinds = await browser.runtime.sendMessage({type: "xfd:lookup", ids: [id]});
      if (disposed || !button.isConnected || postId(button.closest(articleSelector)) !== id) return;
      const types = kinds?.[id] || [];
      const count = types.length;
      if (count <= 1) return download(button, id, 0);
      closePanel();
      panelOwner = button;
      button.setAttribute("aria-haspopup","menu"); button.setAttribute("aria-expanded","true");
      panel = document.createElement("div"); panel.className = "xfd-panel";
      panel.setAttribute("role", "menu"); panel.setAttribute("aria-label", t("chooseVideo"));
      menuTheme(button);
      for (let i = 0; i < count; i++) {
        const option = document.createElement("button"); option.type = "button";
        option.setAttribute("role","menuitem"); option.tabIndex = -1;
        const label = document.createElement("span");
        label.textContent = t(types[i] === "gif" ? "downloadGifNumber" : "downloadVideoNumber", String(i + 1));
        option.append(downloadIcon(),label);
        option.addEventListener("click", e => { e.stopPropagation(); download(button, id, i); });
        panel.append(option);
      }
      document.body.append(panel);
      const r = button.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(r.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - panel.offsetHeight - 8))}px`;
      panel.firstElementChild.focus();
    } catch { notify(t("reloadPage")); }
  }
  function syncColor(button, caret) {
    // X often sets the muted color on the SVG, not on its button wrapper.
    const icon = caret.querySelector("svg") || caret;
    const color = getComputedStyle(icon).color;
    if (button.style.color !== color) button.style.color = color;
    const size = parseFloat(getComputedStyle(icon).width);
    if (size > 0 && size <= 32) button.style.setProperty("--xfd-icon-size",`${size}px`);
  }
  function buttonPlacement(caret, article) {
    // Reserve horizontal space in the nearest native row. Do not change X's
    // flex direction or put an extra 32px-tall item into the header.
    let anchor = caret;
    while (anchor.parentElement && anchor.parentElement !== article) {
      const parent = anchor.parentElement, style = getComputedStyle(parent);
      if ((style.display === "flex" || style.display === "inline-flex") &&
          (style.flexDirection === "row" || style.flexDirection === "row-reverse")) {
        return {parent,anchor};
      }
      anchor = parent;
    }
    return null;
  }
  function removeButton(article) {
    for (const slot of article.querySelectorAll(".xfd-slot")) slot.remove();
    for (const button of article.querySelectorAll(".xfd-button")) button.remove();
  }
  function addButton(article, kinds) {
    const caret = article.querySelector('[data-testid="caret"]');
    if (!caret || !caret.parentElement) return;
    const placement = buttonPlacement(caret,article);
    if (!placement) { removeButton(article); return; }
    const existing = article.querySelector(".xfd-button");
    const label = t(kinds.length === 1 ? (kinds[0] === "gif" ? "downloadGif" : "downloadVideo") : "downloadMedia");
    const slot = existing?.closest(".xfd-slot");
    if (slot?.parentElement === placement.parent && slot.nextElementSibling === placement.anchor) {
      existing.title = label; existing.setAttribute("aria-label",label);
      syncColor(existing, caret);
      return;
    }
    removeButton(article);
    const button = document.createElement("button");
    button.className = "xfd-button"; button.type = "button";
    button.title = label; button.setAttribute("aria-label", label);
    syncColor(button, caret);
    button.append(downloadIcon());
    button.addEventListener("click", clicked);
    // The slot consumes width but has zero height. The clickable button is
    // centered inside it and cannot steal space from the name or timestamp.
    const newSlot = document.createElement("span");
    newSlot.className = "xfd-slot";
    newSlot.append(button);
    placement.parent.insertBefore(newSlot,placement.anchor);
  }
  async function scan() {
    if (disposed) return;
    scanning = true;
    try {
    const articles = [...document.querySelectorAll(articleSelector)];
    const entries = articles.map(article => [article, postId(article)]).filter(([, id]) => id);
    let counts = {};
    try {
      for (let i = 0; i < entries.length; i += 100) {
        Object.assign(counts, await browser.runtime.sendMessage({type: "xfd:lookup", ids: entries.slice(i, i + 100).map(([, id]) => id)}));
      }
    } catch { suspend(); return; }
    if (disposed) return;
    for (const [article, id] of entries) {
      if (!article.isConnected || postId(article) !== id) continue;
      if (counts[id]?.length || article.querySelector('video, [data-testid="videoPlayer"]')) addButton(article,counts[id] || []);
      else removeButton(article);
    }
    } finally {
      scanning = false;
      if (scanAgain && !disposed) { scanAgain = false; schedule(); }
    }
  }
  function schedule() {
    if (disposed) return;
    if (scanning) { scanAgain = true; return; }
    if (scanTimer === null) scanTimer = setTimeout(() => {
      scanTimer = null; scan().catch(() => {});
    },120);
  }
  const observer = new MutationObserver(schedule);
  browser.runtime.onMessage.addListener(message => {
    if (disposed) return;
    if (message.type === "xfd:updated") schedule();
    if (message.type === "xfd:converting") notify(t("gifConverting",String(message.percent)));
    if (message.type === "xfd:finished") notify(t(message.ok ? (message.kind === "gif" ? "gifSaved" : "videoSaved") : "downloadInterrupted"));
  });
  document.addEventListener("pointerdown", e => {
    if (panel && !panel.contains(e.target) && !panelOwner?.contains(e.target)) closePanel();
  }, true);
  document.addEventListener("keydown", e => {
    if (!panel) return;
    if (e.key === "Escape") { e.preventDefault(); closePanel(true); return; }
    if (e.key === "Tab") { closePanel(true); return; }
    if (!["ArrowDown","ArrowUp","Home","End"].includes(e.key) || !panel.contains(document.activeElement)) return;
    e.preventDefault();
    const items = [...panel.querySelectorAll('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
      : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  });
  document.addEventListener("scroll", e => { if (panel && !panel.contains(e.target)) closePanel(); }, true);
  window.addEventListener("resize", schedule, {passive: true});
  // X changes these attributes when switching themes. Update the sampled color.
  const themeObserver = new MutationObserver(schedule);
  function observeBodyTheme() {
    if (!disposed && document.body) themeObserver.observe(document.body, {attributes: true, attributeFilter: ["class", "style", "data-theme"]});
  }
  function suspend() {
    disposed = true; clearTimeout(scanTimer); scanTimer = null; scanAgain = false;
    clearTimeout(toastTimer); observer.disconnect(); themeObserver.disconnect(); closePanel();
    document.querySelector(".xfd-toast")?.remove();
  }
  function resume() {
    disposed = false;
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["href","data-testid"]});
    themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:["class","style","data-theme"]});
    observeBodyTheme(); schedule();
  }
  document.addEventListener("DOMContentLoaded",observeBodyTheme,{once:true});
  window.addEventListener("pagehide",suspend);
  window.addEventListener("pageshow",resume);
  resume();
})();
