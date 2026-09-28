import { IconBox, IconImage, IconPlus } from "./icons";
import { MediaPanel, type PanelItem } from "./media-panel";
import { SideSheet } from "./side-sheet";

/**
 * Miniatura del producto en el catálogo que abre sus fotos reales en un panel lateral.
 * La insignia dice cuántas hay; sin fotos, quien puede subirlas ve un "+".
 */
export function ProductPhotos({
  mediaKey, name, sku, image, countries, items, canEdit,
}: {
  mediaKey: string;
  name: string;
  sku: string | null;
  image: string | null;
  countries: string[];
  items: PanelItem[];
  canEdit: boolean;
}) {
  const n = items.length;
  const label = n ? `Fotos reales · ${n}` : canEdit ? "Fotos reales · subir las primeras" : "Fotos reales · aún no hay";
  return (
    <SideSheet
      triggerClass="pp-thumb"
      triggerLabel={label}
      title={name}
      sub={<>Fotos reales, solo para el equipo · {sku ? `SKU ${sku}` : "sin SKU"}{countries.length > 1 ? ` · las mismas en ${countries.join(", ")}` : ""}</>}
      trigger={
        <>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" loading="lazy" />
          ) : (
            <span className="ph" aria-hidden><IconBox /></span>
          )}
          <span className="pp-hover" aria-hidden><IconImage size={16} /></span>
          {n > 0 ? (
            <span className="pp-badge" aria-hidden><IconImage size={10} />{n}</span>
          ) : canEdit && (
            <span className="pp-badge" data-empty aria-hidden><IconPlus size={9} /></span>
          )}
        </>
      }
    >
      <MediaPanel mediaKey={mediaKey} name={name} items={items} canEdit={canEdit} />
    </SideSheet>
  );
}
