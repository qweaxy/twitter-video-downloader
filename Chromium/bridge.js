"use strict";
(() => {
  chrome.runtime.onMessage.addListener((message,sender,reply) => {
    if (message?.type === "tvd:ping" && sender.id === chrome.runtime.id) reply({ok:true});
  });
  let pending = [], timer = null, sending = false;
  async function flush() {
    timer = null;
    if (sending || !pending.length) return;
    sending = true;
    const entries = pending.splice(0,100);
    try { await chrome.runtime.sendMessage({type:"tvd:metadata",entries}); }
    catch { pending = []; }
    finally { sending = false; if (pending.length) timer = setTimeout(flush,100); }
  }
  window.addEventListener("message",event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "tvd:media" || !Array.isArray(event.data.entries)) return;
     
    try { if (JSON.stringify(event.data.entries).length > 512 * 1024) return; } catch { return; }
    pending.push(...event.data.entries.slice(0,25));
    if (pending.length > 600) pending.splice(0,pending.length-600);
    if (timer === null && !sending) timer = setTimeout(flush,50);
  });
  window.addEventListener("pagehide",() => { clearTimeout(timer); timer = null; pending = []; });
})();
