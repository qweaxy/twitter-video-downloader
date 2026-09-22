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
      [data-testid=caret]{border:0;background:transparent;color:inherit;width:32px;height:32px;font-size:22px}
      [data-testid=videoPlayer]{height:285px;border-radius:16px;border:1px solid #2f3336;background:#101820;display:grid;place-items:center;margin-top:18px}
      .play{font-size:44px;color:#e7e9ea}p{margin:8px 0}
    </style><article data-testid="tweet"><header><b>demo</b><a href="https://x.com/demo/status/100"><time>15 ч</time></a><span class="spacer"></span><div class="controls"><button data-testid="caret">⋯</button></div></header><p>Проверка кнопки скачивания</p><div data-testid="videoPlayer"><span class="play">▷</span></div></article>`);
    await page.evaluate(() => {
      window.mockCounts={'100':1,'200':2};window.downloadCalls=[];
      window.browser={runtime:{onMessage:{addListener:fn=>{window.fromBackground=fn;}},sendMessage:async m=>{
        if(m.type==='xfd:lookup')return Object.fromEntries(m.ids.map(id=>[id,window.mockCounts[id]||0]));
        if(m.type==='xfd:download'){window.downloadCalls.push(m);return {ok:true};}
      }}};
    });
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'content.css'),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'content.js'),'utf8')});
    const icon = page.locator('.xfd-button');await icon.waitFor();
    const [ib,cb]=await Promise.all([icon.boundingBox(),page.locator('[data-testid=caret]').boundingBox()]);
    assert.ok(ib.x < cb.x);assert.ok(Math.abs(ib.y-cb.y)<1);
    await icon.click();
    assert.equal(await page.evaluate(()=>downloadCalls[0].id),'100');
    // React-style DOM reuse must bind the existing button to the new post.
    await page.evaluate(()=>{document.querySelector('time').parentElement.href='https://x.com/demo/status/200';});
    await icon.click();
    const choice=page.getByRole('button',{name:'Скачать видео 2',exact:true});await choice.waitFor();
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
    // A later response re-enables the button without another DOM change.
    await page.evaluate(()=>{mockCounts['300']=1;fromBackground({type:'xfd:updated'});});
    await icon.waitFor();
    console.log('PASS: icon position, download ID, recycled posts, multiple videos, Escape, deduplication, delayed metadata');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
