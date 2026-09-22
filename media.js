/* Pure metadata extraction; shared with the offline tests. */
"use strict";
(() => {
  function mp4URL(value) {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && u.hostname === "video.twimg.com" &&
        !u.username && !u.password && !u.port && /\.mp4$/i.test(u.pathname) ? u.href : null;
    } catch { return null; }
  }
  function unwrap(node) {
    for (let i = 0; i < 5 && node; i++) {
      if (node.tweet) node = node.tweet;
      else if (node.result) node = node.result;
      else return node;
    }
    return node;
  }
  function ownMedia(node) {
    const legacy = node?.legacy || node;
    const entities = legacy?.extended_entities?.media || legacy?.entities?.media || [];
    if (!Array.isArray(entities)) return [];
    return entities.filter(m => m.type === "video" || m.type === "animated_gif").map(m => {
      const variants = Array.isArray(m.video_info?.variants) ? m.video_info.variants : [];
      const best = variants.filter(v => v.content_type === "video/mp4" && mp4URL(v.url))
        .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))[0];
      return best ? {url: mp4URL(best.url), bitrate: Number(best.bitrate) || 0,
        type: m.type === "animated_gif" ? "gif" : "video"} : null;
    }).filter(Boolean);
  }
  function visibleMedia(node, depth = 0) {
    if (!node || depth > 3) return [];
    const own = ownMedia(node);
    if (own.length) return own;
    const l = node.legacy || node;
    const nested = unwrap(l.retweeted_status_result || node.retweeted_status_result ||
      l.retweeted_status || node.quoted_status_result || l.quoted_status_result || l.quoted_status);
    return visibleMedia(nested, depth + 1);
  }
  function extract(root) {
    const found = new Map(), stack = [root];
    let budget = 100000;
    while (stack.length && budget-- > 0) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      const id = node.rest_id || node.id_str;
      if (typeof id === "string" && /^\d+$/.test(id)) {
        const media = visibleMedia(node);
        if (media.length) found.set(id, media);
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
    }
    return found;
  }
  globalThis.XFDMedia = {mp4URL, extract};
})();
