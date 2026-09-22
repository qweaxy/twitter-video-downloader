"use strict";
const tabMedia = new Map();
const activeDownloads = new Map();
const MAX_RESPONSE = 12 * 1024 * 1024;
const MAX_POSTS = 600;

function remember(tabId, json) {
  const found = XFDMedia.extract(json);
  if (!found.size) return;
  let cache = tabMedia.get(tabId);
  if (!cache) tabMedia.set(tabId, cache = new Map());
  for (const [id, media] of found) {
    cache.delete(id);
    cache.set(id, media);
  }
  while (cache.size > MAX_POSTS) cache.delete(cache.keys().next().value);
  browser.tabs.sendMessage(tabId, {type: "xfd:updated"}).catch(() => {});
}

browser.webRequest.onBeforeRequest.addListener(details => {
  if (details.tabId < 0) return;
  const path = new URL(details.url).pathname;
  // Only post/timeline operations, never direct-message responses.
  if (!/\/(?:i\/api\/)?graphql\/[^/]+\/(?:HomeTimeline|HomeLatestTimeline|TweetDetail|TweetResultByRestId|UserTweets|UserTweetsAndReplies|UserMedia|SearchTimeline|Bookmarks|Likes|ListLatestTweetsTimeline|CommunityTweetsTimeline)$/.test(path)) return;
  let filter;
  try { filter = browser.webRequest.filterResponseData(details.requestId); }
  catch { return; }
  const decoder = new TextDecoder();
  let text = "", size = 0;
  filter.ondata = event => {
    // Forward original bytes immediately; parsing must never block the feed.
    filter.write(event.data);
    size += event.data.byteLength;
    if (size > MAX_RESPONSE) {
      text = "";
      filter.disconnect();
      return;
    }
    text += decoder.decode(event.data, {stream: true});
  };
  filter.onstop = () => {
    filter.close();
    try { remember(details.tabId, JSON.parse(text + decoder.decode())); }
    catch { /* Non-JSON or unknown response: leave the page untouched. */ }
    text = "";
  };
  filter.onerror = () => { text = ""; };
}, {
  urls: ["https://x.com/*", "https://twitter.com/*", "https://api.x.com/*", "https://api.twitter.com/*"],
  types: ["xmlhttprequest"]
}, ["blocking"]);

browser.tabs.onRemoved.addListener(tabId => { tabMedia.delete(tabId); });
browser.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") tabMedia.delete(tabId);
});

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (!sender.tab || sender.frameId !== 0) return;
  let host;
  try { host = new URL(sender.url).hostname; } catch { return; }
  if (!["x.com", "twitter.com"].includes(host)) return;
  const cache = tabMedia.get(sender.tab.id);
  if (message?.type === "xfd:lookup") {
    const ids = Array.isArray(message.ids) ? message.ids.slice(0, 100) : [];
    return Object.fromEntries(ids.filter(id => /^\d+$/.test(id)).map(id => [id, cache?.get(id)?.length || 0]));
  }
  if (message?.type !== "xfd:download" || !/^\d+$/.test(message.id)) return;
  const media = cache?.get(message.id);
  if (!media?.length) return {ok: false, error: "Ссылка ещё не найдена. Открой пост и обнови страницу, затем попробуй снова."};
  const index = Number.isInteger(message.index) ? message.index : 0;
  const item = media[index];
  if (!item || !XFDMedia.mp4URL(item.url)) return {ok: false, error: "Этот вариант видео недоступен."};
  try {
    const id = await browser.downloads.download({
      url: item.url, filename: `X_${message.id}_${index + 1}.mp4`,
      conflictAction: "uniquify", incognito: !!sender.tab.incognito
    });
    activeDownloads.set(id, {tabId: sender.tab.id, postId: message.id});
    return {ok: true};
  } catch {
    return {ok: false, error: "Firefox не смог начать скачивание. Обнови пост и попробуй снова."};
  }
});

browser.downloads.onChanged.addListener(delta => {
  const item = activeDownloads.get(delta.id);
  if (!item || !["complete", "interrupted"].includes(delta.state?.current)) return;
  activeDownloads.delete(delta.id);
  browser.tabs.sendMessage(item.tabId, {
    type: "xfd:finished", id: item.postId, ok: delta.state.current === "complete"
  }).catch(() => {});
});
