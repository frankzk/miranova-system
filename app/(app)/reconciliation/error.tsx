"use client";
export default function BankError({ reset }: { reset: () => void }) {
  return (
    <div className="page">
      <h1>Conciliación bancaria</h1>
      <p className="banner" data-tone="danger" role="alert">
        No se pudieron cargar los movimientos. Verifica la conexión y que la
        migración de conciliación bancaria esté aplicada.
      </p>
      <button className="btn" onClick={reset}>
        Volver a cargar
      </button>
    </div>
  );
}
