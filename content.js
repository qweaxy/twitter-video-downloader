"use strict";
(() => {
  const t = (key, substitutions) => browser.i18n.getMessage(key, substitutions);
  let scheduled = false, panel, panelOwner, toastTimer;
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
    if (restore) panelOwner?.focus();
    panelOwner = null;
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
    const id = postId(button.closest(articleSelector));
    if (!id) return;
    try {
      const kinds = await browser.runtime.sendMessage({type: "xfd:lookup", ids: [id]});
      const types = kinds?.[id] || [];
      const count = types.length;
      if (count <= 1) return download(button, id, 0);
      closePanel();
      panelOwner = button;
      panel = document.createElement("div"); panel.className = "xfd-panel";
      panel.setAttribute("role", "group"); panel.setAttribute("aria-label", t("chooseVideo"));
      for (let i = 0; i < count; i++) {
        const option = document.createElement("button"); option.type = "button";
        option.textContent = t(types[i] === "gif" ? "downloadGifNumber" : "downloadVideoNumber", String(i + 1));
        option.addEventListener("click", e => { e.stopPropagation(); download(button, id, i); });
        panel.append(option);
      }
      document.body.append(panel);
      const r = button.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(r.right - 216, innerWidth - 232))}px`;
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
  function placeButton(button, caret) {
    const parent = caret.parentElement;
    const p = parent.getBoundingClientRect(), c = caret.getBoundingClientRect();
    // Anchor to the actual control, even when its parent spans the whole header.
    const left = c.left - p.left - parent.clientLeft + parent.scrollLeft - 36;
    const top = c.top - p.top - parent.clientTop + parent.scrollTop + c.height / 2;
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
  }
  function addButton(article, kinds) {
    const caret = article.querySelector('[data-testid="caret"]');
    if (!caret || !caret.parentElement) return;
    const existing = article.querySelector(".xfd-button");
    const label = t(kinds.length === 1 ? (kinds[0] === "gif" ? "downloadGif" : "downloadVideo") : "downloadMedia");
    if (existing?.parentElement === caret.parentElement) {
      existing.title = label; existing.setAttribute("aria-label",label);
      syncColor(existing, caret);
      placeButton(existing, caret);
      return;
    }
    existing?.remove();
    const button = document.createElement("button");
    button.className = "xfd-button"; button.type = "button";
    button.title = label; button.setAttribute("aria-label", label);
    syncColor(button, caret);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    // Filled 2-unit geometry on a 24-unit grid, matching X's icon weight.
    path.setAttribute("d", "M11 3h2v10.586l4.293-4.293 1.414 1.414L12 17.414l-6.707-6.707 1.414-1.414L11 13.586V3z M4 16h2v3.5c0 .276.224.5.5.5h11a.5.5 0 0 0 .5-.5V16h2v3.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5V16z");
    path.setAttribute("fill", "currentColor");
    svg.append(path); button.append(svg);
    button.addEventListener("click", clicked);
    // Out of normal flow: do not grow the header or move the text/video below it.
    // Only static parents need a positioning context; keep X's existing layout.
    if (getComputedStyle(caret.parentElement).position === "static") caret.parentElement.classList.add("xfd-anchor");
    caret.before(button);
    placeButton(button, caret);
  }
  async function scan() {
    scheduled = false;
    const articles = [...document.querySelectorAll(articleSelector)];
    const entries = articles.map(article => [article, postId(article)]).filter(([, id]) => id);
    let counts = {};
    try {
      for (let i = 0; i < entries.length; i += 100) {
        Object.assign(counts, await browser.runtime.sendMessage({type: "xfd:lookup", ids: entries.slice(i, i + 100).map(([, id]) => id)}));
      }
    } catch { return; }
    for (const [article, id] of entries) {
      if (!article.isConnected || postId(article) !== id) continue;
      if (counts[id]?.length || article.querySelector('video, [data-testid="videoPlayer"]')) addButton(article,counts[id] || []);
      else article.querySelector(".xfd-button")?.remove();
    }
  }
  function schedule() {
    if (!scheduled) { scheduled = true; setTimeout(scan, 120); }
  }
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["href", "data-testid"]
  });
  browser.runtime.onMessage.addListener(message => {
    if (message.type === "xfd:updated") schedule();
    if (message.type === "xfd:converting") notify(t("gifConverting",String(message.percent)));
    if (message.type === "xfd:finished") notify(t(message.ok ? (message.kind === "gif" ? "gifSaved" : "videoSaved") : "downloadInterrupted"));
  });
  document.addEventListener("pointerdown", e => {
    if (panel && !panel.contains(e.target) && !panelOwner?.contains(e.target)) closePanel();
  }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePanel(true); });
  document.addEventListener("scroll", () => { if (panel) closePanel(); }, true);
  window.addEventListener("resize", schedule, {passive: true});
  // X changes these attributes when switching themes. Update the sampled color.
  const themeObserver = new MutationObserver(schedule);
  themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["class", "style", "data-theme"]});
  function observeBodyTheme() {
    if (document.body) themeObserver.observe(document.body, {attributes: true, attributeFilter: ["class", "style", "data-theme"]});
  }
  if (document.body) observeBodyTheme();
  else document.addEventListener("DOMContentLoaded", observeBodyTheme, {once: true});
  schedule();
})();
