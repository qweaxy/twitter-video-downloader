"use strict";
(() => {
  const MAX_SOURCE = 50 * 1024 * 1024;
  function waitMedia(video, event, action, signal) {
    return new Promise((resolve,reject) => {
      const cleanup = () => {
        clearTimeout(timer); video.removeEventListener(event,ready);
        video.removeEventListener("error",fail); signal.removeEventListener("abort",fail);
      };
      const ready = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error("gifFailed")); };
      const timer = setTimeout(fail,30000);
      video.addEventListener(event,ready,{once:true}); video.addEventListener("error",fail,{once:true});
      signal.addEventListener("abort",fail,{once:true});
      if (signal.aborted) { fail(); return; }
      try { action(); } catch { fail(); }
    });
  }
  function workerCall(worker, message, signal, transfer = []) {
    return new Promise((resolve,reject) => {
      const cleanup = () => {
        clearTimeout(timer); worker.onmessage = null; worker.onerror = null; signal.removeEventListener("abort",fail);
      };
      const fail = () => { cleanup(); reject(new Error("gifFailed")); };
      const timer = setTimeout(fail,60000);
      worker.onmessage = ({data}) => { cleanup(); data.error ? reject(new Error(data.error)) : resolve(data); };
      worker.onerror = fail; signal.addEventListener("abort",fail,{once:true});
      if (signal.aborted) { fail(); return; }
      try { worker.postMessage(message,transfer); } catch { fail(); }
    });
  }
  async function convert(url, onProgress, signal, preferences = {}) {
    if (!XFDMedia.mp4URL(url)) throw new Error("gifFailed");
    const settings = XFDSettings.normalize(preferences);
    let sourceURL, worker, video, canvas, reader;
    const checkCancelled = () => { if (signal.aborted) throw new Error("gifFailed"); };
    const releaseResources = () => {
       
       
      if (worker) { try { worker.terminate(); } catch {   } worker = null; }
      if (reader) { try { reader.cancel().catch(() => {}); } catch {   } reader = null; }
      if (video) {
        try { video.pause(); video.removeAttribute("src"); video.load(); } catch {   }
        video = null;
      }
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas = null; }
      if (sourceURL) { URL.revokeObjectURL(sourceURL); sourceURL = null; }
    };
    signal.addEventListener("abort",releaseResources,{once:true});
    try {
      checkCancelled();
      const response = await fetch(url,{signal,credentials:"omit",redirect:"error",cache:"no-store"});
      checkCancelled();
      if (!response.ok || !response.body) throw new Error("gifFailed");
      if (Number(response.headers.get("content-length")) > MAX_SOURCE) {
        await response.body.cancel(); throw new Error("gifTooLarge");
      }
      reader = response.body.getReader();
      const chunks = []; let size = 0;
      while (true) {
        const {done,value} = await reader.read();
        checkCancelled();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_SOURCE) { await reader.cancel(); throw new Error("gifTooLarge"); }
        chunks.push(value);
      }
      reader.releaseLock(); reader = null;
      sourceURL = URL.createObjectURL(new Blob(chunks,{type:"video/mp4"}));
      chunks.length = 0;
      video = document.createElement("video");
      video.muted = true; video.preload = "auto"; video.playsInline = true;
       
      await waitMedia(video,"loadeddata",() => { video.src = sourceURL; video.load(); },signal);
      checkCancelled();
      const {duration,videoWidth:sourceWidth,videoHeight:sourceHeight} = video;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("gifFailed");
      if (!sourceWidth || !sourceHeight) throw new Error("gifFailed");
      const {width,height} = XFDSettings.dimensions(sourceWidth,sourceHeight,settings.gifScale);
      if (duration > 120 || width * height > 2073600) throw new Error("gifTooLarge");
      canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d",{willReadFrequently:true});
      if (!ctx) throw new Error("gifFailed");
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      worker = new Worker(browser.runtime.getURL("gif-worker.js"));
      await workerCall(worker,{type:"init",width,height,colors:settings.gifColors},signal);
      const frames = XFDSettings.framePlan(duration,settings.gifFps);
      for (let i = 0; i < frames.length; i++) {
        checkCancelled();
        const {time,delay} = frames[i];
        if (i > 0) await waitMedia(video,"seeked",() => { video.currentTime = time; },signal);
        checkCancelled();
        ctx.drawImage(video,0,0,width,height);
        const rgba = ctx.getImageData(0,0,width,height).data;
        await workerCall(worker,{type:"frame",rgba:rgba.buffer,delay},signal,[rgba.buffer]);
        onProgress(Math.round((i + 1) / frames.length * 100));
      }
      const result = await workerCall(worker,{type:"finish"},signal);
      checkCancelled();
      return new Blob([result.bytes],{type:"image/gif"});
    } finally {
      signal.removeEventListener("abort",releaseResources);
      releaseResources();
    }
  }
  globalThis.XFDGif = {convert};
})();
