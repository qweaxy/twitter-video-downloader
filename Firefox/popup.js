"use strict";
(() => {
  const t = key => browser.i18n.getMessage(key), $ = id => document.getElementById(id);
  document.documentElement.lang = browser.i18n.getUILanguage();
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-aria]")) node.setAttribute("aria-label",t(node.dataset.i18nAria));
  $("openSettings").title = t("settingsTitle");
  const pending = new Map();
  let settings, sync = 0, revision = 0, warningTimer = null;
  function showWarning(enabled) {
    clearTimeout(warningTimer); warningTimer = null; $("advancedWarning").hidden = true;
    if (enabled) {
      $("advancedWarning").hidden = false;
      warningTimer = setTimeout(() => { $("advancedWarning").hidden = true; warningTimer = null; },30000);
    }
  }
  function error(key) { $("status").textContent = t(key); $("status").hidden = false; }
  function render() {
    const view = {...settings,...Object.fromEntries([...pending].map(([key,entry]) => [key,entry.value]))};
    for (const key of ["allowVideoGif","advancedMode"]) { $(key).checked = view[key]; $(key).disabled = false; }
    $("presets").hidden = view.advancedMode;
    $("allowVideoGif").closest("label").hidden = view.advancedMode;
    if (!view.advancedMode) showWarning(false);
    for (const kind of ["video","gif"]) {
      for (const button of document.querySelectorAll("[data-"+kind+"]")) button.setAttribute("aria-pressed",String(view[kind+"Preset"] === button.dataset[kind]));
      document.querySelector("[data-custom="+kind+"]").setAttribute("aria-pressed",String(view[kind+"Preset"] === "custom"));
    }
  }
  async function apply(patch) {
    const token = ++revision;
    if (Object.hasOwn(patch,"advancedMode")) showWarning(patch.advancedMode);
    for (const [key,value] of Object.entries(patch)) pending.set(key,{token,value});
    render(); $("status").hidden = true;
    try { await XFDSettings.update(patch); settings = {...settings,...patch}; }
    catch { error("settingsSaveFailed"); }
    finally {
      for (const key of Object.keys(patch)) if (pending.get(key)?.token === token) pending.delete(key);
      render();
    }
  }
  for (const key of ["allowVideoGif","advancedMode"]) $(key).addEventListener("change",() => { void apply({[key]:$(key).checked}); });
  for (const kind of ["video","gif"]) {
    for (const button of document.querySelectorAll("[data-"+kind+"]")) button.addEventListener("click",() => {
      if ($("advancedMode").checked) return;
      void apply(XFDSettings.presetPatch(kind,button.dataset[kind]));
    });
    const custom = document.querySelector("[data-custom="+kind+"]"); custom.title = t("customQualityOpen");
    custom.addEventListener("click",async () => {
      try { await browser.tabs.create({url:browser.runtime.getURL("options.html")+"#"+kind+"-custom"}); }
      catch { error("settingsOpenFailed"); }
    });
  }
  browser.storage.onChanged.addListener((changes,area) => {
    if (area !== "local" || !["settings","allowVideoGif","advancedMode"].some(key => changes[key])) return;
    const token = ++sync;
    XFDSettings.load().then(value => { if (token === sync) { settings = value; render(); } }).catch(() => error("settingsLoadFailed"));
  });
  $("openSettings").addEventListener("click",() => browser.runtime.openOptionsPage().catch(() => error("settingsOpenFailed")));
  XFDSettings.load().then(value => { settings = value; render(); }).catch(() => error("settingsLoadFailed"));
})();
