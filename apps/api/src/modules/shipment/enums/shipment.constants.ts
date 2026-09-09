/**
 * Sprint 4 typed shipment constants (AGENTS.md §64; adding a value here is a
 * business-rule change and must be reflected in docs/business-rules/orders.md).
 */

/**
 * Shipment status (task §8) - the WAREHOUSE fulfillment ladder, never a
 * logistics-track status. DRAFT and EXCEPTION are part of the frozen set but
 * not entered by Sprint 4 flows (created shipments start READY_TO_PACK);
 * they exist for the future draft-creation / packing-anomaly flows.
 */
export const SHIPMENT_STATUSES = [
  'DRAFT',
  'READY_TO_PACK',
  'PACKING',
  'READY_TO_SHIP',
  'SHIPPED',
  'CANCELLED',
  'EXCEPTION',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * Package status (task §12/§44). REPACK_REQUIRED marks a SEALED package that
 * lost a line to an interception - it must be re-checked/re-sealed before the
 * shipment can ship again (auditable, not a silent re-open).
 */
export const PACKAGE_STATUSES = [
  'OPEN',
  'SEALED',
  'SHIPPED',
  'CANCELLED',
  'REPACK_REQUIRED',
] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

/**
 * Shipment / package line lifecycle (Sprint 4 follow-up).
 *
 * ACTIVE = the row is still a VALID COMPONENT of its parent (not voided). It
 * does NOT mean "not shipped yet": after a Shipment is SHIPPED its effective
 * shipment_items stay ACTIVE, which is the correct state. VOIDED = kept
 * forever as audit history (e.g. an interception returned the line to stock)
 * and never counted by any business calculation.
 */
export const SHIPMENT_ITEM_STATUSES = ['ACTIVE', 'VOIDED'] as const;
export type ShipmentItemStatus = (typeof SHIPMENT_ITEM_STATUSES)[number];

/** Package line lifecycle - same ACTIVE / VOIDED semantics as shipment items. */
export const PACKAGE_ITEM_STATUSES = ['ACTIVE', 'VOIDED'] as const;
export type PackageItemStatus = (typeof PACKAGE_ITEM_STATUSES)[number];

/** Packed serial lifecycle - VOIDED rows keep the "was packed here" history. */
export const PACKAGE_ITEM_SERIAL_STATUSES = ['ACTIVE', 'VOIDED'] as const;
export type PackageItemSerialStatus = (typeof PACKAGE_ITEM_SERIAL_STATUSES)[number];

/**
 * What caused a line to be voided. `void_source_id` is a POLYMORPHIC business
 * reference (uuid, no database FK): the Service layer validates the type and
 * that the referenced source exists.
 */
export const VOID_SOURCE_TYPES = ['ORDER_INTERCEPTION', 'MANUAL'] as const;
export type VoidSourceType = (typeof VOID_SOURCE_TYPES)[number];

/** Shipping label source (task §19): manual upload now, platform API later. */
export const SHIPPING_LABEL_SOURCES = ['MANUAL_UPLOAD', 'PLATFORM_API'] as const;
export type ShippingLabelSource = (typeof SHIPPING_LABEL_SOURCES)[number];

/** Shipping label type: Sprint 4 ships outbound labels only. */
export const SHIPPING_LABEL_TYPES = ['SHIPPING'] as const;
export type ShippingLabelType = (typeof SHIPPING_LABEL_TYPES)[number];

/** Business number prefixes. */
export const shipmentReserveKey = (shipmentId: string): string => `SHIPMENT:${shipmentId}`;
export const interceptionReturnKey = (interceptionId: string): string =>
  `INTERCEPT:${interceptionId}`;
