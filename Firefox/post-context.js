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
  function postId(article) {
    if (!article) return null;
    for (const time of article.querySelectorAll("time")) {
      const link = time.closest('a[href*="/status/"]');
      const id = link && own(link,article) && statusId(link.href);
      if (id) return id;
    }
    for (const link of article.querySelectorAll('a[href*="/status/"]')) {
      const id = own(link,article) && statusId(link.href);
      if (id) return id;
    }
    return null;
  }
  globalThis.TVDPost = {articleSelector,statusId,postId};
})();
