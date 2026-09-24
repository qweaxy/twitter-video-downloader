"use strict";
(() => {
  const pending = new Map();
  window.addEventListener("message",event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.source !== "tvd:resolved-media") return;
    const request = pending.get(message.token);
    if (!request || request.id !== message.id || !Array.isArray(message.items)) return;
    try { if (JSON.stringify(message.items).length > 256*1024) return; } catch { return; }
    request.finish(message.items.slice(0,16));
  });
  window.addEventListener("pagehide",() => {
    for (const request of pending.values()) request.finish([]);
  });
  globalThis.TVDRecovery = {
    async remember(article,id) {
      if (!article?.isConnected || TVDPost.postId(article) !== id || pending.size >= 4) return false;
      const token = crypto.randomUUID();
      const items = await new Promise(resolve => {
        const finish = items => { clearTimeout(timer); pending.delete(token); resolve(items); };
        const timer = setTimeout(() => finish([]),1200);
        pending.set(token,{id,finish});
        window.postMessage({source:"tvd:resolve-media",id,token},location.origin);
      });
      if (!items.length || !article.isConnected || TVDPost.postId(article) !== id) return false;
      const result = await browser.runtime.sendMessage({type:"tvd:recovered-media",entries:[[id,items]]});
      return result?.ok === true;
    }
  };
})();
