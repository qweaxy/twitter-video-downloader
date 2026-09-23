"use strict";
(() => {
  const t = (key,args) => browser.i18n.getMessage(key,args);
  const $ = id => document.getElementById(id);
  document.documentElement.lang = browser.i18n.getUILanguage();
  document.title = `Twitter Video Downloader — ${t("settingsTitle")}`;
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-aria]")) node.setAttribute("aria-label",t(node.dataset.i18nAria));
  for (const option of document.querySelectorAll("#gifFps option")) option.textContent = t("fpsValue",option.value);
  const form = $("settings-form"), controls = $("controls"), status = $("status");
  const scale = $("gifScale"), range = $("scaleRange");
  const fields = Object.keys(XFDSettings.defaults);
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const gifPresets = {quality:[100,20,256],balanced:[50,15,128],compact:[25,10,64]};
  const namePresets = {classic:"X_{id}_{index}",author:"{author}_{id}_{index}",date:"{date}_{author}_{id}_{index}"};
  let nameInput = $("videoTemplate");
  function message(key,error=false) { status.textContent = t(key); status.dataset.error = String(error); }
  function tab(name,focus=false) {
    for (const button of tabs) {
      const selected = button.dataset.tab === name;
      button.setAttribute("aria-selected",String(selected)); button.tabIndex = selected ? 0 : -1;
      $(button.getAttribute("aria-controls")).hidden = !selected;
      if (selected && focus) button.focus();
    }
  }
  for (const button of tabs) {
    button.addEventListener("click",() => tab(button.dataset.tab));
    button.addEventListener("keydown",event => {
      const i = tabs.indexOf(button);
      const next = {ArrowRight:(i+1)%tabs.length,ArrowLeft:(i+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
      if (next !== undefined) { event.preventDefault(); tab(tabs[next].dataset.tab,true); }
    });
  }
  function read() {
    return Object.fromEntries(fields.map(key => [key,["gifScale","gifFps","gifColors"].includes(key) ? Number($(key).value) : $(key).value]));
  }
  function target(input) {
    nameInput = input;
    for (const id of ["videoTemplate","gifTemplate"]) $(id).dataset.active = String($(id) === input);
    $("tagTarget").textContent = t("tagTarget",t(input.id === "videoTemplate" ? "videoNameLabel" : "gifNameLabel"));
  }
  function preview() {
    const settings = read(), percent = settings.gifScale;
    if (scale.validity.valid) {
      range.value = String(percent);
      const size = XFDSettings.dimensions(1280,720,percent);
      $("scaleExample").textContent = t("scaleExample",[String(size.width),String(size.height),String(Math.round(percent * percent / 100))]);
    }
    for (const button of document.querySelectorAll("[data-scale]")) button.setAttribute("aria-pressed",String(Number(button.dataset.scale) === percent));
    for (const button of document.querySelectorAll("[data-video]")) button.setAttribute("aria-pressed",String(button.dataset.video === settings.videoQuality));
    for (const button of document.querySelectorAll("[data-gif]")) button.setAttribute("aria-pressed",String(gifPresets[button.dataset.gif].every((value,i) => value === [percent,settings.gifFps,settings.gifColors][i])));
    for (const button of document.querySelectorAll("[data-name]")) button.setAttribute("aria-pressed",String(settings.videoTemplate === namePresets[button.dataset.name] && settings.gifTemplate === namePresets[button.dataset.name]));
    const sample = {sourceId:"1900000000000000000",author:"alex",createdAt:"2026-09-20T12:00:00Z",text:t("samplePostText"),width:1280,height:720};
    const variants = [[1280,720,2000000],[854,480,1000000],[640,360,400000]].map(([width,height,bitrate]) => ({width,height,bitrate,url:`https://video.twimg.com/vid/${width}x${height}/example.mp4`}));
    const video = XFDMedia.selectVariant({...sample,type:"video",variants},settings.videoQuality);
    for (const kind of ["video","gif"]) {
      const error = XFDFilenames.templateError(settings[`${kind}Template`]);
      $(`${kind}Template`).setCustomValidity(error ? t(error) : "");
      $(`${kind}NamePreview`).textContent = error ? t("previewInvalid") : XFDFilenames.build(settings,kind === "video" ? video : {...sample,type:"gif"},sample.sourceId,0);
    }
  }
  function dirty() { preview(); message("settingsUnsaved"); }
  function render(settings) { for (const key of fields) $(key).value = String(settings[key]); preview(); }
  const tagLabels = {author:"tagAuthor",id:"tagId",date:"tagDate",download_date:"tagDownloadDate",text:"tagText",index:"tagIndex",type:"tagType",resolution:"tagResolution"};
  for (const tag of XFDFilenames.tags) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = `{${tag}}`; button.title = t(tagLabels[tag]);
    button.setAttribute("aria-label",`${button.textContent}: ${button.title}`);
    button.addEventListener("click",() => {
      const start = nameInput.selectionStart ?? nameInput.value.length, end = nameInput.selectionEnd ?? start;
      const value = `{${tag}}`;
      if (nameInput.value.length - (end-start) + value.length > nameInput.maxLength) { message("nameTemplateInvalid",true); return; }
      nameInput.setRangeText(value,start,end,"end"); nameInput.focus(); dirty();
    });
    $("tag-buttons").append(button);
    const term = document.createElement("dt"), description = document.createElement("dd");
    term.textContent = `{${tag}}`; description.textContent = t(tagLabels[tag]); $("tag-reference").append(term,description);
  }
  for (const id of ["videoTemplate","gifTemplate"]) $(id).addEventListener("focus",() => target($(id)));
  range.addEventListener("input",() => { scale.value = range.value; });
  form.addEventListener("input",dirty); form.addEventListener("change",dirty);
  for (const button of document.querySelectorAll("[data-scale]")) button.addEventListener("click",() => { scale.value = button.dataset.scale; dirty(); });
  for (const button of document.querySelectorAll("[data-video]")) button.addEventListener("click",() => { $("videoQuality").value = button.dataset.video; dirty(); });
  for (const button of document.querySelectorAll("[data-gif]")) button.addEventListener("click",() => {
    ["gifScale","gifFps","gifColors"].forEach((id,i) => { $(id).value = String(gifPresets[button.dataset.gif][i]); }); dirty();
  });
  for (const button of document.querySelectorAll("[data-name]")) button.addEventListener("click",() => {
    $("videoTemplate").value = $("gifTemplate").value = namePresets[button.dataset.name]; dirty();
  });
  form.noValidate = true;
  form.addEventListener("submit",async event => {
    event.preventDefault(); if (controls.disabled) return;
    preview();
    const invalid = fields.map($).find(input => !input.validity.valid);
    if (invalid) {
      tab(invalid.closest('[role="tabpanel"]').id.replace("panel-",""));
      const details = invalid.closest("details"); if (details) details.open = true;
      invalid.reportValidity(); return;
    }
    const value = read(); controls.disabled = true;
    try { render(await XFDSettings.save(value)); message("settingsSaved"); }
    catch { message("settingsSaveFailed",true); }
    finally { controls.disabled = false; }
  });
  $("reset").addEventListener("click",() => { render(XFDSettings.defaults); message("settingsResetPending"); });
  target(nameInput);
  XFDSettings.load().then(value => { render(value); controls.disabled = false; message("settingsReady"); }).catch(() => {
    render(XFDSettings.defaults); controls.disabled = false; message("settingsLoadFailed",true);
  });
})();
