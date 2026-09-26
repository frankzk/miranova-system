// Contacto del dueño de una tienda: accesos rápidos (grupo de WhatsApp, chat y llamada),
// otras operaciones del mismo dueño y sugerencias para vincular las que parecen suyas.
import Link from "next/link";
import { ContactForm, StoreActionButton, type ContactState } from "./contact-forms";
import { IconChat, IconExternal, IconPhone } from "./icons";
import type { StoreContactView } from "@/lib/contacts";
import { formatPhone, whatsappChat, type Suggestion } from "@/lib/store-contacts";
import { storeHref } from "@/lib/store-links";

type Action = (prev: ContactState, form: FormData) => Promise<ContactState>;

export type StoreContactProps = {
  view: StoreContactView;
  store: { accountId: string; storeId: string; storeName: string };
  actions: { save: Action; link: Action; unlink: Action };
};

export function StoreContact({ view, store, actions }: StoreContactProps) {
  const { contact: c, siblings, suggestions, self } = view;
  const ops = siblings.length + 1;
  return (
    <section id="contacto" className="panel sd-contact" aria-labelledby="sd-contact-title">
      <div className="panel-head">
        <h2 id="sd-contact-title">Contacto del dueño</h2>
        <span className="aside">
          {!c ? "Sin contacto registrado" : !c.whatsapp_group_url ? "Sin grupo de WhatsApp" : ops > 1 ? `Mismo grupo en ${ops} operaciones` : "Grupo registrado"}
        </span>
      </div>

      {c ? (
        <div className="panel-body ct-body">
          <QuickLinks group={c.whatsapp_group_url} phone={c.owner_phone} />
          <dl className="sd-kv">
            <div><dt>Responsable</dt><dd>{c.owner_name || "—"}</dd></div>
            <div><dt>Teléfono</dt><dd>{c.owner_phone ? formatPhone(c.owner_phone) : "—"}</dd></div>
            <div><dt>Grupo</dt><dd>{c.whatsapp_group_url ? "Registrado" : <span className="ct-missing">Falta el enlace</span>}</dd></div>
            {c.notes && <div><dt>Notas</dt><dd className="ct-notes">{c.notes}</dd></div>}
          </dl>

          {siblings.length > 0 && (
            <div className="ct-block">
              <h3>También atiende</h3>
              <ul className="ct-list">
                {siblings.map((l) => {
                  const ref = { accountId: l.account_id, storeId: l.store_id, storeName: l.store?.name ?? l.store_name ?? "" };
                  return (
                    <li key={`${l.account_id}|${l.store_id}`}>
                      <div className="who">
                        <Link href={storeHref(l.account_id, l.store_id)}>{ref.storeName || "Tienda"}</Link>
                        <span className="muted">{l.store?.account_name ?? ""}</span>
                      </div>
                      <StoreActionButton action={actions.unlink} contactId={c.id} store={ref} label="Quitar" pending="…" className="btn btn-sm btn-ghost" />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <details className="fu-edit ct-edit">
            <summary>Editar contacto</summary>
            <ContactForm
              action={actions.save}
              store={store}
              defaults={{ group: c.whatsapp_group_url, phone: c.owner_phone, owner_name: c.owner_name, notes: c.notes }}
              submit="Guardar cambios"
            />
            <div className="ct-unlink">
              <StoreActionButton action={actions.unlink} contactId={c.id} store={store} label="Desvincular esta tienda" pending="Quitando…" className="btn btn-sm btn-danger" />
              <span className="muted">
                {siblings.length ? "Las demás operaciones conservan el contacto." : "Es la única tienda del contacto: se borrará."}
              </span>
            </div>
          </details>
        </div>
      ) : (
        <div className="panel-body ct-body">
          <p className="sd-note">
            Guarda el grupo de soporte de la tienda. Si el dueño tiene otras operaciones, pega el mismo enlace en sus fichas
            (o vincúlalas abajo) y quedarán en un solo contacto.
          </p>
          <ContactForm action={actions.save} store={store} defaults={{ owner_name: self?.person }} submit="Guardar contacto" />
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="ct-suggest">
          <h3>¿Mismo dueño en otra operación?</h3>
          <ul className="ct-list">
            {suggestions.map((s) => (
              <SuggestionRow key={`${s.store.account_id}|${s.store.store_id}`} s={s} mine={c?.id ?? null} store={store} actions={actions} />
            ))}
          </ul>
          <p className="ct-foot">
            Responsable según la plataforma{self?.person ? <> (en esta tienda: <b>{self.person}</b>)</> : null}. Un nombre parecido con otro
            responsable suele ser otra tienda: vincula solo si lo confirmaste.
          </p>
        </div>
      )}
    </section>
  );
}

/** Botones de acceso rápido al grupo y al dueño. */
export function QuickLinks({ group, phone, compact }: { group: string | null; phone: string | null; compact?: boolean }) {
  if (!group && !phone) return null;
  const size = compact ? " btn-sm" : "";
  return (
    <div className="ct-quick">
      {group && (
        <a className={`btn btn-wa${size}`} href={group} target="_blank" rel="noopener noreferrer">
          <IconChat /> Abrir grupo
        </a>
      )}
      {phone && (
        <a className={`btn${size}`} href={whatsappChat(phone)} target="_blank" rel="noopener noreferrer">
          <IconExternal /> WhatsApp al dueño
        </a>
      )}
      {phone && !compact && (
        <a className="btn btn-ghost" href={`tel:+${phone}`}>
          <IconPhone /> Llamar
        </a>
      )}
    </div>
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
  if (mine && !s.contact_id) {
    action = <StoreActionButton action={actions.link} contactId={mine} store={other} label="Vincular" pending="…" />;
  } else if (!mine && s.contact_id) {
    action = <StoreActionButton action={actions.link} contactId={s.contact_id} store={store} label="Usar su contacto" pending="…" />;
  } else if (mine && s.contact_id) {
    action = <span className="muted ct-note">Tiene otro contacto</span>;
  } else {
    action = <span className="muted ct-note">Sin contacto aún</span>;
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
