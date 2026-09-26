// Seguimiento comercial de una tienda (responsable, último contacto, recomendación, próximo paso).
// Marcador: lo implementa el módulo de seguimiento; la ficha de tienda ya lo incluye con estas props.

export type StoreFollowupsProps = {
  accountId: string;
  storeId: string;
  storeName: string;
  currency: string;
};

export async function StoreFollowups(_props: StoreFollowupsProps) {
  return null;
}
