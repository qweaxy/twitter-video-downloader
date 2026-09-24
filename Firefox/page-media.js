"use strict";
(() => {
  const {extract,cleanItems} = XFDMedia;
  const {postId,articleSelector} = TVDPost;
  const fields = new Set(["rest_id","id_str","legacy","extended_entities","entities","media","type","video_info","variants","content_type","url","bitrate","core","user_results","result","user","tweet","screen_name","created_at","full_text","text","note_tweet","note_tweet_results","retweeted_status_result","retweeted_status","quoted_status_result","quoted_status"]);
  const skip = new Set(["return","stateNode","child","sibling","alternate","_owner","ref"]);
  function read(object,key) {
    try { return Object.getOwnPropertyDescriptor(object,key)?.value; } catch { return undefined; }
  }
  function snapshot(root) {
    const seen = new WeakSet(); let remaining = 6000;
    function copy(value,depth) {
      if (typeof value === "string") return value.slice(0,8192);
      if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
      if (!value || typeof value !== "object" || depth > 20 || --remaining < 0 || seen.has(value)) return undefined;
      seen.add(value);
      if (Array.isArray(value)) return value.slice(0,32).map(item => copy(item,depth+1)).filter(item => item !== undefined);
      const result = {};
      for (const key of fields) {
        const item = copy(read(value,key),depth+1);
        if (item !== undefined) result[key] = item;
      }
      return result;
    }
    return copy(root,0);
  }
  function roots(article) {
    const nodes = [article,...Array.from(article.querySelectorAll('video, [data-testid="videoPlayer"]')).slice(0,16)];
    let parent = article.parentElement;
    for (let i=0;parent && i<4;i++,parent=parent.parentElement) nodes.push(parent);
    const result = [], seen = new WeakSet();
    for (const node of nodes) {
      for (const key of Object.keys(node)) {
        if (key.startsWith("__reactProps$")) result.push(read(node,key));
        if (!key.startsWith("__reactFiber$") && !key.startsWith("__reactInternalInstance$")) continue;
        let fiber = read(node,key);
        for (let i=0;fiber && typeof fiber === "object" && i<24 && !seen.has(fiber);i++) {
          seen.add(fiber); result.push(read(fiber,"memoizedProps")); fiber = read(fiber,"return");
        }
      }
    }
    return result;
  }
  function resolve(article,id) {
    const queue = roots(article).map(value => ({value,depth:0})), seen = new WeakSet();
    for (let i=0;i<queue.length && i<4000;i++) {
      const {value,depth} = queue[i];
      if (!value || typeof value !== "object" || seen.has(value) || depth > 12) continue;
      seen.add(value);
      if (read(value,"rest_id") === id || read(value,"id_str") === id) {
        try {
          const items = cleanItems(extract(snapshot(value)).get(id),id);
          if (items.length) return items;
        } catch {}
      }
      let descriptors;
      try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { continue; }
      for (const key of Object.keys(descriptors).slice(0,256)) {
        if (skip.has(key) || queue.length >= 4000) continue;
        const child = descriptors[key].value;
        if (child && typeof child === "object") queue.push({value:child,depth:depth+1});
      }
    }
    return [];
  }
  let lastRequest = 0;
  window.addEventListener("message",event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.source !== "tvd:resolve-media" ||
        typeof message.id !== "string" || !/^\d{1,30}$/.test(message.id) ||
        typeof message.token !== "string" || message.token.length > 80) return;
    let items = [];
    try {
      if (Date.now()-lastRequest >= 100) {
        lastRequest = Date.now();
        const article = Array.from(document.querySelectorAll(articleSelector)).find(node => postId(node) === message.id);
        if (article) items = resolve(article,message.id);
      }
    } catch {}
    window.postMessage({source:"tvd:resolved-media",id:message.id,token:message.token,items},location.origin);
  });
})();
