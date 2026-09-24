"use strict";
const t = key => browser.i18n.getMessage(key);
const tabMedia = new Map();
const activeDownloads = new Map();
const pendingDownloads = new Set();
let gifJob = null;
let stopping = false;
const MAX_POSTS = 600;
const MAX_METADATA = 2 * 1024 * 1024;
const metadataOrder = new Map();
let metadataSize = 0;
function forgetMetadata(key) {
  const entry = metadataOrder.get(key);
  if (!entry) return;
  metadataOrder.delete(key); metadataSize -= entry.size;
  const cache = tabMedia.get(entry.tabId);
  cache?.delete(entry.id);
  if (cache && !cache.size) tabMedia.delete(entry.tabId);
}
function storeMetadata(tabId,id,items) {
  const size = JSON.stringify(items).length;
  if (!items.length || size > MAX_METADATA) return;
  const key = `${tabId}:${id}`;
  forgetMetadata(key);
  let cache = tabMedia.get(tabId);
  if (!cache) tabMedia.set(tabId,cache = new Map());
  cache.set(id,items);
  metadataOrder.set(key,{tabId,id,size}); metadataSize += size;
  while (metadataOrder.size > MAX_POSTS || metadataSize > MAX_METADATA) forgetMetadata(metadataOrder.keys().next().value);
}
const monitor = new XFDResponseMonitor(browser.webRequest,remember);
browser.browserAction.onClicked.addListener(() => { browser.runtime.openOptionsPage().catch(() => {}); });

function remember(tabId, json) {
  if (stopping) return;
  const found = XFDMedia.extract(json);
  if (!found.size) return;
  for (const [id, media] of found) storeMetadata(tabId,id,XFDMedia.cleanItems(media,id));
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
  for (const [key,entry] of metadataOrder) if (entry.tabId === tabId) forgetMetadata(key);
  monitor.clearTab(tabId);
  for (const operation of pendingDownloads) if (operation.tabId === tabId) operation.controller.abort();
}
browser.tabs.onRemoved.addListener(clearTab);
browser.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") clearTab(tabId);
});

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (stopping || !sender.tab || sender.frameId !== 0) return;
  let source;
  try { source = new URL(sender.url); } catch { return; }
  if (source.protocol !== "https:" || !["x.com", "twitter.com"].includes(source.hostname)) return;
  if (message?.type === "tvd:recovered-media") {
    if (!Array.isArray(message.entries) || JSON.stringify(message.entries).length > 512 * 1024) return {ok:false};
    let changed = false;
    for (const pair of message.entries.slice(0,100)) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string" || !/^\d{1,30}$/.test(pair[0])) continue;
      const [id,raw] = pair, items = XFDMedia.cleanItems(raw,id);
      if (!items.length || tabMedia.get(sender.tab.id)?.has(id)) continue;
      storeMetadata(sender.tab.id,id,items); changed = true;
    }
    if (changed) browser.tabs.sendMessage(sender.tab.id,{type:"xfd:updated"}).catch(() => {});
    return {ok:true};
  }
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
    if ((message.format !== undefined && !["mp4","gif"].includes(message.format)) || (item.type === "gif" && message.format === "mp4")) return {ok:false,error:t("variantUnavailable")};
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
      clearTimeout(timeout); timeout = null; conversion.timer = null;
      objectURL = URL.createObjectURL(blob);
    }
    if (stopping || operation.controller.signal.aborted) return {ok:false,error:t("downloadCancelled")};
    if (item.type === "gif") browser.tabs.sendMessage(sender.tab.id,{type:"xfd:saving",id:message.id}).catch(() => {});
    const id = await browser.downloads.download({
      url: objectURL || item.url, filename: XFDFilenames.build(settings,item,message.id,index),
      conflictAction: "uniquify", incognito: !!sender.tab.incognito,
      ...(settings.saveLocation === "browser" ? {} : {saveAs:settings.saveLocation === "ask"})
    });
    if (stopping) return {ok:false,error:t("downloadCancelled")};
    activeDownloads.set(id, {tabId: sender.tab.id, postId: message.id, objectURL, kind:item.type});
    objectURL = null;  
     
    browser.downloads.search({id}).then(items => {
      if (items[0]) return finishDownload({id},items[0]);
    }).catch(() => {});
    return {ok: true};
  } catch (error) {
    if (TVDDownloadStatus.cancelled(error)) return {ok:false,error:t("saveCancelled")};
    return {ok: false, error: t(item.type === "gif" ? (error.message === "gifTooLarge" ? "gifTooLarge" : "gifFailed") : "downloadFailed")};
  } finally {
    if (objectURL) URL.revokeObjectURL(objectURL);
    if (timeout) clearTimeout(timeout);
    if (conversion && gifJob === conversion) gifJob = null;
    pendingDownloads.delete(operation);
  }
});

async function finishDownload(delta, snapshot = null) {
  const item = activeDownloads.get(delta.id);
  if (!item || (!snapshot && !delta.state && !delta.error && !delta.paused)) return;
  if (!snapshot && delta.state?.current === "complete") snapshot = {state:"complete"};
  if (!snapshot) {
    try { [snapshot] = await browser.downloads.search({id:delta.id}); }
    catch { return; }
  }
  const result = TVDDownloadStatus.outcome(snapshot);
  if (!result || activeDownloads.get(delta.id) !== item) return;
  activeDownloads.delete(delta.id);
  if (item.objectURL) URL.revokeObjectURL(item.objectURL);
  browser.tabs.sendMessage(item.tabId, {
    type:"xfd:finished", id:item.postId, kind:item.kind, ok:result === "complete", cancelled:result === "cancelled"
  }).catch(() => {});
}
browser.downloads.onChanged.addListener(delta => { finishDownload(delta).catch(() => {}); });
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
  activeDownloads.clear(); tabMedia.clear(); metadataOrder.clear(); metadataSize = 0;
}
 
globalThis.addEventListener("pagehide",shutdown);
globalThis.addEventListener("unload",shutdown);
