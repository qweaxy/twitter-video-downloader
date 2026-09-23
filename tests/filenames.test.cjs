const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({TextEncoder});
for(const file of ['filenames.js','settings.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
const f=context.XFDFilenames,s=context.XFDSettings;
const item={type:'video',sourceId:'123',author:'alex',createdAt:'2026-09-20T23:00:00-03:00',text:'Sea / sky: 🌊',width:1280,height:720};
test('all tags, source IDs, dates, separate GIF names, and default migration',()=>{
  const settings=s.normalize({videoTemplate:'{date}_{author}_{id}_{index}_{type}_{resolution}_{download_date}',gifTemplate:'{text}_{resolution}.gif',gifScale:50});
  assert.equal(f.build(settings,item,'999',1,new Date('2026-09-23T00:00:00Z')),'2026-09-21_alex_123_2_video_1280x720_2026-09-23.mp4');
  assert.equal(f.build(settings,{...item,type:'gif'},'999',0),'Sea _ sky_ 🌊_640x360.gif');
  assert.equal(f.build(s.normalize({}),{type:'video'},'999',0),'X_999_1.mp4');
  assert.equal(s.normalize({gifScale:50}).videoQuality,'best');
});
test('invalid templates cannot sneak in unknown or partial tags',()=>{
  for(const template of ['',null,' ','{bad}','{author','{{author}}','{}','x'.repeat(181)]) assert.ok(f.templateError(template));
  assert.equal(f.templateError('{author}_{id}'), '');
  assert.equal(s.normalize({videoTemplate:'{bad}',gifTemplate:'{text}'}).videoTemplate,'X_{id}_{index}');
  assert.equal(s.normalize({videoQuality:'4k'}).videoQuality,'best');
});
test('filename paths, reserved device names and Unicode are handled safely',()=>{
  assert.equal(f.clean('CON'),'_CON');assert.equal(f.clean('nul.txt'),'_nul.txt');
  const settings=s.normalize({videoTemplate:'../{text}',downloadFolder:'../../outside'});
  const name=f.build(settings,{...item,text:'../../../bad\\file\u0000.mp4'},'123',0);
  assert.equal(name.split('/').length,2);assert.ok(!name.startsWith('.'));assert.ok(!name.includes('\\'));assert.ok(!name.includes('\u0000'));
  assert.equal(f.clean('...','fallback'),'fallback');
  assert.ok(Buffer.byteLength(f.clean('🌊'.repeat(180)))<=180);
  assert.equal(f.clean('e\u0301'),'é');
});
test('post text is data, not another template; missing metadata has documented fallbacks',()=>{
  const settings=s.normalize({videoTemplate:'{author}_{date}_{resolution}_{text}'});
  assert.equal(f.build(settings,{type:'video'},'999',0),'unknown_unknown_unknown_999.mp4');
  assert.equal(f.build(s.normalize({videoTemplate:'{text}'}),{...item,text:'{author}'},'999',0),'{author}.mp4');
});
