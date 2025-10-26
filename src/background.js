importScripts("./shared/settings.js");

const shared = self.FuriganaShared;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(null, (stored) => {
    const defaults = shared.DEFAULT_SETTINGS;
    const missing = {};
    let needsUpdate = false;
    Object.entries(defaults).forEach(([key, value]) => {
      if (typeof stored[key] === "undefined") {
        missing[key] = value;
        needsUpdate = true;
      }
    });
    if (needsUpdate) {
      chrome.storage.sync.set(missing);
    }
  });
});
