"use strict";
(() => {
  const t = (key,args) => browser.i18n.getMessage(key,args);
  const $ = id => document.getElementById(id);
  document.documentElement.lang = browser.i18n.getUILanguage();
  document.title = `Twitter Video Downloader — ${t("settingsTitle")}`;
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-aria]")) node.setAttribute("aria-label",t(node.dataset.i18nAria));
  for (const node of document.querySelectorAll("[data-i18n-title]")) {
    node.title = t(node.dataset.i18nTitle); node.setAttribute("aria-label",node.title);
  }
  for (const option of document.querySelectorAll("#gifFps option, #videoFpsCap option")) option.textContent = option.value === "" ? t("originalFrameRate") : t("fpsValue",option.value);
  const form = $("settings-form"), controls = $("controls"), status = $("status");
  const bitrateRange = $("bitrateRange"), gifQualityRange = $("gifQualityRange");
  const fields = Object.keys(XFDSettings.defaults), tabs = [...document.querySelectorAll("[data-tab]")];
  const namePresets = {classic:"X_{id}_{index}",author:"{author}_{id}_{index}",date:"{date}_{author}_{id}_{index}"};
  const pending = new Map();
  let known = {}, revision = 0, syncRevision = 0, nameInput = $("videoTemplate"), warningTimer = null;
  function showWarning(enabled) {
    clearTimeout(warningTimer); warningTimer = null; $("advancedWarning").hidden = true;
    if (enabled) {
      $("advancedWarning").hidden = false;
      warningTimer = setTimeout(() => { $("advancedWarning").hidden = true; warningTimer = null; },30000);
    }
  }
  function message(key,error=false) { status.textContent = key ? t(key) : ""; status.dataset.error = String(error); status.hidden = !key; }
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
    return Object.fromEntries(fields.map(key => [key,
      key === "videoQuality" && $("videoPreset").value !== "custom" ? XFDSettings.videoPresets[$("videoPreset").value] :
      ["allowVideoGif","advancedMode"].includes(key) ? $(key).checked :
      ["videoBitrateCap","videoFpsCap","gifScale","gifFps","gifColors"].includes(key)
        ? ($(key).value === "" ? null : Number($(key).value)) : $(key).value]));
  }
  function target(input) {
    nameInput = input;
    for (const id of ["videoTemplate","gifTemplate"]) $(id).dataset.active = String($(id) === input);
    $("tagTarget").textContent = t("tagTarget",t(input.id === "videoTemplate" ? "videoNameLabel" : "gifNameLabel"));
  }
  function preview() {
    const settings = {...known,...read()};
    $("allowVideoGif").closest("label").hidden = settings.advancedMode;
    if (!settings.advancedMode) showWarning(false);
    $("videoCustom").hidden = settings.videoPreset !== "custom";
    $("gifCustom").hidden = settings.gifPreset !== "custom";
    gifQualityRange.value = String(settings.gifScale);
    const gifQualityText = `${settings.gifScale}%`;
    $("gifQualityValue").textContent = gifQualityText;
    gifQualityRange.setAttribute("aria-valuetext",gifQualityText);
    for (const id of ["videoFpsCap","videoBitrateCap"]) document.querySelector('label[for="'+id+'"] .reencode-hint').hidden = $(id).value === "";
    if ($("videoBitrateCap").validity.valid) {
      bitrateRange.value = String(settings.videoBitrateCap ?? 0);
      bitrateRange.setAttribute("aria-valuetext",settings.videoBitrateCap == null ? t("originalQuality") : t("bitrateValue",String(settings.videoBitrateCap)));
    }
    for (const kind of ["video","gif"]) for (const button of document.querySelectorAll("[data-"+kind+"]")) button.setAttribute("aria-pressed",String(button.dataset[kind] === settings[kind+"Preset"]));
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
  function validate(key) {
    const input = $(key), invalid = !input.validity.valid;
    input.setAttribute("aria-invalid",String(invalid));
    let error = $(`${key}-error`);
    if (invalid && !error) {
      error = document.createElement("p"); error.id = `${key}-error`; error.className = "field-error";
      input.closest(".field")?.append(error);
      input.setAttribute("aria-describedby",`${input.getAttribute("aria-describedby") || ""} ${error.id}`.trim());
    }
    if (error) { error.textContent = invalid ? (key === "videoBitrateCap" ? t("bitrateInvalid") : ["videoTemplate","gifTemplate"].includes(key) ? t(XFDFilenames.templateError(input.value) || "nameTemplateInvalid") : t("settingInvalid")) : ""; error.hidden = !invalid; }
    return !invalid;
  }
  async function apply(patch) {
    const token = ++revision, before = {...known};
    if (Object.hasOwn(patch,"advancedMode")) showWarning(patch.advancedMode);
    for (const key of Object.keys(patch)) { known[key] = patch[key]; pending.set(key,token); }
    try {
      await XFDSettings.update(patch);
      if (token === revision) message("");
    } catch {
      for (const key of Object.keys(patch)) if (pending.get(key) === token) known[key] = before[key];
      if (pending.get("advancedMode") === token && !known.advancedMode) showWarning(false);
      message("settingsSaveFailed",true);
    } finally {
      for (const key of Object.keys(patch)) if (pending.get(key) === token) pending.delete(key);
    }
  }
  function dirty(event,keys) {
    if (controls.disabled) return;
    const input = event?.target, key = input === gifQualityRange ? "gifScale" : input?.id;
    if (input === gifQualityRange) {
      $("gifScale").value = input.value;
      $("gifQuality").value = Number(input.value) === 100 ? "best" : "legacy";
      keys = ["gifScale","gifQuality"];
    }
    preview();
    keys ||= key === "bitrateRange" ? ["videoBitrateCap"] : fields.includes(key) ? [key] : [];
    const values = read(), patch = {};
    for (const field of keys) if (validate(field) && values[field] !== known[field]) patch[field] = values[field];
    const kind = ["videoQuality","videoFpsCap","videoBitrateCap"].includes(key) ? "video" : ["gifScale","gifQuality","gifFps","gifColors"].includes(key) ? "gif" : null;
    if (kind && Object.keys(patch).length && XFDSettings.isOriginal(values,kind)) {
      const relevant = kind === "video" ? ["videoQuality","videoFpsCap","videoBitrateCap"] : ["gifScale","gifQuality","gifFps","gifColors"];
      if (relevant.every(field => validate(field))) {
        $(kind+"Preset").value = "quality"; patch[kind+"Preset"] = "quality";
        if (kind === "gif") patch.gifScale = 100;
        preview();
      }
    }
    if (Object.keys(patch).length) void apply(patch);
  }
  function render(settings,partial=false) {
    for (const key of fields) {
      if (partial && (pending.has(key) || (document.hasFocus() && document.activeElement === $(key)) || !$(key).validity.valid)) continue;
      known[key] = settings[key];
      if (["allowVideoGif","advancedMode"].includes(key)) $(key).checked = settings[key];
      else $(key).value = key === "videoQuality" && settings[key] === "smallest" ? "best" : settings[key] == null ? "" : String(settings[key]);
      validate(key);
    }
    preview();
  }
  async function checkCodec() {
    let available = false;
    try { available = !!(await VideoEncoder.isConfigSupported({codec:"avc1.42001f",width:1280,height:720,bitrate:2000000,framerate:30})).supported; } catch {}
    $("videoBitrateCap").disabled = $("videoFpsCap").disabled = bitrateRange.disabled = !available;
    $("mp4CodecNote").hidden = available;
    if (!available) $("mp4CodecNote").textContent = t("mp4CodecUnavailable");
    $("videoBitrateCap").placeholder = t("originalQuality");
  }
  const tagLabels = {author:"tagAuthor",id:"tagId",date:"tagDate",download_date:"tagDownloadDate",text:"tagText",index:"tagIndex",type:"tagType",resolution:"tagResolution"};
  for (const tag of XFDFilenames.tags) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = `{${tag}}`; button.title = t(tagLabels[tag]);
    button.setAttribute("aria-label",`${button.textContent}: ${button.title}`);
    button.addEventListener("click",() => {
      const start = nameInput.selectionStart ?? nameInput.value.length, end = nameInput.selectionEnd ?? start, value = `{${tag}}`;
      if (nameInput.value.length - (end-start) + value.length > nameInput.maxLength) { message("nameTemplateInvalid",true); return; }
      nameInput.setRangeText(value,start,end,"end"); nameInput.focus(); dirty(null,[nameInput.id]);
    });
    $("tag-buttons").append(button);
    const term = document.createElement("dt"), description = document.createElement("dd");
    term.textContent = `{${tag}}`; description.textContent = t(tagLabels[tag]); $("tag-reference").append(term,description);
  }
  for (const id of ["videoTemplate","gifTemplate"]) $(id).addEventListener("focus",() => target($(id)));
  bitrateRange.addEventListener("input",() => { $("videoBitrateCap").value = Number(bitrateRange.value) === 0 ? "" : bitrateRange.value; });
  form.addEventListener("input",dirty); form.addEventListener("change",dirty);
  function choosePreset(kind,preset) {
    const patch = XFDSettings.presetPatch(kind,preset);
    if (kind === "video" && preset === "custom" && known.videoQuality === "smallest") patch.videoQuality = "best";
    for (const [key,value] of Object.entries(patch)) if ($(key)) $(key).value = value == null ? "" : String(value);
    dirty(null,Object.keys(patch).filter(key => fields.includes(key)));
  }
  for (const kind of ["video","gif"]) for (const button of document.querySelectorAll("[data-"+kind+"]")) button.addEventListener("click",() => choosePreset(kind,button.dataset[kind]));
  function route() {
    const name = location.hash.slice(1), kind = name.split("-")[0];
    if (["video","gif","files"].includes(kind)) tab(kind);
    if (["video-custom","gif-custom"].includes(name) && !controls.disabled) choosePreset(kind,"custom");
  }
  window.addEventListener("hashchange",route);
  for (const button of document.querySelectorAll("[data-name]")) button.addEventListener("click",() => {
    $("videoTemplate").value = $("gifTemplate").value = namePresets[button.dataset.name]; dirty(null,["videoTemplate","gifTemplate"]);
  });
  form.noValidate = true; form.addEventListener("submit",event => event.preventDefault());
  browser.storage.onChanged.addListener((changes,area) => {
    if (area !== "local" || !["settings","allowVideoGif","advancedMode"].some(key => changes[key])) return;
    const token = ++syncRevision;
    XFDSettings.load().then(value => { if (token === syncRevision) render(value,true); }).catch(() => message("settingsLoadFailed",true));
  });
  target(nameInput); route();
  XFDSettings.load().then(async value => { render(value); await checkCodec(); controls.disabled = false; route(); message("settingsAutoApply"); }).catch(async () => {
    render(XFDSettings.defaults); await checkCodec(); controls.disabled = false; route(); message("settingsLoadDefaults",true);
  });
})();
