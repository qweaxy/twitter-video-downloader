"use strict";
(() => {
  const articleSelector = '[data-testid="tweet"]';
  function statusId(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !["x.com","twitter.com"].includes(url.hostname)) return null;
      return url.pathname.match(/^\/(?:[^/]+|i\/web)\/status\/(\d+)(?:\/|$)/)?.[1] || null;
    } catch { return null; }
  }
  function own(node,article) {
    if (node.closest(articleSelector) !== article) return false;
    const nested = node.closest('[data-testid="quoteTweet"], div[role="link"][tabindex], [data-testid="tweetText"]');
    return !nested || nested === article || !article.contains(nested);
  }
  function postId(article,doc = document,href = location.href) {
    if (!article) return null;
    for (const time of article.querySelectorAll("time")) {
      const link = time.closest('a[href*="/status/"]');
      const id = link && own(link,article) && statusId(link.href);
      if (id) return id;
    }
    const pageId = statusId(href);
    const column = doc.querySelector('[data-testid="primaryColumn"]') || doc.querySelector("main") || doc;
    if (pageId && column.querySelector(articleSelector) === article) return pageId;
    for (const link of article.querySelectorAll('a[href*="/status/"]')) {
      const id = own(link,article) && statusId(link.href);
      if (id) return id;
    }
    return null;
  }
  function directURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "video.twimg.com" && !url.username && !url.password && !url.port && /\.mp4$/i.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }
  function visibleMedia(article,id) {
    const result = [], seen = new Set();
    for (const video of [...article.querySelectorAll("video")].slice(0,16)) {
      const sources = [video.currentSrc,video.src,...[...video.querySelectorAll("source[src]")].map(s => s.src)];
      const urls = [...new Set(sources.map(directURL).filter(Boolean))];
      if (!urls.length || seen.has(urls[0])) continue;
      seen.add(urls[0]);
      const gif = urls.some(url => new URL(url).pathname.startsWith("/tweet_video/"));
      result.push({url:urls[0],variants:urls.map(url => ({url,bitrate:0})),type:gif ? "gif" : "video",sourceId:id});
    }
    return result;
  }
  globalThis.TVDPost = {articleSelector,statusId,postId,visibleMedia};
})();
