const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');

function environment({duration=.15,size=4*4,fail=false,hangWorker=false}={}) {
  const seeks=[],revoked=[],progress=[],workers=[],draws=[],blobs=new Map();
  let frame=0;
  const video=new EventTarget();
  Object.assign(video,{duration,videoWidth:4,videoHeight:size/4,muted:false,preload:'',playsInline:false,
    pause(){this.paused=true;},
    load(){if(this.src)queueMicrotask(()=>this.dispatchEvent(new Event('loadeddata')));},
    removeAttribute(){this.src='';}});
  Object.defineProperty(video,'currentTime',{set(value){seeks.push(value);frame++;queueMicrotask(()=>video.dispatchEvent(new Event('seeked')));}});
  class Worker {
    constructor() {
      workers.push(this);this.terminated=false;
      const self={postMessage:data=>queueMicrotask(()=>this.onmessage?.({data}))};
      const context=vm.createContext({self,Uint8ClampedArray});
      context.importScripts=name=>vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context);
      vm.runInContext(fs.readFileSync(path.join(root,'gif-worker.js'),'utf8'),context);
      this.self=self;
    }
    postMessage(data){if(!hangWorker)queueMicrotask(()=>this.self.onmessage({data}));}
    terminate(){this.terminated=true;}
  }
  const context=vm.createContext({
    XFDMedia:{mp4URL:url=>url},
    browser:{runtime:{getURL:name=>name}},
    Worker,Blob,setTimeout,clearTimeout,
    URL:{createObjectURL(blob){const url='blob:'+blobs.size;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},
    fetch:async()=>{if(fail)throw new Error('fetch failed');return new Response(new Uint8Array(8));},
    document:{createElement:name=>name==='video'?video:{getContext:()=>({drawImage(video,x,y,w,h){draws.push([w,h]);},getImageData(x,y,w,h){
      const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++)data.set([frame*40,80,120,255],i*4);return {data};
    }})}}
  });
  vm.runInContext(fs.readFileSync(path.join(root,'settings.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'gif-converter.js'),'utf8'),context);
  return {convert:context.XFDGif.convert,seeks,revoked,progress,workers,draws,video};
}

test('converter seeks the full animation, uses real encoder worker and releases resources',async()=>{
  const e=environment();const blob=await e.convert('https://video.twimg.com/a.mp4',p=>e.progress.push(p),new AbortController().signal);
  assert.equal(blob.type,'image/gif');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0,6)).toString(),'GIF89a');
  assert.deepEqual(e.seeks,[.05,.1]);assert.equal(e.progress.at(-1),100);
  assert.equal(e.workers[0].terminated,true);assert.deepEqual(e.revoked,['blob:0']);
});
test('50% scales both dimensions before encoding; fps and palette settings reach output',async()=>{
  const e=environment({duration:.2});
  const blob=await e.convert('https://video.twimg.com/a.mp4',()=>{},new AbortController().signal,{gifScale:50,gifFps:10,gifColors:64});
  const bytes=Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.readUInt16LE(6),2);assert.equal(bytes.readUInt16LE(8),2);
  assert.deepEqual(e.draws,[[2,2],[2,2]]);assert.deepEqual(e.seeks,[.1]);
  // Fixed header (13) + loop extension (19) + graphic control (8) + image descriptor.
  assert.equal(bytes[49]&7,5); // 2^(5+1) = 64 palette entries.
});
test('duration limit rejects without producing a partial GIF; source blob is released',async()=>{
  const e=environment({duration:121});
  await assert.rejects(e.convert('https://video.twimg.com/a.mp4',()=>{},new AbortController().signal),/gifTooLarge/);
  assert.deepEqual(e.revoked,['blob:0']);assert.equal(e.workers.length,0);
});
test('network errors propagate; an aborted conversion stops before encoding',async()=>{
  const e=environment({fail:true});await assert.rejects(e.convert('https://video.twimg.com/a.mp4',()=>{},new AbortController().signal));
  const cancelled=environment();const controller=new AbortController();controller.abort();
  await assert.rejects(cancelled.convert('https://video.twimg.com/a.mp4',()=>{},controller.signal));
  assert.equal(cancelled.workers.length,0);assert.deepEqual(cancelled.revoked,[]);
});
test('abort terminates the worker and media decoder synchronously during pending work',async()=>{
  const e=environment({hangWorker:true}),controller=new AbortController();
  const pending=e.convert('https://video.twimg.com/a.mp4',()=>{},controller.signal);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(e.workers.length,1);
  controller.abort();
  // Check before awaiting the rejected promise: unload cannot rely on that turn.
  assert.equal(e.workers[0].terminated,true);assert.equal(e.video.paused,true);
  assert.equal(e.video.src,'');assert.deepEqual(e.revoked,['blob:0']);
  await assert.rejects(pending,/gifFailed/);
  assert.deepEqual(e.revoked,['blob:0']);
});
