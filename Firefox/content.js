"use strict";
(() => {
  const t = (key, substitutions) => browser.i18n.getMessage(key, substitutions);
  let scanTimer = null, scanning = false, scanAgain = false, disposed = false;
  let panel, panelOwner, toastTimer, advancedDialog;
  const videoRequests = new Map();
  const articleSelector = TVDPost.articleSelector;
  const postId = article => TVDPost.postId(article);
  let lookupFailures = 0, retryAfter = 0;
  async function lookup(article,id,recover = false) {
    let kinds = await browser.runtime.sendMessage({type:"xfd:lookup",ids:[id]});
    if (!kinds?.[id]?.length && recover && globalThis.TVDRecovery) {
      if (await TVDRecovery.remember(article,id)) kinds = await browser.runtime.sendMessage({type:"xfd:lookup",ids:[id]});
    }
    return kinds?.[id] || [];
  }
  function notify(text,action) {
    if (disposed || !document.body) return;
    document.querySelector(".xfd-toast")?.remove();
    clearTimeout(toastTimer);
    const toast = document.createElement("div");
    toast.className = "xfd-toast";
    toast.setAttribute("role", "status");
    toast.textContent = text;
    if (action) {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = t("downloadOriginal");
      button.addEventListener("click",event => { if (!event.isTrusted) return; toast.remove(); action(); });
      toast.append(button);
    }
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
  function menuTheme(button,target = panel) {
    let node = button.closest(articleSelector), background;
    while (node) {
      const color = getComputedStyle(node).backgroundColor;
      const channels = color.match(/[\d.]+/g)?.map(Number);
      if (channels && channels.length >= 3 && (channels.length < 4 || channels[3] > 0.9)) { background = {color,channels}; break; }
      node = node.parentElement;
    }
    const dark = background ? background.channels[0] * .2126 + background.channels[1] * .7152 + background.channels[2] * .0722 < 128
      : matchMedia("(prefers-color-scheme: dark)").matches;
    target.dataset.theme = dark ? "dark" : "light";
    target.style.setProperty("--xfd-menu-bg",background?.color || (dark ? "#000" : "#fff"));
    target.style.setProperty("--xfd-surface",background?.color || (dark ? "#000" : "#fff"));
  }
  async function download(button, id, index, format, profile = null, original = false) {
    closePanel();
    button.disabled = true;
    if (format === "mp4" && !original) {
      videoRequests.set(`${id}:${index}`,{button,id,index,profile});
      if (videoRequests.size > 100) videoRequests.delete(videoRequests.keys().next().value);
    }
    try {
      const reply = await browser.runtime.sendMessage({type: "xfd:download", id, index, format, profile, original});
      if (reply?.original) videoRequests.delete(`${id}:${index}`);
      notify(reply?.ok ? (reply.converting ? t(reply.kind === "video" ? "mp4Converting" : "gifConverting","0") : t("downloadStarted")) : reply?.error || t("videoFailed"),
        reply?.original ? () => download(button,id,index,"mp4",profile,true) : null);
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
  function formatMenu(button, id, types, index, allowVideoGif) {
    if (types[index] === "gif") { download(button,id,index,"gif"); return; }
    if (!allowVideoGif) { download(button,id,index,"mp4"); return; }
    const formats = ["mp4","gif"];
    const choices = formats.map(format => ({
      label:t(format === "mp4" ? "downloadAsMp4" : "downloadAsGif"),
      action:() => download(button,id,index,format)
    }));
    if (types.length > 1) choices.push({label:t("backToMedia"),back:true,action:() => mediaMenu(button,id,types,allowVideoGif)});
    showMenu(button,id,choices,t("chooseFormat"));
  }
  function mediaMenu(button, id, types, allowVideoGif) {
    if (types.length === 1) { formatMenu(button,id,types,0,allowVideoGif); return; }
    showMenu(button,id,types.map((type,index) => ({
      label:t(type === "gif" ? "downloadGifNumber" : "downloadVideoNumber",String(index+1)),
      submenu:type !== "gif" && allowVideoGif,action:() => formatMenu(button,id,types,index,allowVideoGif)
    })),t("chooseVideo"));
  }
  function showAdvanced(button,id,types,initial,originals = []) {
    advancedDialog?.xfdClose();
    const article = button.closest(articleSelector);
    if (disposed || !article?.isConnected || postId(article) !== id) return;
    const dialog = document.createElement("dialog"); dialog.className = "xfd-dialog";
    dialog.xfdOwner = article; dialog.xfdOwnerId = id; advancedDialog = dialog;
    const form = document.createElement("form"); form.noValidate = true;
    const header = document.createElement("div"); header.className = "xfd-dialog-header";
    const heading = document.createElement("h2"); heading.id = `xfd-title-${id}`; heading.textContent = t("advancedTitle");
    dialog.setAttribute("aria-labelledby",heading.id);
    const cross = document.createElement("button"); cross.type = "button"; cross.className = "xfd-dialog-close";
    cross.textContent = "×"; cross.setAttribute("aria-label",t("advancedClose")); cross.title = t("advancedClose");
    header.append(heading,cross); form.append(header);
    const reference = document.createElement("p"); reference.className = "xfd-source-reference"; form.append(reference);
    let profile = {...initial,videoPreset:"custom",gifPreset:"custom"}, codecAvailable = false, closed = false, themeFrame = null;
    let preferredFormat = initial.format;
    const changed = new Map();
    let revision = 0;
    function select(key,label,choices,value) {
      const wrap = document.createElement("label"); wrap.textContent = label;
      const input = document.createElement("select"); input.name = key;
      for (const [val,text] of choices) {
        const option = document.createElement("option"); option.value = String(val); option.textContent = text; input.append(option);
      }
      input.value = value == null ? "" : String(value); wrap.append(input); form.append(wrap); return input;
    }
    function number(key,label,value,min,max,step) {
      const wrap = document.createElement("label"); wrap.textContent = label;
      const input = document.createElement("input"); input.name = key; input.type = "number";
      input.min = String(min); input.max = String(max); input.step = String(step);
      input.placeholder = t("originalQuality"); input.value = value == null ? "" : String(value);
      wrap.append(input); form.append(wrap); return input;
    }
    function markReencoding(input) {
      const icon = document.createElement("span"); icon.className = "xfd-reencode-hint"; icon.tabIndex = 0;
      icon.title = t("videoReencodeHint"); icon.setAttribute("aria-label",icon.title); icon.setAttribute("role","img");
      const sync = () => { icon.hidden = input.value === ""; };
      input.addEventListener("input",sync); input.addEventListener("change",sync); sync();
      icon.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>"; input.before(icon); return sync;
    }
    const media = types.length > 1 ? select("media",t("chooseVideo"),types.map((type,i) => [i,t(type === "gif" ? "downloadGifNumber" : "downloadVideoNumber",String(i+1))]),0) : null;
    const format = document.createElement("input"); format.type = "hidden"; format.name = "format"; format.hidden = true; format.value = initial.format;
    const formatTabs = document.createElement("div"); formatTabs.className = "xfd-format-tabs";
    formatTabs.setAttribute("role","tablist"); formatTabs.setAttribute("aria-label",t("chooseFormat"));
    const formatButtons = ["mp4","gif"].map((value,index) => {
      const tab = document.createElement("button"); tab.type = "button"; tab.className = "xfd-format-tab";
      tab.dataset.format = value; tab.id = `xfd-format-${id}-${value}`;
      const number = document.createElement("span"); number.textContent = String(index+1).padStart(2,"0"); number.setAttribute("aria-hidden","true");
      const label = document.createElement("span"); label.textContent = value.toUpperCase(); tab.append(number,label);
      tab.setAttribute("role","tab"); tab.setAttribute("aria-controls",`xfd-format-panel-${id}-${value}`);
      tab.addEventListener("click",event => activateFormat(event,tab));
      tab.addEventListener("keydown",event => {
        const enabled = formatButtons.filter(button => !button.disabled), index = enabled.indexOf(tab);
        const next = {ArrowRight:(index+1)%enabled.length,ArrowLeft:(index+enabled.length-1)%enabled.length,Home:0,End:enabled.length-1}[event.key];
        if (next !== undefined) {
          event.preventDefault(); enabled[next].focus(); activateFormat(event,enabled[next]);
        }
      });
      formatTabs.append(tab); return tab;
    });
    function activateFormat(event,tab) {
      if (!event.isTrusted || closed || format.value === tab.dataset.format) return;
      format.value = tab.dataset.format; saveChanges(event,format);
    }
    form.append(format,formatTabs);
    const videoFields = document.createElement("div"), gifFields = document.createElement("div");
    for (const [panel,value] of [[videoFields,"mp4"],[gifFields,"gif"]]) {
      panel.id = `xfd-format-panel-${id}-${value}`; panel.setAttribute("role","tabpanel");
      panel.setAttribute("aria-labelledby",`xfd-format-${id}-${value}`);
    }
    const videoCustom = document.createElement("div"), gifCustom = document.createElement("div");
    videoCustom.className = "xfd-video-custom"; gifCustom.className = "xfd-gif-custom";
    const row = document.createElement("div"); row.className = "xfd-video-row";
    const quality = select("videoQuality",t("videoQualityLabel"),[["best",t("qualityBest")],["1080","1080p"],["720","720p"],["480","480p"],["360","360p"]],initial.videoQuality);
    const fps = select("videoFpsCap",t("videoFpsLabel"),[["",t("originalFrameRate")],...[60,30,15].map(n => [n,t("fpsValue",String(n))])],initial.videoFpsCap);
    const syncFpsHint = markReencoding(fps);
    row.append(quality.parentElement,fps.parentElement); videoCustom.append(row);
    const bitrate = number("videoBitrateCap",t("videoBitrateLabel"),initial.videoBitrateCap,.25,50,"any");
    const syncBitrateHint = markReencoding(bitrate);
    const slider = document.createElement("input"); slider.type = "range"; slider.min = "0"; slider.max = "50"; slider.step = "0.25";
    slider.name = "bitrateRange"; slider.setAttribute("aria-label",t("videoBitrateLabel"));
    const bitrateRow = document.createElement("div"); bitrateRow.className = "xfd-bitrate-row";
    const bitrateLabel = bitrate.parentElement; bitrateRow.append(slider,bitrate); bitrateLabel.append(bitrateRow); videoCustom.append(bitrateLabel);
    const bitrateHelp = document.createElement("p"); bitrateHelp.className = "xfd-dialog-note"; bitrateHelp.textContent = t("videoBitrateHelp"); videoCustom.append(bitrateHelp);
    const codecNote = document.createElement("p"); codecNote.className = "xfd-dialog-note"; codecNote.textContent = t("mp4CodecUnavailable");
    codecNote.hidden = true; videoCustom.append(codecNote);
    const scaleLabel = document.createElement("label"); scaleLabel.textContent = t("gifScaleLabel");
    const scale = document.createElement("input"); scale.type = "hidden"; scale.name = "gifScale"; scale.value = String(initial.gifScale); scale.hidden = true;
    const gifQualityRange = document.createElement("input"); gifQualityRange.type = "range"; gifQualityRange.name = "gifQualityRange";
    gifQualityRange.min = "10"; gifQualityRange.max = "100"; gifQualityRange.step = "1";
    gifQualityRange.setAttribute("aria-label",t("gifScaleLabel"));
    const gifQualityValue = document.createElement("output"); gifQualityValue.className = "xfd-gif-quality-value";
    const scaleRow = document.createElement("div"); scaleRow.className = "xfd-gif-quality-row";
    scaleRow.append(gifQualityRange,gifQualityValue); scaleLabel.append(scale,scaleRow); form.append(scaleLabel);
    const gifFps = select("gifFps",t("fpsLabel"),[["",t("originalFrameRate")],...[5,10,15,20,25,30].map(n => [n,t("fpsValue",String(n))])],initial.gifFps);
    const colors = select("gifColors",t("colorsLabel"),[64,128,256].map(n => [n,String(n)]),initial.gifColors);
    videoFields.append(videoCustom);
    gifCustom.append(scale.parentElement,gifFps.parentElement,colors.parentElement); gifFields.append(gifCustom); form.append(videoFields,gifFields);
    const status = document.createElement("p"); status.className = "xfd-field-error"; status.setAttribute("role","status"); status.hidden = true;
    form.append(status);
    const actions = document.createElement("div"); actions.className = "xfd-dialog-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = t("advancedCancel");
    const submit = document.createElement("button"); submit.type = "submit"; submit.className = "xfd-dialog-primary"; submit.textContent = t("advancedDownload");
    actions.append(cancel,submit); form.append(actions); dialog.append(form); document.body.append(dialog);
    const playing = [...article.querySelectorAll("video")].filter(video => !video.paused && !video.ended).map(video => ({video,src:video.currentSrc}));
    const stopPlayback = event => { if (event.target instanceof HTMLVideoElement) event.target.pause(); };
    const dialogThemeObserver = new MutationObserver(records => {
      if (records.every(record => record.target.closest?.(".xfd-dialog"))) return;
      if (themeFrame == null) themeFrame = requestAnimationFrame(() => { themeFrame = null; if (!closed) menuTheme(button,dialog); });
    });
    function close(resumePlayback = true) {
      if (closed) return;
      closed = true; dialogThemeObserver.disconnect();
      if (themeFrame != null) cancelAnimationFrame(themeFrame);
      article.removeEventListener("play",stopPlayback,true);
      if (dialog.open) dialog.close();
      dialog.remove(); if (advancedDialog === dialog) advancedDialog = null;
      if (resumePlayback && !disposed && article.isConnected && postId(article) === id) {
        for (const {video,src} of playing) if (video.isConnected && video.currentSrc === src && !video.ended) video.play().catch(() => {});
        if (button.isConnected) button.focus();
      }
    }
    dialog.xfdClose = close;
    cross.addEventListener("click",() => close()); cancel.addEventListener("click",() => close());
    dialog.addEventListener("cancel",event => { event.preventDefault(); close(); });
    dialog.addEventListener("close",() => close());
    let backdropDown = false;
    dialog.addEventListener("pointerdown",event => {
      const rect = dialog.getBoundingClientRect();
      backdropDown = event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    });
    dialog.addEventListener("click",event => { if (backdropDown && event.target === dialog) close(); backdropDown = false; });
    function syncBitrate() {
      if (!bitrate.validity.valid) return;
      const value = bitrate.value === "" ? null : Number(bitrate.value);
      slider.value = String(value ?? 0);
      slider.setAttribute("aria-valuetext",value == null ? t("originalQuality") : t("bitrateValue",String(value)));
    }
    function update() {
      const index = Number(media?.value || 0);
      format.value = preferredFormat;
      for (const tab of formatButtons) {
        const selected = tab.dataset.format === format.value;
        tab.setAttribute("aria-selected",String(selected)); tab.tabIndex = selected ? 0 : -1;
      }
      videoFields.hidden = format.value !== "mp4"; gifFields.hidden = format.value !== "gif";
      quality.disabled = format.value !== "mp4";
      bitrate.disabled = fps.disabled = slider.disabled = !codecAvailable || quality.disabled;
      scale.disabled = gifQualityRange.disabled = gifFps.disabled = colors.disabled = format.value !== "gif";
      gifQualityRange.value = scale.value;
      const gifQualityText = `${scale.value}%`;
      gifQualityValue.textContent = gifQualityText;
      gifQualityRange.setAttribute("aria-valuetext",gifQualityText);
      const original = originals[index] || {};
      const dimensions = [original.width,original.height].every(value => Number.isFinite(value) && value > 0) ? `${original.width} × ${original.height}` : null;
      const rate = Number.isFinite(original.bitrate) && original.bitrate > 0 ? t("bitrateValue",new Intl.NumberFormat(browser.i18n.getUILanguage(),{maximumFractionDigits:2}).format(original.bitrate / 1e6)) : null;
      const properties = [dimensions,rate].filter(Boolean);
      reference.hidden = !properties.length;
      reference.textContent = properties.length ? t("sourceReference",properties.join(" · ")) : "";
      syncBitrate(); syncFpsHint(); syncBitrateHint();
    }
    function validate(input) {
      const invalid = !input.validity.valid;
      input.setAttribute("aria-invalid",String(invalid));
      let error = form.querySelector(`[data-error-for="${input.name}"]`);
      if (invalid && !error) {
        error = document.createElement("span"); error.dataset.errorFor = input.name; error.className = "xfd-field-error";
        input.closest("label").append(error);
      }
      if (error) { error.textContent = invalid ? t(input.name === "videoBitrateCap" ? "bitrateInvalid" : "settingInvalid") : ""; error.hidden = !invalid; }
      return !invalid;
    }
    function saveChanges(event,input = event.target) {
      if (!event.isTrusted || closed) return;
      if (input === slider) { bitrate.value = Number(slider.value) === 0 ? "" : slider.value; syncBitrateHint(); input = bitrate; }
      if (input === gifQualityRange) { scale.value = input.value; input = scale; }
      if (input === media) { update(); input = format; }
      else if (input === format) { preferredFormat = format.value; update(); }
      const stringFields = ["format","videoQuality","gifQuality"];
      if (![...stringFields,"videoFpsCap","videoBitrateCap","gifScale","gifFps","gifColors"].includes(input.name) || !validate(input)) return;
      const value = stringFields.includes(input.name) ? input.value : input.value === "" ? null : Number(input.value);
      let patch = {[input.name]:value,...(input === scale ? {gifQuality:value === 100 ? "best" : "legacy"} : {}),...(input.name.startsWith("video") ? {videoPreset:"custom"} : input.name.startsWith("gif") ? {gifPreset:"custom"} : {})};
      patch = Object.fromEntries(Object.entries(patch).filter(([key,val]) => profile[key] !== val));
      if (!Object.keys(patch).length) return;
      const token = ++revision;
      Object.assign(profile,patch);
      for (const [key,val] of Object.entries(patch)) {
        changed.set(key,token);
        const control = form.elements.namedItem(key);
        if (control) control.value = val == null ? "" : String(val);
      }
      update(); status.hidden = true;
      browser.runtime.sendMessage({type:"xfd:update-profile",patch}).then(reply => {
        if (!reply?.ok) throw new Error("settingsSaveFailed");
      }).catch(() => { if (!closed && Object.keys(patch).some(key => changed.get(key) === token)) { status.textContent = t("settingsSaveFailed"); status.hidden = false; } });
    }
    form.addEventListener("input",saveChanges); form.addEventListener("change",saveChanges);
    form.addEventListener("submit",event => {
      event.preventDefault();
      if (!event.isTrusted) return;
      const invalid = [...form.querySelectorAll("input,select")].filter(input => !input.disabled && !validate(input));
      if (invalid.length) { invalid[0].focus(); return; }
      const index = Number(media?.value || 0), selectedFormat = format.value;
      const selectedProfile = {...profile,format:selectedFormat};
      close(); download(button,id,index,selectedFormat,selectedProfile,selectedFormat === "mp4" && !codecAvailable);
    });
    update(); menuTheme(button,dialog);
    try { dialog.showModal(); } catch (error) { close(false); throw error; }
    article.addEventListener("play",stopPlayback,true);
    for (const {video} of playing) video.pause();
    dialogThemeObserver.observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:["class","style","data-theme"]});
    Promise.resolve().then(async () => {
      try { codecAvailable = !!(await VideoEncoder.isConfigSupported({codec:"avc1.42001f",width:1280,height:720,bitrate:2000000,framerate:30})).supported; } catch {}
      if (closed) return;
      codecNote.hidden = codecAvailable; update();
    });
  }
  async function clicked(event) {
    event.preventDefault(); event.stopPropagation();
    if (!event.isTrusted) return;
    const button = event.currentTarget;
    if (panelOwner === button) { closePanel(true); return; }
    const id = postId(button.closest(articleSelector));
    if (!id) return;
    if (button.disabled) return;
    button.disabled = true;
    let types;
    try {
      types = await lookup(button.closest(articleSelector),id,true);
      if (!types.length) {
        for (const delay of [250,750]) {
          await new Promise(resolve => setTimeout(resolve,delay));
          if (disposed || !button.isConnected || postId(button.closest(articleSelector)) !== id) return;
          types = await lookup(button.closest(articleSelector),id,true);
          if (types.length) break;
        }
      }
      if (disposed || !button.isConnected || postId(button.closest(articleSelector)) !== id) return;
      if (!types.length) { notify(t("linkMissing")); return; }
    } catch { if (!disposed) notify(t("reloadPage")); return; }
    finally { button.disabled = false; }
    try {
      const {settings,profile,originals} = await browser.runtime.sendMessage({type:"xfd:preferences",id});
      if (disposed || !button.isConnected || postId(button.closest(articleSelector)) !== id) return;
      if (settings.advancedMode) showAdvanced(button,id,types,profile,originals);
      else mediaMenu(button,id,types,settings.allowVideoGif);
    } catch { notify(t("settingsLoadFailed")); }
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
    if (disposed || document.hidden) return;
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
    if (disposed || document.hidden) return;
    if (scanning) { scanAgain = true; return; }
    if (scanTimer === null) scanTimer = setTimeout(() => {
      scanTimer = null; scan().catch(() => {});
    },Math.max(120,retryAfter-Date.now()));
  }
  const relevantNodes = `${articleSelector}, video, [data-testid="videoPlayer"], [data-testid="caret"], [data-testid="User-Name"], time, a[href*="/status/"]`;
  const extensionNodes = ".xfd-slot, .xfd-button, .xfd-panel, .xfd-toast, .xfd-dialog";
  function pageChanged(records) {
    if (panelOwner && !panelOwner.isConnected) closePanel();
    if (advancedDialog && (!advancedDialog.xfdOwner.isConnected || postId(advancedDialog.xfdOwner) !== advancedDialog.xfdOwnerId)) advancedDialog.xfdClose(false);
    for (const record of records) {
      if (record.target.nodeType === 1 && record.target.closest(extensionNodes)) continue;
      if (record.type === "attributes") {
        if (record.attributeName === "data-testid" || record.target.matches("a")) { schedule(); return; }
      } else {
        for (const node of [...record.addedNodes,...record.removedNodes]) {
          if (node.nodeType === 1 && !node.matches(extensionNodes) &&
              (node.matches(relevantNodes) || node.querySelector(relevantNodes))) { schedule(); return; }
        }
      }
    }
  }
  const observer = new MutationObserver(pageChanged);
  document.addEventListener("visibilitychange",() => {
    if (document.hidden) { clearTimeout(scanTimer); scanTimer = null; }
    else schedule();
  });
  browser.runtime.onMessage.addListener(message => {
    if (disposed) return;
    if (message.type === "xfd:updated") { retryAfter = 0; schedule(); }
    if (message.type === "tvd:error") {
      const retry = message.original ? videoRequests.get(`${message.id}:${message.index}`) : null;
      if (retry) videoRequests.delete(`${message.id}:${message.index}`);
      notify(message.error || t("gifFailed"),retry
        ? () => download(retry.button,retry.id,retry.index,"mp4",retry.profile,true) : null);
    }
    if (message.type === "xfd:saving") notify(t("gifSaving"));
    if (message.type === "xfd:converting") notify(t(message.kind === "video" ? "mp4Converting" : "gifConverting",String(message.percent)));
    if (message.type === "xfd:finished") {
      if (message.kind === "video") videoRequests.delete(`${message.id}:${message.index}`);
      notify(t(message.ok ? (message.kind === "gif" ? "gifSaved" : "videoSaved") : (message.cancelled ? "saveCancelled" : "downloadInterrupted")));
    }
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
  window.addEventListener("popstate",schedule);
   
  const themeObserver = new MutationObserver(schedule);
  function observeBodyTheme() {
    if (!disposed && document.body) themeObserver.observe(document.body, {attributes: true, attributeFilter: ["class", "style", "data-theme"]});
  }
  function suspend() {
    disposed = true; clearTimeout(scanTimer); scanTimer = null; scanAgain = false;
    clearTimeout(toastTimer); observer.disconnect(); themeObserver.disconnect(); closePanel(); advancedDialog?.xfdClose(false);
    videoRequests.clear();
    document.querySelector(".xfd-toast")?.remove();
  }
  function resume() {
    disposed = false; retryAfter = 0;
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["href","data-testid"]});
    themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:["class","style","data-theme"]});
    observeBodyTheme(); schedule();
  }
  document.addEventListener("DOMContentLoaded",observeBodyTheme,{once:true});
  window.addEventListener("pagehide",suspend);
  window.addEventListener("pageshow",resume);
  resume();
})();
