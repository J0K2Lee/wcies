import { Injectable } from '@nestjs/common';
import {
  PlatformLabelFile,
  PlatformOrderLabelFile,
  PlatformShipmentPreparation,
} from '@wcies/platform-contracts';
import { splitPdfPages } from '../../../common/pdf/document';
import { parseOzonAuth } from './ozon-auth';
import { OzonClient } from './ozon.client';
import {
  OzonFbsPosting,
  OzonPackageLabelCreateResponse,
  OzonPackageLabelGetResponse,
  OzonPackageLabelTask,
  OzonPostingProduct,
  OzonShipPackage,
} from './types/api.types';
import {
  PlatformApiError,
  PlatformBatchShapeError,
  PlatformMalformedResponseError,
} from '../platform-error';
import { DomainError } from '../../../common/errors/domain.error';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { isOzonPostingCancelled } from './ozon.mapper';

/**
 * OZON posting statuses meaning the order has ALREADY been accepted for
 * dispatch (组包 done). Verified against the v3 English spec vocabulary and
 * corroborated by real account data (2026-09-18): of 197 synced postings,
 * every `awaiting_deliver` / `delivering` row carries a `tracking_number`
 * while every `awaiting_packaging` row has none - i.e. OZON assigns the
 * waybill exactly at assembly time. See docs/integrations/ozon.md.
 */
const OZON_ASSEMBLED_STATUSES: ReadonlySet<string> = new Set([
  'awaiting_deliver',
  'delivering',
  'driver_pickup',
  'acceptance_in_progress',
  'delivered',
]);

/**
 * Statuses we will attempt to assemble. `awaiting_packaging` is the one
 * verified shippable state; `available_actions` (`ship` / `ship_async`) is
 * used as a corroborating signal so unlisted-but-explicitly-shippable
 * postings are not blocked. Anything else is reported, never guessed
 * (AGENTS.md §88).
 */
const OZON_FALLBACK_SHIPPABLE_STATUSES: ReadonlySet<string> = new Set(['awaiting_packaging']);

/** `available_actions` values that mean "the platform can assemble this now". */
const SHIP_ACTION_HINTS: ReadonlySet<string> = new Set(['ship', 'ship_async']);
/** `available_actions` values that mean "assembly is already running". */
const SHIP_IN_PROGRESS_HINTS: ReadonlySet<string> = new Set([
  'ship_async_in_process',
  'ship_async_retry',
]);

/**
 * Posting substatus meaning "assembly accepted, platform still processing".
 * T0 2026-10-09 (OZON 124 / 56089221-0064-1): right after a 200 from
 * /v4/posting/fbs/ship the posting re-reads as awaiting_packaging with
 * substatus `ship_pending` and only later flips to awaiting_deliver - the
 * confirmation is asynchronous and this state is a normal pending outcome,
 * never an error.
 */
const SHIP_PENDING_SUBSTATUS = 'ship_pending';

/**
 * 异步面单任务的轮询窗口（2026-11-03）：6 次 × 1.5s ≈ 9 秒。
 * T0 实测任务 2–7 秒完成；批量打印是同步 HTTP 请求，不在请求里长时间等待，
 * 超窗按「未就绪」返回，由预取任务或用户重试补做。
 */
const LABEL_POLL_ATTEMPTS = 6;
const LABEL_POLL_INTERVAL_MS = 1500;

/** 面单任务在大/小两种格式里挑哪一种（见 pickLabelTask）。 */
const PREFERRED_LABEL_TASK_TYPE = 'small_label';

/**
 * OZON order fulfillment operations (2026-09-18 order shipping flow).
 *
 * Owns the platform-side WRITE for this flow - 组包 (`/v4/posting/fbs/ship`)
 * - plus the label fetch (`/v2/posting/fbs/package-label`). Like
 * OzonWarehouseService it is a thin platform-facing service: transport and
 * platform semantics only, no WCIES repositories, no business state.
 *
 * IDEMPOTENCY: OZON treats an already-assembled posting as a repeat-call
 * error, so `prepareShipment` first READS the posting and returns
 * `alreadyPrepared` without writing when the platform has already accepted
 * the order. That makes the caller's "ensure prepared" step safe to call on
 * every 发货 click.
 *
 * T0: the ship request/response and the label body encoding are spec-derived
 * but NOT yet run against a live account (AGENTS.md §92 requires the owner's
 * explicit approval for that). See docs/integrations/ozon.md 平台写操作.
 */
@Injectable()
export class OzonShipmentService {
  /**
   * 面单任务轮询的等待实现。单测替换成即时返回（真实值见
   * LABEL_POLL_INTERVAL_MS），避免测试真的等 9 秒。
   */
  protected wait: (ms: number) => Promise<void> = sleep;

  constructor(
    private readonly client: OzonClient,
    private readonly logger: AppLoggerService,
  ) {}

  async prepareShipment(
    context: { storeId: string; credential: Readonly<Record<string, unknown>> },
    order: { platformOrderId: string },
  ): Promise<PlatformShipmentPreparation> {
    const auth = parseOzonAuth(context.credential, context.storeId);
    const postingNumber = order.platformOrderId;

    const before = await this.readPosting(auth, context.storeId, postingNumber);
    if (isAssembled(before)) {
      return {
        platformOrderId: postingNumber,
        trackingNumber: readTrackingNumber(before),
        platformStatus: before.status,
        alreadyPrepared: true,
      };
    }

    const decision = classify(before);
    if (decision === 'IN_PROGRESS') {
      // Assembly was already submitted (by this or an earlier call) and the
      // platform is still processing it: report the pending acceptance, do
      // NOT fire a second write.
      this.logger.log(
        `ozon assembly submitted, confirmation pending store=${context.storeId} posting=${postingNumber} status=${before.status}${before.substatus ? `/${before.substatus}` : ''}`,
        'OzonShipmentService',
      );
      return pendingResult(postingNumber, before.status);
    }
    if (decision === 'BLOCKED') {
      throw new OzonOrderNotReadyError(`OZON 订单当前状态（${before.status}）不允许组包`, {
        postingNumber,
        platformStatus: before.status,
      });
    }

    const packages = buildPackages(before, postingNumber);
    await this.shipIgnoringAlreadyShipped(auth, context.storeId, postingNumber, packages);

    // The spec is explicit that a 200 does NOT prove assembly - the posting
    // must be re-read. A genuine failure (ship_failed / cancelled) is an
    // error; anything else still unassembled is the normal async window.
    const after = await this.readPosting(auth, context.storeId, postingNumber);
    if (!isAssembled(after)) {
      if (after.status === 'cancelled' || after.substatus === 'ship_failed') {
        throw new OzonAssemblyNotConfirmedError({
          postingNumber,
          platformStatus: after.status,
          substatus: after.substatus ?? null,
        });
      }
      this.logger.log(
        `ozon assembly submitted, confirmation pending store=${context.storeId} posting=${postingNumber} status=${after.status}${after.substatus ? `/${after.substatus}` : ''}`,
        'OzonShipmentService',
      );
      return pendingResult(postingNumber, after.status);
    }
    this.logger.log(
      `ozon posting assembled store=${context.storeId} posting=${postingNumber} status=${after.status}`,
      'OzonShipmentService',
    );
    return {
      platformOrderId: postingNumber,
      trackingNumber: readTrackingNumber(after),
      platformStatus: after.status,
      alreadyPrepared: false,
    };
  }

  /**
   * Fetches the shipping label PDF. OZON only serves labels for
   * `awaiting_deliver` postings, so the caller must have prepared the
   * shipment first. Returns null when the platform has not produced the label
   * yet (a retryable, non-fatal condition).
   */
  async fetchShippingLabel(
    context: { storeId: string; credential: Readonly<Record<string, unknown>> },
    order: { platformOrderId: string },
  ): Promise<PlatformLabelFile | null> {
    const auth = parseOzonAuth(context.credential, context.storeId);
    const postingNumber = order.platformOrderId;

    const task = await this.createLabelTask(auth, context.storeId, [postingNumber]);
    if (task === null) {
      return null;
    }
    const ready = await this.waitForLabelFile(auth, context.storeId, task, 1);
    if (ready === null) {
      this.logger.warn(
        `ozon label still pending store=${context.storeId} posting=${postingNumber}`,
        'OzonShipmentService',
      );
      return null;
    }
    return {
      fileName: `ozon-label-${postingNumber}.pdf`,
      mimeType: 'application/pdf',
      bytes: ready.bytes,
    };
  }

  /**
   * 批量取面单（2026-10-21 引入，2026-11-03 迁移到异步接口）：
   * `POST /v3/posting/fbs/package-label/create` 一次提交多个 posting，
   * `POST /v2/posting/fbs/package-label/get` 按任务取 `file_url`，内容为
   * **一个** PDF，页面顺序即请求顺序（T0 实测 2 单 → 2 页，printed 2/2）。
   *
   * 只有「全部 posting 都打印成功（`unprinted_postings` 为空）且页数正好等于
   * 单数」时才拆页归档；部分成功/页数不符/不可解析时抛
   * `PlatformBatchShapeError`，由调用方降级为逐单请求——批量只是提速，不承担
   * 正确性（AGENTS.md §88）。
   */
  async fetchShippingLabels(
    context: { storeId: string; credential: Readonly<Record<string, unknown>> },
    platformOrderIds: readonly string[],
  ): Promise<readonly PlatformOrderLabelFile[]> {
    const ids = [...new Set(platformOrderIds.filter((id) => id !== ''))];
    if (ids.length === 0) {
      return [];
    }
    const auth = parseOzonAuth(context.credential, context.storeId);
    if (ids.length === 1) {
      const first = ids[0];
      const file =
        first === undefined
          ? null
          : await this.fetchShippingLabel(context, { platformOrderId: first });
      return file === null || first === undefined ? [] : [{ platformOrderId: first, file }];
    }

    const task = await this.createLabelTask(auth, context.storeId, ids);
    if (task === null) {
      return [];
    }
    const ready = await this.waitForLabelFile(auth, context.storeId, task, ids.length);
    if (ready === null) {
      return [];
    }

    let pages: Uint8Array[];
    try {
      pages = await splitPdfPages(ready.bytes);
    } catch (error: unknown) {
      throw new PlatformBatchShapeError(
        `OZON 批量面单返回无法解析为 PDF：${
          error instanceof Error ? error.message : String(error)
        }`,
        { requested: ids.length, pages: null },
      );
    }
    if (pages.length !== ids.length) {
      throw new PlatformBatchShapeError(
        `OZON 批量面单返回页数（${pages.length}）与请求订单数（${ids.length}）不一致`,
        { requested: ids.length, pages: pages.length },
      );
    }

    const files: PlatformOrderLabelFile[] = [];
    for (let index = 0; index < ids.length; index += 1) {
      const platformOrderId = ids[index];
      const bytes = pages[index];
      if (platformOrderId === undefined || bytes === undefined) {
        throw new PlatformBatchShapeError('OZON 批量面单无法与订单一一对应', {
          requested: ids.length,
          pages: pages.length,
        });
      }
      files.push({
        platformOrderId,
        file: {
          fileName: `ozon-label-${platformOrderId}.pdf`,
          mimeType: 'application/pdf',
          bytes,
        },
      });
    }
    return files;
  }

  // -----------------------------------------------------------------------
  // 异步面单任务（2026-11-03）
  // -----------------------------------------------------------------------

  /**
   * 建面单任务并选出要打印的那一个。
   *
   * 返回 null = 平台此刻给不出面单（posting 不在 `awaiting_deliver`、任务空、
   * 或平台答「未就绪」）。这是可重试状态，不是业务失败。
   *
   * 多任务时只取一个：大/小两种格式会各自出文件，全取会让一份 PDF 每单两页，
   * 「页序 = 请求顺序」的映射随之失效。
   */
  private async createLabelTask(
    auth: ReturnType<typeof parseOzonAuth>,
    storeId: string,
    postingNumbers: readonly string[],
  ): Promise<OzonPackageLabelTask | null> {
    let response: OzonPackageLabelCreateResponse;
    try {
      response = await this.client.packageLabelCreate(auth, storeId, postingNumbers);
    } catch (error: unknown) {
      if (error instanceof PlatformApiError && isLabelNotReady(error.message)) {
        this.logger.warn(
          `ozon label task rejected store=${storeId} postings=${postingNumbers.length} reason=${error.message}`,
          'OzonShipmentService',
        );
        return null;
      }
      throw error;
    }

    // 走 unknown：`Array.isArray` 作用于 readonly 数组会退化成 any[]。
    const rawTasks: unknown = response.tasks;
    const tasks: readonly OzonPackageLabelTask[] = Array.isArray(rawTasks)
      ? (rawTasks as readonly OzonPackageLabelTask[])
      : [];
    const task = pickLabelTask(tasks);
    if (task === null) {
      return null;
    }
    if (tasks.length > 1) {
      this.logger.warn(
        `ozon label returned ${tasks.length} tasks (${tasks
          .map((entry) => entry.task_type ?? '?')
          .join(',')}), printing ${task.task_type ?? '?'} only`,
        'OzonShipmentService',
      );
    }
    return task;
  }

  /**
   * 轮询任务直到拿到文件。返回 null = 轮询窗口内仍未完成（`pending` /
   * `in_progress`），调用方按「未就绪」处理，绝不能把它当失败。
   *
   * 任何「部分打印」一律抛 `PlatformBatchShapeError`：文件里到底有哪几单、
   * 页序如何都是未经验证的推断（AGENTS §88），只能逐单重取。
   */
  private async waitForLabelFile(
    auth: ReturnType<typeof parseOzonAuth>,
    storeId: string,
    task: OzonPackageLabelTask,
    requestedCount: number,
  ): Promise<{ bytes: Uint8Array } | null> {
    const taskId = task.task_id;
    if (taskId === undefined) {
      return null;
    }
    for (let attempt = 1; attempt <= LABEL_POLL_ATTEMPTS; attempt += 1) {
      const result = await this.client.packageLabelGet(auth, storeId, taskId);
      const code = result.status?.code ?? '';
      if (code === 'completed') {
        const unprinted = result.status?.unprinted_postings ?? [];
        const printed = result.status?.printed_postings_count;
        if (unprinted.length > 0 || (typeof printed === 'number' && printed !== requestedCount)) {
          throw new PlatformBatchShapeError(
            `OZON 面单只打印了 ${typeof printed === 'number' ? printed : '?'}/${requestedCount} 单${
              unprinted.length === 0
                ? ''
                : `：${unprinted.map((entry) => describeUnprinted(entry)).join('；')}`
            }`,
            { requested: requestedCount, printed: printed ?? null },
          );
        }
        const fileUrl = result.file_url;
        if (typeof fileUrl !== 'string' || fileUrl === '') {
          throw new PlatformMalformedResponseError({
            message: 'OZON 面单任务已完成但没有返回文件地址',
            httpStatus: null,
            requestId: null,
            endpoint: '/v2/posting/fbs/package-label/get',
            storeId,
          });
        }
        const download = await this.client.downloadFile(fileUrl, {
          storeId,
          endpoint: '/v2/posting/fbs/package-label/file',
        });
        if (!isPdf(download.bytes)) {
          throw new PlatformMalformedResponseError({
            message: `OZON 面单文件不是 PDF（Content-Type=${download.contentType ?? 'unknown'}，${download.bytes.byteLength} 字节）`,
            httpStatus: null,
            requestId: null,
            endpoint: '/v2/posting/fbs/package-label/file',
            storeId,
          });
        }
        return { bytes: download.bytes };
      }
      if (code === 'error') {
        throw new PlatformApiError({
          code: 'PLATFORM_API_ERROR',
          httpStatus: null,
          requestId: null,
          endpoint: '/v2/posting/fbs/package-label/get',
          storeId,
          message: `OZON 面单生成失败：${describeTaskError(result)}`,
        });
      }
      if (attempt < LABEL_POLL_ATTEMPTS) {
        await this.wait(LABEL_POLL_INTERVAL_MS);
      }
    }
    return null;
  }

  // -----------------------------------------------------------------------

  private async readPosting(
    auth: ReturnType<typeof parseOzonAuth>,
    storeId: string,
    postingNumber: string,
  ): Promise<OzonFbsPosting> {
    const response = await this.client.fbsPostingGet(auth, storeId, postingNumber);
    const posting = response?.result;
    if (typeof posting?.posting_number !== 'string' || typeof posting?.status !== 'string') {
      throw new OzonOrderNotReadyError('OZON 未返回该订单的有效发货单信息', {
        postingNumber,
      });
    }
    return posting;
  }

  /**
   * Sends the assembly request, tolerating the platform's "already shipped"
   * answer as success: the caller re-reads the posting right after, so a
   * concurrent/repeated assembly still converges to the platform facts.
   */
  private async shipIgnoringAlreadyShipped(
    auth: ReturnType<typeof parseOzonAuth>,
    storeId: string,
    postingNumber: string,
    packages: readonly OzonShipPackage[],
  ): Promise<void> {
    try {
      await this.client.fbsPostingShip(auth, storeId, { postingNumber, packages });
    } catch (error: unknown) {
      if (error instanceof PlatformApiError && isAlreadyShipped(error.message)) {
        this.logger.warn(
          `ozon posting already assembled store=${storeId} posting=${postingNumber}`,
          'OzonShipmentService',
        );
        return;
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------

type PrepareDecision = 'ASSEMBLED' | 'CAN_SHIP' | 'IN_PROGRESS' | 'BLOCKED';

function isAssembled(posting: OzonFbsPosting): boolean {
  return OZON_ASSEMBLED_STATUSES.has(posting.status);
}

/** Platform accepted the assembly; the waybill is not readable yet. */
function pendingResult(postingNumber: string, platformStatus: string): PlatformShipmentPreparation {
  return {
    platformOrderId: postingNumber,
    trackingNumber: null,
    platformStatus,
    alreadyPrepared: false,
    assemblyPending: true,
  };
}

/**
 * Decides whether the posting may be assembled. `available_actions` (when the
 * platform provides it) wins over our status list so a posting the platform
 * itself advertises as shippable is never blocked by an incomplete local
 * vocabulary.
 */
function classify(posting: OzonFbsPosting): PrepareDecision {
  if (posting.substatus === SHIP_PENDING_SUBSTATUS) {
    return 'IN_PROGRESS';
  }
  const actions = readActions(posting);
  if (actions.some((action) => SHIP_IN_PROGRESS_HINTS.has(action))) {
    return 'IN_PROGRESS';
  }
  if (actions.some((action) => SHIP_ACTION_HINTS.has(action))) {
    return 'CAN_SHIP';
  }
  if (isOzonPostingCancelled(posting.status)) {
    return 'BLOCKED';
  }
  return OZON_FALLBACK_SHIPPABLE_STATUSES.has(posting.status) ? 'CAN_SHIP' : 'BLOCKED';
}

/**
 * Reads a posting array field defensively. The narrowing goes through
 * `unknown` on purpose: `Array.isArray` on a `readonly T[]` yields an
 * `any[]` intersection that would silently poison every downstream access.
 */
function readActions(posting: OzonFbsPosting): readonly string[] {
  const raw: unknown = posting.available_actions;
  return Array.isArray(raw) ? (raw as readonly string[]) : [];
}

function readProducts(posting: OzonFbsPosting): readonly OzonPostingProduct[] {
  const raw: unknown = posting.products;
  return Array.isArray(raw) ? (raw as readonly OzonPostingProduct[]) : [];
}

/**
 * Builds the ship request from the posting READ FROM THE PLATFORM - never from
 * local rows - so the parcel contents always match what OZON expects. Every
 * product of the posting goes into a single package ("one order = one
 * parcel"), which is what the fulfilment flow ships.
 */
function buildPackages(posting: OzonFbsPosting, postingNumber: string): OzonShipPackage[] {
  const products = readProducts(posting);
  const mapped = products.map((product) => {
    const quantity = product.quantity;
    if (!Number.isInteger(product.sku) || product.sku <= 0) {
      throw new OzonOrderNotReadyError('该发货单存在无有效 SKU 的商品行，无法组包', {
        postingNumber,
        sku: product.sku,
      });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new OzonOrderNotReadyError('该发货单存在无效数量，无法组包', {
        postingNumber,
        sku: product.sku,
        quantity,
      });
    }
    return { product_id: product.sku, quantity };
  });
  if (mapped.length === 0) {
    throw new OzonOrderNotReadyError('该发货单没有商品行，无法组包', { postingNumber });
  }
  return [{ products: mapped }];
}

function readTrackingNumber(posting: OzonFbsPosting): string | null {
  const value = posting.tracking_number;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 选出本次要打印的任务。平台在店铺配置了两种面单格式时会一次返回两个任务
 * （`big_label` 普通面单 / `small_label` 小面单）；一份 PDF 每单两页会让
 * 「页序 = 请求顺序」的拆页失效，所以只取一个。
 *
 * 取 `small_label`：T0 实测 ON-002 / ON-003 的 create 只返回 small_label，
 * 即店铺当前打印的就是小面单。若某店同时返回两种，这里仍打印小面单——
 * 需要改口径时改 `PREFERRED_LABEL_TASK_TYPE`，不要按页数猜。
 */
function pickLabelTask(tasks: readonly OzonPackageLabelTask[]): OzonPackageLabelTask | null {
  const usable = tasks.filter((task) => task.task_id !== undefined && task.task_id !== '');
  if (usable.length === 0) {
    return null;
  }
  return usable.find((task) => task.task_type === PREFERRED_LABEL_TASK_TYPE) ?? usable[0] ?? null;
}

/** 未打印单的失败原因（平台原文，只用于日志/错误消息，不参与判断）。 */
function describeUnprinted(entry: {
  readonly posting_number?: string;
  readonly message?: string;
}): string {
  return `${entry.posting_number ?? '?'}${entry.message ? ` ${entry.message}` : ''}`;
}

function describeTaskError(result: OzonPackageLabelGetResponse): string {
  const failure = result.error;
  if (failure !== undefined && (failure.message ?? '') !== '') {
    return `${failure.code ?? '?'} ${failure.message ?? ''}`.trim();
  }
  const unprinted = result.status?.unprinted_postings ?? [];
  return unprinted.length === 0
    ? '平台未给出原因'
    : unprinted.map((entry) => describeUnprinted(entry)).join('；');
}

/** 文件是不是 PDF（魔数校验：防止把 CDN 的错误页当成面单归档）。 */
function isPdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 5));
  return head === '%PDF-';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 平台答复「这些单现在取不到面单」——可重试状态，不是业务失败。
 * - 旧同步接口：`The next postings aren't ready` / `label not allowed ...`；
 * - 新异步 create（T0 2026-11-03）：`NO_POSTINGS_FOR_BATCH_DOWNLOAD`（HTTP 400
 *   code 3，posting 不在 `awaiting_deliver` 时返回）。
 */
function isLabelNotReady(message: string): boolean {
  return (
    message.includes("aren't ready") ||
    message.includes('not ready') ||
    message.includes('label not allowed') ||
    message.includes('NO_POSTINGS_FOR_BATCH_DOWNLOAD')
  );
}

/** Assembly already done - the caller re-reads and converges on the facts. */
function isAlreadyShipped(message: string): boolean {
  return message.includes('POSTING_ALREADY_SHIPPED') || message.includes('HAS_INCORRECT_STATUS');
}

/**
 * 批量面单的返回无法安全地一页对一单（页数不符 / 返回的不是可解析 PDF）。
 * 这不是业务失败——调用方应当降级为逐单请求，因此它刻意不是 DomainError
 * （不进入统一错误码体系，也不面向用户展示）。
 */

/** OZON order cannot be prepared in its current platform state. */
export class OzonOrderNotReadyError extends DomainError {
  readonly code = 'OZON_ORDER_NOT_PREPARABLE';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * The platform REJECTED the assembly (substatus ship_failed) or the posting
 * turned out cancelled after the write - a genuine failure worth an exception
 * row, unlike the normal async pending window (assemblyPending).
 */
export class OzonAssemblyNotConfirmedError extends DomainError {
  readonly code = 'PLATFORM_SHIP_NOT_CONFIRMED';
  readonly httpStatus = 502;

  constructor(details: {
    postingNumber: string;
    platformStatus: string;
    substatus: string | null;
  }) {
    super(
      `OZON 组包未成功（当前状态 ${details.platformStatus}${
        details.substatus === null ? '' : `/${details.substatus}`
      }），请重试`,
      { ...details },
    );
  }
}
