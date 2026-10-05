"use strict";
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const t = key => api.i18n.getMessage(key);
  document.documentElement.lang = api.i18n.getUILanguage();
  document.title = `Twitter Video Downloader — ${t("welcomeTitle")}`;
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);

  const settings = document.getElementById("settings");
  const close = document.getElementById("close");
  const status = document.getElementById("status");
  let leaving = false;

  function leave(action) {
    if (leaving) return;
    leaving = true;
    settings.disabled = close.disabled = true;
    document.body.classList.add("leaving");
    const delay = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240;
    setTimeout(action,delay);
  }

  settings.addEventListener("click",() => leave(() => {
    location.replace(api.runtime.getURL("options.html"));
  }));
  close.addEventListener("click",() => leave(async () => {
    try {
      const tab = await api.tabs.getCurrent();
      if (tab?.id == null) throw new Error("No current tab");
      await api.tabs.remove(tab.id);
    } catch {
      leaving = false;
      settings.disabled = close.disabled = false;
      document.body.classList.remove("leaving");
      status.textContent = t("welcomeCloseFailed");
    }
  }));
})();
