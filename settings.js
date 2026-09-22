"use strict";
(() => {
  const defaults = Object.freeze({gifScale:100,gifFps:20,gifColors:256,saveLocation:"browser"});
  function normalize(input) {
    const value = input && typeof input === "object" ? input : {};
    const number = (key,min,max) => typeof value[key] === "number" && Number.isFinite(value[key])
      ? Math.max(min,Math.min(max,Math.round(value[key]))) : defaults[key];
    return {
      gifScale:number("gifScale",10,100),
      gifFps:[5,10,15,20,25,30].includes(value.gifFps) ? value.gifFps : defaults.gifFps,
      gifColors:[64,128,256].includes(value.gifColors) ? value.gifColors : defaults.gifColors,
      saveLocation:["browser","ask","downloads"].includes(value.saveLocation) ? value.saveLocation : defaults.saveLocation
    };
  }
  async function load() {
    const data = await browser.storage.local.get("settings");
    return normalize(data.settings);
  }
  async function save(settings) {
    const value = normalize(settings);
    await browser.storage.local.set({settings:value});
    return value;
  }
  function dimensions(width,height,scale) {
    const percent = normalize({gifScale:scale}).gifScale;
    return {width:Math.max(1,Math.round(width * percent / 100)),height:Math.max(1,Math.round(height * percent / 100))};
  }
  function framePlan(duration,fps) {
    const rate = normalize({gifFps:fps}).gifFps;
    const frames = [];
    for (let i = 0; i < Math.ceil(duration * rate); i++) {
      const start = Math.round(i * 100 / rate);
      const end = Math.round(Math.min(duration,(i + 1) / rate) * 100);
      const delay = (end - start) * 10;
      if (delay < 20 && frames.length) frames[frames.length - 1].delay += delay;
      else frames.push({time:i / rate,delay:Math.max(20,delay)});
    }
    return frames;
  }
  globalThis.XFDSettings = {defaults,normalize,load,save,dimensions,framePlan};
})();
