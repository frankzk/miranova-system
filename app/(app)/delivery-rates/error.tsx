"use client";
export default function DeliveryRatesError({ reset }: { reset: () => void }) {
  return <div className="page"><div className="panel empty" role="alert"><h2>No pudimos cargar las tasas de entrega</h2>
    <p>No se muestran cifras parciales. Vuelve a intentarlo o elige un período más corto.</p>
    <button className="btn btn-primary" onClick={reset}>Volver a intentar</button></div></div>;
}
