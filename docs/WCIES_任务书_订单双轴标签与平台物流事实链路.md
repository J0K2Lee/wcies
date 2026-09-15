# WCIES 任务书（订单管理：双轴标签体系 + 平台物流事实链路）

> 依据：`AGENTS.md`、`docs/business-rules/orders.md`、`docs/business-rules/purchase.md`（§3.5）、
> `docs/integrations/ozon.md`（§6.1 / §6.1c / §6.1d / §6.2 / §6.6）、`docs/ozon-seller-api-eng-version-3.json`（OZON 官方规范，
> 2026-09-14 版）、`docs/会议纪要.md`、`docs/WCIES_下一阶段规划_Sprint_9_订单状态同步与运营闭环.md`、
> 工作区代码实测（文中行号为 2026-09-15 工作区实测）。
>
> 性质：**标签体系重构（UI + 查询契约）+ 平台物流事实链路扩展**。
> 其中 T5 退货/退款模块为路线图 Sprint 12 范围前移（用户 2026-09-15 明确指示「本次整模块做」），
> 实施前必须先冻结业务规则文档 `docs/business-rules/returns.md`。
>
> 实施顺序：**T1 → T2 → T3 / T4（可并行）→ T5**。T2 的回读候选与 T4 的停滞判定都依赖
> T1 的 `platform_stage` 落库；T3 的「待收货 / 已完成」标签依赖 T1 + T2 的阶段事实。

> 修订历史：
> - v1（2026-09-15）：用户 5 项反馈的根因核查、口径冻结、T1–T5 实施范围、验收标准、需确认项。
> - v2（2026-09-15，本版）：全量证据复核后修订——
>   1. **T2 回读候选规则重设计**：v1 的「距上次平台变更 > N 小时 + 停滞异常未 OPEN」存在两个缺陷
>      （长尾单饥饿、停滞单被排除后失去兜底回读、异常无法自动解决），改为「上次回读检查时间」轮转制（§3 T2）；
>   2. **停滞时钟锚点纠正**：`/v3/posting/fbs/get` 响应**不含** `changed_state_date`（该字段仅存在于
>      webhook 载荷与 list 请求过滤器，规范实测），回读路径的锚点改为平台自身的 `delivering_date`（§2.4）；
>   3. `orders` 表增 `platform_stage_changed_at` / `platform_facts_checked_at` 两列，钉死 T2/T4 查询锚点；
>   4. 统一 `异常`（聚合）chip 的口径（v1 的 §2.2 与 T3 实现描述不一致：5 源 vs 3 源）；
>   5. 补齐 v1 遗漏：`orders.md` §7a.2 的同步改写义务、`PROCESSED` 状态对 `NEW_POSTING` 同样生效、
>      允许修改目录缺 `app.module.ts` / web 路由 / ENV 配置、测试缺 `order-platform-status-sync.integration.spec.ts`；
>   6. 明确两处此前隐含的决策：`TYPE_STATE_CHANGED` 回读遇到未知单会建单；停滞评估在每次回读相遇时执行（而非仅状态变化时）。

---

# 1. 问题清单与根因（有证据，非推测；v2 已逐条复核）

用户 2026-09-15 反馈（附订单管理页截图，4 张单全部缺货、待处理计数为 0）：

| # | 问题 | 根因（证据，2026-09-15 复核通过） |
|---|---|---|
| 1 | 缺货没有对应的筛选标签 | 标签只映射 5 个状态（`apps/web/src/pages/orders/OrdersPage.tsx:147-155`）；`ERP_ORDER_STATUSES` 共 11 个（`apps/api/src/modules/order/enums/order.constants.ts:15-28`），`BACKORDERED` / `PARTIALLY_BACKORDERED` / `PICKED` / `PARTIALLY_SHIPPED` / `CANCELLED` / `ALLOCATING` 六个状态无去处，只能从「全部」翻 |
| 2 | 「待处理」标签不含缺货，且实测恒为 0 | 标签硬映射 `NEW`；`docs/business-rules/orders.md` §7 明确「NEW 仅作为创建历史记录的起点」，`order-ingestion.service.ts:102`（创建为 NEW）→ `:155`（同一请求内立刻按行汇总覆盖）→ NEW 几乎不可能停留。缺货单落在 `BACKORDERED`，因此「待处理」恒 0 而「全部」全是缺货 |
| 3 | 「异常」是否应涵盖缺货 | 标签「异常」= `erp_status='EXCEPTION'` = **全部行映射失败**（`order-status.service.ts:84-91`）；缺货是 `BACKORDERED`/`PARTIALLY_BACKORDERED`，`orders.md` §7 要求「UI 明确区分『不知道是什么 SKU』与『知道 SKU 但没库存』」。但列表 ERP 状态列的红色 `×N` 统计的是 OPEN 的 `ORDER_ITEM` 异常、**包含 `ORDER_OUT_OF_STOCK`**（`order.repository.ts:209-215`）→ 缺货单带红标却不在「异常」内，这是歧义来源 |
| 4 | 「待处理」与「异常」是否重复 | 两者是不同轴：待处理是**物流阶段**（横向：未发货 / 在途 / 妥投），异常是**货物状态**（纵向：正常流程 vs 异常），一张单可同时属于两者。当前实现的问题是「待处理」是空集，而不是与异常重复 |
| 5 | 「待采购」按钮作用不明、位置突兀 | 它是**筛选器**、不是动作按钮：后端 `pendingProcurement=true` = 存在 `MAPPED` + `BACKORDERED` + 有 `skuId` 且未被未取消采购单覆盖的订单行（`order.service.ts:74-82`、`order.repository.ts:57-70`、`purchase.md` §3.5）。现为红色 danger 幽灵按钮夹在搜索框与店铺下拉之间、无 Tooltip，故显得突兀 |

**核查中另发现（本次一并处理）**

| # | 发现 | 证据 |
|---|---|---|
| A1 | 标签与行内文案错配：标签「待发货」筛的是 `READY_TO_PICK`，而该状态在行内渲染为「待拣货」（`StatusBadge.tsx:119`）；`PICKED`（发货页按它取数：`apps/web/src/pages/shipments/ShipmentsPage.tsx:55`）与 `PARTIALLY_SHIPPED` 无标签 | `OrdersPage.tsx:152-153`、`StatusBadge.tsx:116-128` |
| A2 | Dashboard「待处理」卡片同病（用 `NEW`，恒 0） | `apps/web/src/pages/DashboardPage.tsx:139` |
| A3 | 平台状态刷新范围整体排除 `SHIPPED`，**妥投事实永远学不到** | `order.repository.ts:163-177`（`erp_status NOT IN ('CANCELLED','SHIPPED')`） |
| A4 | OZON webhook 已订阅 `TYPE_STATE_CHANGED` 且已收到真实样本，但代码只落库不处理（`WebhookProcessService` 仅 `NEW_POSTING` 分支动作，其余一律 `SKIPPED`，`webhook.service.ts:155-171`） | `ozon.md` §6.6（订阅清单 + 首批投递：`posting_on_way_to_city`，posting `62081919-0389-1`）；§6.1c 处理表 |
| A5 | 已发货订单被平台取消会**静默**变 `CANCELLED`（`SHIPPED` 行保持、无异常、无退货任务） | `order.service.ts:388-421`（`SHIPPED`/`RELEASED` 行 `continue`）、`:532`（平台取消传导） |
| A6 | OZON 规范中**没有轨迹查询接口**，只有 `"/v2/fbs/posting/tracking-number/set"`（我们上传单号）——规范 JSON 全量 paths 检索确认 | `docs/ozon-seller-api-eng-version-3.json` |
| A7 | 平台提供送达时间事实，可用于展示（本期不参与判定） | `client_delivery_date_end` = "Expected date by which the order is delivered"；`delivery_date_begin/end` = 预计送达区间；`delivering_date` = "Date when the shipment was transferred for delivery"（同规范 schema 描述） |

**v2 复核中新增的事实（影响 T2/T4 设计）**

| # | 事实 | 证据 |
|---|---|---|
| A8 | `/v3/posting/fbs/get` 响应对象（`v3FbsPostingDetail`，43 个属性）**不含** `changed_state_date` / `last_changed_status_date`；后者只作为 `/v3,/v4 posting/fbs/list` 请求**过滤器**存在，前者只在 webhook 载荷中 | 规范 JSON schema 逐项核对（2026-09-15） |
| A9 | `v3FbsPostingDetail` 的时间戳字段为：`in_process_at` / `shipment_date` / `shipment_date_without_delay` / `delivering_date` / `fact_delivery_date` / `pickup_code_verified_at`。其中 `delivering_date`（交物流时间）与 `fact_delivery_date`（实际妥投时间）是**平台自身的阶段时间戳**，回读可得 | 同上 |
| A10 | `RAW_EVENT_STATUSES` 已含 `PROCESSED`（`sync.constants.ts:19-26`），webhook 事件状态升级无需改枚举；但现状是**连已成功入库的 `NEW_POSTING` 也被标 `SKIPPED`**（`webhook.service.ts:171` 无条件 SKIPPED）——语义错误，本次一并修正 | 代码实测 |
| A11 | T4 停滞判定若挂在 ORDER_SYNC 每轮，评估必须发生在「每次回读相遇」而非「状态变化时」——停滞的定义恰恰是**没有任何变化**，只评估变化会永远漏掉停滞单（与 `orders.md` §16 时限重评估同理） | 设计推演 |

---

# 2. 口径定义（冻结，实施时同步写入 `docs/business-rules/orders.md`）

## 2.1 一级 · 订单物流阶段（标签，模块默认「待处理」）

| 标签 | 判定 | 说明 |
|---|---|---|
| `全部` | 无筛选 | 含已取消 |
| `待处理` | `erp_status NOT IN ('SHIPPED','CANCELLED')` | 含「平台已妥投但系统未发货」的分歧单（保留 ⚠ 与时限异常，提示人工走「标记外部履约」/取消）；缺货单天然落在其中 |
| `待收货` | `erp_status='SHIPPED'` 且 平台阶段 ≠ `DELIVERED` | 已发货、平台未妥投（在途），含 `platform_stage IS NULL` 的未同步单 |
| `已完成` | `erp_status='SHIPPED'` 且 平台阶段 = `DELIVERED` | 平台妥投 |

- `已取消` 只在「全部」可见（不算物流阶段，也不属于异常）。
- 用户原话：「订单应该分为待处理、待收货、已完成和全部，以订单的物流状态归属，模块默认显示待处理」。

## 2.2 二级 · 行级货物状态（chips，同一级之下的第二级标签，同一单可多命中）

| chip | 判定（后端 EXISTS 子查询，与行内徽标同源） |
|---|---|
| `待拣货` | 存在行 `fulfillment_status='RESERVED'` |
| `拣货中` | `erp_status='PICKING'`（该状态由「存在未完成拣货任务」的汇总规则产生，`order-status.service.ts:92-94`） |
| `待发货` | 存在行 `fulfillment_status='PICKED'` |
| `缺货` | 存在行 `fulfillment_status='BACKORDERED'` |
| `映射失败` | 存在行 `mapping_status='FAILED'` |
| `发货超时` | `shipment_deadline < now()` 且 `erp_status NOT IN ('SHIPPED','CANCELLED')`（部分发货剩余行未出且已过时限的 `PARTIALLY_SHIPPED` 也算） |
| `异常`（聚合） | 缺货 ∪ 映射失败 ∪ 发货超时 ∪ **物流停滞**（即：存在 OPEN 的 `ORDER_TRACKING_STALLED` 异常）。T5 落地后并入「已发货退款」（存在 OPEN 的退货/退款待处理单） |

- 用户原话：「待拣货、拣货中归属行级口径，与各种异常状态属于同一级标签，均表示货物状态」。
- 「行级口径」意味着**不能用订单 ERP 状态表达**：映射失败行不占状态位（`orders.md` §7：部分映射失败时订单保留业务汇总状态），因此"部分已发货 + 一行映射失败"的订单状态是 `PARTIALLY_SHIPPED`，却仍需人工 —— 这是现有所有标签都漏掉它的原因。
- `拣货中` 与 `待拣货` 允许同时命中（拣货中的订单仍有未拣的 RESERVED 行），属设计预期。

## 2.3 行内标记（非筛选）

`缺货 N`、`已采购 N`、`已到货 N`、`映射失败 N`。已采购/已到货取 `purchase.md` §3.5 的派生状态（`ORDERED` / `ARRIVED`），与现有行内徽标同源。

## 2.4 物流停滞（用户定：**平台状态超 3 天未变**）

- 适用范围：`platform_stage = 'IN_TRANSIT'`（已交物流）；未发货阶段的超时由「发货超时」覆盖。**见 §8 待确认项 2。**
- **时钟锚点（v2 纠正）**：以**平台自己的时间戳**为准，按来源取值——
  1. 回读路径（`/v3/posting/fbs/get`）：`delivering_date`（"Date when the shipment was transferred for delivery"，A9）——进入 `IN_TRANSIT` 的平台事实时间；
  2. webhook 路径：事件载荷的 `changed_state_date`（仅作 `platform_status_history` 迁移行的补充溯源，**回读响应中没有该字段**，A8）；
  3. 两者皆缺：回退该次迁移的观察时间（history 行 `created_at`）。
  该值规范化落在 `orders.platform_stage_changed_at`（见 T1/T2），避免「我们的接收时间」当锚点导致投递延迟误判。
- 判定：`platform_stage='IN_TRANSIT'` 且 `now() - platform_stage_changed_at > 3 天` → `ORDER_TRACKING_STALLED`。
- **评估时机（v2 明确）**：每次回读相遇时评估（无论事实是否变化，同 `orders.md` §16 时限重评估模式，A11）；进入 `DELIVERED` / `CANCELLED` 自动 resolve。
- 平台的送达日期事实（`client_delivery_date_end` / `delivery_date_begin/end`）本期只作展示/回读顺带字段，不参与判定（判定按 3 天规则）。

---

# 3. 实施范围

## T1 平台阶段归一化 + 事实落库

**后端**

- `packages/platform-contracts/src/index.ts`：新增
  `PLATFORM_ORDER_STAGES = ['AWAITING_SHIPMENT','IN_TRANSIT','DELIVERED','CANCELLED'] as const`；
  `PlatformOrderRaw` 增 `readonly platformStage: string | null` 与 `readonly platformStageChangedAt: Date | null`
  （与既有 `platformCancelled` 同一层：平台语义在 mapper 内消化，核心只读归一化结果，AGENTS.md §31/§33）。
- `apps/api/src/modules/integration/ozon/types/api.types.ts`：`OzonFbsPosting` 增
  `delivering_date?` / `fact_delivery_date?`（及展示用 `client_delivery_date_end?` / `delivery_date_begin?` / `delivery_date_end?`，A7）。
- `apps/api/src/modules/integration/ozon/ozon.mapper.ts`：`mapPostingToOrder` 增 `platformStage` / `platformStageChangedAt` 映射
  （仅映射有文档依据的取值，状态词表与规范 v3 的 Seller API 状态表逐词核对一致，2026-09-15）：

  | Seller API `status` | 归一化 `platformStage` |
  |---|---|
  | `awaiting_approve` / `awaiting_packaging` / `awaiting_registration` / `awaiting_deliver` | `AWAITING_SHIPMENT` |
  | `delivering` / `driver_pickup` / `acceptance_in_progress` | `IN_TRANSIT` |
  | `delivered` | `DELIVERED` |
  | `cancelled` | `CANCELLED` |
  | `arbitration` / `client_arbitration` / `not_accepted` | `null`（待归类，仅记文档，不猜，AGENTS.md §88） |

  `platformStageChangedAt` 取值：`IN_TRANSIT` → `delivering_date`；`DELIVERED` → `fact_delivery_date`；其余 → `null`（容错解析，缺失/非法为 null，不抛错）。
- `apps/api/src/modules/order/entities/order.entity.ts` + `database/migrations/*_add_order_platform_stage.ts`：
  - 新列 `platform_stage varchar(30) NULL`；
  - 新列 `platform_stage_changed_at timestamptz NULL`（§2.4 锚点，T2/T4 查询用）；
  - 新列 `platform_facts_checked_at timestamptz NULL`（最近一次回读确认时间，T2 候选轮转用）；
  - 索引：`(store_id, platform_stage)`（回读候选）、`(erp_status, platform_stage)`（列表 stage 筛选）；
  - 幂等回填（仅对已知词表做 CASE 映射；`platform_stage_changed_at` 回退顺序：
    `raw_data->>'delivering_date'` → 该单最新平台状态历史行时间 → 订单 `created_at`；
    未归类值保持 NULL 并输出计数，AGENTS.md §89）。
- 写入路径：`order-ingestion.service.ts`（创建）与 `order.service.ts#applySyncedPlatformFacts`（事实更新）落
  `platform_stage` / `platform_stage_changed_at`（阶段迁移时更新，取 mapper 值，null 则回退当前时间）；
  **只写平台事实，绝不写 `erp_status`**（AGENTS.md §38）。

**测试**：`ozon.mapper.spec.ts` 增平台阶段映射契约测试（含未归类 → `null`、缺失 → `null`、
`delivering_date` 非法 → `platformStageChangedAt = null`）。

**文档**：`docs/integrations/ozon.md` 增「平台阶段映射表 + 未归类清单 + 验证日期」，并补记 A8
（`changed_state_date` 仅 webhook 载荷有、GET 响应无——防止后人再踩）。

## T2 事件驱动 + 按需回读（替换全量刷新）

**后端**

- `platform_status_history` 增 `platform_changed_at timestamptz NULL`（webhook 来源取事件 `changed_state_date`；
  回读来源取 mapper 的 `platformStageChangedAt`；均缺失时回退行 `created_at`）+ migration。
- `apps/api/src/modules/sync/services/webhook.service.ts#WebhookProcessService`：
  - 动作分支从仅 `NEW_POSTING` 扩展为 `NEW_POSTING` / `TYPE_STATE_CHANGED` / `TYPE_POSTING_CANCELLED`
    （后两者载荷含 `posting_number`（ozon.md §6.1 已核对），复用 `fetchOrdersByPlatformIds` 定向回读）：
    回读 `adapter.fetchOrdersByPlatformIds(context, [posting_number])` → 走既有事实链路
    （`ingestPlatformOrders` → 已知单走 `applySyncedPlatformFacts`：`platform_status` / `platform_stage` +
    平台状态历史 + 取消传导 + 时限重算）。
  - **显式决策**：回读遇到 WCIES 未知单会**完整建单**（与 `NEW_POSTING` 路径同语义——webhook 本就是补漏通道，
    摄入幂等且窗口轮询有同样效果）。若用户希望「状态事件只更新已知单、不建单」，需在实施前提出。
  - **不把 push 词表写进 `platform_status`**（`ozon.md` §6.2），一律以回读的 Seller API 原文为准。
  - 事件状态修正（A10）：产生动作的事件（含既有 `NEW_POSTING`）标 `PROCESSED`，异常标 `FAILED`，
    无动作类型（`PING` / `ITEM_CHANGED` / `UNKNOWN`）维持 `SKIPPED`；枚举无需变更（`PROCESSED` 已存在）。
    保留既有幂等（`(store, sha256(payload))` 去重）。
- `apps/api/src/modules/sync/services/order-sync.service.ts#refreshPlatformFacts` 改为**按需回读轮转**（v2 重设计）：
  - **删除全量刷新语义**（不再"每轮刷新所有非 ERP 终态订单"；现状见 `order.repository.ts:163-177`）。
  - 候选 = `platform_stage IS NULL OR platform_stage IN ('AWAITING_SHIPMENT','IN_TRANSIT')`（**平台阶段**非终态，
    不再按 `erp_status` 排除——`erp_status='SHIPPED'` 的单继续回读直到平台妥投/取消，这正是 A3 的修复）
    且 `platform_facts_checked_at IS NULL OR now() - platform_facts_checked_at > ORDER_STATE_FALLBACK_HOURS`
    （默认 24，ENV 可配）；
  - 排序 `platform_facts_checked_at ASC NULLS FIRST`（最久未查优先），每单回读后无论事实是否变化都刷新
    `platform_facts_checked_at`；
  - 批大小 `PLATFORM_REFRESH_BATCH = 100`/轮、`OZON_MIN_REQUEST_INTERVAL_MS = 110ms`/店铺预算不变。
  - **为什么不用「距上次平台变更」选候选（v1 方案，已废弃）**：事实不变的单「上次变更时间」永远不前进，
    同一批最老的单会每轮霸占全部回读预算，较新的停滞单饥饿；且排除「停滞异常已 OPEN」的单后，
    该单从此失去兜底回读——若 webhook 恰好停用（ozon.md §6.5 自动暂停是真实风险），异常永远无法自动
    resolve。「上次检查时间」轮转制同时解决三点：公平覆盖、预算有界、停滞单持续被观察直至终态。
- ENV 新增 `ORDER_STATE_FALLBACK_HOURS`（默认 24）→ `apps/api/src/config/configuration.ts` + `env.validation.ts` + `.env.example`。
- **新单发现轮询不变**（`fetchOrders` 分页）：OZON 官方在 `TYPE_ORDER_NEW` 章节自述该通知可能延迟，新单发现不能只靠 webhook。
- `TYPE_ORDER_*`（`order_number` 与 `platform_order_id` 的关系未验证，`ozon.md` §6.1d 第 4 点）继续只落库，不产生业务效果。

**测试**：webhook 处理器 spec（`TYPE_STATE_CHANGED` → 回读 → 事实应用；重复投递不重复处理；未知单回读建单）；
`tests/integration/order-platform-status-sync.integration.spec.ts` 增：回读候选只取 checked 超时的单（轮转公平性）、
`erp_status='SHIPPED'` 的单仍在候选内（A3 回归）、webhook 事件标 `PROCESSED`。

**文档**：
- `ozon.md` §6.1c 处理表更新（`TYPE_STATE_CHANGED` / `TYPE_POSTING_CANCELLED` 由「仅落库」改为「回读 + 事实应用」）；
- **`orders.md` §7a 第 2 点同步改写**（v1 遗漏）：现文档描述的是"每轮对非 ERP 终态订单定向回读（上限 100）"的全量刷新语义，
  本任务将其改为"按需回读轮转"后必须同步改写该条，否则代码与业务规则文档冲突（AGENTS.md 开发纪律）。

## T3 列表查询契约 + 前端双轴标签（对应用户反馈 1 / 2 / 4 / 5）

**后端**

- `apps/api/src/modules/order/dto/order.dto.ts`：
  - `OrderListQueryDto` 增 `stage ∈ {PENDING, IN_TRANSIT, COMPLETED}` 与
    `goodsState ∈ {TO_PICK, PICKING, TO_SHIP, BACKORDERED, MAPPING_FAILED, SHIPMENT_OVERDUE, ABNORMAL}`
    （`@IsIn` + Swagger 描述写明 §2.1/§2.2 判定口径）；
  - `OrderListItemDto` 增 `backorderedOrderedCount` / `backorderedArrivedCount`。
- `apps/api/src/modules/order/repositories/order.repository.ts`：`OrderListFilters` 增 `stage` / `goodsState`；
  实现为 EXISTS 子查询（与行内徽标同源，能覆盖"部分已发货仍有缺货/失败行"的订单）；
  `ABNORMAL` = 缺货 ∪ 映射失败 ∪ 发货超时 ∪ 存在 OPEN `ORDER_TRACKING_STALLED`（与 §2.2 口径一致，
  T5 后并入已发货退款）；新增按订单 id 批量取 `BACKORDERED` 行 id 的查询。
- `apps/api/src/modules/order/services/order.service.ts`：用 `ORDER_PROCUREMENT_PORT#getProcurementStatesByOrderItemIds`
  （已存在）汇总本页已采购/已到货计数 —— **不新增跨模块 SQL**（AGENTS.md §9）。
- `apps/api/src/modules/order/controllers/order.controller.ts`：透传新参数。
- 保留 `erpStatus` 与 `pendingProcurement`（`purchase.md` §3.5 文档视图 + 集成测试在用）；前端不再调用 `pendingProcurement`。

**前端**

- `apps/web/src/pages/orders/OrdersPage.tsx`：
  - 一级 Tabs：`全部 / 待处理 / 待收货 / 已完成`，默认 `待处理`；计数沿用轻查询（`pageSize=1` 读 `meta.total`，
    **计数查询带当前 storeId/keyword**，修复现状计数与筛选条件脱节的问题）；
  - 二级 chips：`全部 · 待拣货 · 拣货中 · 待发货 ｜ 缺货 · 映射失败 · 发货超时 · 异常`，单选取值 + Tooltip 写明判定规则；
  - 行内：`缺货 N` 旁显示 `已采购 N` / `已到货 N`；ERP 状态列红色 `×N` 加 Tooltip 说明（计的是未处理异常条数，含 `ORDER_OUT_OF_STOCK`）；
  - **删除**「待采购」按钮及其 `pendingProcurement` state / 查询参数；删除 `STATUS_TABS` 上未使用的 `risk?` 死字段。
- `apps/web/src/pages/DashboardPage.tsx`：待处理卡片改 `stage=PENDING`（与订单页同口径）。
- `apps/web/src/pages/exceptions/ExceptionsPage.tsx` 与 `DashboardPage.tsx`：补 T4 新增异常类型的 label / category。

**契约**：`pnpm openapi:export` → `openapi.json` + `packages/api-client/src/generated/schema.d.ts` 再生成；`pnpm check:openapi` 通过。

## T4 异常类型扩展（对应用户反馈 3）

**后端**

- `apps/api/src/modules/exception/enums/exception.constants.ts` 增：
  - `ORDER_TRACKING_STALLED`：`platform_stage='IN_TRANSIT'` 且 `now() - platform_stage_changed_at > 3 天` → 创建
    （引用 `ORDER`）；阶段进入 `DELIVERED` / `CANCELLED` 自动 resolve。评估挂在 ORDER_SYNC 回读相遇时
    （候选轮转保证每个非终态单至少每 fallback 窗口被观察一次，无需新增定时任务；**每次相遇都评估**，A11）。
  - `ORDER_CANCELLED_AFTER_SHIP`：`applySyncedPlatformFacts` 的取消传导命中"存在 `SHIPPED` 行"的订单时创建；
    订单仍走既有 `cancel()` 链路，库存不动、`SHIPPED` 行保持。
- 两个类型都必须经 `ExceptionService` 创建（禁止绕过，AGENTS.md §52/§53）。

**前端**：异常中心与 Dashboard 的异常类型标签、分类。

**文档**：`orders.md` §15 异常清单同步新增两个类型（`order.constants.ts` / `exception.constants.ts` 文件头注释均明确
"新增取值属于业务规则变更，必须同步文档"）。

## T5 退货/退款模块（路线图 Sprint 12 前移，**先冻结规则再实现**）

**前置（必须先完成并被用户确认）**：`docs/business-rules/returns.md`，至少覆盖：

1. 退货状态机（AGENTS.md §98：状态机属产品业务设计，AI 不得自行新增状态）；
2. 批次对单策略（`docs/会议纪要.md` 的核心难点："退货通常以批次形式返回，无法准确对应到原始订单"）；
3. 库存回流路径：退货临时仓 / 隔离库位（"建议建立退货临时仓或专用库存池，隔离待检退货"）→ 检验 → 经
   `InventoryService.returnToStock` / `moveBin` 入主库存（AGENTS.md §10/§17/§18）；
4. 退款口径与财务边界（对账属路线图 Sprint 13）；
5. 与既有 PICKED 取消拦截（`interception` 模块）的分工；
6. 异常类型：`RETURN_ORDER_NOT_FOUND` / `RETURN_DIFFERENCE` 与 `ORDER_CANCELLED_AFTER_SHIP` 的关系。

**平台侧（只读）**：`/v1/returns/list`、`/v2/returns/rfbs/list`（`docs/ozon-seller-api-eng-version-3.json` 已确认存在）；
**不做** `/v1/returns/rfbs/action/set`（真实平台写操作，AGENTS.md §92 需专项确认）。

**交付物**：`apps/api/src/modules/returns/**`（模块 + 实体 + migration）+ `app.module.ts` 模块注册 +
库存接入 + 页面（`apps/web/src/pages/returns/**` + 路由/导航注册）+ 通知 + 真实 PG 集成测试。

---

# 4. 验收标准

1. 订单列表默认进入「待处理」；缺货单出现在其中；切到「缺货」chip 得到的结果集与行内「缺货 N」徽标一致。
2. 一级、二级标签的计数与同筛选条件下的列表 `total` 一致（计数含当前店铺/关键词筛选）。
3. 工具栏不再有「待采购」按钮；缺货且已登记采购的订单行显示「已采购 N」/「已到货 N」。
4. 平台状态变为 `delivered` 后，订单从「待收货」进入「已完成」（事件路径 ≤1 分钟；兜底回读路径：单量不超批容量时 ≤24h + 一个轮次）。
5. `IN_TRANSIT` 且平台状态 3 天未变 → 出现 `ORDER_TRACKING_STALLED`；妥投后自动解决（**经兜底回读也能自动解决**，不依赖 webhook 存活）。
6. 已发货订单被平台取消 → 出现 `ORDER_CANCELLED_AFTER_SHIP`；订单走既有 `cancel()` 链路，库存不动，`SHIPPED` 行保持。
7. 回读轮转公平性：连续两轮候选集不重复（除非候选总数 < 批容量）；`erp_status='SHIPPED'` 的在途单持续出现在候选中直至平台终态。
8. `pnpm lint` / `typecheck` / `check:arch` / `test` / `test:integration` / `openapi:export` + `check:openapi` 全绿。

---

# 5. 测试与验证要求

- OZON mapper 平台阶段映射契约测试（含未归类 → `null`、`delivering_date` 容错）。
- `tests/integration/orders.integration.spec.ts` 增：`stage` / `goodsState` 各取值筛选、已采购计数、发货超时谓词（含 `PARTIALLY_SHIPPED` 命中）。
- `tests/integration/order-platform-status-sync.integration.spec.ts` 增（v1 遗漏，该文件正是 T2/T4 改动的主战场）：
  兜底候选选取（只取 checked 超时单、轮转公平、`SHIPPED` 单不排除）、停滞异常创建与自动解决（含纯回读路径）、
  已发货取消异常、webhook `TYPE_STATE_CHANGED` → 回读 → 事实应用、重复投递不重复处理。
- webhook 处理器 unit spec：事件状态 `PROCESSED` / `SKIPPED` / `FAILED` 的分流。
- `tests/integration/perf-lists.integration.spec.ts` 回归（列表新增 EXISTS 条件后性能不退化）。
- T5：退货回库必须有真实 PostgreSQL 集成测试（AGENTS.md §77：库存测试不得全部 Mock）。

---

# 6. 本批不做的事（范围控制）

1. 渠道库存推送 / Allocator（AGENTS.md §21，路线图 Sprint 11）。
2. 平台轨迹接口 —— 规范中不存在（只有 `tracking-number/set`，A6）。
3. `TYPE_ORDER_*` 的 `order_number` → `platform_order_id` 映射（官方关系未验证，`ozon.md` §6.1d）。
4. WB / Yandex 适配器。
5. 退货平台写操作（`/v1/returns/rfbs/action/set`）。
6. 财务对账（路线图 Sprint 13）。
7. 新增 webhook 订阅 —— 承诺送达日期可在回读 posting 时顺带取得，不加订阅（加订阅属真实平台写操作）；
   `TYPE_CUTOFF_DATE_CHANGED` / `TYPE_DELIVERY_DATE_CHANGED` 虽在可选清单（ozon.md §6.1b）但本期同样不订阅。
8. 不新增 ERP 状态（AGENTS.md §98）；不改 `erpStatus` 汇总规则。
9. 不按送达日期事实判定停滞/妥投超期（本期只用 3 天规则 + `DELIVERED` 事实；送达日期仅展示）。

---

# 7. 允许修改的目录（v2 补齐遗漏）

```text
apps/api/src/modules/order/**            （T1/T3/T4）
apps/api/src/modules/sync/**             （T2/T4 评估）
apps/api/src/modules/exception/**        （T4 类型）
apps/api/src/modules/integration/ozon/** （T1 mapper + types）
apps/api/src/config/**                   （T2 ENV：ORDER_STATE_FALLBACK_HOURS，v2 补）
apps/api/src/app.module.ts               （T5 ReturnsModule 注册，v2 补）
apps/web/src/pages/orders/**             （T3）
apps/web/src/pages/DashboardPage.tsx     （T3 卡片口径）
apps/web/src/pages/exceptions/**         （T4 标签）
apps/web/src/app/**                      （T5 路由与导航注册，v2 补）
packages/platform-contracts/**           （T1 契约）
packages/api-client/src/generated/**     （再生成）
database/migrations/**                   （T1/T2/T5）
tests/integration/**                     （全部）
docs/**、openapi.json、.env.example      （文档、契约与环境变量样例，v2 补 .env.example）
T5 另加：apps/api/src/modules/returns/**、apps/web/src/pages/returns/**
```

---

# 8. 需用户确认项

1. 异常类型命名：`ORDER_TRACKING_STALLED`（AGENTS.md §53 例举的是 `TRACKING_STALLED`，本任务书按代码库
   `ORDER_*` 前缀惯例命名，二者指同一事）、`ORDER_CANCELLED_AFTER_SHIP`。
2. 「平台状态超 3 天未变」的适用范围 = **已交物流后的在途阶段**；未发货阶段的超时由「发货超时」覆盖
   （这是对用户原话「状态超 3 天未变就报」的解读，若需覆盖全部阶段请指出）。
3. `arbitration` / `client_arbitration` / `not_accepted` 三个状态暂标 `NULL` 待归类。
4. 兜底回读阈值默认 24 小时（ENV `ORDER_STATE_FALLBACK_HOURS` 可配）。
5. **T2 显式决策**：`TYPE_STATE_CHANGED` / `TYPE_POSTING_CANCELLED` 定向回读遇到 WCIES 未知单时**建单**
   （与 `NEW_POSTING` 同语义，推荐保持一致）；若希望只更新已知单请指出。
6. T5 的 `returns.md` 六项决策（§3 T5 前置清单）。

---

# 9. 与路线图的关系（提示）

- 本任务书把路线图 **Sprint 12**（退货 + 物流追踪）中的**物流停滞判定**与**退货/退款模块**提前实施，属用户明确指示的范围调整。
- 路线图 Sprint 10（补货建议）与 Sprint 11（渠道库存推送）不受影响，仍待后续排期。
- `docs/WCIES_下一阶段规划_Sprint_9_订单状态同步与运营闭环.md` §6.3「不做退货、物流追踪模块」一条在本任务书生效后需要废止，并记录本次调整。
