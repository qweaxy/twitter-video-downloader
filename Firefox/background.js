"use strict";
const t = key => browser.i18n.getMessage(key);
const tabMedia = new Map();
const activeDownloads = new Map();
const pendingDownloads = new Set();
let gifJob = null;
let stopping = false;
const MAX_POSTS = 600;
const monitor = new XFDResponseMonitor(browser.webRequest,remember);
browser.browserAction.onClicked.addListener(() => { browser.runtime.openOptionsPage().catch(() => {}); });

function remember(tabId, json) {
  if (stopping) return;
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
  if (stopping || details.tabId < 0) return;
  const path = new URL(details.url).pathname;
   
  if (!/\/(?:i\/api\/)?graphql\/[^/]+\/(?:HomeTimeline|HomeLatestTimeline|TweetDetail|TweetResultByRestId|UserTweets|UserTweetsAndReplies|UserMedia|SearchTimeline|Bookmarks|Likes|ListLatestTweetsTimeline|CommunityTweetsTimeline)$/.test(path)) return;
  monitor.capture(details);
}, {
  urls: ["https://x.com/*", "https://twitter.com/*", "https://api.x.com/*", "https://api.twitter.com/*"],
  types: ["xmlhttprequest"]
}, ["blocking"]);

function clearTab(tabId) {
  tabMedia.delete(tabId);
  monitor.clearTab(tabId);
  for (const operation of pendingDownloads) if (operation.tabId === tabId) operation.controller.abort();
}
browser.tabs.onRemoved.addListener(clearTab);
browser.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") clearTab(tabId);
});

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (stopping || !sender.tab || sender.frameId !== 0) return;
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
  let item = media[index];
  if (!item || !XFDMedia.mp4URL(item.url)) return {ok: false, error: t("variantUnavailable")};
  let objectURL = null, conversion = null, timeout = null;
  const operation = {tabId:sender.tab.id,controller:new AbortController(),timer:null};
  pendingDownloads.add(operation);
  try {
    let settings;
    try { settings = await XFDSettings.load(); }
    catch { return {ok:false,error:t("settingsLoadFailed")}; }
    if (stopping || operation.controller.signal.aborted) return {ok:false,error:t("downloadCancelled")};
    if (message.format !== undefined && !["mp4","gif"].includes(message.format)) return {ok:false,error:t("variantUnavailable")};
    item = {...item,type:message.format === "gif" ? "gif" : message.format === "mp4" ? "video" : item.type};
    item = XFDMedia.selectVariant(item,item.type === "gif" ? "best" : settings.videoQuality);
    if (!item) return {ok:false,error:t("variantUnavailable")};
    if (item.type === "gif") {
      if (gifJob) return {ok:false,error:t("gifBusy")};
      conversion = operation;
      gifJob = conversion;
      timeout = setTimeout(() => conversion.controller.abort(),10 * 60 * 1000);
      conversion.timer = timeout;
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
    if (stopping || operation.controller.signal.aborted) return {ok:false,error:t("downloadCancelled")};
    const id = await browser.downloads.download({
      url: objectURL || item.url, filename: XFDFilenames.build(settings,item,message.id,index),
      conflictAction: "uniquify", incognito: !!sender.tab.incognito,
      ...(settings.saveLocation === "browser" ? {} : {saveAs:settings.saveLocation === "ask"})
    });
    if (stopping) return {ok:false,error:t("downloadCancelled")};
    activeDownloads.set(id, {tabId: sender.tab.id, postId: message.id, objectURL, kind:item.type});
    objectURL = null;  
     
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
    pendingDownloads.delete(operation);
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
browser.downloads.onErased.addListener(id => {
  const item = activeDownloads.get(id);
  if (item?.objectURL) URL.revokeObjectURL(item.objectURL);
  activeDownloads.delete(id);
});

function shutdown() {
  if (stopping) return;
  stopping = true;
  monitor.stop();
  for (const operation of pendingDownloads) {
    clearTimeout(operation.timer);
    operation.controller.abort();
  }
  pendingDownloads.clear(); gifJob = null;
  for (const item of activeDownloads.values()) if (item.objectURL) URL.revokeObjectURL(item.objectURL);
  activeDownloads.clear(); tabMedia.clear();
}
 
globalThis.addEventListener("pagehide",shutdown);
globalThis.addEventListener("unload",shutdown);
