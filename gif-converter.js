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
  async function convert(url, onProgress, signal) {
    if (!XFDMedia.mp4URL(url)) throw new Error("gifFailed");
    let sourceURL, worker, video;
    try {
      const response = await fetch(url,{signal,credentials:"omit",redirect:"error"});
      if (!response.ok || !response.body) throw new Error("gifFailed");
      if (Number(response.headers.get("content-length")) > MAX_SOURCE) {
        await response.body.cancel(); throw new Error("gifTooLarge");
      }
      const reader = response.body.getReader(), chunks = []; let size = 0;
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_SOURCE) { await reader.cancel(); throw new Error("gifTooLarge"); }
        chunks.push(value);
      }
      sourceURL = URL.createObjectURL(new Blob(chunks,{type:"video/mp4"}));
      chunks.length = 0;
      video = document.createElement("video");
      video.muted = true; video.preload = "auto"; video.playsInline = true;
      // Decoding and seeking do not depend on autoplay or a visible player.
      await waitMedia(video,"loadeddata",() => { video.src = sourceURL; video.load(); },signal);
      const {duration,videoWidth:width,videoHeight:height} = video;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("gifFailed");
      if (duration > 120 || width * height > 2073600) throw new Error("gifTooLarge");
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d",{willReadFrequently:true});
      if (!ctx) throw new Error("gifFailed");
      worker = new Worker(browser.runtime.getURL("gif-worker.js"));
      await workerCall(worker,{type:"init",width,height},signal);
      const frames = Math.max(1,Math.ceil(duration * 20));
      for (let i = 0; i < frames; i++) {
        const time = i / 20;
        if (i > 0) await waitMedia(video,"seeked",() => { video.currentTime = time; },signal);
        ctx.drawImage(video,0,0,width,height);
        const rgba = ctx.getImageData(0,0,width,height).data;
        const delay = Math.max(20,Math.round(Math.min(0.05,duration - time) * 1000));
        await workerCall(worker,{type:"frame",rgba:rgba.buffer,delay},signal,[rgba.buffer]);
        onProgress(Math.round((i + 1) / frames * 100));
      }
      const result = await workerCall(worker,{type:"finish"},signal);
      return new Blob([result.bytes],{type:"image/gif"});
    } finally {
      worker?.terminate();
      if (video) { video.removeAttribute("src"); video.load(); }
      if (sourceURL) URL.revokeObjectURL(sourceURL);
    }
  }
  globalThis.XFDGif = {convert};
})();
