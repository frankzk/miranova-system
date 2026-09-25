// Puente entre la página (inject.js) y el service worker de la extensión.
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.__miranova !== true) return;
  chrome.runtime.sendMessage({ type: "capture", url: e.data.url, payload: e.data.payload }).catch(() => {});
});
