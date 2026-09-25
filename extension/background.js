// Agrupa las capturas y las envía al endpoint /api/ingest del panel.
let queue = [];
let timer = null;

async function getConfig() {
  const { serverUrl = "", apiKey = "" } = await chrome.storage.sync.get(["serverUrl", "apiKey"]);
  return { serverUrl: serverUrl.replace(/\/+$/, ""), apiKey };
}

async function setStatus(status) {
  await chrome.storage.local.set({ lastStatus: { ...status, at: new Date().toISOString() } });
  if (status.ok) {
    const { savedTotal = 0 } = await chrome.storage.local.get("savedTotal");
    const next = savedTotal + (status.saved || 0);
    await chrome.storage.local.set({ savedTotal: next });
    chrome.action.setBadgeBackgroundColor({ color: "#2f9e44" });
    chrome.action.setBadgeText({ text: status.saved ? String(status.saved) : "" });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: "#c92a2a" });
    chrome.action.setBadgeText({ text: "!" });
  }
}

async function flush() {
  timer = null;
  const batch = queue;
  queue = [];
  if (batch.length === 0) return;

  const { serverUrl, apiKey } = await getConfig();
  if (!serverUrl || !apiKey) {
    await setStatus({ ok: false, error: "Configura la URL del panel y la API key" });
    return;
  }
  try {
    const res = await fetch(`${serverUrl}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ batch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    await setStatus({ ok: true, saved: data.saved });
  } catch (err) {
    await setStatus({ ok: false, error: String(err.message || err) });
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "capture") return;
  queue.push({ url: msg.url, payload: msg.payload });
  if (!timer) timer = setTimeout(flush, 1500);
});
