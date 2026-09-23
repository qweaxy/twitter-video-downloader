"use strict";
(() => {
  const extract = globalThis.XFDMedia.extract;
  const post = window.postMessage.bind(window);
  const LIMIT = 12 * 1024 * 1024;
  const operation = /\/(?:i\/api\/)?graphql\/[^/]+\/(?:HomeTimeline|HomeLatestTimeline|TweetDetail|TweetResultByRestId|UserTweets|UserTweetsAndReplies|UserMedia|SearchTimeline|Bookmarks|Likes|ListLatestTweetsTimeline|CommunityTweetsTimeline)$/;
  let active = 0;
  function allowed(value) {
    try {
      const url = new URL(value,location.href);
      return url.protocol === "https:" && ["x.com","twitter.com","api.x.com","api.twitter.com"].includes(url.hostname) && operation.test(url.pathname);
    } catch { return false; }
  }
  function publish(json) {
    try {
      const entries = [...extract(json)].slice(-600);
       
      for (let i=0;i<entries.length;i+=25) post({source:"tvd:media",entries:entries.slice(i,i+25)},location.origin);
    } catch {   }
  }
  async function inspect(response) {
    let reader, timer;
    try {
      if (!response.ok || !response.body || Number(response.headers.get("content-length")) > LIMIT) return;
      reader = response.body.getReader();
      let timedOut = false;
      timer = setTimeout(() => { timedOut = true; reader.cancel().catch(() => {}); },30000);
      const chunks = []; let size = 0;
      while (true) {
        const {done,value} = await reader.read();
        if (timedOut) return;
        if (done) break;
        size += value.byteLength;
        if (size > LIMIT) { reader.cancel().catch(() => {}); return; }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
      publish(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {   }
    finally {
      clearTimeout(timer);
      if (reader) { try { reader.releaseLock(); } catch {} }
      else response.body?.cancel().catch(() => {});
      active--;
    }
  }
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const result = Reflect.apply(originalFetch,this,args);
    const url = args[0] instanceof Request ? args[0].url : args[0];
    if (allowed(url)) result.then(response => {
      if (active >= 2) return;
      try { const copy = response.clone(); active++; void inspect(copy); } catch {}
    },() => {});
    return result;  
  };
  const open = XMLHttpRequest.prototype.open;
  const urls = new WeakMap();
  XMLHttpRequest.prototype.open = function(method,url,...rest) {
    const result = Reflect.apply(open,this,[method,url,...rest]);
    if (!urls.has(this)) this.addEventListener("load",() => {
      if (!allowed(urls.get(this)) || this.status < 200 || this.status >= 300) return;
      try {
        if (this.responseType === "json") {
          if (Number(this.getResponseHeader("content-length")) > LIMIT) return;
          publish(this.response);
        } else if (!this.responseType || this.responseType === "text") {
          const text = this.responseText;
          if (text.length <= LIMIT) publish(JSON.parse(text));
        }
      } catch {}
    });
    urls.set(this,url); return result;
  };
})();
