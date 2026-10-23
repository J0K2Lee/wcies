import { Injectable } from '@nestjs/common';
import {
  PlatformLabelFile,
  PlatformOrderLabelFile,
  PlatformShipmentPreparation,
} from '@wcies/platform-contracts';
import { parseWbAuthCredential } from './wb.adapter';
import { WbAuth, WbClient } from './wb.client';
import { WbV3CrossBorderSticker, WbV3OrderStatus } from './types/api.types';
import { PlatformApiError } from '../platform-error';
import { pngToPdfPage } from '../../../common/pdf/document';
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

/** 单次贴纸请求的订单数上限（官方 spec：orders ≤100）。 */
export const WB_STICKER_BATCH_LIMIT = 100;

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
   * 单张面单（2026-10-22 改造）。优先走**跨境贴纸**接口：
   * - 返回 PDF（批量打印可直接合并，不必再做图片转 PDF）；
   * - 带生成状态（`awaitingTrackNumber` = 还没好）；
   * - 带运单号 `parcelId`（订单接口不给，这是 WB 运单号的唯一来源）。
   *
   * 跨境接口对非跨境电商不适用（4xx / 空结果）→ 降级到通用 PNG 贴纸
   * （转成单页 PDF 后返回，保证下游只处理 PDF）。跨境店拿到
   * `awaitingTrackNumber` 时**不**降级：通用贴纸属于另一套流程，打错更糟。
   */
  async fetchShippingLabel(
    context: { storeId: string; credential: Readonly<Record<string, unknown>> },
    order: { platformOrderId: string },
  ): Promise<PlatformLabelFile | null> {
    const auth = parseWbAuthCredential(context.credential, context.storeId);
    const orderId = parseWbOrderId(order.platformOrderId);

    const crossBorder = await this.crossBorderStickers(auth, context.storeId, [orderId]);
    const sticker = crossBorder?.find((row) => row.orderId === orderId);
    if (sticker !== undefined) {
      return this.decodeCrossBorderSticker(sticker, order.platformOrderId);
    }
    return this.genericSticker(auth, context.storeId, orderId, order.platformOrderId);
  }

  /**
   * 批量面单（2026-10-22）：一次请求 ≤100 单（官方 spec 上限），跨境优先、
   * 通用贴纸兜底。只返回**已就绪**的单；未就绪的不出现在结果里（调用方按
   * 「平台尚未生成」处理），与 OZON 批量接口同契约。
   */
  async fetchShippingLabels(
    context: { storeId: string; credential: Readonly<Record<string, unknown>> },
    platformOrderIds: readonly string[],
  ): Promise<readonly PlatformOrderLabelFile[]> {
    if (platformOrderIds.length === 0) {
      return [];
    }
    const auth = parseWbAuthCredential(context.credential, context.storeId);
    const byId = new Map<number, string>();
    for (const platformOrderId of platformOrderIds) {
      byId.set(parseWbOrderId(platformOrderId), platformOrderId);
    }
    const orderIds = [...byId.keys()];

    const files = new Map<string, PlatformLabelFile>();
    const crossBorder = await this.crossBorderStickers(auth, context.storeId, orderIds);
    const pending: number[] = [];
    for (const orderId of orderIds) {
      const platformOrderId = byId.get(orderId) ?? String(orderId);
      const sticker = crossBorder?.find((row) => row.orderId === orderId);
      if (sticker === undefined) {
        pending.push(orderId);
        continue;
      }
      const file = this.decodeCrossBorderSticker(sticker, platformOrderId);
      if (file !== null) {
        files.set(platformOrderId, file);
      }
      // status=awaitingTrackNumber：跨境单面单未就绪，等下次（不降级）。
    }

    if (pending.length > 0) {
      const response = await this.client.v3OrderStickers(auth, context.storeId, {
        orderIds: pending,
        type: 'png',
        width: STICKER_WIDTH,
        height: STICKER_HEIGHT,
      });
      for (const sticker of response.stickers ?? []) {
        const platformOrderId = byId.get(sticker.orderId);
        if (platformOrderId === undefined) {
          continue;
        }
        const file = await this.decodeGenericSticker(sticker.file, platformOrderId);
        if (file !== null) {
          files.set(platformOrderId, file);
        }
      }
    }

    return platformOrderIds.flatMap((platformOrderId) => {
      const file = files.get(platformOrderId);
      return file === undefined ? [] : [{ platformOrderId, file }];
    });
  }

  /**
   * 跨境贴纸。平台不支持（非跨境电商）时返回 null 让调用方降级；空结果同样
   * 视为「不适用」（跨境店在 confirm/complete 时一定有条目）。
   */
  private async crossBorderStickers(
    auth: WbAuth,
    storeId: string,
    orderIds: readonly number[],
  ): Promise<readonly WbV3CrossBorderSticker[] | null> {
    if (orderIds.length === 0) {
      return null;
    }
    try {
      const response = await this.client.v3OrderStickersCrossBorder(auth, storeId, { orderIds });
      const stickers = response.stickers ?? [];
      return stickers.length === 0 ? null : stickers;
    } catch (error: unknown) {
      if (error instanceof PlatformApiError && isCrossBorderNotApplicable(error)) {
        this.logger.warn(
          `wb cross-border stickers unavailable store=${storeId}, falling back to generic`,
          'WbShipmentService',
        );
        return null;
      }
      throw error;
    }
  }

  private decodeCrossBorderSticker(
    sticker: WbV3CrossBorderSticker,
    platformOrderId: string,
  ): PlatformLabelFile | null {
    if (sticker.status !== undefined && sticker.status !== 'ready') {
      return null; // awaitingTrackNumber：等承运商回传运单号
    }
    if (typeof sticker.file !== 'string' || sticker.file === '') {
      return null;
    }
    const bytes = Buffer.from(sticker.file, 'base64');
    if (bytes.byteLength === 0) {
      return null;
    }
    const trackingNumber =
      typeof sticker.parcelId === 'string' && sticker.parcelId.trim() !== ''
        ? sticker.parcelId.trim()
        : null;
    return {
      fileName: `wb-label-${platformOrderId}.pdf`,
      mimeType: 'application/pdf',
      bytes: new Uint8Array(bytes),
      trackingNumber,
    };
  }

  /** 通用贴纸只给 PNG：转成单页 PDF，保证下游（合并打印）只处理 PDF。 */
  private async decodeGenericSticker(
    file: string | undefined,
    platformOrderId: string,
  ): Promise<PlatformLabelFile | null> {
    if (typeof file !== 'string' || file === '') {
      return null;
    }
    const png = Buffer.from(file, 'base64');
    if (png.byteLength === 0) {
      return null;
    }
    const pdf = await pngToPdfPage(new Uint8Array(png));
    return {
      fileName: `wb-label-${platformOrderId}.pdf`,
      mimeType: 'application/pdf',
      bytes: pdf,
      trackingNumber: null,
    };
  }

  /** 单张的通用贴纸路径（非跨境店）。 */
  private async genericSticker(
    auth: WbAuth,
    storeId: string,
    orderId: number,
    platformOrderId: string,
  ): Promise<PlatformLabelFile | null> {
    const response = await this.client.v3OrderStickers(auth, storeId, {
      orderIds: [orderId],
      type: 'png',
      width: STICKER_WIDTH,
      height: STICKER_HEIGHT,
    });
    const sticker = (response.stickers ?? []).find((row) => row.orderId === orderId);
    if (sticker === undefined) {
      this.logger.warn(`wb sticker missing store=${storeId} order=${orderId}`, 'WbShipmentService');
      return null;
    }
    return this.decodeGenericSticker(sticker.file, platformOrderId);
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

/**
 * 跨境贴纸接口对「非跨境电商」的拒绝：4xx（无该订单 / 不支持该流程）。
 * 5xx 与鉴权错误必须原样抛出——那说明链路坏了，不能静默换成另一套贴纸。
 */
function isCrossBorderNotApplicable(error: PlatformApiError): boolean {
  const status = error.platformError.httpStatus;
  return status === 400 || status === 404 || status === 409 || status === 422;
}

/** WB order cannot enter the supply flow in its current state. */
export class WbOrderNotPreparableError extends DomainError {
  readonly code = 'WB_ORDER_NOT_PREPARABLE';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown>) {
    super(message, details);
  }
}
