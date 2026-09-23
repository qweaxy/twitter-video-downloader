"use strict";
(() => {
  class ResponseMonitor {
    constructor(api,onJSON) {
      this.api = api; this.onJSON = onJSON; this.entries = new Set();
      this.buffered = 0; this.stopped = false;
    }
    capture(details) {
      // Bound all buffered responses together, including streams awaiting headers.
      if (this.stopped || this.entries.size >= 32) return;
      let filter;
      try { filter = this.api.filterResponseData(details.requestId); } catch { return; }
      const entry = {tabId:details.tabId,started:false,abandoned:false,done:false,text:"",size:0,timer:null};
      const decoder = new TextDecoder();
      this.entries.add(entry);
      const releaseBuffer = () => { this.buffered -= entry.size; entry.size = 0; entry.text = ""; };
      const cleanup = () => {
        if (entry.done) return;
        entry.done = true; clearTimeout(entry.timer); releaseBuffer(); this.entries.delete(entry);
      };
      const disconnect = () => {
        if (entry.done) return;
        entry.abandoned = true; clearTimeout(entry.timer); releaseBuffer();
        // Firefox forbids disconnect() before onstart. In that state, keep only
        // a small callback to disconnect as soon as the response actually starts.
        if (!entry.started) return;
        try { filter.disconnect(); }
        catch { try { filter.close(); } catch { /* Already closed by Firefox. */ } }
        cleanup();
      };
      entry.disconnect = disconnect;
      const armTimeout = () => {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(disconnect,30000);
      };
      filter.onstart = () => {
        if (entry.done) return;
        entry.started = true;
        if (entry.abandoned || this.stopped) disconnect();
        else armTimeout();
      };
      filter.ondata = event => {
        if (entry.done) return;
        entry.started = true;
        try {
          // The page always receives the original bytes, even when we skip parsing.
          filter.write(event.data);
          if (entry.abandoned || this.stopped || entry.size + event.data.byteLength > 12 * 1024 * 1024 ||
              this.buffered + event.data.byteLength > 24 * 1024 * 1024) { disconnect(); return; }
          entry.size += event.data.byteLength; this.buffered += event.data.byteLength;
          entry.text += decoder.decode(event.data,{stream:true}); armTimeout();
        } catch { disconnect(); }
      };
      filter.onstop = () => {
        if (entry.done) return;
        const shouldParse = !entry.abandoned && !this.stopped;
        const text = entry.text;
        try { filter.close(); }
        catch { if (entry.started) { try { filter.disconnect(); } catch { /* Terminal stream. */ } } }
        cleanup();
        if (shouldParse) {
          try { this.onJSON(details.tabId,JSON.parse(text + decoder.decode())); }
          catch { /* Non-JSON, changed schema, or detached receiver. */ }
        }
      };
      filter.onerror = cleanup; // This is a terminal Firefox stream event.
      armTimeout();
    }
    clearTab(tabId) { for (const entry of this.entries) if (entry.tabId === tabId) entry.disconnect(); }
    stop() {
      if (this.stopped) return;
      this.stopped = true;
      for (const entry of this.entries) entry.disconnect();
    }
  }
  globalThis.XFDResponseMonitor = ResponseMonitor;
})();
