-- Velocidad: las funciones y vistas que calculaban la tienda de cada pedido desde el `raw` de Drop
-- (coalesce(raw->'seller'->>'sellerId', raw->'user'->>'id', 'name:' || dropshipper), que obliga a
-- descomprimir el JSON de cada pedido) pasan a usar la columna orders.store_id (migración 0040),
-- que guarda exactamente ese valor.
--
-- Se reescriben sobre la definición vigente en la base (no se copian aquí 11 funciones largas):
-- se reemplaza solo esa expresión y se verifica que no quede ninguna. Antes de aplicarlo se probó
-- en producción con copias: las 11 funciones y las 2 vistas dan exactamente el mismo resultado,
-- entre 1,4 y 14 veces más rápido. Volver a correrlo no hace nada.

create or replace function pg_temp.store_rewrite(def text) returns text language plpgsql as $f$
begin
  -- order_growth: un pedido sin tienda cuenta como 'name:' (se conserva tal cual)
  def := regexp_replace(def, $re$coalesce\(\s*(\w+)\.raw\s*->\s*'seller'\s*->>\s*'sellerId'\s*,\s*\1\.raw\s*->\s*'user'\s*->>\s*'id'\s*,\s*'name:'\s*\|\|\s*coalesce\(\s*\1\.dropshipper\s*,\s*''\s*\)\s*\)$re$, $r$coalesce(\1.store_id, 'name:')$r$, 'gi');
  -- la forma de siempre (alias.raw …)
  def := regexp_replace(def, $re$coalesce\(\s*(\w+)\.raw\s*->\s*'seller'\s*->>\s*'sellerId'\s*,\s*\1\.raw\s*->\s*'user'\s*->>\s*'id'\s*,\s*'name:'\s*\|\|\s*\1\.dropshipper\s*\)$re$, '\1.store_id', 'gi');
  -- dashboard_summary agrupa (solo pedidos con tienda) sin el prefijo 'name:': mismos grupos
  def := regexp_replace(def, $re$coalesce\(\s*raw\s*->\s*'seller'\s*->>\s*'sellerId'\s*,\s*raw\s*->\s*'user'\s*->>\s*'id'\s*,\s*dropshipper\s*\)$re$, 'store_id', 'gi');
  -- vistas (así las devuelve pg_get_viewdef)
  def := regexp_replace(def, $re$COALESCE\(\(\((\w+)\.raw -> 'seller'::text\) ->> 'sellerId'::text\), \(\(\1\.raw -> 'user'::text\) ->> 'id'::text\), \('name:'::text \|\| \1\.dropshipper\)\)$re$, '\1.store_id', 'g');
  if def ilike '%sellerId%' then
    raise exception 'store_rewrite: quedó la expresión vieja en %', left(def, 160);
  end if;
  return def;
end
$f$;

do $do$
declare f record;
begin
  for f in
    select c.oid, c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and pg_get_viewdef(c.oid) ilike '%sellerId%'
  loop
    execute format('create or replace view public.%I%s as %s',
      f.relname,
      case when f.reloptions is null then '' else format(' with (%s)', array_to_string(f.reloptions, ', ')) end,
      rtrim(pg_temp.store_rewrite(pg_get_viewdef(f.oid)), E'; \n'));
  end loop;
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ilike '%sellerId%'
  loop
    execute pg_temp.store_rewrite(pg_get_functiondef(f.oid));
  end loop;
end
$do$;
