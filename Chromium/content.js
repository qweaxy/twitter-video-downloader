"use strict";
(() => {
  const t = (key, substitutions) => browser.i18n.getMessage(key, substitutions);
  let scanTimer = null, scanning = false, scanAgain = false, disposed = false;
  let panel, panelOwner, toastTimer;
  const articleSelector = TVDPost.articleSelector;
  const postId = article => TVDPost.postId(article);
  let lookupFailures = 0, retryAfter = 0;
  async function lookup(article,id) {
    let kinds = await browser.runtime.sendMessage({type:"xfd:lookup",ids:[id]});
    if (!kinds?.[id]?.length && globalThis.TVDVisibleMedia) {
      if (await TVDVisibleMedia.remember(article,id)) kinds = await browser.runtime.sendMessage({type:"xfd:lookup",ids:[id]});
    }
    return kinds?.[id] || [];
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
  }
  async function download(button, id, index, format) {
    closePanel();
    button.disabled = true;
    try {
      const reply = await browser.runtime.sendMessage({type: "xfd:download", id, index, format});
      notify(reply?.ok ? (reply.converting ? t("gifConverting","0") : t("downloadStarted")) : reply?.error || t("videoFailed"));
    } catch { notify(t("extensionRestarted")); }
    finally { button.disabled = false; }
  }
  function showMenu(button, id, choices, title) {
    closePanel();
    if (disposed || !button.isConnected || postId(button.closest(articleSelector)) !== id) return;
    panelOwner = button;
    button.setAttribute("aria-haspopup","menu"); button.setAttribute("aria-expanded","true");
    panel = document.createElement("div"); panel.className = "xfd-panel";
    panel.setAttribute("role","menu"); panel.setAttribute("aria-label",title);
    menuTheme(button);
    for (const choice of choices) {
      const option = document.createElement("button"); option.type = "button";
      option.setAttribute("role","menuitem"); option.tabIndex = -1;
      if (choice.submenu) option.setAttribute("aria-haspopup","menu");
      const label = document.createElement("span"); label.textContent = choice.label;
      const icon = downloadIcon();
      if (choice.back) icon.firstElementChild.setAttribute("d","M7.414 13l5.293 5.293-1.414 1.414L3.586 12l7.707-7.707 1.414 1.414L7.414 11H21v2H7.414z");
      option.append(icon,label);
      option.addEventListener("click",event => {
        event.preventDefault(); event.stopPropagation();
        if (!event.isTrusted) return;
        if (!button.isConnected || postId(button.closest(articleSelector)) !== id) { closePanel(); return; }
        choice.action();
      });
      panel.append(option);
    }
    document.body.append(panel);
    const rect = button.getBoundingClientRect();
    panel.style.left = `${Math.max(8,Math.min(rect.right-panel.offsetWidth,innerWidth-panel.offsetWidth-8))}px`;
    panel.style.top = `${Math.max(8,Math.min(rect.bottom+6,innerHeight-panel.offsetHeight-8))}px`;
    panel.firstElementChild.focus();
  }
  function formatMenu(button, id, types, index) {
    if (types[index] === "gif") { download(button,id,index,"gif"); return; }
    const formats = ["mp4","gif"];
    const choices = formats.map(format => ({
      label:t(format === "mp4" ? "downloadAsMp4" : "downloadAsGif"),
      action:() => download(button,id,index,format)
    }));
    if (types.length > 1) choices.push({label:t("backToMedia"),back:true,action:() => mediaMenu(button,id,types)});
    showMenu(button,id,choices,t("chooseFormat"));
  }
  function mediaMenu(button, id, types) {
    if (types.length === 1) { formatMenu(button,id,types,0); return; }
    showMenu(button,id,types.map((type,index) => ({
      label:t(type === "gif" ? "downloadGifNumber" : "downloadVideoNumber",String(index+1)),
      submenu:type !== "gif",action:() => formatMenu(button,id,types,index)
    })),t("chooseVideo"));
  }
  async function clicked(event) {
    event.preventDefault(); event.stopPropagation();
    if (!event.isTrusted) return;
    const button = event.currentTarget;
    if (panelOwner === button) { closePanel(true); return; }
    const id = postId(button.closest(articleSelector));
    if (!id) return;
    try {
      const types = await lookup(button.closest(articleSelector),id);
      if (disposed || !button.isConnected || postId(button.closest(articleSelector)) !== id) return;
      if (!types.length) { notify(t("linkMissing")); return; }
      mediaMenu(button,id,types);
    } catch { notify(t("reloadPage")); }
  }
  function syncColor(button, caret) {
     
    const icon = caret.querySelector("svg") || caret;
    const color = getComputedStyle(icon).color;
    if (button.style.color !== color) button.style.color = color;
    const size = parseFloat(getComputedStyle(icon).width);
    if (size > 0 && size <= 32) button.style.setProperty("--xfd-icon-size",`${size}px`);
  }
  function buttonPlacement(caret, article) {
     
     
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
      const entries = articles.map(article => [article,postId(article)]).filter(([,id]) => id);
      for (const [article] of entries) {
        if (article.querySelector('video, [data-testid="videoPlayer"]') && !article.querySelector(".xfd-button")) addButton(article,[]);
      }
      const counts = {};
      try {
        for (let i=0;i<entries.length;i+=100) {
          const result = await browser.runtime.sendMessage({type:"xfd:lookup",ids:entries.slice(i,i+100).map(([,id]) => id)});
          if (!result || result.ok === false) throw new Error("lookupFailed");
          Object.assign(counts,result);
        }
        if (globalThis.TVDVisibleMedia) {
          for (const [article,id] of entries) {
            if (disposed) return;
            if (!counts[id]?.length && await TVDVisibleMedia.remember(article,id)) counts[id] = await lookup(article,id);
          }
        }
        lookupFailures = 0; retryAfter = 0;
      } catch {
        lookupFailures++;
        retryAfter = Date.now()+Math.min(30000,500*2**Math.min(lookupFailures-1,6));
        scanAgain = true;
      }
      if (disposed) return;
      for (const [article,id] of entries) {
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
    },Math.max(120,retryAfter-Date.now()));
  }
  const observer = new MutationObserver(schedule);
  browser.runtime.onMessage.addListener(message => {
    if (disposed) return;
    if (message.type === "xfd:updated") { retryAfter = 0; schedule(); }
    if (message.type === "tvd:error") notify(message.error || t("gifFailed"));
    if (message.type === "xfd:saving") notify(t("gifSaving"));
    if (message.type === "xfd:converting") notify(t("gifConverting",String(message.percent)));
    if (message.type === "xfd:finished") notify(t(message.ok ? (message.kind === "gif" ? "gifSaved" : "videoSaved") : (message.cancelled ? "saveCancelled" : "downloadInterrupted")));
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
  document.addEventListener("loadedmetadata",schedule,true);
  document.addEventListener("loadeddata",schedule,true);
  window.addEventListener("popstate",schedule);
   
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
    disposed = false; retryAfter = 0;
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["href","src","poster","data-testid"]});
    themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:["class","style","data-theme"]});
    observeBodyTheme(); schedule();
  }
  document.addEventListener("DOMContentLoaded",observeBodyTheme,{once:true});
  window.addEventListener("pagehide",suspend);
  window.addEventListener("pageshow",resume);
  resume();
})();
