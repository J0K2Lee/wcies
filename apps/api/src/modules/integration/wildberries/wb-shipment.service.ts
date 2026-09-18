import { Injectable } from '@nestjs/common';
import { PlatformLabelFile, PlatformShipmentPreparation } from '@wcies/platform-contracts';
import { parseWbAuthCredential } from './wb.adapter';
import { WbAuth, WbClient } from './wb.client';
import { WbV3OrderStatus } from './types/api.types';
import { DomainError } from '../../../common/errors/domain.error';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/**
 * WB seller statuses meaning the order has ALREADY been handed into the
 * supply flow, so there is nothing left for `prepareShipment` to do. Verified
 * vocabulary: docs/wb-orders-fbs-openapi.yaml (POST /api/v3/orders/status).
 *
 * `confirm` = in assembly (the seller put the order into a supply),
 * `complete` = in delivery (the supply was handed over / scanned by WB).
 */
const WB_PREPARED_STATUSES: ReadonlySet<string> = new Set(['confirm', 'complete']);

/** Supply name prefix so platform-side supplies are traceable to WCIES. */
const SUPPLY_NAME_PREFIX = 'WCIES-';

/** Sticker request: 58x40 png is WB's thermal-label size. */
const STICKER_WIDTH = 58;
const STICKER_HEIGHT = 40;

/**
 * WB outbound-shipment operations (2026-09-18 order fulfillment flow).
 *
 * STRUCTURAL DIFFERENCE from OZON/Yandex (docs/integrations/wildberries.md
 * §9): WB has NO per-order "ship" write. The seller-side state machine is
 * supply-driven, and the only seller path into `confirm` is putting the order
 * into a supply. Confirmed mapping (user 2026-09-18): ONE DEDICATED SUPPLY PER
 * ORDER, named `WCIES-<platformOrderId>`.
 *
 * Therefore `prepareShipment` = "join a supply" (order -> `confirm`), which is
 * what unblocks the sticker fetch. It deliberately does NOT call
 * `supplies/{id}/deliver`: that would tell the platform "in delivery" while
 * the goods are still on our shelf - the `complete` fact arrives when WB
 * scans the supply at handover, and flows back through the regular order sync.
 *
 * IDEMPOTENCY: the order status is READ first; `confirm` / `complete` orders
 * produce NO write at all.
 */
@Injectable()
export class WbShipmentService {
  constructor(
    private readonly client: WbClient,
    private readonly logger: AppLoggerService,
  ) {}

  async prepareShipment(
    context: { storeId: string; credential: Readonly<Record<string, unknown>> },
    order: { platformOrderId: string },
  ): Promise<PlatformShipmentPreparation> {
    const auth = parseWbAuthCredential(context.credential, context.storeId);
    const orderId = parseWbOrderId(order.platformOrderId);

    const before = await this.readStatus(auth, context.storeId, orderId);
    if (before !== null && WB_PREPARED_STATUSES.has(before.supplierStatus ?? '')) {
      return {
        platformOrderId: order.platformOrderId,
        trackingNumber: null,
        platformStatus: before.supplierStatus ?? null,
        alreadyPrepared: true,
      };
    }
    if (before === null) {
      throw new WbOrderNotPreparableError('WB 未返回该订单的组货状态，无法发货', {
        platformOrderId: order.platformOrderId,
      });
    }
    if (before.supplierStatus === 'cancel' || before.supplierStatus === 'cancel_carrier') {
      throw new WbOrderNotPreparableError('该 WB 订单已取消，不能发货', {
        platformOrderId: order.platformOrderId,
        supplierStatus: before.supplierStatus,
      });
    }
    if (before.supplierStatus !== 'new') {
      // Anything else is a state we have not verified a transition from -
      // reported, never guessed (AGENTS.md §88).
      throw new WbOrderNotPreparableError(`WB 订单当前状态（${before.supplierStatus}）不允许发货`, {
        platformOrderId: order.platformOrderId,
        supplierStatus: before.supplierStatus,
      });
    }

    // One dedicated supply per order (user-confirmed mapping). Reusing a fixed
    // name does NOT dedupe - WB always creates a NEW supply - so idempotency
    // comes from the status read above, not from the name.
    const supply = await this.client.v3CreateSupply(auth, context.storeId, {
      name: `${SUPPLY_NAME_PREFIX}${order.platformOrderId}`,
    });
    await this.client.v3AddOrdersToSupply(auth, context.storeId, {
      supplyId: supply.id,
      orderIds: [orderId],
    });

    const after = await this.readStatus(auth, context.storeId, orderId);
    const supplierStatus = after?.supplierStatus ?? 'confirm';
    this.logger.log(
      `wb order joined supply store=${context.storeId} order=${orderId} supply=${supply.id} status=${supplierStatus}`,
      'WbShipmentService',
    );
    return {
      platformOrderId: order.platformOrderId,
      trackingNumber: null,
      platformStatus: supplierStatus,
      alreadyPrepared: false,
    };
  }

  /**
   * Fetches the order's sticker (面单). Only `confirm` / `complete` orders
   * have one, so the caller must have prepared the shipment first. Answers as
   * JSON with a base64 `file`, decoded here into bytes.
   */
  async fetchShippingLabel(
    context: { storeId: string; credential: Readonly<Record<string, unknown>> },
    order: { platformOrderId: string },
  ): Promise<PlatformLabelFile | null> {
    const auth = parseWbAuthCredential(context.credential, context.storeId);
    const orderId = parseWbOrderId(order.platformOrderId);

    const response = await this.client.v3OrderStickers(auth, context.storeId, {
      orderIds: [orderId],
      type: 'png',
      width: STICKER_WIDTH,
      height: STICKER_HEIGHT,
    });
    const sticker = (response.stickers ?? []).find((row) => row.orderId === orderId);
    if (sticker === undefined || typeof sticker.file !== 'string' || sticker.file === '') {
      this.logger.warn(
        `wb sticker missing store=${context.storeId} order=${orderId}`,
        'WbShipmentService',
      );
      return null;
    }
    const bytes = Buffer.from(sticker.file, 'base64');
    if (bytes.byteLength === 0) {
      return null;
    }
    return {
      fileName: `wb-sticker-${order.platformOrderId}.png`,
      mimeType: 'image/png',
      bytes: new Uint8Array(bytes),
    };
  }

  /** Status read; null when the platform answers without our order. */
  private async readStatus(
    auth: WbAuth,
    storeId: string,
    orderId: number,
  ): Promise<WbV3OrderStatus | null> {
    const response = await this.client.v3OrderStatuses(auth, storeId, [orderId]);
    return (response.orders ?? []).find((row) => row.id === orderId) ?? null;
  }
}

// ---------------------------------------------------------------------------

/**
 * WB assembly-order ids are int64 on the wire; our `platform_order_id` stores
 * them as strings. A non-numeric id cannot be a v3 assembly order - reported
 * instead of being coerced (AGENTS.md §89).
 */
export function parseWbOrderId(platformOrderId: string): number {
  if (!/^\d{1,18}$/.test(platformOrderId)) {
    throw new WbOrderNotPreparableError('WB 订单号不是有效的数字 ID，无法调用发货接口', {
      platformOrderId,
    });
  }
  return Number(platformOrderId);
}

/** WB order cannot enter the supply flow in its current state. */
export class WbOrderNotPreparableError extends DomainError {
  readonly code = 'WB_ORDER_NOT_PREPARABLE';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown>) {
    super(message, details);
  }
}
