"use strict";
(() => {
  function convert(url,settings,onProgress,signal) {
    if (!XFDMedia.mp4URL(url)) return Promise.reject(new Error("mp4Failed"));
    return new Promise((resolve,reject) => {
      const worker = new Worker(browser.runtime.getURL("mp4-transcoder.js"),{type:"module"});
      const cleanup = () => { clearTimeout(timeout); signal.removeEventListener("abort",cancel); worker.terminate(); };
      const cancel = () => { cleanup(); reject(new Error("downloadCancelled")); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error("mp4Failed")); },10*60*1000);
      worker.onmessage = ({data}) => {
        if (data.type === "progress") { onProgress(data.percent); return; }
        cleanup();
        if (data.type === "error") reject(new Error(data.error));
        else if (data.type === "unchanged") resolve(null);
        else if (data.type === "done") resolve(new Blob([data.buffer],{type:"video/mp4"}));
        else reject(new Error("mp4Failed"));
      };
      worker.onerror = () => { cleanup(); reject(new Error("mp4Failed")); };
      signal.addEventListener("abort",cancel,{once:true});
      if (signal.aborted) { cancel(); return; }
      try { worker.postMessage({url,bitrateCap:settings.videoBitrateCap,fpsCap:settings.videoFpsCap}); }
      catch { cleanup(); reject(new Error("mp4Failed")); }
    });
  }
  globalThis.XFDMP4 = {convert};
})();
