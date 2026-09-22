"use strict";
const t = key => browser.i18n.getMessage(key);
const tabMedia = new Map();
const activeDownloads = new Map();
let gifJob = null;
const MAX_RESPONSE = 12 * 1024 * 1024;
const MAX_POSTS = 600;
browser.browserAction.onClicked.addListener(() => { browser.runtime.openOptionsPage().catch(() => {}); });

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

function clearTab(tabId) {
  tabMedia.delete(tabId);
  if (gifJob?.tabId === tabId) gifJob.controller.abort();
}
browser.tabs.onRemoved.addListener(clearTab);
browser.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") clearTab(tabId);
});

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (!sender.tab || sender.frameId !== 0) return;
  let host;
  try { host = new URL(sender.url).hostname; } catch { return; }
  if (!["x.com", "twitter.com"].includes(host)) return;
  const cache = tabMedia.get(sender.tab.id);
  if (message?.type === "xfd:lookup") {
    const ids = Array.isArray(message.ids) ? message.ids.slice(0, 100) : [];
    return Object.fromEntries(ids.filter(id => /^\d+$/.test(id)).map(id => [id, (cache?.get(id) || []).map(item => item.type)]));
  }
  if (message?.type !== "xfd:download" || !/^\d+$/.test(message.id)) return;
  const media = cache?.get(message.id);
  if (!media?.length) return {ok: false, error: t("linkMissing")};
  const index = Number.isInteger(message.index) ? message.index : 0;
  const item = media[index];
  if (!item || !XFDMedia.mp4URL(item.url)) return {ok: false, error: t("variantUnavailable")};
  let objectURL = null, conversion = null, timeout = null;
  let settings;
  try { settings = await XFDSettings.load(); }
  catch { return {ok:false,error:t("settingsLoadFailed")}; }
  try {
    if (item.type === "gif") {
      if (gifJob) return {ok:false,error:t("gifBusy")};
      conversion = {tabId:sender.tab.id,controller:new AbortController()};
      gifJob = conversion;
      timeout = setTimeout(() => conversion.controller.abort(),10 * 60 * 1000);
      let lastProgress = -1;
      const progress = percent => {
        const step = Math.floor(percent / 5) * 5;
        if (step === lastProgress) return;
        lastProgress = step;
        browser.tabs.sendMessage(sender.tab.id,{type:"xfd:converting",id:message.id,percent:step}).catch(() => {});
      };
      progress(0);
      const blob = await XFDGif.convert(item.url,progress,conversion.controller.signal,settings);
      if (conversion.controller.signal.aborted) throw new Error("gifFailed");
      objectURL = URL.createObjectURL(blob);
    }
    const id = await browser.downloads.download({
      url: objectURL || item.url, filename: `X_${message.id}_${index + 1}.${item.type === "gif" ? "gif" : "mp4"}`,
      conflictAction: "uniquify", incognito: !!sender.tab.incognito,
      ...(settings.saveLocation === "browser" ? {} : {saveAs:settings.saveLocation === "ask"})
    });
    activeDownloads.set(id, {tabId: sender.tab.id, postId: message.id, objectURL, kind:item.type});
    objectURL = null; // Owned by the download until completion/interruption.
    // Small blob downloads can finish before download() resolves.
    browser.downloads.search({id}).then(items => {
      const state = items[0]?.state;
      if (state) finishDownload({id,state:{current:state}});
    }).catch(() => {});
    return {ok: true};
  } catch (error) {
    return {ok: false, error: t(item.type === "gif" ? (error.message === "gifTooLarge" ? "gifTooLarge" : "gifFailed") : "downloadFailed")};
  } finally {
    if (objectURL) URL.revokeObjectURL(objectURL);
    if (timeout) clearTimeout(timeout);
    if (conversion && gifJob === conversion) gifJob = null;
  }
});

function finishDownload(delta) {
  const item = activeDownloads.get(delta.id);
  if (!item || !["complete", "interrupted"].includes(delta.state?.current)) return;
  activeDownloads.delete(delta.id);
  if (item.objectURL) URL.revokeObjectURL(item.objectURL);
  browser.tabs.sendMessage(item.tabId, {
    type: "xfd:finished", id: item.postId, kind:item.kind, ok: delta.state.current === "complete"
  }).catch(() => {});
}
browser.downloads.onChanged.addListener(finishDownload);
