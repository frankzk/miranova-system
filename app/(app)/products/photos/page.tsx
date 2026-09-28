import Link from "next/link";
import { AccountChips } from "@/components/account-chips";
import { GetForm } from "@/components/client";
import { IconImage, IconPlay, IconSearch } from "@/components/icons";
import { MediaPanel, type PanelItem } from "@/components/media-panel";
import { ProductsSubnav } from "@/components/products-subnav";
import { SideSheet } from "@/components/side-sheet";
import { PageHead } from "@/components/ui";
import { listAccounts } from "@/lib/accounts";
import { requirePermission } from "@/lib/auth";
import { fmtInt } from "@/lib/format";
import { mediaKey } from "@/lib/media-rules";
import { can } from "@/lib/permissions";
import { listMedia, type MediaItem } from "@/lib/product-media";
import { listProducts } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { listUsers } from "@/lib/users";
import "./photos.css";

export const metadata = { title: "Fotos reales" };

type Group = { key: string; name: string; sku: string | null; image: string | null; countries: string[]; media: MediaItem[] };

const FILTERS = { con: "Con fotos", sin: "Sin fotos" } as const;
type Filter = keyof typeof FILTERS;

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default async function PhotosPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  const user = await requirePermission("products");
  const canEdit = can(user, "photos");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const f = sp.f && sp.f in FILTERS ? (sp.f as Filter) : undefined;
  const accounts = await listAccounts();
  const scope = await getScope(accounts);
  const [products, media, users] = await Promise.all([listProducts(scope.account), listMedia(), listUsers()]);

  const country = new Map(accounts.map((a) => [a.id, a.country]));
  const byKey = new Map<string, MediaItem[]>();
  for (const m of media) byKey.set(m.media_key, [...(byKey.get(m.media_key) ?? []), m]);

  // un grupo por SKU (compartido entre países) o, sin SKU, por producto de la cuenta
  const groups = new Map<string, Group>();
  for (const p of products) {
    const key = mediaKey(p);
    const g = groups.get(key) ?? { key, name: p.name, sku: p.sku?.trim() || null, image: null, countries: [], media: byKey.get(key) ?? [] };
    const c = country.get(p.account_id);
    if (c && !g.countries.includes(c)) g.countries.push(c);
    g.image ??= p.image_url;
    groups.set(key, g);
  }
  const all = [...groups.values()];
  const withMedia = all.filter((g) => g.media.length > 0).length;
  const last = (g: Group) => g.media.at(-1)?.created_at ?? "";
  const rows = all
    .filter((g) => !f || (f === "con") === g.media.length > 0)
    .filter((g) => !q || norm(`${g.name} ${g.sku ?? ""}`).includes(norm(q)))
    .sort((a, b) => (last(b) > last(a) ? 1 : last(b) < last(a) ? -1 : a.name.localeCompare(b.name, "es")));

  const who = new Map(users.map((u) => [u.id, u.name.split(" ")[0]]));
  const items = (g: Group): PanelItem[] =>
    g.media.map((m) => ({
      id: m.id, kind: m.kind, content_type: m.content_type, size_bytes: m.size_bytes, caption: m.caption, created_at: m.created_at,
      by: m.uploaded_by ? who.get(m.uploaded_by) ?? null : null,
    }));
  const href = (x: { f?: Filter; q?: string }) => {
    const s = new URLSearchParams();
    if (x.q) s.set("q", x.q);
    if (x.f) s.set("f", x.f);
    return `/products/photos${s.size ? `?${s}` : ""}`;
  };

  return (
    <div className="page">
      <PageHead
        title="Fotos reales"
        sub={<>Fotos y videos propios de cada producto, solo para el equipo · por SKU, las mismas en todos los países · {fmtInt(withMedia)} de {fmtInt(all.length)} productos con fotos</>}
      />
      <ProductsSubnav />
      <AccountChips accounts={accounts} current={scope.account} next={href({ f, q })} />

      <GetForm className="toolbar" role="search">
        {f && <input type="hidden" name="f" value={f} />}
        <label className="input-icon search">
          <span className="sr-only">Buscar producto</span>
          <IconSearch />
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Nombre o SKU" />
        </label>
        <button className="btn" type="submit">Buscar</button>
        <nav className="segmented" aria-label="Filtrar por fotos">
          <Link href={href({ q })} aria-current={!f ? "page" : undefined}>Todos</Link>
          <Link href={href({ q, f: "con" })} aria-current={f === "con" ? "page" : undefined}>Con fotos · {fmtInt(withMedia)}</Link>
          <Link href={href({ q, f: "sin" })} aria-current={f === "sin" ? "page" : undefined}>Sin fotos · {fmtInt(all.length - withMedia)}</Link>
        </nav>
      </GetForm>

      {rows.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <h3>{q ? "Ningún producto coincide" : f === "con" ? "Aún no hay fotos reales" : "No hay productos"}</h3>
            <p>{q ? "Prueba con otra parte del nombre o el SKU." : f === "con" ? "Abre un producto y sube sus fotos: quedan listas para copiar o descargar." : "Sincroniza el catálogo en Cuentas."}</p>
          </div>
        </div>
      ) : (
        <ul className="ph-grid">
          {rows.map((g) => {
            const cover = g.media.find((m) => m.kind === "photo");
            const photos = g.media.filter((m) => m.kind === "photo").length;
            const videos = g.media.length - photos;
            return (
              <li key={g.key}>
                <SideSheet
                  triggerClass="ph-card"
                  title={g.name}
                  sub={<>{g.sku ? `SKU ${g.sku}` : "Sin SKU"} · {g.countries.join(", ")}</>}
                  trigger={
                    <>
                      <span className="ph-thumb" data-empty={!cover || undefined}>
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/media/${cover.id}`} alt="" loading="lazy" decoding="async" />
                        ) : g.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={g.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                        ) : (
                          <IconImage size={22} />
                        )}
                        <span className="ph-count" data-none={g.media.length === 0 || undefined}>
                          {g.media.length === 0 ? "Sin fotos" : <>{photos > 0 && <><IconImage size={12} /> {photos}</>}{videos > 0 && <> <IconPlay size={11} /> {videos}</>}</>}
                        </span>
                      </span>
                      <span className="ph-name">{g.name}</span>
                      <span className="ph-sub">
                        {g.sku && <span className="tag">{g.sku}</span>}
                        {g.countries.map((c) => <span key={c} className="ph-cc">{c}</span>)}
                      </span>
                    </>
                  }
                >
                  <MediaPanel mediaKey={g.key} name={g.name} items={items(g)} canEdit={canEdit} />
                </SideSheet>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
