"use strict";
(() => {
  const t = (key,args) => browser.i18n.getMessage(key,args);
  document.documentElement.lang = browser.i18n.getUILanguage();
  document.title = `X Feed Download — ${t("settingsTitle")}`;
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-aria]")) node.setAttribute("aria-label",t(node.dataset.i18nAria));
  for (const option of document.querySelectorAll("#gifFps option")) option.textContent = t("fpsValue",option.value);
  const form = document.getElementById("settings-form"), controls = document.getElementById("controls");
  const scale = document.getElementById("gifScale"), range = document.getElementById("scaleRange");
  const status = document.getElementById("status");
  function message(key,error=false) { status.textContent = t(key); status.dataset.error = String(error); }
  function preview() {
    if (!scale.validity.valid) return;
    const percent = Number(scale.value);
    range.value = String(percent);
    const size = XFDSettings.dimensions(1280,720,percent);
    document.getElementById("scaleExample").textContent = t("scaleExample",[String(size.width),String(size.height),String(Math.round(percent * percent / 100))]);
    for (const button of document.querySelectorAll("[data-scale]")) button.setAttribute("aria-pressed",String(Number(button.dataset.scale) === percent));
  }
  function render(settings) {
    for (const [key,value] of Object.entries(settings)) document.getElementById(key).value = String(value);
    preview();
  }
  function read() {
    return {gifScale:Number(scale.value),gifFps:Number(document.getElementById("gifFps").value),
      gifColors:Number(document.getElementById("gifColors").value),saveLocation:document.getElementById("saveLocation").value};
  }
  form.addEventListener("input",() => { preview(); message("settingsUnsaved"); });
  form.addEventListener("change",() => { preview(); message("settingsUnsaved"); });
  range.addEventListener("input",() => { scale.value = range.value; preview(); });
  for (const button of document.querySelectorAll("[data-scale]")) button.addEventListener("click",() => {
    scale.value = button.dataset.scale; preview(); message("settingsUnsaved");
  });
  form.addEventListener("submit",async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const value = read(); controls.disabled = true;
    try { render(await XFDSettings.save(value)); message("settingsSaved"); }
    catch { message("settingsSaveFailed",true); }
    finally { controls.disabled = false; }
  });
  document.getElementById("reset").addEventListener("click",() => { render(XFDSettings.defaults); message("settingsResetPending"); });
  XFDSettings.load().then(value => { render(value); controls.disabled = false; }).catch(() => {
    render(XFDSettings.defaults); controls.disabled = false; message("settingsLoadFailed",true);
  });
})();
