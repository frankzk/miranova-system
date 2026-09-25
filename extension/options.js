const $ = (id) => document.getElementById(id);

async function load() {
  const { serverUrl = "", apiKey = "" } = await chrome.storage.sync.get(["serverUrl", "apiKey"]);
  $("serverUrl").value = serverUrl;
  $("apiKey").value = apiKey;
  const { lastStatus, savedTotal = 0 } = await chrome.storage.local.get(["lastStatus", "savedTotal"]);
  if (lastStatus) {
    const when = new Date(lastStatus.at).toLocaleString();
    $("status").innerHTML = lastStatus.ok
      ? `<span class="ok">✓ Último envío ${when}: ${lastStatus.saved} pedidos.</span>\nTotal enviados: ${savedTotal}`
      : `<span class="err">✗ ${when}: ${lastStatus.error}</span>`;
  }
}

$("save").addEventListener("click", async () => {
  const serverUrl = $("serverUrl").value.trim().replace(/\/+$/, "");
  const apiKey = $("apiKey").value.trim();
  await chrome.storage.sync.set({ serverUrl, apiKey });
  // prueba de conexión: un lote vacío debe responder 200
  try {
    const res = await fetch(`${serverUrl}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ batch: [] }),
    });
    $("status").innerHTML = res.ok
      ? '<span class="ok">✓ Conectado. Ya puedes abrir tus órdenes en Drop.</span>'
      : `<span class="err">✗ El panel respondió ${res.status}. Revisa la API key.</span>`;
  } catch (e) {
    $("status").innerHTML = `<span class="err">✗ No se pudo conectar: ${e.message}</span>`;
  }
});

$("open").addEventListener("click", async () => {
  const { serverUrl } = await chrome.storage.sync.get("serverUrl");
  if (serverUrl) chrome.tabs.create({ url: serverUrl });
});

load();
