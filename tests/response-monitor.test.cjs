const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function setup() {
  const filters=[],received=[],timers=new Map();let next=0;
  const context=vm.createContext({TextDecoder,setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../response-monitor.js'),'utf8'),context);
  const api={filterResponseData:()=>{
    const f={started:false,written:0,write(data){this.written+=data.byteLength;},close(){this.closed=true;},disconnect(){assert.equal(this.started,true);this.disconnected=true;}};
    filters.push(f);return f;
  }};
  const monitor=new context.XFDResponseMonitor(api,(tab,json)=>received.push([tab,json]));
  const capture=(tabId=1,start=true)=>{
    monitor.capture({tabId,requestId:String(filters.length)});
    const f=filters.at(-1);if(start){f.started=true;f.onstart();}return f;
  };
  return {monitor,filters,received,timers,capture};
}
const data=value=>({data:new TextEncoder().encode(value).buffer});
test('closed tab cannot repopulate cache and all buffered data is released',()=>{
  const e=setup(),f=e.capture();f.ondata(data('{"ok":true}'));
  assert.ok(e.monitor.buffered>0);e.monitor.clearTab(1);
  assert.equal(f.disconnected,true);assert.equal(e.monitor.buffered,0);assert.equal(e.timers.size,0);
  f.onstop();assert.equal(e.received.length,0);
});
test('shutdown before onstart defers disconnect until Firefox permits it',()=>{
  const e=setup(),f=e.capture(1,false);e.monitor.stop();
  assert.equal(f.disconnected,undefined);assert.equal(e.timers.size,0);
  f.started=true;f.onstart();
  assert.equal(f.disconnected,true);assert.equal(e.monitor.entries.size,0);
  e.monitor.capture({tabId:1,requestId:'new'});assert.equal(e.filters.length,1);
});
test('write/close errors and terminal network errors leave no tracked stream or timer',()=>{
  for(const kind of ['write','close','network']) {
    const e=setup(),f=e.capture();
    if(kind==='write')f.write=()=>{throw new Error('closed channel');};
    if(kind==='close')f.close=()=>{throw new Error('closed channel');};
    assert.doesNotThrow(()=>f.ondata(data('{}')));
    if(kind==='network')f.onerror();else f.onstop();
    assert.equal(e.monitor.entries.size,0);assert.equal(e.monitor.buffered,0);assert.equal(e.timers.size,0);
  }
});
test('idle timeout hands the live response back to Firefox',()=>{
  const e=setup(),f=e.capture();f.ondata(data('{'));
  [...e.timers.values()][0]();
  assert.equal(f.disconnected,true);assert.equal(f.closed,undefined);assert.equal(f.written,1);
  assert.equal(e.monitor.buffered,0);assert.equal(e.timers.size,0);
});
test('concurrent response memory is bounded and bytes still reach the page',()=>{
  const e=setup();
  for(let i=0;i<3;i++)e.capture(i).ondata({data:new ArrayBuffer(8*1024*1024)});
  const excess=e.capture(4);excess.ondata({data:new ArrayBuffer(1024)});
  assert.equal(excess.disconnected,true);assert.equal(excess.written,1024);
  assert.equal(e.monitor.buffered,24*1024*1024);
  e.monitor.stop();assert.equal(e.monitor.buffered,0);assert.equal(e.timers.size,0);
});
