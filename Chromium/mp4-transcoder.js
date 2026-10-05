import {Input,BlobSource,MP4,Output,Mp4OutputFormat,BufferTarget,Conversion,Quality,canEncodeVideo} from "./vendor/mediabunny.min.mjs";

const MAX_SOURCE = 150 * 1024 * 1024;
async function transcode({url,bitrateCap,fpsCap}) {
  const response = await fetch(url,{credentials:"omit",redirect:"error",cache:"no-store"});
  if (!response.ok || !response.body) throw new Error("mp4Failed");
  if (Number(response.headers.get("content-length")) > MAX_SOURCE) {
    await response.body.cancel(); throw new Error("mp4TooLarge");
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SOURCE) { await reader.cancel(); throw new Error("mp4TooLarge"); }
    chunks.push(value);
  }
  const input = new Input({source:new BlobSource(new Blob(chunks,{type:"video/mp4"})),formats:[MP4]});
  try {
    if (!await input.canRead()) throw new Error("mp4Failed");
    const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
    if (!video) throw new Error("mp4Failed");
    const sourceBitrate = await video.getAverageBitrate();
    const sourceFps = (await video.computeFrameRateMetrics()).bestGuessFrameRate;
    const limitBitrate = bitrateCap && sourceBitrate && bitrateCap * 1e6 < sourceBitrate ? bitrateCap * 1e6 : null;
    const limitFps = fpsCap && Number.isFinite(sourceFps) && fpsCap < sourceFps ? fpsCap : null;
    if (!limitBitrate && !limitFps) { postMessage({type:"unchanged"}); return; }
    const width = await video.getCodedWidth(), height = await video.getCodedHeight();
    const quality = new Quality({bitrate:limitBitrate || Math.max(250000,Math.round(sourceBitrate || 2000000))});
    if (!await canEncodeVideo("avc",{width,height,quality,frameRate:limitFps || sourceFps || 30})) throw new Error("mp4Unavailable");
    const target = new BufferTarget();
    const output = new Output({format:new Mp4OutputFormat(),target});
    const conversion = await Conversion.init({input,output,tracks:"primary",video:{codec:"avc",quality,
      ...(limitFps ? {frameRate:limitFps} : {}),forceTranscode:true}});
    if (!conversion.isValid || !conversion.utilizedTracks.some(track => track.type === "video") ||
        (audio && !conversion.utilizedTracks.some(track => track.type === "audio"))) throw new Error("mp4Unavailable");
    conversion.onProgress = progress => postMessage({type:"progress",percent:Math.round(progress * 100)});
    await conversion.execute();
    if (!target.buffer) throw new Error("mp4Failed");
    postMessage({type:"done",buffer:target.buffer},[target.buffer]);
  } finally { input.dispose(); }
}
self.onmessage = event => { transcode(event.data).catch(error => postMessage({type:"error",error:["mp4TooLarge","mp4Unavailable"].includes(error.message) ? error.message : "mp4Failed"})); };
