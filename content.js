"use strict";
(() => {
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
      notify(reply?.ok ? "Скачивание началось — файл появится в загрузках Firefox." : reply?.error || "Не удалось получить видео.");
    } catch { notify("Расширение перезапущено. Обнови страницу X."); }
    finally { button.disabled = false; }
  }
  async function clicked(event) {
    event.preventDefault(); event.stopPropagation();
    if (!event.isTrusted) return;
    const button = event.currentTarget;
    const id = postId(button.closest(articleSelector));
    if (!id) return;
    try {
      const counts = await browser.runtime.sendMessage({type: "xfd:lookup", ids: [id]});
      const count = counts?.[id] || 0;
      if (count <= 1) return download(button, id, 0);
      closePanel();
      panelOwner = button;
      panel = document.createElement("div"); panel.className = "xfd-panel";
      panel.setAttribute("role", "group"); panel.setAttribute("aria-label", "Выбери видео");
      for (let i = 0; i < count; i++) {
        const option = document.createElement("button"); option.type = "button";
        option.textContent = `Скачать видео ${i + 1}`;
        option.addEventListener("click", e => { e.stopPropagation(); download(button, id, i); });
        panel.append(option);
      }
      document.body.append(panel);
      const r = button.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(r.right - 216, innerWidth - 232))}px`;
      panel.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - panel.offsetHeight - 8))}px`;
      panel.firstElementChild.focus();
    } catch { notify("Обнови страницу X и попробуй снова."); }
  }
  function addButton(article) {
    if (article.querySelector(".xfd-button")) return;
    const caret = article.querySelector('[data-testid="caret"]');
    if (!caret || !caret.parentElement) return;
    const button = document.createElement("button");
    button.className = "xfd-button"; button.type = "button";
    button.title = "Скачать видео"; button.setAttribute("aria-label", "Скачать видео");
    button.style.color = getComputedStyle(caret).color;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", "M12 3v12m-4.5-4.5L12 15l4.5-4.5M5 16.5V21h14v-4.5");
    path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.7"); path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round"); svg.append(path); button.append(svg);
    button.addEventListener("click", clicked);
    if (caret.parentElement.children.length === 1) caret.parentElement.classList.add("xfd-controls");
    caret.before(button);
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
      if (counts[id] || article.querySelector('video, [data-testid="videoPlayer"]')) addButton(article);
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
    if (message.type === "xfd:finished") notify(message.ok ? "Видео сохранено." : "Скачивание прервано. Проверь панель загрузок Firefox и попробуй ещё раз.");
  });
  document.addEventListener("pointerdown", e => {
    if (panel && !panel.contains(e.target) && !panelOwner?.contains(e.target)) closePanel();
  }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePanel(true); });
  document.addEventListener("scroll", () => { if (panel) closePanel(); }, true);
  schedule();
})();
