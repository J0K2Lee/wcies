/**
 * Which tables a SKU delete touches, and how (decision 0008).
 *
 * Shared by the repository (which runs the statements) and the service (which
 * decides whether a delete is allowed), so both read one description instead
 * of each hardcoding its own table list.
 */

/**
 * Master-data children removed by a forced delete. These carry no business
 * history: barcodes, images, bundle links and platform mappings are all
 * re-creatable. Losing them costs the seller nothing but re-entry.
 *
 * The value lists every column holding a SKU id. One column is the norm; the
 * bundle table references a SKU twice (as bundle AND as component) and both
 * sides must be cleaned, so a single `sku_id` assumption does not hold.
 */
export const SKU_REFERENCE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  sku_barcodes: ['sku_id'],
  sku_images: ['sku_id'],
  platform_listing_skus: ['sku_id'],
  sku_bundle_components: ['bundle_sku_id', 'component_sku_id'],
};

/** Every table a forced delete cleans. */
export const SKU_CASCADE_TABLES: readonly string[] = [
  'sku_barcodes',
  'sku_images',
  'platform_listing_skus',
  'sku_bundle_components',
];

/**
 * WHERE fragment matching a SKU in `table`, plus the bind values.
 *
 * A SKU can appear in a table through more than one column (the bundle table
 * references it as both bundle and component), so the match is an OR across
 * every column that table declares.
 */
export function skuMatchCondition(
  table: string,
  skuId: string,
  firstParam = 1,
): { where: string; params: string[] } {
  const columns = SKU_REFERENCE_COLUMNS[table] ?? ['sku_id'];
  const where = columns.map((column, index) => `${column} = $${firstParam + index}`).join(' OR ');
  return { where, params: columns.map(() => skuId) };
}

/**
 * Business-history tables that always block a delete, forced or not
 * (AGENTS.md §25). An inventory ledger row, an order line or a picking record
 * is evidence that the SKU physically moved, so removing it would break the
 * audit chain and the inventory rules (AGENTS.md §10/§17).
 */
export const SKU_HISTORY_TABLES: readonly string[] = [
  'inventory_balances',
  'inventory_safety_stocks',
  'inventory_reservations',
  'inventory_serials',
  'inventory_transactions',
  'order_items',
  'picking_task_items',
  'package_items',
  'package_item_serials',
  'shipment_items',
];
