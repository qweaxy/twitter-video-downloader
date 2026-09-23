"use strict";
(() => {
  function outcome(item) {
    if (item?.state === "complete") return "complete";
    if (item?.state !== "interrupted" || item.paused || typeof item.error !== "string" || !item.error) return null;
    return item.error === "USER_CANCELED" ? "cancelled" : "failed";
  }
  function cancelled(error) {
    return /^Download cancel(?:ed|led)(?: by the user)?\.?$/i.test(error?.message || "");
  }
  globalThis.TVDDownloadStatus = {outcome,cancelled};
})();
