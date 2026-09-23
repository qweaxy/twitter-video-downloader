// Synthetic DOM check; does not load X or emulate Firefox's extension runtime.
const {chromium} = require(require.resolve('playwright', {paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || process.cwd()]}));
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
(async () => {
  const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:660,height:530}});
    await page.setContent(`<style>
      body{background:#000;color:#e7e9ea;font:15px system-ui;margin:0}
      article{width:566px;padding:18px 22px;border:1px solid #2f3336;margin:20px auto}
      header{display:flex;align-items:center;gap:9px} a{color:#71767b;text-decoration:none}
      .spacer{flex:1}.controls{display:flex;flex-direction:column;color:#71767b}
      [data-testid=caret]{border:0;padding:0;background:transparent;color:#e7e9ea;width:20px;height:20px}
      [data-testid=caret] svg{width:18px;height:18px;color:#71767b}
      [data-testid=videoPlayer]{height:285px;border-radius:16px;border:1px solid #2f3336;background:#101820;display:grid;place-items:center;margin-top:18px}
      .play{font-size:44px;color:#e7e9ea}p{margin:8px 0}
    </style><article data-testid="tweet"><header><b>demo</b><a href="https://x.com/demo/status/100"><time>15 ч</time></a><span class="spacer"></span><div class="controls"><button data-testid="caret"><svg viewBox="0 0 24 24"><circle fill="currentColor" cx="12" cy="12" r="2"/></svg></button></div></header><p>Проверка кнопки скачивания</p><div data-testid="videoPlayer"><span class="play">▷</span></div></article>`);
    const before={header:await page.locator('header').boundingBox(),text:await page.locator('p').boundingBox(),video:await page.locator('[data-testid=videoPlayer]').boundingBox()};
    const catalog=JSON.parse(fs.readFileSync(path.join(root,'_locales/en/messages.json'),'utf8'));
    await page.evaluate(catalog=>{window.catalog=catalog;},catalog);
    await page.evaluate(() => {
      window.mockCounts={'100':1,'200':2};window.downloadCalls=[];
      window.browser={i18n:{getMessage:(key,value)=>window.catalog[key]?.message.replace('$NUMBER$',value)||''},runtime:{onMessage:{addListener:fn=>{window.fromBackground=fn;}},sendMessage:async m=>{
        if(m.type==='xfd:lookup')return Object.fromEntries(m.ids.map(id=>[id,Array(window.mockCounts[id]||0).fill('video')]));
        if(m.type==='xfd:download'){window.downloadCalls.push(m);return {ok:true};}
      }}};
    });
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'content.css'),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'content.js'),'utf8')});
    const icon = page.locator('.xfd-button');await icon.waitFor();
    const [ib,cb]=await Promise.all([icon.boundingBox(),page.locator('[data-testid=caret]').boundingBox()]);
    assert.ok(ib.x+ib.width < cb.x);assert.ok(Math.abs(ib.y+ib.height/2-cb.y-cb.height/2)<1);
    assert.deepEqual(await page.locator('header').boundingBox(),before.header);
    assert.deepEqual(await page.locator('p').boundingBox(),before.text);
    assert.deepEqual(await page.locator('[data-testid=videoPlayer]').boundingBox(),before.video);
    assert.equal(await icon.evaluate(el=>getComputedStyle(el).color),'rgb(113, 118, 123)');
    assert.equal(await icon.getAttribute('title'),'Download video');
    assert.equal(await page.locator('.xfd-slot').count(),1);
    await icon.click();
    assert.equal(await page.evaluate(()=>downloadCalls[0].id),'100');
    // React-style DOM reuse must bind the existing button to the new post.
    await page.evaluate(()=>{document.querySelector('time').parentElement.href='https://x.com/demo/status/200';});
    await icon.click();
    const choice=page.getByRole('menuitem',{name:'Download video 2',exact:true});await choice.waitFor();
    const menu=page.getByRole('menu');
    assert.equal(await menu.locator('button svg').count(),2);
    assert.equal(await menu.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)');
    assert.equal(await choice.evaluate(el=>getComputedStyle(el).fontWeight),'700');
    assert.equal(await menu.evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
    await page.keyboard.press('ArrowDown');assert.equal(await choice.evaluate(el=>document.activeElement===el),true);
    await choice.click();assert.equal(await page.evaluate(()=>downloadCalls.at(-1).index),1);
    assert.equal(await page.evaluate(()=>downloadCalls.at(-1).id),'200');
    await icon.click();await choice.waitFor();await page.keyboard.press('Escape');
    assert.equal(await page.locator('.xfd-panel').count(),0);
    assert.equal(await icon.evaluate(el=>document.activeElement===el),true);
    await page.evaluate(()=>{for(let i=0;i<10;i++)document.querySelector('article').append(document.createElement('span'));});
    await page.waitForTimeout(300);assert.equal(await page.locator('.xfd-button').count(),1);
    // A recycled text-only post loses its video button.
    await page.evaluate(()=>{document.querySelector('time').parentElement.href='https://x.com/demo/status/300';document.querySelector('[data-testid=videoPlayer]').remove();});
    await page.waitForTimeout(300);assert.equal(await page.locator('.xfd-button').count(),0);
    assert.equal(await page.locator('.xfd-slot').count(),0);
    // A later response re-enables the button without another DOM change.
    await page.evaluate(()=>{mockCounts['300']=1;fromBackground({type:'xfd:updated'});});
    await icon.waitFor();
    // Regression: long names must give up width to the button, including when
    // X wraps its native menu in a column. Header height and body offsets stay put.
    for (const controlsDirection of ['column','row']) {
      for (const width of [566,360,280]) {
        await page.evaluate(({width,controlsDirection})=>{
          document.querySelector('article').remove();
          const article=document.createElement('article');article.dataset.testid='tweet';
          article.style.width=`${width}px`;
          article.innerHTML=`<header style="gap:0"><div class="identity" style="display:flex;flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap"><b style="overflow:hidden;text-overflow:ellipsis">A deliberately very long display name that should never cover a download control</b><span style="overflow:hidden;text-overflow:ellipsis;min-width:0"> @a_very_long_handle</span><a href="https://x.com/demo/status/100" style="flex-shrink:0"><time> · 14h</time></a></div><div class="controls" style="display:flex;flex-direction:${controlsDirection};flex-shrink:0"><button data-testid="caret"><svg viewBox="0 0 24 24"><circle fill="currentColor" cx="12" cy="12" r="2"/></svg></button></div></header><p>Post body must not move down</p><div data-testid="videoPlayer">Video</div>`;
          document.body.append(article);
        },{width,controlsDirection});
        const initial={
          header:await page.locator('header').boundingBox(),
          text:await page.locator('p').boundingBox(),
          video:await page.locator('[data-testid=videoPlayer]').boundingBox()
        };
        await icon.waitFor();
        const buttonBox=await icon.boundingBox();
        const identity=await page.locator('.identity').boundingBox();
        const more=await page.locator('[data-testid=caret]').boundingBox();
        assert.ok(identity.x+identity.width<=buttonBox.x+.5,`overlap at ${width}px/${controlsDirection}`);
        assert.ok(buttonBox.x+buttonBox.width<=more.x,`menu overlap at ${width}px`);
        assert.deepEqual(await page.locator('header').boundingBox(),initial.header);
        assert.deepEqual(await page.locator('p').boundingBox(),initial.text);
        assert.deepEqual(await page.locator('[data-testid=videoPlayer]').boundingBox(),initial.video);
        assert.ok(await icon.evaluate(button=>{
          const r=button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
        }),'button center must receive clicks');
        const oldCount=await page.evaluate(()=>downloadCalls.length);
        await icon.click();
        assert.equal(await page.evaluate(()=>downloadCalls.length),oldCount+1);
      }
    }
    console.log('PASS: long names, narrow headers, row/column wrappers, hit target, unchanged body offsets, recycled posts, multiple videos');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
