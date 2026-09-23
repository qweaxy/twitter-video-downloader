"use strict";
(() => {
  const defaultTemplate = "X_{id}_{index}";
  const tags = Object.freeze(["author","id","date","download_date","text","index","type","resolution"]);
  function templateError(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 180) return "nameTemplateInvalid";
    let unknown = false;
    const rest = value.replace(/\{([^{}]+)\}/g,(_,tag) => { if (!tags.includes(tag)) unknown = true; return ""; });
    return unknown || /[{}]/.test(rest) ? "nameTagInvalid" : "";
  }
  function clean(value,fallback = "X",maxBytes = 180) {
    let name = String(value ?? "").normalize("NFC")
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,"")
      .replace(/[\\/:*?"<>|]/g,"_").replace(/\s+/g," ").trim().replace(/^\.+|[. ]+$/g,"");
    const parts = Array.from(name), encoder = new TextEncoder();
    while (parts.length && encoder.encode(parts.join("")).length > maxBytes) parts.pop();
    name = parts.join("").replace(/[. ]+$/g,"");
    if (!name) name = fallback;
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    return name;
  }
  function day(value,fallback) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0,10) : fallback;
  }
  function build(settings,item,postId,index,now = new Date()) {
    const kind = item.type === "gif" ? "gif" : "video";
    const extension = kind === "gif" ? "gif" : "mp4";
    const proposed = kind === "gif" ? settings.gifTemplate : settings.videoTemplate;
    const template = templateError(proposed) ? defaultTemplate : proposed;
    const sourceId = /^\d+$/.test(item.sourceId || "") ? item.sourceId : String(postId);
    let width = Number(item.width) || 0, height = Number(item.height) || 0;
    if (kind === "gif" && width && height) {
      const scale = typeof settings.gifScale === "number" ? Math.max(10,Math.min(100,settings.gifScale)) : 100;
      width = Math.max(1,Math.round(width * scale / 100)); height = Math.max(1,Math.round(height * scale / 100));
    }
    const values = {
      author:item.author || "unknown", id:sourceId,
      date:day(item.createdAt,"unknown"), download_date:day(now,"unknown"),
      text:Array.from(item.text || sourceId).slice(0,80).join(""),
      index:String(index + 1), type:kind, resolution:width && height ? `${width}x${height}` : "unknown"
    };
     
    const expanded = template.replace(/\{([^{}]+)\}/g,(_,tag) => values[tag]);
    const basename = clean(expanded.replace(/\.(mp4|gif)$/i,""),`X_${postId}_${index + 1}`);
    const folder = settings.downloadFolder ? clean(settings.downloadFolder,"",80) : "";
    return `${folder ? folder + "/" : ""}${basename}.${extension}`;
  }
  globalThis.XFDFilenames = {defaultTemplate,tags,templateError,clean,build};
})();
