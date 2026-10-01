"use client";
import { useState } from "react";

type Props = {
  countries: { code: string; name: string }[]; country: string; period: string;
  from: string; to: string; today: string; age: string; includeCancelled: boolean;
};

export function DeliveryFilters(props: Props) {
  const [period, setPeriod] = useState(props.period);
  return <form action="/delivery-rates" method="get" className="delivery-filters">
    <label className="field"><span>País</span><select className="input" name="country" defaultValue={props.country}>
      <option value="">Todos los países</option>
      {props.countries.map((c) => <option value={c.code} key={c.code}>{c.name}</option>)}
    </select></label>
    <label className="field"><span>Pedidos creados</span><select className="input" name="r" value={period} onChange={(e) => setPeriod(e.target.value)}>
      <option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option>
      <option value="90">Últimos 90 días</option><option value="custom">Rango de fechas</option>
    </select></label>
    {period === "custom" && <>
      <label className="field"><span>Desde</span><input className="input" type="date" name="from" defaultValue={props.from} max={props.today} required /></label>
      <label className="field"><span>Hasta</span><input className="input" type="date" name="to" defaultValue={props.to || props.today} max={props.today} required /></label>
    </>}
    <label className="field"><span>Antigüedad mínima</span><select className="input" name="age" defaultValue={props.age}>
      <option value="0">Todos los pedidos</option><option value="7">7 días completos</option><option value="14">14 días completos</option>
    </select></label>
    <label className="field"><span>Base de completados</span><select className="input" name="cancelled" defaultValue={props.includeCancelled ? "1" : "0"}>
      <option value="0">Entregados + no entregados</option><option value="1">Incluir cancelados / rechazados</option>
    </select></label>
    <button className="btn btn-primary" type="submit">Aplicar filtros</button>
  </form>;
}
