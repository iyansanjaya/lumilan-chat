import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { record } from './shared/model.js';

test('platform icon assets preserve branding and macOS has a transparent safe area', async()=>{
  const config=record(record(JSON.parse(await readFile('package.json','utf8'))).build);
  const mac=record(config.mac);
  assert.equal(record(config.win).icon,'build/icon.ico');
  assert.equal(record(config.linux).icon,'build/icon.png');
  assert.equal(mac.icon,'build/icon-mac.icns');
  const {data,info}=await sharp('build/icon-mac.svg').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,1024);assert.equal(info.height,1024);
  assert.equal(data.length, info.width*info.height*4);
  let left=info.width,right=0,top=info.height,bottom=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]!>8){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  assert(left>=99&&top>=99&&right<=924&&bottom<=924,`macOS icon fills its canvas: ${[left,top,right,bottom]}`);
  const center=(512*info.width+512)*4;
  assert.equal(data[center+3],255,'Icon lost its opaque brand artwork');
  assert(typeof mac.icon==='string');
  const icns=await readFile(mac.icon);
  assert.equal(icns.toString('ascii',0,4),'icns');assert.equal(icns.readUInt32BE(4),icns.length);
  const sizes=new Set<number>();
  for(let offset=8;offset<icns.length;) {
    const length=icns.readUInt32BE(offset+4);
    assert(length>=8&&offset+length<=icns.length);
    const {data:pixels,info:representation}=await sharp(icns.subarray(offset+8,offset+length)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const side=representation.width;assert.equal(representation.height,side);sizes.add(side);
    const margin=Math.floor(side*.09);
    for(let y=0;y<side;y++)for(let x=0;x<side;x++)if(x<margin||y<margin||x>=side-margin||y>=side-margin)
      assert(pixels[(y*side+x)*4+3]!<=8,`ICNS ${side}px lost its safe area`);
    assert.equal(pixels[(Math.floor(side/2)*side+Math.floor(side/2))*4+3],255);
    offset+=length;
  }
  assert.deepEqual([...sizes].sort((a,b)=>a-b),[16,32,64,128,256,512,1024]);
});
