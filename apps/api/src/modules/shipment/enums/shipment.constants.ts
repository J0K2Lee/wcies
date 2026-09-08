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
