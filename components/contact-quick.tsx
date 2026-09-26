// Acceso rápido al contacto de una tienda en los listados: abre su grupo de WhatsApp (o el chat
// con el dueño si solo hay teléfono); sin contacto, lleva a su ficha con el panel para agregarlo.
import Link from "next/link";
import { IconChat, IconPlus } from "./icons";
import { formatPhone, whatsappChat } from "@/lib/store-contacts";

export type QuickContact = { group: string | null; phone: string | null } | undefined;

/** Envuelto en un span para no heredar los estilos de los enlaces de la fila. */
export function ContactQuick(props: { c: QuickContact; storeHref: string; name: string }) {
  return <span className="qc-slot"><QuickLink {...props} /></span>;
}

function QuickLink({ c, storeHref, name }: { c: QuickContact; storeHref: string; name: string }) {
  if (c?.group) {
    return (
      <a className="qc qc-wa" href={c.group} target="_blank" rel="noopener noreferrer" title={`Abrir el grupo de WhatsApp de ${name}`}>
        <IconChat /> Grupo
      </a>
    );
  }
  if (c?.phone) {
    return (
      <a className="qc qc-wa" href={whatsappChat(c.phone)} target="_blank" rel="noopener noreferrer" title={`WhatsApp al dueño de ${name} (${formatPhone(c.phone)})`}>
        <IconChat /> WhatsApp
      </a>
    );
  }
  return (
    <Link className="qc qc-add" href={`${storeHref}#contacto`} title={`Agregar el grupo de WhatsApp de ${name}`}>
      <IconPlus /> Grupo
    </Link>
  );
}
