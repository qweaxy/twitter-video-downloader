const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'settings.js'),'utf8');
function setup(store={}) {
  const context=vm.createContext({TextEncoder,browser:{storage:{local:{get:async()=>store,set:async data=>{Object.assign(store,structuredClone(data));}}}}});
  vm.runInContext(fs.readFileSync(path.join(root,'filenames.js'),'utf8'),context);
  vm.runInContext(source,context);return context.XFDSettings;
}
test('settings persist across new contexts, and invalid/missing values get safe defaults',async()=>{
  const store={},s=setup(store);
  assert.equal((await s.load()).gifScale,100);
  await s.save({gifScale:50,gifFps:15,gifColors:128,saveLocation:'ask'});
  const restarted=setup(store),value=await restarted.load();
  assert.equal(value.gifScale,50);assert.equal(value.gifFps,15);assert.equal(value.gifColors,128);assert.equal(value.saveLocation,'ask');
  const invalid=s.normalize({gifScale:0,gifFps:1000,gifColors:'64',saveLocation:'bad',other:'ignored'});
  assert.equal(invalid.gifScale,10);assert.equal(invalid.gifFps,20);assert.equal(invalid.gifColors,256);assert.equal(invalid.saveLocation,'browser');
  assert.equal(Object.hasOwn(invalid,'other'),false);assert.equal(s.normalize({gifScale:Infinity}).gifScale,100);
  assert.equal(s.normalize({gifScale:200}).gifScale,100);
});
test('scale means percent of both dimensions with no zero-sized output',()=>{
  const s=setup();const half=s.dimensions(1280,720,50);
  assert.equal(half.width,640);assert.equal(half.height,360);
  assert.equal(half.width*half.height/(1280*720),.25);
  assert.equal(s.dimensions(1,1,10).width,1);
});
test('all frame rates preserve duration within GIF timing precision',()=>{
  const s=setup();
  for(const fps of [5,10,15,20,25,30]) for(const duration of [.02,.16,.21,1,1.03,17.37]) {
    const frames=s.framePlan(duration,fps);
    const sum=frames.reduce((total,f)=>total+f.delay,0);
    assert.ok(Math.abs(sum-duration*1000)<=10,`${fps} fps, ${duration}s: ${sum}ms`);
    assert.ok(frames.every(f=>f.delay>=20 && f.time<duration));
  }
});
test('options page and script labels are available in both languages',()=>{
  const html=fs.readFileSync(path.join(root,'options.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'options.js'),'utf8');
  const keys=[...html.matchAll(/data-i18n(?:-aria)?="([A-Za-z]+)"/g),...js.matchAll(/\b(?:t|message)\("([A-Za-z]+)"/g)].map(m=>m[1]);
  for(const locale of ['en','ru']) {
    const messages=JSON.parse(fs.readFileSync(path.join(root,'_locales',locale,'messages.json'),'utf8'));
    for(const key of keys)assert.ok(messages[key]?.message,`${locale}: ${key}`);
  }
});
