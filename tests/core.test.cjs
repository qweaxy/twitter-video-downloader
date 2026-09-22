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
function env(locale = 'en') {
  const callbacks={}, filters=[], downloads=[], messages=[];
  const event=name=>({addListener:fn=>{callbacks[name]=fn;}});
  const browser={
    i18n:{getMessage:key=>JSON.parse(fs.readFileSync(path.join(root,'_locales',locale,'messages.json'),'utf8'))[key]?.message || ''},
    webRequest:{onBeforeRequest:event('request'),filterResponseData:()=>{
      const f={chunks:[],write(data){this.chunks.push(Buffer.from(data));},close(){this.closed=true;},disconnect(){this.disconnected=true;}};
      filters.push(f);return f;
    }},
    tabs:{onRemoved:event('removed'),onUpdated:event('updated'),sendMessage:async (id,msg)=>{messages.push([id,msg]);}},
    runtime:{onMessage:event('message')},
    downloads:{download:async opts=>{downloads.push(opts);return 10;},onChanged:event('downloadChanged')}
  };
  const ctx=vm.createContext({URL,TextDecoder,browser});
  vm.runInContext(mediaSource,ctx);vm.runInContext(bgSource,ctx);
  return {ctx,callbacks,filters,downloads,messages};
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
test('quotes, retweets, multiple videos and GIFs stay attached to the correct post',()=>{
  const e=env();const child=tweet('200',[media(low)]);
  const quote={rest_id:'100',legacy:{},quoted_status_result:{result:child}};
  const retweet={rest_id:'300',legacy:{retweeted_status_result:{result:{tweet:child}}}};
  const own=tweet('400',[media(high)]);own.quoted_status_result={result:child};
  own.legacy.extended_entities.media.push({type:'animated_gif',video_info:{variants:[media(low)]}});
  const got=e.ctx.XFDMedia.extract({items:[quote,retweet,own]});
  assert.equal(got.get('100')[0].url,low);assert.equal(got.get('300')[0].url,low);
  assert.equal(got.get('400')[0].url,high);assert.equal(got.get('400').length,2);
  assert.equal(e.ctx.XFDMedia.extract(tweet('999',[])).size,0);
});
test('stream remains byte-exact, downloads cached post, rejects cross-tab or external senders',async()=>{
  const e=env();const {f,bytes}=capture(e,{caption:'Привет 🎬',data:tweet('100',[media(high)])});
  assert.deepEqual(Buffer.concat(f.chunks),bytes);assert.equal(f.closed,true);
  const counts=await e.callbacks.message({type:'xfd:lookup',ids:['100']},sender);
  assert.equal(counts['100'],1);
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
  assert.equal((await e.callbacks.message({type:'xfd:lookup',ids:['100']},sender))['100'],0);
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
