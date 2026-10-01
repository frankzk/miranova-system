// Contacto del dueño de una tienda: una barra bajo el título con los accesos rápidos (grupo de
// WhatsApp, chat con el dueño) y un panel lateral para editar, ver las otras operaciones del
// mismo dueño y vincular las que parecen suyas. Sin permiso de editar (actions = null) el panel
// es de solo lectura: sin formulario ni botones de vincular o quitar.
import Link from "next/link";
import { ContactForm, StoreActionButton, type ContactState } from "./contact-forms";
import { IconChat, IconExternal, IconMail, IconPhone, IconPlus } from "./icons";
import { SideSheet } from "./side-sheet";
import type { StoreContactView } from "@/lib/contacts";
import { formatPhone, storeEmail, whatsappChat, type Suggestion } from "@/lib/store-contacts";
import { storeHref } from "@/lib/store-links";

type Action = (prev: ContactState, form: FormData) => Promise<ContactState>;

export type StoreContactProps = {
  view: StoreContactView;
  store: { accountId: string; storeId: string; storeName: string };
  actions: { save: Action; link: Action; unlink: Action } | null;
};

/** Barra de contacto: quién es, cómo escribirle y el panel para gestionarlo. */
export function StoreContactBar({ view, store, actions }: StoreContactProps) {
  const { contact: c, siblings, suggestions, self } = view;
  const mail = storeEmail(c?.email, view.detectedEmail);
  const samePerson = suggestions.filter((s) => s.reason === "same_person");
  const person = c?.owner_name || self?.person;
  // solo lectura: el panel se muestra si hay algo que ver
  const showSheet = !!actions || !!c || suggestions.length > 0;

  return (
    <section className="ct-bar" data-state={c ? (c.whatsapp_group_url ? "ok" : "partial") : "missing"} aria-label="Contacto del dueño">
      <span className="ct-bar-icon" aria-hidden><IconChat /></span>
      <div className="ct-bar-text">
        <p className="ct-bar-title">
          {c ? (
            <>
              {person || "Contacto sin nombre"}
              {c.owner_phone && <span className="ct-bar-phone">{formatPhone(c.owner_phone)}</span>}
              {mail && <MailLink mail={mail} />}
            </>
          ) : (
            <>
              Sin grupo de WhatsApp
              {mail && <MailLink mail={mail} />}
            </>
          )}
        </p>
        <p className="ct-bar-sub">
          {c
            ? !c.whatsapp_group_url
              ? "Falta el enlace del grupo de soporte"
              : siblings.length
                ? `Mismo grupo en ${siblings.length + 1} operaciones: ${siblings.map((l) => opName(l.store?.name ?? l.store_name, l.store?.account_name)).join(", ")}`
                : "Grupo de soporte registrado"
            : samePerson.length
              ? `${person ? `${person} tiene` : "Mismo responsable en"} ${samePerson.length === 1 ? "otra operación" : `${samePerson.length} operaciones más`}: ${samePerson.map((s) => opName(s.store.name, s.store.account_name)).join(", ")}`
              : person
                ? `Responsable según la plataforma: ${person}`
                : "Guarda el grupo de soporte para escribirle en un clic"}
        </p>
      </div>
      <div className="ct-bar-actions">
        {c?.whatsapp_group_url && (
          <a className="btn btn-wa" href={c.whatsapp_group_url} target="_blank" rel="noopener noreferrer">
            <IconChat /> Abrir grupo
          </a>
        )}
        {c?.owner_phone && (
          <a className="btn" href={whatsappChat(c.owner_phone)} target="_blank" rel="noopener noreferrer" title={`WhatsApp a ${formatPhone(c.owner_phone)}`}>
            <IconExternal /> WhatsApp al dueño
          </a>
        )}
        {showSheet && (
          <SideSheet
            hash="contacto"
            triggerClass={c || !actions ? "btn btn-ghost" : "btn btn-primary"}
            trigger={!actions ? "Ver contacto" : c ? "Gestionar" : <><IconPlus /> Agregar contacto</>}
            title="Contacto del dueño"
            sub={<>{store.storeName}{self?.account_name && <> · {self.account_name}</>}</>}
          >
            <ContactSheet view={view} store={store} actions={actions} />
          </SideSheet>
        )}
      </div>
    </section>
  );
}

const opName = (name: string | null | undefined, account: string | null | undefined) =>
  `${name ?? "Tienda"}${account ? ` (${account.replace(/^Drop\s+/i, "")})` : ""}`;

/** Contenido del panel: accesos, datos, otras operaciones y sugerencias. */
function ContactSheet({ view, store, actions }: StoreContactProps) {
  const { contact: c, siblings, suggestions, self } = view;
  return (
    <>
      {c && (c.whatsapp_group_url || c.owner_phone) && (
        <div className="order-actions">
          {c.whatsapp_group_url && (
            <a className="btn btn-wa" href={c.whatsapp_group_url} target="_blank" rel="noopener noreferrer"><IconChat /> Abrir grupo</a>
          )}
          {c.owner_phone && (
            <a className="btn" href={whatsappChat(c.owner_phone)} target="_blank" rel="noopener noreferrer"><IconExternal /> WhatsApp al dueño</a>
          )}
          {c.owner_phone && <a className="btn btn-ghost" href={`tel:+${c.owner_phone}`}><IconPhone /> Llamar</a>}
        </div>
      )}

      {!actions && c && (
        <div className="section">
          <h3>Datos del contacto</h3>
          <dl className="sd-kv">
            <div><dt>Responsable</dt><dd>{c.owner_name || self?.person || "—"}</dd></div>
            <div><dt>Teléfono</dt><dd>{c.owner_phone ? formatPhone(c.owner_phone) : "—"}</dd></div>
            <div><dt>Correo de la tienda</dt><dd>{storeEmail(c.email, view.detectedEmail)?.email ?? "—"}</dd></div>
            <div><dt>Grupo de WhatsApp</dt><dd>{c.whatsapp_group_url ? "Registrado" : "—"}</dd></div>
            {c.notes && <div><dt>Notas</dt><dd>{c.notes}</dd></div>}
          </dl>
        </div>
      )}

      {actions && (
        <div className="section">
          <h3>{c ? "Datos del contacto" : "Nuevo contacto"}</h3>
          {!c && (
            <p className="sheet-note">
              Si el dueño tiene otras operaciones, usa el mismo grupo en todas: al pegar un enlace que ya existe, la tienda se suma a ese contacto.
            </p>
          )}
          <ContactForm
            action={actions.save}
            store={store}
            defaults={c ? { group: c.whatsapp_group_url, phone: c.owner_phone, owner_name: c.owner_name, email: c.email, notes: c.notes } : { owner_name: self?.person }}
            submit={c ? "Guardar cambios" : "Guardar contacto"}
          />
        </div>
      )}

      {c && siblings.length > 0 && (
        <div className="section">
          <h3>También atiende <span className="count">{siblings.length}</span></h3>
          <ul className="ct-list">
            {siblings.map((l) => {
              const ref = { accountId: l.account_id, storeId: l.store_id, storeName: l.store?.name ?? l.store_name ?? "" };
              return (
                <li key={`${l.account_id}|${l.store_id}`}>
                  <div className="who">
                    <Link href={storeHref(l.account_id, l.store_id)}>{ref.storeName || "Tienda"}</Link>
                    <span className="muted">{l.store?.account_name ?? ""}{l.store?.person && <> · {l.store.person}</>}</span>
                  </div>
                  {actions && <StoreActionButton action={actions.unlink} contactId={c.id} store={ref} label="Quitar" pending="…" className="btn btn-sm btn-ghost" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="section">
          <h3>¿Mismo dueño en otra operación?</h3>
          <ul className="ct-list">
            {suggestions.map((s) => (
              <SuggestionRow key={`${s.store.account_id}|${s.store.store_id}`} s={s} mine={c?.id ?? null} store={store} actions={actions} />
            ))}
          </ul>
          <p className="sheet-note">
            Responsable según la plataforma{self?.person ? <> (en esta tienda: <b>{self.person}</b>)</> : null}. Un nombre parecido con otro
            responsable suele ser otra tienda: vincula solo si lo confirmaste.
          </p>
        </div>
      )}

      {actions && c && (
        <div className="section ct-unlink">
          <StoreActionButton action={actions.unlink} contactId={c.id} store={store} label="Desvincular esta tienda" pending="Quitando…" className="btn btn-sm btn-danger" />
          <span className="muted">
            {siblings.length ? "Las demás operaciones conservan el contacto." : "Es la única tienda del contacto: se borrará."}
          </span>
        </div>
      )}
    </>
  );
}

function SuggestionRow({ s, mine, store, actions }: { s: Suggestion; mine: string | null; store: StoreContactProps["store"]; actions: StoreContactProps["actions"] }) {
  const tag = s.reason === "same_person"
    ? { tone: "success", label: "Mismo responsable" }
    : s.other_person
      ? { tone: "warning", label: "Otro responsable" }
      : { tone: "neutral", label: "Nombre parecido" };
  const other = { accountId: s.store.account_id, storeId: s.store.store_id, storeName: s.store.name };
  let action: React.ReactNode;
  if (!actions) {
    action = null;
  } else if (mine && !s.contact_id) {
    action = <StoreActionButton action={actions.link} contactId={mine} store={other} label="Vincular" pending="…" />;
  } else if (!mine && s.contact_id) {
    action = <StoreActionButton action={actions.link} contactId={s.contact_id} store={store} label="Usar su contacto" pending="…" />;
  } else {
    action = <span className="muted ct-note">{mine ? "Tiene otro contacto" : "Sin contacto aún"}</span>;
  }
  return (
    <li>
      <div className="who">
        <Link href={storeHref(s.store.account_id, s.store.store_id)}>{s.store.name}</Link>
        <span className="muted">
          {s.store.account_name}
          {s.store.person && <> · {s.store.person}</>}
        </span>
      </div>
      <span className="pill" data-tone={tag.tone}>{tag.label}</span>
      {action}
    </li>
  );
}

/**
 * Contacto dentro del panel lateral de Salud de tiendas: los datos a la vista, accesos para
 * escribir o llamar y la edición plegada. Vincular otras operaciones sigue en la ficha completa.
 */
export function StoreContactSection({ view, store, actions, fullHref }: StoreContactProps & { fullHref: string }) {
  const { contact: c, siblings, suggestions, self } = view;
  const person = c?.owner_name || self?.person;
  const mail = storeEmail(c?.email, view.detectedEmail);
  return (
    <div className="section sd-drawer-ct" id="contacto">
      <h3>Contacto</h3>
      {c ? (
        <>
          {(c.whatsapp_group_url || c.owner_phone) && (
            <div className="ct-quick">
              {c.whatsapp_group_url && (
                <a className="btn btn-wa" href={c.whatsapp_group_url} target="_blank" rel="noopener noreferrer"><IconChat /> Abrir grupo</a>
              )}
              {c.owner_phone && (
                <a className="btn" href={whatsappChat(c.owner_phone)} target="_blank" rel="noopener noreferrer"><IconExternal /> WhatsApp al dueño</a>
              )}
              {c.owner_phone && <a className="btn btn-ghost" href={`tel:+${c.owner_phone}`}><IconPhone /> Llamar</a>}
            </div>
          )}
          <dl className="kv">
            <dt>Responsable</dt>
            <dd>{person || "—"}</dd>
            <dt>Teléfono</dt>
            <dd>{c.owner_phone ? formatPhone(c.owner_phone) : "—"}</dd>
            <dt>Correo de la tienda</dt>
            <dd>{mail ? <MailLink mail={mail} /> : "—"}</dd>
            <dt>Grupo de WhatsApp</dt>
            <dd>{c.whatsapp_group_url ? "Registrado" : "Falta el enlace del grupo"}</dd>
            {c.notes && (
              <>
                <dt>Notas</dt>
                <dd>{c.notes}</dd>
              </>
            )}
            {siblings.length > 0 && (
              <>
                <dt>También atiende</dt>
                <dd>{siblings.map((l) => opName(l.store?.name ?? l.store_name, l.store?.account_name)).join(", ")}</dd>
              </>
            )}
          </dl>
          {actions && (
            <details className="ct-edit">
              <summary>Editar contacto</summary>
              <ContactForm
                action={actions.save}
                store={store}
                defaults={{ group: c.whatsapp_group_url, phone: c.owner_phone, owner_name: c.owner_name, email: c.email, notes: c.notes }}
                submit="Guardar cambios"
              />
            </details>
          )}
        </>
      ) : (
        <>
          <dl className="kv">
            <dt>Dueño según Drop</dt>
            <dd>{person || "—"}</dd>
            <dt>Correo de la tienda</dt>
            <dd>{mail ? <MailLink mail={mail} /> : "—"}</dd>
          </dl>
          <p className="sheet-note ct-none">Aún no hay grupo de WhatsApp ni teléfono guardado.</p>
          {actions && <ContactForm action={actions.save} store={store} defaults={{ owner_name: self?.person }} submit="Guardar contacto" />}
        </>
      )}
      {suggestions.length > 0 && (
        <p className="sheet-note ct-more">
          {suggestions.length === 1 ? "Hay 1 operación que podría ser" : `Hay ${suggestions.length} operaciones que podrían ser`} del mismo dueño.{" "}
          <Link href={`${fullHref}#contacto`} prefetch={false}>Revisar en la ficha</Link>
        </p>
      )}
    </div>
  );
}

/** Correo de la tienda con su origen: el del contacto o el detectado en los pedidos. */
function MailLink({ mail }: { mail: { email: string; source: "contacto" | "pedidos" } }) {
  return (
    <span className="ct-mail">
      <a href={`mailto:${mail.email}`}><IconMail /> {mail.email}</a>
      {mail.source === "pedidos" && <span className="ct-mail-src" title="Drop no manda el correo de la tienda: es el que la tienda pone en sus pedidos">detectado en los pedidos</span>}
    </span>
  );
}
