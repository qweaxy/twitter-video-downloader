"use strict";
(() => {
  let job = null;
  const blobs = new Map();
  const send = data => chrome.runtime.sendMessage({target:"worker",...data});
  async function run(request,controller) {
    const id = request.jobId;
    const timeout = setTimeout(() => controller.abort(),10*60*1000);
    const heartbeat = setInterval(() => { send({type:"tvd:heartbeat",jobId:id}).then(reply => { if (!reply?.ok) controller.abort(); },() => controller.abort()); },20000);
    try {
      let previous = -1;
      const progress = percent => {
        const step = Math.floor(percent/5)*5;
        if (step !== previous) { previous = step; send({type:"tvd:progress",jobId:id,percent:step}).then(reply => { if (!reply?.ok) controller.abort(); },() => controller.abort()); }
      };
      const blob = request.type === "tvd:convert-mp4"
        ? await XFDMP4.convert(request.url,request.settings,progress,controller.signal)
        : await XFDGif.convert(request.url,progress,controller.signal,request.settings);
      if (controller.signal.aborted) throw new Error("downloadCancelled");
      clearTimeout(timeout);
      if (!blob) { await send({type:"tvd:unchanged",jobId:id}); return; }
      const url = URL.createObjectURL(blob); blobs.set(id,url);
      const reply = await send({type:"tvd:ready",jobId:id,url});
      if (!reply?.ok) release(id);
    } catch (error) {
      release(id);
      const code = request.type === "tvd:convert-mp4"
        ? (["mp4TooLarge","mp4Unavailable","downloadCancelled"].includes(error.message) ? error.message : "mp4Failed")
        : (error.message === "gifTooLarge" ? "gifTooLarge" : "gifFailed");
      await send({type:"tvd:conversion-error",jobId:id,error:code}).catch(() => {});
    } finally {
      clearTimeout(timeout); clearInterval(heartbeat);
      if (job?.id === id) job = null;
      send({type:"tvd:idle"}).catch(() => {});
    }
  }
  function release(id) { const url = blobs.get(id); if (url) URL.revokeObjectURL(url); blobs.delete(id); }
  chrome.runtime.onMessage.addListener((message,sender,reply) => {
    if (message?.target !== "offscreen" || sender.id !== chrome.runtime.id || sender.tab) return;
    if (["tvd:convert","tvd:convert-mp4"].includes(message.type)) {
      if (job) { reply({ok:false,error:"gifBusy"}); return; }
      if (!XFDMedia.mp4URL(message.url) || typeof message.jobId !== "string") { reply({ok:false,error:message.type === "tvd:convert-mp4" ? "mp4Failed" : "gifFailed"}); return; }
      const controller = new AbortController(); job = {id:message.jobId,controller};
      reply({ok:true}); void run(message,controller);
    } else if (message.type === "tvd:cancel") {
      if (job?.id === message.jobId) job.controller.abort();
      reply({ok:true});
    } else if (message.type === "tvd:release") {
      release(message.jobId); reply({ok:true});
      if (!job && !blobs.size) send({type:"tvd:idle"}).catch(() => {});
    } else if (message.type === "tvd:status") reply({jobId:job?.id || null,blobs:[...blobs.keys()]});
  });
  function stop() { job?.controller.abort(); for (const id of blobs.keys()) release(id); }
  addEventListener("pagehide",stop); addEventListener("unload",stop);
})();
