const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');

function environment({duration=.15,size=4*4,fail=false}={}) {
  const seeks=[],revoked=[],progress=[],workers=[],blobs=new Map();
  let frame=0;
  const video=new EventTarget();
  Object.assign(video,{duration,videoWidth:4,videoHeight:size/4,muted:false,preload:'',playsInline:false,
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
    postMessage(data){queueMicrotask(()=>this.self.onmessage({data}));}
    terminate(){this.terminated=true;}
  }
  const context=vm.createContext({
    XFDMedia:{mp4URL:url=>url},
    browser:{runtime:{getURL:name=>name}},
    Worker,Blob,setTimeout,clearTimeout,
    URL:{createObjectURL(blob){const url='blob:'+blobs.size;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},
    fetch:async()=>{if(fail)throw new Error('fetch failed');return new Response(new Uint8Array(8));},
    document:{createElement:name=>name==='video'?video:{getContext:()=>({drawImage(){},getImageData(){
      const data=new Uint8ClampedArray(size*4);for(let i=0;i<size;i++)data.set([frame*40,80,120,255],i*4);return {data};
    }})}}
  });
  vm.runInContext(fs.readFileSync(path.join(root,'gif-converter.js'),'utf8'),context);
  return {convert:context.XFDGif.convert,seeks,revoked,progress,workers};
}

test('converter seeks the full animation, uses real encoder worker and releases resources',async()=>{
  const e=environment();const blob=await e.convert('https://video.twimg.com/a.mp4',p=>e.progress.push(p),new AbortController().signal);
  assert.equal(blob.type,'image/gif');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0,6)).toString(),'GIF89a');
  assert.deepEqual(e.seeks,[.05,.1]);assert.equal(e.progress.at(-1),100);
  assert.equal(e.workers[0].terminated,true);assert.deepEqual(e.revoked,['blob:0']);
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
  assert.equal(cancelled.workers.length,0);assert.deepEqual(cancelled.revoked,['blob:0']);
});
