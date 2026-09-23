const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const mediaSource = fs.readFileSync(path.join(root, 'media.js'), 'utf8');
const bgSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
function media(url, bitrate = 100) { return {content_type:'video/mp4',url,bitrate}; }
function tweet(id, variants) {
  return {rest_id:id, legacy:{extended_entities:{media:[{type:'video',video_info:{variants}}]}}};
}
const low='https://video.twimg.com/ext_tw_video/1/pu/vid/320x180/low.mp4';
const high='https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/high.mp4?tag=12';
function env(locale = 'en', preferences) {
  const callbacks={}, filters=[], downloads=[], messages=[];
  const event=name=>({addListener:fn=>{callbacks[name]=fn;}});
  const browser={
    storage:{local:{get:async()=>({settings:preferences}),set:async value=>{preferences=value.settings;}}},
    browserAction:{onClicked:event('action')},
    i18n:{getMessage:key=>JSON.parse(fs.readFileSync(path.join(root,'_locales',locale,'messages.json'),'utf8'))[key]?.message || ''},
    webRequest:{onBeforeRequest:event('request'),filterResponseData:()=>{
      const f={chunks:[],write(data){this.chunks.push(Buffer.from(data));},close(){this.closed=true;},disconnect(){this.disconnected=true;}};
      filters.push(f);return f;
    }},
    tabs:{onRemoved:event('removed'),onUpdated:event('updated'),sendMessage:async (id,msg)=>{messages.push([id,msg]);}},
    runtime:{onMessage:event('message'),openOptionsPage:async()=>{messages.push(['options']);}},
    downloads:{download:async opts=>{downloads.push(opts);return 10;},search:async()=>[{state:'in_progress'}],onChanged:event('downloadChanged'),onErased:event('downloadErased')}
  };
  const ctx=vm.createContext({URL,TextDecoder,browser,AbortController,Blob,setTimeout,clearTimeout,
    addEventListener:(name,fn)=>{callbacks[name]=fn;}});
  vm.runInContext(fs.readFileSync(path.join(root,'settings.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(root,'response-monitor.js'),'utf8'),ctx);
  vm.runInContext(mediaSource,ctx);vm.runInContext(bgSource,ctx);
  return {ctx,callbacks,filters,downloads,messages,browser};
}
function capture(e, value, tabId=1) {
  e.callbacks.request({url:'https://x.com/i/api/graphql/hash/HomeTimeline',tabId,requestId:'1'});
  const f=e.filters.at(-1), bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));
  for(let i=0;i<bytes.length;i+=17){const b=bytes.subarray(i,i+17);f.ondata({data:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)});}
  f.onstop();return {f,bytes};
}
const sender={tab:{id:1,incognito:false},frameId:0,url:'https://x.com/home'};
test('chooses the highest bitrate MP4, ignores HLS and untrusted hosts',()=>{
  const e=env();const got=e.ctx.XFDMedia.extract({data:tweet('100',[
    media(low,10),media(high,200),media('https://evil.example/a.mp4',999),
    {content_type:'application/x-mpegURL',url:'https://video.twimg.com/a.m3u8',bitrate:900}
  ])});
  assert.equal(got.get('100')[0].url,high);
  for(const u of ['http://video.twimg.com/a.mp4','https://video.twimg.com.evil.example/a.mp4','https://x@video.twimg.com/a.mp4','https://video.twimg.com:88/a.mp4','https://video.twimg.com/a.m3u8']) assert.equal(e.ctx.XFDMedia.mp4URL(u),null);
});
test('closing a tab while settings load prevents a new conversion or download',async()=>{
  const e=env();capture(e,tweet('700',[media(low)]));
  let resolve;e.browser.storage.local.get=()=>new Promise(done=>{resolve=done;});
  const pending=e.callbacks.message({type:'xfd:download',id:'700'},sender);
  e.callbacks.removed(1);resolve({settings:{}});
  assert.equal((await pending).ok,false);assert.equal(e.downloads.length,0);
});
test('background shutdown detaches streams, cancels conversion and refuses new work',async()=>{
  const e=env();const post=tweet('701',[media(low)]);post.legacy.extended_entities.media[0].type='animated_gif';capture(e,post);
  let signal;
  e.ctx.XFDGif={convert:async(url,progress,s)=>{signal=s;return new Promise((resolve,reject)=>s.addEventListener('abort',()=>reject(new Error('gifFailed'))));}};
  const pending=e.callbacks.message({type:'xfd:download',id:'701'},sender);
  await new Promise(resolve=>setImmediate(resolve));
  e.callbacks.request({url:'https://x.com/i/api/graphql/hash/HomeTimeline',tabId:1,requestId:'late'});
  const stream=e.filters.at(-1);stream.onstart();
  e.callbacks.pagehide();e.callbacks.unload();
  assert.equal(signal.aborted,true);assert.equal(stream.disconnected,true);
  assert.equal((await pending).ok,false);assert.equal(e.downloads.length,0);
  const count=e.filters.length;
  e.callbacks.request({url:'https://x.com/i/api/graphql/hash/HomeTimeline',tabId:1,requestId:'new'});
  assert.equal(e.filters.length,count);
});
test('erasing a download releases its GIF blob immediately',async()=>{
  const e=env();const post=tweet('702',[media(low)]);post.legacy.extended_entities.media[0].type='animated_gif';capture(e,post);
  e.ctx.XFDGif={convert:async()=>new Blob(['GIF89a'],{type:'image/gif'})};
  await e.callbacks.message({type:'xfd:download',id:'702'},sender);
  e.callbacks.downloadErased(10);
  await assert.rejects(fetch(e.downloads[0].url));
});
test('quotes, retweets, multiple videos and GIFs stay attached to the correct post',()=>{
  const e=env();const child=tweet('200',[media(low)]);
  const quote={rest_id:'100',legacy:{},quoted_status_result:{result:child}};
  const retweet={rest_id:'300',legacy:{retweeted_status_result:{result:{tweet:child}}}};
  const own=tweet('400',[media(high)]);own.quoted_status_result={result:child};
  own.legacy.extended_entities.media.push({type:'animated_gif',video_info:{variants:[media(low)]}});
  const got=e.ctx.XFDMedia.extract({items:[quote,retweet,own]});
  assert.equal(got.get('100')[0].url,low);assert.equal(got.get('300')[0].url,low);
  assert.equal(got.get('400')[0].url,high);assert.equal(got.get('400').length,2);
  assert.equal(got.get('400')[0].type,'video');assert.equal(got.get('400')[1].type,'gif');
  assert.equal(e.ctx.XFDMedia.extract(tweet('999',[])).size,0);
});
test('stream remains byte-exact, downloads cached post, rejects cross-tab or external senders',async()=>{
  const e=env();const {f,bytes}=capture(e,{caption:'Привет 🎬',data:tweet('100',[media(high)])});
  assert.deepEqual(Buffer.concat(f.chunks),bytes);assert.equal(f.closed,true);
  const counts=await e.callbacks.message({type:'xfd:lookup',ids:['100']},sender);
  assert.deepEqual(Array.from(counts['100']),['video']);
  const ok=await e.callbacks.message({type:'xfd:download',id:'100'},sender);
  assert.equal(ok.ok,true);assert.equal(e.downloads[0].url,high);
  assert.equal(e.downloads[0].filename,'X_100_1.mp4');
  const missing=await e.callbacks.message({type:'xfd:download',id:'100'},{...sender,tab:{id:2}});
  assert.equal(missing.ok,false);
  await e.callbacks.message({type:'xfd:download',id:'100'},{...sender,url:'https://evil.example/'});
  assert.equal(e.downloads.length,1);
  e.callbacks.downloadChanged({id:10,state:{current:'complete'}});
  assert.equal(e.messages.at(-1)[1].ok,true);
  e.callbacks.removed(1);
  assert.equal((await e.callbacks.message({type:'xfd:lookup',ids:['100']},sender))['100'].length,0);
});
test('GIFs use converted image/gif blobs; videos keep direct MP4; blob URLs are released',async()=>{
  const e=env();const post=tweet('500',[media(low)]);post.legacy.extended_entities.media[0].type='animated_gif';
  capture(e,post);
  let converted=0;
  e.ctx.XFDGif={convert:async(url,progress,signal)=>{
    assert.equal(url,low);assert.equal(signal.aborted,false);converted++;progress(50);
    return new Blob(['GIF89a'],{type:'image/gif'});
  }};
  const result=await e.callbacks.message({type:'xfd:download',id:'500'},sender);
  assert.equal(result.ok,true);assert.equal(converted,1);
  assert.equal(e.downloads[0].filename,'X_500_1.gif');
  assert.ok(e.downloads[0].url.startsWith('blob:'));
  const response=await fetch(e.downloads[0].url);
  assert.equal(response.headers.get('content-type'),'image/gif');assert.equal(await response.text(),'GIF89a');
  e.callbacks.downloadChanged({id:10,state:{current:'complete'}});
  await assert.rejects(fetch(e.downloads[0].url));
  assert.equal(e.messages.at(-1)[1].kind,'gif');
});
test('failed conversion never silently downloads MP4 and does not keep the busy lock',async()=>{
  const e=env();const post=tweet('501',[media(low)]);post.legacy.extended_entities.media[0].type='animated_gif';capture(e,post);
  let attempts=0;
  e.ctx.XFDGif={convert:async()=>{attempts++;throw new Error('gifTooLarge');}};
  for(let i=0;i<2;i++) {
    const result=await e.callbacks.message({type:'xfd:download',id:'501'},sender);
    assert.equal(result.ok,false);assert.match(result.error,/limits/);
  }
  assert.equal(attempts,2);assert.equal(e.downloads.length,0);
});
test('only one GIF conversion runs; closing its tab cancels it',async()=>{
  const e=env();const post=tweet('502',[media(low)]);post.legacy.extended_entities.media[0].type='animated_gif';capture(e,post);
  let conversionSignal;
  e.ctx.XFDGif={convert:async(url,progress,signal)=>new Promise((resolve,reject)=>{
    conversionSignal=signal;signal.addEventListener('abort',()=>reject(new Error('gifFailed')),{once:true});
  })};
  const pending=e.callbacks.message({type:'xfd:download',id:'502'},sender);
  const second=await e.callbacks.message({type:'xfd:download',id:'502'},sender);
  assert.equal(second.ok,false);assert.match(second.error,/Another GIF/);
  e.callbacks.removed(1);assert.equal(conversionSignal.aborted,true);
  assert.equal((await pending).ok,false);assert.equal(e.downloads.length,0);
});
test('malformed and oversized responses leave the feed usable; DMs are ignored',()=>{
  const e=env();const {f,bytes}=capture(e,'not json');
  assert.deepEqual(Buffer.concat(f.chunks),bytes);assert.equal(f.closed,true);
  const before=e.filters.length;
  e.callbacks.request({url:'https://x.com/i/api/graphql/hash/DmInbox',tabId:1,requestId:'2'});
  assert.equal(e.filters.length,before);
  e.callbacks.request({url:'https://x.com/i/api/graphql/hash/TweetDetail',tabId:1,requestId:'3'});
  const big=e.filters.at(-1);big.ondata({data:new ArrayBuffer(12*1024*1024+1)});
  assert.equal(big.disconnected,true);assert.equal(big.chunks[0].length,12*1024*1024+1);
});
test('both locales cover every message; background errors use the selected catalog',async()=>{
  const en=JSON.parse(fs.readFileSync(path.join(root,'_locales/en/messages.json'),'utf8'));
  const ru=JSON.parse(fs.readFileSync(path.join(root,'_locales/ru/messages.json'),'utf8'));
  assert.deepEqual(Object.keys(en).sort(),Object.keys(ru).sort());
  const source=bgSource+fs.readFileSync(path.join(root,'content.js'),'utf8');
  for(const match of source.matchAll(/\bt\("([A-Za-z]+)"/g)) assert.ok(en[match[1]]?.message,match[1]);
  for(const locale of ['en','ru']) {
    const e=env(locale);
    const reply=await e.callbacks.message({type:'xfd:download',id:'404'},sender);
    assert.equal(reply.error,(locale==='en'?en:ru).linkMissing.message);
    assert.ok((locale==='en'?en:ru).downloadVideoNumber.placeholders.number.content==='$1');
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(manifest.default_locale,'en');
  assert.equal(manifest.description,'__MSG_extensionDescription__');
});
test('saved scale/fps/colors reach GIF conversion and saving preference reaches downloads',async()=>{
  const e=env('en',{gifScale:50,gifFps:10,gifColors:128,saveLocation:'ask'});
  const post=tweet('600',[media(low)]);post.legacy.extended_entities.media[0].type='animated_gif';capture(e,post);
  let used;
  e.ctx.XFDGif={convert:async(url,progress,signal,settings)=>{used=settings;return new Blob(['GIF89a'],{type:'image/gif'});}};
  assert.equal((await e.callbacks.message({type:'xfd:download',id:'600'},sender)).ok,true);
  assert.equal(used.gifScale,50);assert.equal(used.gifFps,10);assert.equal(used.gifColors,128);
  assert.equal(e.downloads[0].saveAs,true);
  e.callbacks.downloadChanged({id:10,state:{current:'complete'}});
  await e.browser.storage.local.set({settings:{saveLocation:'downloads'}});
  capture(e,tweet('601',[media(high)]));
  await e.callbacks.message({type:'xfd:download',id:'601'},sender);
  assert.equal(e.downloads[1].url,high);assert.equal(e.downloads[1].saveAs,false);
  await e.browser.storage.local.set({settings:{saveLocation:'browser'}});
  await e.callbacks.message({type:'xfd:download',id:'601'},sender);
  assert.equal(Object.hasOwn(e.downloads[2],'saveAs'),false);
  e.callbacks.action();assert.deepEqual(e.messages.at(-1),['options']);
});
