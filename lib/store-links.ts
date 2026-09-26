// Enlaces a la ficha de una tienda. La tienda se identifica por cuenta + ID de la plataforma
// (store_id de order_facts: el sellerId, o "name:<nombre>" si la plataforma no lo manda).

export const storeHref = (accountId: string, storeId: string) =>
  `/stores/${encodeURIComponent(accountId)}/${encodeURIComponent(storeId)}`;
