"use strict";
importScripts("compat.js","filenames.js","settings.js","media.js","download-status.js");
const t = key => chrome.i18n.getMessage(key);
const OFFSCREEN = "offscreen.html";
let state = {posts:[],downloads:{},job:null}, offscreenQueue = Promise.resolve();
 
let stateQueue = chrome.storage.session.get("tvdState").then(data => {
  if (data.tvdState) state = data.tvdState;
});
function transaction(fn) {
  const next = stateQueue.then(async () => {
    const result = fn(state);
    await chrome.storage.session.set({tvdState:state});
    return result;
  });
  stateQueue = next.catch(() => {}); return next;
}
const tell = (tabId,message,documentId) => chrome.tabs.sendMessage(tabId,message,documentId ? {documentId} : undefined).catch(() => {});
const off = message => chrome.runtime.sendMessage({target:"offscreen",...message});
function offscreenTask(fn) {
  const next = offscreenQueue.then(fn); offscreenQueue = next.catch(() => {}); return next;
}
async function hasOffscreen() {
  return (await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL(OFFSCREEN)]})).length > 0;
}
function ensureOffscreen() {
  return offscreenTask(async () => {
    if (!await hasOffscreen()) await chrome.offscreen.createDocument({url:OFFSCREEN,reasons:["BLOBS","WORKERS"],justification:"Decode animation frames and encode a GIF locally, keeping its Blob alive until the download finishes."});
  });
}
function closeIfIdle() {
  return offscreenTask(async () => {
    await stateQueue;
    if (state.job || Object.values(state.downloads).some(d => d.jobId)) return;
    if (!await hasOffscreen()) return;
    const status = await off({type:"tvd:status"});
    if (!status?.jobId && !status?.blobs?.length) await chrome.offscreen.closeDocument();
  }).catch(() => {});
}
function sourceSender(sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !sender.documentId) return false;
  try { const url = new URL(sender.url); return url.protocol === "https:" && ["x.com","twitter.com"].includes(url.hostname); } catch { return false; }
}
function cleanItems(value,id) {
  if (!Array.isArray(value)) return [];
  return value.slice(0,16).flatMap(item => {
    if (!item || !["video","gif"].includes(item.type)) return [];
    const variants = (Array.isArray(item.variants) ? item.variants : [item]).slice(0,12).flatMap(v => {
      if (!v || typeof v.url !== "string" || v.url.length > 2048) return [];
      const url = XFDMedia.mp4URL(v.url); if (!url) return [];
      const dimensions = new URL(url).pathname.match(/\/(\d{1,5})x(\d{1,5})\//);
      return [{url,bitrate:Number.isFinite(v.bitrate) ? Math.max(0,Math.min(1e9,v.bitrate)) : 0,width:dimensions ? Number(dimensions[1]) : 0,height:dimensions ? Number(dimensions[2]) : 0}];
    });
    if (!variants.length) return [];
    variants.sort((a,b) => b.bitrate-a.bitrate);
    const text = (v,n) => typeof v === "string" ? Array.from(v).slice(0,n).join("") : "";
    return [{...variants[0],variants,type:item.type,sourceId:/^\d{1,30}$/.test(item.sourceId || "") ? item.sourceId : id,
      author:text(item.author,50),text:text(item.text,80),createdAt:text(item.createdAt,80)}];
  });
}
async function remember(message,sender) {
  if (!Array.isArray(message.entries) || JSON.stringify(message.entries).length > 1024*1024) return {ok:false};
  await transaction(s => {
    for (const pair of message.entries.slice(0,100)) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string" || !/^\d{1,30}$/.test(pair[0])) continue;
      const [id,raw] = pair, items = cleanItems(raw,id); if (!items.length) continue;
      if (message.type === "tvd:visible-media" && s.posts.some(p => p.tabId === sender.tab.id && p.documentId === sender.documentId && p.id === id)) continue;
      s.posts = s.posts.filter(p => !(p.tabId === sender.tab.id && p.id === id));
      s.posts.push({tabId:sender.tab.id,documentId:sender.documentId,id,items});
    }
    if (s.posts.length > 600) s.posts.splice(0,s.posts.length-600);
     
    while (s.posts.length && JSON.stringify(s.posts).length > 2*1024*1024) s.posts.shift();
  });
  tell(sender.tab.id,{type:"xfd:updated"},sender.documentId); return {ok:true};
}
async function stillCurrent(job) {
   
  try { await chrome.tabs.sendMessage(job.tabId,{type:"tvd:ping"},{documentId:job.documentId}); return true; } catch { return false; }
}
async function saveDownload(url,job,jobId = null) {
  if (job.kind === "gif") tell(job.tabId,{type:"xfd:saving",id:job.postId},job.documentId);
  const id = await chrome.downloads.download({url,filename:job.filename,conflictAction:"uniquify",
    ...(job.saveLocation === "browser" ? {} : {saveAs:job.saveLocation === "ask"})});
  await transaction(s => {
    s.downloads[id] = {tabId:job.tabId,documentId:job.documentId,postId:job.postId,kind:job.kind,jobId};
    if (jobId && s.job?.id === jobId) s.job = null;
  });
  const items = await chrome.downloads.search({id}).catch(() => []);
  if (items[0]) await finishDownload({id},items[0]);
  return {ok:true};
}
async function requestDownload(message,sender) {
  if (typeof message.id !== "string" || !/^\d{1,30}$/.test(message.id)) return {ok:false,error:t("linkMissing")};
  await stateQueue;
  const post = state.posts.find(p => p.tabId === sender.tab.id && p.documentId === sender.documentId && p.id === message.id);
  const index = Number.isInteger(message.index) ? message.index : 0;
  let item = post?.items[index]; if (!item) return {ok:false,error:t("linkMissing")};
  let settings;
  try { settings = await XFDSettings.load(); } catch { return {ok:false,error:t("settingsLoadFailed")}; }
  if ((message.format !== undefined && !["mp4","gif"].includes(message.format)) || (item.type === "gif" && message.format === "mp4")) return {ok:false,error:t("variantUnavailable")};
  item = {...item,type:message.format === "gif" ? "gif" : message.format === "mp4" ? "video" : item.type};
  item = XFDMedia.selectVariant(item,item.type === "gif" ? "best" : settings.videoQuality);
  if (!item) return {ok:false,error:t("variantUnavailable")};
  const job = {id:crypto.randomUUID(),tabId:sender.tab.id,documentId:sender.documentId,postId:message.id,kind:item.type,
    filename:XFDFilenames.build(settings,item,message.id,index),saveLocation:settings.saveLocation,started:Date.now()};
  if (!await stillCurrent(job)) return {ok:false,error:t("downloadCancelled")};
  if (item.type === "video") {
    try { return await saveDownload(item.url,job); } catch (error) { return {ok:false,error:t(TVDDownloadStatus.cancelled(error) ? "saveCancelled" : "downloadFailed")}; }
  }
   
  await stateQueue;
  if (state.job && Date.now() - state.job.started > 30000) {
    const alive = await hasOffscreen() && await off({type:"tvd:status"}).catch(() => null);
    const previous = state.job?.id;
    if (!alive?.jobId && !alive?.blobs?.includes(previous)) await transaction(s => { if (s.job?.id === previous) s.job = null; });
  }
  const accepted = await transaction(s => { if (s.job) return false; s.job = job; return true; });
  if (!accepted) return {ok:false,error:t("gifBusy")};
  try {
    await ensureOffscreen();
    await stateQueue;
    if (state.job?.id !== job.id || !await stillCurrent(job)) throw new Error("downloadCancelled");
    const response = await off({type:"tvd:convert",jobId:job.id,url:item.url,settings});
    if (!response?.ok) throw new Error(response?.error || "gifFailed");
    await stateQueue;
    if (state.job?.id !== job.id) { await off({type:"tvd:cancel",jobId:job.id}); throw new Error("downloadCancelled"); }
    tell(job.tabId,{type:"xfd:converting",id:job.postId,percent:0},job.documentId);
    return {ok:true,converting:true};
  } catch (error) {
    await transaction(s => { if (s.job?.id === job.id) s.job = null; });
    closeIfIdle(); return {ok:false,error:t(["gifBusy","downloadCancelled"].includes(error.message) ? error.message : "gifFailed")};
  }
}
async function handleOffscreen(message) {
  await stateQueue;
  if (message.type === "tvd:idle") { await closeIfIdle(); return {ok:true}; }
  const job = state.job;
  if (!job || job.id !== message.jobId) return {ok:false};
  if (message.type === "tvd:heartbeat") return {ok:true};
  if (message.type === "tvd:progress") {
    tell(job.tabId,{type:"xfd:converting",id:job.postId,percent:Math.max(0,Math.min(100,Number(message.percent) || 0))},job.documentId);
    return {ok:true};
  }
  if (message.type === "tvd:conversion-error") {
    await transaction(s => { if (s.job?.id === job.id) s.job = null; });
    tell(job.tabId,{type:"tvd:error",error:t(message.error === "gifTooLarge" ? "gifTooLarge" : "gifFailed")},job.documentId);
    return {ok:true};
  }
  if (message.type === "tvd:ready") {
    const prefix = `blob:${chrome.runtime.getURL("")}`;
    if (typeof message.url !== "string" || !message.url.startsWith(prefix)) return {ok:false};
    try {
      if (!await stillCurrent(job)) throw new Error("closed");
      await stateQueue;
      if (state.job?.id !== job.id) throw new Error("closed");
      return await saveDownload(message.url,job,job.id);
    } catch (error) {
      await transaction(s => { if (s.job?.id === job.id) s.job = null; });
      tell(job.tabId,{type:"tvd:error",error:t(TVDDownloadStatus.cancelled(error) ? "saveCancelled" : "downloadFailed")},job.documentId); return {ok:false};
    }
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (!message || message.target === "offscreen") return;
  let task;
  if (message.target === "worker" && sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL(OFFSCREEN)) task = handleOffscreen(message);
  else if (sourceSender(sender)) {
    if (["tvd:metadata","tvd:visible-media"].includes(message.type)) task = remember(message,sender);
    else if (message.type === "xfd:lookup") task = stateQueue.then(() => {
      const ids = Array.isArray(message.ids) ? message.ids.slice(0,100).filter(id => typeof id === "string" && /^\d{1,30}$/.test(id)) : [];
      return Object.fromEntries(ids.map(id => [id,(state.posts.find(p => p.tabId === sender.tab.id && p.documentId === sender.documentId && p.id === id)?.items || []).map(m => m.type)]));
    });
    else if (message.type === "xfd:download") task = requestDownload(message,sender);
  }
  if (!task) return;
  task.then(respond,() => respond({ok:false,error:t("downloadFailed")})); return true;
});
async function clearTab(tabId) {
  const job = await transaction(s => {
    s.posts = s.posts.filter(p => p.tabId !== tabId);
    if (s.job?.tabId !== tabId) return null;
    const job = s.job; s.job = null; return job;
  });
  if (job) await off({type:"tvd:cancel",jobId:job.id}).catch(() => {});
  closeIfIdle();
}
async function finishDownload(delta, snapshot = null) {
  if (!snapshot && !delta.state && !delta.error && !delta.paused) return;
  await stateQueue;
  const tracked = state.downloads[delta.id];
  if (!tracked) return;
  if (!snapshot && delta.state?.current === "complete") snapshot = {state:"complete"};
  if (!snapshot) {
    try { [snapshot] = await chrome.downloads.search({id:delta.id}); }
    catch { return; }
  }
  const result = TVDDownloadStatus.outcome(snapshot);
  if (!result) return;
  const item = await transaction(s => {
    if (s.downloads[delta.id] !== tracked) return null;
    delete s.downloads[delta.id]; return tracked;
  });
  if (!item) return;
  if (item.jobId) await off({type:"tvd:release",jobId:item.jobId}).catch(() => {});
  tell(item.tabId,{type:"xfd:finished",id:item.postId,kind:item.kind,ok:result === "complete",cancelled:result === "cancelled"},item.documentId);
  closeIfIdle();
}
async function forgetDownload(id) {
  const item = await transaction(s => { const item = s.downloads[id]; delete s.downloads[id]; return item; });
  if (item?.jobId) await off({type:"tvd:release",jobId:item.jobId}).catch(() => {});
  closeIfIdle();
}
chrome.action.onClicked.addListener(() => { chrome.runtime.openOptionsPage().catch(() => {}); });
chrome.tabs.onRemoved.addListener(id => { clearTab(id).catch(() => {}); });
chrome.tabs.onUpdated.addListener((id,change) => { if (change.status === "loading") clearTab(id).catch(() => {}); });
chrome.downloads.onChanged.addListener(delta => { finishDownload(delta).catch(() => {}); });
chrome.downloads.onErased.addListener(id => { forgetDownload(id).catch(() => {}); });
 
stateQueue.then(async () => {
  for (const id of Object.keys(state.downloads)) {
    const items = await chrome.downloads.search({id:Number(id)});
    if (items[0]) await finishDownload({id:Number(id)},items[0]);
    else await forgetDownload(Number(id));
  }
}).catch(() => {});
