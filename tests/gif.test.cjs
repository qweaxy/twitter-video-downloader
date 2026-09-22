const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const source=fs.readFileSync(path.join(__dirname,'../gif-encoder.js'),'utf8');
const ctx=vm.createContext({});vm.runInContext(source,ctx);
const {Encoder}=ctx.XFDGifEncoder;
test('GIF89a round-trips through Pillow: colors, dimensions, timing, animation, dictionary resets',()=>{
  const fixtures=[];
  for(const [width,height] of [[1,1],[17,13],[256,256]]) {
    const encoder=new Encoder(width,height),refs=[];
    let random=918273;
    for(let frame=0;frame<3;frame++) {
      const rgba=new Uint8Array(width*height*4),rgb=new Uint8Array(width*height*3);
      for(let i=0;i<width*height;i++) {
        random=(Math.imul(random,1664525)+1013904223)>>>0;
        // Exact 64-color palette. Noise forces 9/10/11/12-bit transitions and resets.
        const color=(random>>>16)&63;
        const values=[((color>>4)&3)*85,((color>>2)&3)*85,(color&3)*85];
        rgba.set([...values,255],i*4);rgb.set(values,i*3);
      }
      encoder.frame(rgba,50+frame*10);refs.push(Buffer.from(rgb).toString('base64'));
    }
    const bytes=encoder.finish();assert.equal(Buffer.from(bytes.subarray(0,6)).toString(),'GIF89a');
    fixtures.push({width,height,gif:Buffer.from(bytes).toString('base64'),rgb:refs});
  }
  const result=spawnSync('python3',['-c',`
import sys,json,base64,io
from PIL import Image
for f in json.load(sys.stdin):
 im=Image.open(io.BytesIO(base64.b64decode(f['gif'])))
 assert im.format=='GIF' and im.size==(f['width'],f['height'])
 assert im.n_frames==3 and im.info['loop']==0
 for i,expected in enumerate(f['rgb']):
  im.seek(i)
  assert im.info['duration']==50+i*10
  assert im.convert('RGB').tobytes()==base64.b64decode(expected)
print('Pillow verified all GIF frames, colors, timing and loops')
`],{input:JSON.stringify(fixtures),encoding:'utf8',maxBuffer:1024*1024});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/verified/);
});
test('invalid dimensions, incomplete frames and empty animations are rejected',()=>{
  assert.throws(()=>new Encoder(0,10));assert.throws(()=>new Encoder(4096,4096));
  const e=new Encoder(2,2);assert.throws(()=>e.finish());assert.throws(()=>e.frame(new Uint8Array(4),50));
});
