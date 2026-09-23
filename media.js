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
  function variant(value) {
    const url = value.content_type === "video/mp4" && mp4URL(value.url);
    if (!url) return null;
    const match = new URL(url).pathname.match(/\/(\d{1,5})x(\d{1,5})\//);
    const width = match ? Number(match[1]) : 0, height = match ? Number(match[2]) : 0;
    return {url,bitrate:Math.max(0,Number(value.bitrate) || 0),width,height};
  }
  function selectVariant(item,quality = "best") {
    const variants = (item.variants || [item]).filter(v => mp4URL(v.url));
    if (!variants.length) return null;
    const byBitrate = [...variants].sort((a,b) => b.bitrate - a.bitrate);
    if (quality === "best") return {...item,...byBitrate[0]};
    if (quality === "smallest") return {...item,...byBitrate[byBitrate.length - 1]};
    const known = variants.filter(v => v.width > 0 && v.height > 0);
    if (!known.length) return {...item,...byBitrate[0]};
    const cap = Number(quality);
    const fits = known.filter(v => Math.min(v.width,v.height) <= cap);
    const candidates = fits.length ? fits : known;
    candidates.sort((a,b) => fits.length
      ? Math.min(b.width,b.height) - Math.min(a.width,a.height) || b.bitrate - a.bitrate
      : Math.min(a.width,a.height) - Math.min(b.width,b.height) || a.bitrate - b.bitrate);
    return {...item,...candidates[0]};
  }
  function ownMedia(node) {
    const legacy = node?.legacy || node;
    const entities = legacy?.extended_entities?.media || legacy?.entities?.media || [];
    if (!Array.isArray(entities)) return [];
    return entities.filter(m => m.type === "video" || m.type === "animated_gif").map(m => {
      const variants = Array.isArray(m.video_info?.variants) ? m.video_info.variants : [];
      const choices = variants.map(variant).filter(Boolean).sort((a,b) => b.bitrate - a.bitrate);
      const user = unwrap(node.core?.user_results || node.user);
      const author = user?.core?.screen_name || user?.legacy?.screen_name || user?.screen_name || "";
      const text = node.note_tweet?.note_tweet_results?.result?.text || legacy?.full_text || legacy?.text || "";
      return choices.length ? {...choices[0], variants:choices,
        type: m.type === "animated_gif" ? "gif" : "video",
        sourceId:String(node.rest_id || legacy?.id_str || node.id_str || ""),
        author:typeof author === "string" ? author.slice(0,50) : "",
        createdAt:typeof legacy?.created_at === "string" ? legacy.created_at : "",
        text:typeof text === "string" ? Array.from(text).slice(0,80).join("") : ""
      } : null;
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
        // A nested legacy object can repeat this ID without its author context.
        // Prefer the richer Tweet object instead of overwriting it later.
        const score = list => list.reduce((n,m) => n + !!m.author + !!m.createdAt + !!m.text,0);
        if (media.length && (!found.has(id) || score(media) > score(found.get(id)))) found.set(id, media);
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
    }
    return found;
  }
  globalThis.XFDMedia = {mp4URL, extract, selectVariant};
})();
