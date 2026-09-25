// Corre dentro de la página de Drop (world: MAIN). Observa las respuestas JSON
// que la propia web de Drop recibe de su API y, si parecen pedidos, las pasa
// a content.js. No hace peticiones nuevas ni lee tu contraseña o token.
(() => {
  if (window.__miranovaHooked) return;
  window.__miranovaHooked = true;

  const URL_HINT = /order|orden|pedido|shipment|despacho|dispatch/i;
  const BODY_HINT = /"(customer|cliente|dropshipper|carrier|paquetera|orderNumber|shippingAddress)"/i;
  const SKIP = /\.(js|css|png|jpe?g|svg|webp|woff2?)(\?|$)|google|facebook|sentry|intercom|hotjar|segment/i;

  function maybeSend(url, text) {
    try {
      if (!text || text.length > 5_000_000 || SKIP.test(url)) return;
      if (!URL_HINT.test(url) && !BODY_HINT.test(text)) return;
      const payload = JSON.parse(text);
      window.postMessage({ __miranova: true, url, payload }, window.location.origin);
    } catch (_) {
      /* no era JSON */
    }
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const url = res.url || String(args[0]?.url || args[0]);
        res.clone().text().then((t) => maybeSend(url, t)).catch(() => {});
      }
    } catch (_) {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__miranovaUrl = String(url);
    return origOpen.call(this, method, url, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        const ct = this.getResponseHeader("content-type") || "";
        if (!ct.includes("json")) return;
        const text =
          this.responseType === "" || this.responseType === "text"
            ? this.responseText
            : this.responseType === "json"
              ? JSON.stringify(this.response)
              : null;
        maybeSend(this.responseURL || this.__miranovaUrl, text);
      } catch (_) {}
    });
    return origSend.apply(this, args);
  };
})();
