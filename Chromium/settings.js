"use strict";
(() => {
  const defaults = Object.freeze({videoPreset:"quality",gifPreset:"quality",gifQuality:"best",gifScale:100,gifFps:null,gifColors:256,saveLocation:"browser",
    videoQuality:"best",videoBitrateCap:null,videoFpsCap:null,allowVideoGif:true,advancedMode:false,
    videoTemplate:"X_{id}_{index}",gifTemplate:"X_{id}_{index}",downloadFolder:""});
  function normalize(input) {
    const value = input && typeof input === "object" ? input : {};
    const number = (key,min,max) => typeof value[key] === "number" && Number.isFinite(value[key])
      ? Math.max(min,Math.min(max,Math.round(value[key]))) : defaults[key];
    // Restore percentage sizing; keep older percentage settings intact.
    const oldResolutionPreset = ["1080","720","480","360"].includes(value.gifQuality) && number("gifScale",10,100) === 100 && ["balanced","compact"].includes(value.gifPreset);
    const gifScale = oldResolutionPreset ? gifPresets[value.gifPreset][0] : number("gifScale",10,100);
    const gifQuality = gifScale === 100 ? "best" : "legacy";
    const originalVideo = value.videoPreset === "quality" && (value.videoQuality || "best") === "best" && value.videoBitrateCap == null;
    const videoFpsCap = originalVideo || value.videoFpsCap == null ? null : typeof value.videoFpsCap === "number" && Number.isFinite(value.videoFpsCap) ? ([60,30,15].find(fps => fps <= value.videoFpsCap) || 15) : null;
    const originalGif = value.gifPreset === "quality" && gifQuality === "best" && (value.gifColors ?? 256) === 256;
    const gifFps = originalGif || value.gifFps == null ? null : [5,10,15,20,25,30].includes(value.gifFps) ? value.gifFps : defaults.gifFps;
    const videoPreset = value.videoBitrateCap != null ? "custom" : Object.keys(videoPresets).find(key => videoPresets[key] === (value.videoQuality || "best") && videoFpsCap === (key === "quality" ? null : 60)) || "custom";
    const gifPreset = Object.keys(gifPresets).find(key => gifPresets[key].every((v,i) => v === [gifScale,gifFps,value.gifColors ?? 256][i])) || "custom";
    return {
      videoPreset:value.videoPreset === "custom" ? "custom" : videoPreset,
      gifPreset:value.gifPreset === "custom" ? "custom" : gifPreset,
      gifQuality,
      gifScale,
      gifFps,
      gifColors:[64,128,256].includes(value.gifColors) ? value.gifColors : defaults.gifColors,
      saveLocation:["browser","ask","downloads"].includes(value.saveLocation) ? value.saveLocation : defaults.saveLocation,
      videoQuality:value.videoPreset === "custom" && value.videoQuality === "smallest" ? "best" : ["best","1080","720","480","360","smallest"].includes(value.videoQuality) ? value.videoQuality : defaults.videoQuality,
      videoBitrateCap:typeof value.videoBitrateCap === "number" && Number.isFinite(value.videoBitrateCap) && value.videoBitrateCap >= .25 && value.videoBitrateCap <= 50 ? value.videoBitrateCap : null,
      videoFpsCap,
      allowVideoGif:typeof value.allowVideoGif === "boolean" ? value.allowVideoGif : defaults.allowVideoGif,
      advancedMode:typeof value.advancedMode === "boolean" ? value.advancedMode : defaults.advancedMode,
      videoTemplate:XFDFilenames.templateError(value.videoTemplate) ? defaults.videoTemplate : value.videoTemplate.trim(),
      gifTemplate:XFDFilenames.templateError(value.gifTemplate) ? defaults.gifTemplate : value.gifTemplate.trim(),
      downloadFolder:typeof value.downloadFolder === "string" ? XFDFilenames.clean(value.downloadFolder,"",80) : ""
    };
  }
  async function load() {
    const data = await browser.storage.local.get(["settings","allowVideoGif","advancedMode"]);
    return normalize({...data.settings,allowVideoGif:data.allowVideoGif,advancedMode:data.advancedMode});
  }
  async function save(settings) {
    const value = normalize(settings);
    const {allowVideoGif,advancedMode,...preferences} = value;
    await browser.storage.local.set({settings:preferences,allowVideoGif,advancedMode});
    return value;
  }
  async function setMode(key,enabled) {
    if (!["allowVideoGif","advancedMode"].includes(key) || typeof enabled !== "boolean") throw new TypeError("Invalid mode");
    await browser.storage.local.set({[key]:enabled});
  }
  function normalizeProfile(input,settings = defaults) {
    const videoQuality = input?.videoQuality ?? settings.videoQuality;
    const value = normalize({...settings,...input,videoQuality:videoQuality === "smallest" ? "best" : videoQuality,...(input ? {videoPreset:input.videoPreset,gifPreset:input.gifPreset,...(Object.hasOwn(input,"gifScale") && !Object.hasOwn(input,"gifQuality") ? {gifQuality:undefined} : {})} : {})});
    return {format:input?.format === "gif" ? "gif" : "mp4",videoQuality:value.videoQuality,
      videoPreset:value.videoPreset,gifPreset:value.gifPreset,gifQuality:value.gifQuality,
      videoBitrateCap:value.videoBitrateCap,videoFpsCap:value.videoFpsCap,
      gifScale:value.gifScale,gifFps:value.gifFps,gifColors:value.gifColors};
  }
  async function loadProfile(settings) {
    const data = await browser.storage.local.get("advancedProfile");
    return normalizeProfile(data.advancedProfile,settings || await load());
  }
  async function saveProfile(profile) {
    const value = normalizeProfile(profile);
    await browser.storage.local.set({advancedProfile:value});
    return value;
  }
  function dimensions(width,height,scale) {
    const percent = normalize({gifScale:scale}).gifScale;
    return {width:Math.max(1,Math.round(width * percent / 100)),height:Math.max(1,Math.round(height * percent / 100))};
  }
  function sourceFramePlan(duration,timestamps) {
    if (!Number.isFinite(duration) || duration <= 0) throw new TypeError("Invalid duration");
    const times = [...new Set([0,...timestamps.filter(time => Number.isFinite(time) && time >= 0 && time < duration)])].sort((a,b) => a-b);
    const frames = [];
    for (let i = 0; i < times.length; i++) {
      const delay = (Math.round((times[i+1] ?? duration) * 100) - Math.round(times[i] * 100)) * 10;
      if (delay <= 0) continue;
      if (frames.length && frames[frames.length-1].delay < 20) frames[frames.length-1].delay += delay;
      else frames.push({time:times[i],delay});
    }
    if (frames.length > 1 && frames[frames.length-1].delay < 20) frames[frames.length-2].delay += frames.pop().delay;
    if (frames.length === 1) frames[0].delay = Math.max(20,frames[0].delay);
    return frames;
  }
  function framePlan(duration,fps) {
    if (!Number.isFinite(fps) || fps <= 0 || fps > 240) throw new TypeError("Invalid frame rate");
    return sourceFramePlan(duration,Array.from({length:Math.ceil(duration * fps)},(_,i) => i / fps));
  }
  const videoPresets = Object.freeze({quality:"best",balanced:"720",compact:"smallest"});
  const gifPresets = Object.freeze({quality:[100,null,256],balanced:[75,15,128],compact:[50,10,64]});
  function presetPatch(kind,preset) {
    if (!["video","gif"].includes(kind) || !["quality","balanced","compact","custom"].includes(preset)) throw new TypeError("Invalid preset");
    if (preset === "custom") return {[kind+"Preset"]:preset};
    if (kind === "video") return {videoPreset:preset,videoQuality:videoPresets[preset],videoFpsCap:preset === "quality" ? null : 60,videoBitrateCap:null};
    const [gifScale,gifFps,gifColors] = gifPresets[preset];
    return {gifPreset:preset,gifQuality:gifScale === 100 ? "best" : "legacy",gifFps,gifColors,gifScale};
  }
  function isOriginal(settings,kind) {
    return kind === "video" ? settings.videoQuality === "best" && settings.videoFpsCap == null && settings.videoBitrateCap == null
      : kind === "gif" && settings.gifScale === 100 && settings.gifFps == null && settings.gifColors === 256;
  }
  function gifDimensions(width,height,settings = {}) {
    return dimensions(width,height,normalize(settings).gifScale);
  }
  let writes = Promise.resolve();
  function commit(patch,profile = false) {
    const next = writes.then(async () => {
      const current = profile ? await loadProfile() : await load();
      const clean = Object.fromEntries(Object.keys(current).filter(key => Object.hasOwn(patch || {},key)).map(key => [key,patch[key]]));
      return profile ? saveProfile({...current,...clean}) : save({...current,...clean});
    });
    writes = next.catch(() => {}); return next;
  }
  async function update(patch,profile = false) {
    const reply = await browser.runtime.sendMessage({type:profile ? "xfd:update-profile" : "xfd:update-settings",patch});
    if (!reply?.ok) throw new Error("settingsSaveFailed");
    return reply.value;
  }
  globalThis.XFDSettings = {defaults,normalize,load,save,setMode,normalizeProfile,loadProfile,saveProfile,
    commit,update,videoPresets,gifPresets,presetPatch,isOriginal,gifDimensions,dimensions,framePlan,sourceFramePlan};
})();
