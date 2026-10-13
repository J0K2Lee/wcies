/**
 * Print output contract (Sprint 7 T6.3, decision 0013 / planning §10.3.1).
 *
 * The browser consumes PrintTasks TODAY (new window + window.print()).
 * The future LOCAL PRINT AGENT (Sprint 8+, deliberately NOT built now -
 * printer model, label stock and courier selection are still unknown,
 * AGENTS.md §88) consumes the SAME task shape over localhost, so switching
 * only means adding a transport, not redesigning producers.
 *
 * Rules for producers:
 * - Always emit tasks through this type; never hand-build print HTML elsewhere.
 * - Code128 for SKU/BIN labels (decision 0007); the payload carries the raw
 *   value - the consumer owns symbology rendering.
 * - Copies is per-task; repeat the task instead of inventing batch types.
 */
export type PrintTask = SkuLabelTask | BinLabelTask | ShippingLabelTask;

export interface SkuLabelTask {
  readonly type: 'SKU_LABEL';
  readonly payload: {
    readonly barcode: string;
    /** Shown as the label title; the SKU CODE is deliberately NOT printed
     *  (2026-10-09 user instruction - the 6-digit barcode + name is enough
     *  for identification and keeps the small label short). */
    readonly skuName?: string;
    readonly copies: number;
  };
}

export interface BinLabelTask {
  /** Bin barcode IS the bin code itself (decision 0010: 编码即条码). */
  readonly type: 'BIN_LABEL';
  readonly payload: {
    readonly binCode: string;
    readonly warehouseCode?: string;
    readonly copies: number;
  };
}

export interface ShippingLabelTask {
  /** Platform/courier PDF reached via its (signed) URL. */
  readonly type: 'SHIPPING_LABEL';
  readonly payload: {
    readonly url: string;
    readonly copies: number;
  };
}
