"use strict";
importScripts("gif-encoder.js");
let encoder;
self.onmessage = ({data}) => {
  try {
    if (data.type === "init") encoder = new XFDGifEncoder.Encoder(data.width,data.height,data.colors);
    else if (data.type === "frame") encoder.frame(new Uint8ClampedArray(data.rgba),data.delay);
    else if (data.type === "finish") {
      const bytes = encoder.finish();
      self.postMessage({bytes:bytes.buffer},[bytes.buffer]);
      return;
    }
    self.postMessage({ok:true});
  } catch (error) { self.postMessage({error:error.message}); }
};
