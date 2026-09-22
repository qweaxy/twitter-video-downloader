/* Local GIF89a encoder. No network, dependencies, or remote executable code. */
"use strict";
(() => {
  class Bytes {
    constructor() { this.chunks = []; this.buffer = new Uint8Array(65536); this.used = 0; this.length = 0; }
    byte(value) {
      if (this.length >= 128 * 1024 * 1024) throw new Error("gifTooLarge");
      if (this.used === this.buffer.length) {
        this.chunks.push(this.buffer); this.buffer = new Uint8Array(65536); this.used = 0;
      }
      this.buffer[this.used++] = value; this.length++;
    }
    word(value) { this.byte(value & 255); this.byte(value >>> 8); }
    text(value) { for (let i = 0; i < value.length; i++) this.byte(value.charCodeAt(i)); }
    array(values) { for (const value of values) this.byte(value); }
    finish() {
      const output = new Uint8Array(this.length); let offset = 0;
      for (const chunk of this.chunks) { output.set(chunk, offset); offset += chunk.length; }
      output.set(this.buffer.subarray(0, this.used), offset);
      return output;
    }
  }

  // Weighted median-cut over a 15-bit histogram; a fresh local palette per frame.
  function quantize(rgba,colors) {
    const counts = new Uint32Array(32768);
    const red = new Float64Array(32768), green = new Float64Array(32768), blue = new Float64Array(32768);
    const keys = [];
    for (let i = 0; i < rgba.length; i += 4) {
      const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
      if (!counts[key]++) keys.push(key);
      red[key] += rgba[i]; green[key] += rgba[i + 1]; blue[key] += rgba[i + 2];
    }
    function box(keys) {
      const low = [31,31,31], high = [0,0,0]; let weight = 0;
      for (const key of keys) {
        const channels = [key >> 10, (key >> 5) & 31, key & 31];
        for (let c = 0; c < 3; c++) { low[c] = Math.min(low[c],channels[c]); high[c] = Math.max(high[c],channels[c]); }
        weight += counts[key];
      }
      const ranges = high.map((v,c) => v - low[c]);
      const channel = ranges.indexOf(Math.max(...ranges));
      return {keys,weight,channel,score:keys.length > 1 ? ranges[channel] * Math.sqrt(weight) : -1};
    }
    const boxes = [box(keys)];
    while (boxes.length < colors) {
      let index = 0;
      for (let i = 1; i < boxes.length; i++) if (boxes[i].score > boxes[index].score) index = i;
      const current = boxes[index];
      if (current.score < 0) break;
      const shift = (2 - current.channel) * 5;
      current.keys.sort((a,b) => ((a >> shift) & 31) - ((b >> shift) & 31));
      let weight = 0, split = 0;
      while (split < current.keys.length - 1 && weight < current.weight / 2) weight += counts[current.keys[split++]];
      boxes[index] = box(current.keys.slice(0,split));
      boxes.push(box(current.keys.slice(split)));
    }
    const palette = new Uint8Array(colors * 3), mapping = new Uint8Array(32768);
    boxes.forEach((entry,index) => {
      let r = 0, g = 0, b = 0;
      for (const key of entry.keys) { mapping[key] = index; r += red[key]; g += green[key]; b += blue[key]; }
      palette[index * 3] = Math.round(r / entry.weight);
      palette[index * 3 + 1] = Math.round(g / entry.weight);
      palette[index * 3 + 2] = Math.round(b / entry.weight);
    });
    const indexed = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < indexed.length; i++) {
      const p = i * 4;
      indexed[i] = mapping[((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3)];
    }
    return {palette,indexed};
  }

  function lzw(out, pixels, minimumBits) {
    out.byte(minimumBits);
    const clear = 1 << minimumBits, end = clear + 1, first = clear + 2;
    const block = new Uint8Array(255); let used = 0, bits = 0, bitCount = 0;
    let width = minimumBits + 1, decoderNext = first, previous = false;
    function packedByte(value) {
      block[used++] = value;
      if (used === 255) { out.byte(used); out.array(block); used = 0; }
    }
    function code(value) {
      bits |= value << bitCount; bitCount += width;
      while (bitCount >= 8) { packedByte(bits & 255); bits >>>= 8; bitCount -= 8; }
      // Track decoder growth so width transitions also work before the end code.
      if (value === clear) { width = minimumBits + 1; decoderNext = first; previous = false; }
      else if (value !== end) {
        if (previous && decoderNext < 4096) {
          decoderNext++;
          if (decoderNext === (1 << width) && width < 12) width++;
        }
        previous = true;
      }
    }
    code(clear);
    let table = new Map(), next = first, prefix = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
      const value = pixels[i], key = prefix * 256 + value;
      const existing = table.get(key);
      if (existing !== undefined) { prefix = existing; continue; }
      code(prefix);
      if (next < 4096) table.set(key,next++);
      else { code(clear); table.clear(); next = first; }
      prefix = value;
    }
    code(prefix); code(end);
    if (bitCount) packedByte(bits & 255);
    if (used) { out.byte(used); out.array(block.subarray(0,used)); }
    out.byte(0);
  }

  class Encoder {
    constructor(width,height,colors = 256) {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
          width > 65535 || height > 65535 || width * height > 2073600) throw new Error("gifTooLarge");
      this.width = width; this.height = height; this.frames = 0; this.done = false;
      if (![64,128,256].includes(colors)) throw new Error("gifFailed");
      this.colors = colors;
      this.out = new Bytes();
      const out = this.out;
      out.text("GIF89a"); out.word(width); out.word(height); out.array([0x70,0,0]);
      out.array([0x21,0xff,11]); out.text("NETSCAPE2.0"); out.array([3,1,0,0,0]);
    }
    frame(rgba,delayMs) {
      if (this.done || rgba.length !== this.width * this.height * 4) throw new Error("gifFailed");
      const {palette,indexed} = quantize(rgba,this.colors), out = this.out;
      out.array([0x21,0xf9,4,4]); out.word(Math.max(2,Math.min(65535,Math.round(delayMs / 10)))); out.array([0,0]);
      out.byte(0x2c); out.word(0); out.word(0); out.word(this.width); out.word(this.height); out.byte(0x80 | (Math.log2(this.colors) - 1));
      out.array(palette); lzw(out,indexed,Math.log2(this.colors)); this.frames++;
    }
    finish() {
      if (this.done || !this.frames) throw new Error("gifFailed");
      this.done = true; this.out.byte(0x3b); return this.out.finish();
    }
  }
  globalThis.XFDGifEncoder = {Encoder};
})();
