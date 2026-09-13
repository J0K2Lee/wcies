# WCIES 下一阶段规划（Sprint 9：订单状态同步与运营闭环）

> 依据：`AGENTS.md`、`docs/WCIES_下一阶段规划_Sprint_7_及后续.md`（v7）、
> `docs/WCIES_下一阶段规划_Sprint_8_批量建档与映射补齐.md`（v1）、Sprint 0–8 提交记录、
> 开发库真实数据核查（2026-09-13，提交 `20b4791`）、`docs/会议纪要.md`。
>
> 本文件是**规划**，不是实施任务书。实施前需先确认第 5 节的决策点。
>
> 修订历史：
> - v1.5（2026-09-14）：建档增强（多变体挂靠、类目体系、品牌/尺寸预填、SKU 图片、
>   保存并下一变体）移至 **Sprint 8.5** 执行——见
>   `docs/WCIES_下一阶段规划_Sprint_8.5_建档并映射增强.md`。本文件 T4 走查中的
>   「建档并映射」环节以**增强版**执行（含类目/品牌/图片）。
> - v1：Sprint 8 收尾盘点 + Sprint 9 范围建议。
>   **核心变更：原路线的 Sprint 9「补货建议」顺延一期**，理由见 §2.1。
> - v2（本版）：按用户要求核实 OZON webhook 事件清单后修订决策 1/2——
>   官方规范 v2.1 内含 14 种订阅类型完整枚举与各事件 payload（取消/时限/
>   状态事件全部存在，详见 `docs/integrations/ozon.md` §6，2026-09-13 核对）。
>   T1 增补可选 T1b（webhook 加速路径）；「不做的事」第 4 条相应改写；
>   新发现一处应答格式文档冲突（ozon.md §6.4）待实测定论。

---

# 1. 现状盘点（有证据，非推测）

## 1.1 Sprint 8 已完成（2026-09-13 核对提交 `20b4791`）

| 任务 | 内容 | 状态 |
|---|---|---|
| T1 | Listing 快速建档（Product + SKU +（可选）条码 + 映射，单事务编排，失败整体回滚） | ✅ 已提交 |
| T2 | 未映射清单导出 Excel（与导入模板逐列对齐；导入改为 BIND 既有同步行，不再插孪生行） | ✅ 已提交 |
| T3 | 未映射工作台（mapping-stats 计数、`hasOrderException` 派生标记、异常命中行置顶） | ✅ 已提交 |
| T4a | 移动加权平均成本收尾（后端更新 + 文档 + 测试在 Sprint 7 已交付；收货界面空成本黄色警示） | ✅ 已提交 |
| T4b | 暂存位交互引导（收货选位 ST 区标记「暂存」、库存页「待上架」派生提示） | ✅ 已提交 |
| T5 | **真实数据走查验收（≥5 个新商品 + ≥20 行 Excel 闭环）** | ❌ **未执行**（见 §1.2） |

提交时测试基线：Unit 146 通过；Integration 220 + 9 新增（串行）通过；
1323 行未映射导出做过一次真实冒烟。

## 1.2 真实数据状态（2026-09-13 开发库实测）

| 项 | 数量 | 说明 |
|---|---|---|
| `products` / `skus` | **各 1** | 与 Sprint 8 开始时一致——**快速建档尚未在真实数据上用过** |
| `platform_listing_skus` 未映射 | 1323 | 不变 |
| `inventory_balances` | 1 | 仍是那 1 条 SELLABLE |
| `orders` | 5 | ORD00000001–04 + ORD00000047 |
| `purchase_orders` / 已确认收货单 | 1 / 1 | 不变 |
| `system_exceptions` OPEN | **6** | 见下表 |

6 个 OPEN 异常的构成：

| 异常 | 数量 | 说明 |
|---|---|---|
| `ORDER_SKU_MAPPING_FAILED` | 4 | ORD00000001/02/03 + ORD00000004（已 RESOLVED 1 个）——**正是 Sprint 8 快速建档的靶子** |
| `ORDER_OUT_OF_STOCK` | 2 | ORD00000004、ORD00000047 |
| `ORDER_INTERCEPTION_FAILED` | 1 | **ITC00000004：拦截失败「暂存区未找到」，库存保持 Picked** |

## 1.3 关键发现一：订单同步存在「一次性摄入」缺口（代码证据）

这是本次核查**最重要的发现**，直接对应会议纪要的第一痛点。

`order-ingestion.service.ts:83-88`：

```typescript
const existing = await this.orderRepo.findByStoreAndPlatformOrder(...);
if (existing !== null) {
  return this.buildResult(existing, true);   // duplicates = true，直接返回
}
```

**订单一旦摄入，后续同步永远跳过**。全仓核查确认：没有任何代码路径会更新
已存在订单的 `platform_status`（`order.repository.ts` 无 update platformStatus；
webhook 处理器只认 `NEW_POSTING`，`webhook.service.ts:157`）。

后果（对照 `docs/integrations/ozon.md:99` 的状态清单——
`awaiting_packaging / awaiting_deliver / delivering / delivered / cancelled` 全是已知事实）：

1. **平台取消永远不可见**。买家在 OZON 取消订单无需商家审核（会议纪要原文），
   而我们的 `ORDER_SYNC` 再跑多少遍也看不到 `cancelled`——
   Reserved 库存被永久占用；BACKORDERED 单会被白白采购（缺货货到后无法交付）。
2. **平台发货/送达不可见**。真实数据已经出现分裂案例：
   `ORD00000001` 平台状态 `delivering`，而系统订单行仍 `PENDING`、
   erp `EXCEPTION`——用户在系统外完成了这笔订单（映射失败后线下采购直发），
   系统毫无感知，异常至今挂着。
3. 时限倒计时（Sprint 7 T1）对已摄入订单是**静态快照**：
   `shipment_deadline` 若在平台侧调整，系统不会更新。

## 1.4 关键发现二：定时同步从未开启（配置证据）

Sprint 5 已实现调度器（`webhook-scheduler.processors.ts`）：
按 ENV 间隔 + 店铺 `settings.sync.orderSyncEnabled / listingSyncEnabled` 派发，
且有 `failStaleRunning` 崩溃恢复与单飞保护——**基础设施是齐的**。

但「最后一公里」全部缺失：

| 层 | 现状 |
|---|---|
| ENV | `ORDER_SYNC_INTERVAL_SECONDS` / `LISTING_SYNC_INTERVAL_SECONDS` 未设置（API 容器实测无此变量；代码默认 0 = 关） |
| 店铺设置 | `香港玩具店` 的 `settings->'sync'` 为**空**（DB 实测） |
| 界面 | 全 `apps/web` 无任何同步开关入口（grep 无 `orderSyncEnabled`） |

实测结果：**最后一次同步停在 2026-09-11**，两天零增量。
订单不会自己进来，时限预警、待采购视图全部依赖用户记得手动点同步。

## 1.5 真实订单的时限压力（2026-09-13 实测）

```
订单号          ERP状态      平台状态           shipment_deadline（UTC）
ORD00000047    BACKORDERED  awaiting_packaging  2026-09-13 10:48  ← 今天，即将到期
ORD00000002    EXCEPTION    awaiting_deliver    2026-09-13 21:00  ← 今天
ORD00000003    EXCEPTION    awaiting_deliver    2026-09-14 23:00
ORD00000004    BACKORDERED  awaiting_packaging  2026-09-16 21:00
```

「先售后采」的赛跑正在真实发生，而系统两天没有拉过新订单。

---

# 2. 下一阶段的核心判断

## 2.1 原路线 Sprint 9「补货建议」必须顺延

原路线（Sprint 7 规划 §4）：Sprint 9 = 补货建议，前置依赖
「Sprint 7 采购登记数据 + Sprint 8」。

**该依赖只满足了代码，没有满足数据**：

| 补货建议需要的 | 现有 |
|---|---|
| 采购历史（多次、多 SKU） | 1 张采购单、1 个 SKU |
| 销量历史 | 5 张订单、0 张已发货 |
| 在管 SKU 基数 | 1 |

在 1 个 SKU 上做补货算法是无米下锅——做出来的只有空面板。
**顺延一期，把 Sprint 10 补货建议的前置（数据积累）作为本 Sprint 的验收产出之一（§3 T4）。**

## 2.2 本 Sprint 的定位：让系统与现实保持一致

Sprint 7 补了「货进系统」，Sprint 8 补了「商品进系统」，
**Sprint 9 补「变化进系统」**——平台侧每天发生的事（新订单、取消、发货、时限调整）
必须自动、及时地反映进来。三个缺口按因果排序：

| 缺口 | 后果 | 对应任务 |
|---|---|---|
| 已摄入订单的状态变化被跳过（§1.3） | 取消不可见 → 库存白占/白采购；发货不可见 → 账实分裂 | T1 |
| 定时同步全关（§1.4） | 新订单也不及时，一切能力沦为「打开页面才有效」 | T2 |
| 拦截回库卡死 + 快速建档未实战（§1.2） | 已知异常挂着不动，Sprint 7/8 的能力没被真实使用 | T3/T4 |

## 2.3 与会议纪要的对应关系

会议纪要（用户最近的业务输入）核心痛点逐条对照：

| 会议纪要痛点 | 本 Sprint | 后续 |
|---|---|---|
| 「商家无法实时获知订单取消状态…缺乏系统化的取消信息同步机制」 | **T1 + T2 直接解决**（取消自动进系统 + 定时拉取） | — |
| 「库存变动应与订单状态强关联：取消+退货应回加库存」 | T1 取消传导复用既有释放/拦截链路（Sprint 3/4 已建） | 退货回流 = Sprint 12 |
| 「退货批次无法对应原始订单」 | 不在本期 | Sprint 12（退货模块） |
| 「高货值丢货需前置信息同步」 | 不在本期 | Sprint 12（追踪） |

---

# 3. Sprint 9 建议范围

## T1 已摄入订单的平台状态更新（本 Sprint 核心）

**目标**：`ORDER_SYNC` 再遇到已存在的订单时，从「跳过」改为「对比更新」。

要点：

1. **只更新平台事实字段**：`platform_status`、`shipment_deadline`、`raw_data`。
   **绝不**直接改 `erpStatus`（§38 平台状态与 ERP 状态分离）。
2. **取消传导**：检测到平台状态变为 `cancelled`（ozon.md:99 已登记的状态值，
   不是猜测）时，调用**既有** `OrderService.cancel()` 链路——
   Reserved 行释放 Reservation、Picked 行建 Interception（Sprint 3/4 已实现并测试）。
   自动还是人工确认，见决策 D1。
3. **发货/送达差异可见化**：平台 `delivering/delivered` 而系统未发货的订单
   （ORD00000001 这类「线下履约」），在订单页给出明确标记。是否提供
   「标记外部履约」的正式路径，见决策 D6。
4. **幂等**：状态无变化不写库；同一取消事件重复同步不得重复释放
   （复用 `ORDER_RELEASE:<orderItemId>` 既有幂等键）。
5. **历史**：平台状态迁移必须可追溯（§39）。落点设计（复用
   `order_status_history` 加来源维度 vs 新表）在任务书中定，本规划不预设。
6. **数据源零新增**：用现有 `ORDER_SYNC` 再轮询即可（`ozon.mapper.ts:121`
   已提取 `posting.status`）。轮询是**不依赖公网 URL 的基线路径**；
   webhook 加速路径见 T1b。
7. 单条订单更新失败不得拖垮整批同步（§36）。

## T1b（可选，依赖决策 D1b）Webhook 取消/时限事件接入

**前提事实已核实（2026-09-13，官方规范 v2.1，详见 `docs/integrations/ozon.md` §6.1）**：
OZON 订阅类型共 14 种，其中与本 Sprint 直接相关的三种全部存在且 payload 有官方定义：

| 事件 | 对 WCIES 的意义 |
|---|---|
| `TYPE_POSTING_CANCELLED`（带 `reason{id,message}`、`old/new_state`） | 取消的**秒级推送**（轮询要等下一周期）；reason 恰好是会议纪要要求的「取消原因」登记字段 |
| `TYPE_CUTOFF_DATE_CHANGED`（`new/old_cutoff_date`） | `shipment_deadline` 变化的推送（官方标注测试期、可能为空——回读式处理天然兜底） |
| `TYPE_STATE_CHANGED`（push 模型词表） | 平台状态迁移推送（注意词表差异，见 ozon.md §6.2，回读规避） |

要点：

1. **架构零新增**：复用 Sprint 5 已建的 webhook 链路（raw event → 队列 → 回读入库）。
   处理器目前只认 `NEW_POSTING`，扩展取消/时限两个分支即可。
2. **webhook 只是加速，轮询仍是事实兜底**：无签名、无事件 ID、投递不保证——
   取消传导的幂等与正确性全部落在 T1 的轮询路径上；webhook 丢件时轮询补齐。
3. **两个硬前置**：
   - 需要公网可达 URL（内网穿透或正式部署）——**部署条件，不是代码条件**；
   - 配置订阅 = **真实平台写操作**（§92），需用户明确批准后经 `/v1/notification/set` 执行。
4. **接入前必须先实测应答格式**（ozon.md §6.4 的文档冲突：`{result:true}` vs
   `{version,name,time}`）——用 `/v1/notification/check` 对我们的端点做一次真实校验，
   以实测为准修订控制器。
5. **本期不订阅** `TYPE_STOCKS_CHANGED`（属渠道库存推送阶段）与聊天类事件。

## T2 定时同步开启（Sprint 5 调度器的最后一公里）

1. **ENV 默认值**进 `docker-compose.yml`（开发栈即默认生效）：
   `ORDER_SYNC_INTERVAL_SECONDS=60`、`LISTING_SYNC_INTERVAL_SECONDS=300`
   ——正好是调度器代码里的安全下限（`intervalMs` 的 min 参数），不发明新频率。
   webhook（若 T1b 落地）负责秒级取消，轮询 60s 负责事实兜底与增量——两者互补，
   频率不必再调快（对 OZON 配额友好，§4 限流实测见 ozon.md）。
2. **店铺同步开关 UI**：店铺管理页暴露
   `settings.sync.orderSyncEnabled / listingSyncEnabled`（后端
   `readStoreSyncSettings` 已消费该结构，只缺写入口）。
3. **同步新鲜度可见**：店铺概览/首页显示「最近一次成功同步时间」，
   超过 N 小时未成功标红——回答「系统到底在不在跑」。
4. 可选（决策 D3）：连续失败进异常中心 `SYNC_FAILED`
   （AGENTS §53 已列该类型，代码枚举未实现——枚举新增属业务规则变更，需确认）。

## T3 拦截回库暂存位兜底 + 存量卡死拦截处理

**事实**：ITC00000004 因「暂存区未找到」失败，库存保持 Picked（真实卡死案例）。
Sprint 8 T4b 只做了界面引导，拦截执行路径对暂存位的依赖没有兜底。

1. 拦截执行/完成时若仓库无暂存位：**自动创建** `STAGING` 库位
   （`bin_code` 自由字符串，Sprint 8 规划 §3.4b 已核实零 Schema 改动合法），
   或回退 `DEFAULT`——两方案见决策 D4。
2. 真实数据操作：按正式拦截流程处理完 ITC00000004（货回库位才恢复可售，§42）。
3. 若行为变化，同步更新 `docs/business-rules/orders.md`（拦截章节）。

## T4 Sprint 8 真实数据验收（从 Sprint 8 T5 结转）+ 数据积累

**这一项同时是 Sprint 10（补货建议）的数据前提。**

1. 用 4 个 OPEN 的 `ORDER_SKU_MAPPING_FAILED` 异常做快速建档走查
   （它们就是现成的靶子），再补足至 ≥5 个新商品；
2. 每个商品走完整链路：建档并映射 → 重试解析 → 登记采购 → 扫码收货 →
   重试分配 → 拣货 → 发货（能走多远走多远，缺货停在 BACKORDERED 也算走到位）；
3. 一轮 ≥20 行 Excel 导出→补填→双导入闭环（Sprint 8 T5 原文要求）；
4. 产出物：SKU 基数、采购历史、销售历史——为补货建议攒米。

## T5 验收

1. **集成测试**（新增）：
   - 平台取消传导：Reserved 订单 → 同步到 cancelled → Reservation 释放、可售恢复；
   - Picked 取消：同步 cancelled → 建 Interception，不直接恢复库存（§78 Case 3 的同步触发版）；
   - 重复同步同一取消：只释放一次；
   - 状态无变化的重复同步：零写入。
2. **真实数据**（手工）：
   - 开启定时同步后观察 ≥48h：订单自动流入、无 SYNC_ALREADY_RUNNING 噪音；
   - 4 个 mapping-failed 异常清零（建档+重试解析）或明确处理结论；
   - ITC00000004 走完拦截闭环，库存回到可售；
   - T4 的 ≥5 商品走查记录。

---

# 4. 后续阶段建议（Sprint 10 起）

| 阶段 | 范围 | 前置依赖 | 变化 |
|---|---|---|---|
| Sprint 10 | 补货建议（基于采购历史与销量） | **本 Sprint T4 的数据积累** | 顺延一期（原 Sprint 9） |
| Sprint 11 | 渠道库存推送（Allocator + OZON 写接口，真实平台写需专项确认） | 在管 SKU/库存基数 | 顺延一期（原 Sprint 10） |
| Sprint 12 | 退货 + 物流追踪（退货批次对单、TRACKING_STALLED/LOST） | **本 Sprint T1 的状态同步基座** | 会议纪要第二痛点 |
| Sprint 13 | 财务（成本、对账） | 采购成本数据（moving_average_cost 已在记账） | — |
| 按需 | WB / Yandex 适配器 | 无（可并行） | — |

双轨期风险提示继续有效（Sprint 7 规划决策 5）：推送能力就绪前，
平台侧库存人工维护，系统库存视为内部账。

---

# 5. 需要用户决策的点

> **Webhook 事实前置（2026-09-13 已核实，来源：官方 OpenAPI 规范 v2.1
> `notification.v1.*` 枚举 + 规范内嵌文档段，详见 `docs/integrations/ozon.md` §6）**：
> OZON 共 14 种订阅类型 + 1 种自动连通检查（`TYPE_PING`，不可订阅）。
> 与本 Sprint 相关的三种事件（取消 / 发货时限变化 / 状态变化）**全部存在且
> payload 有官方定义**——取消事件自带 `reason{id,message}`，恰好是会议纪要
> 要求登记的「取消原因」。但**真实投递从未在我们环境验证过**（从未配置过
> 真实 webhook），且存在一处应答格式的文档冲突（ozon.md §6.4）。
> 以下决策 1/2 的选项均以此为前提。

## 决策 1：平台取消的感知路径与执行方式（T1 / T1b）

**感知路径（D1a）**——事实更新后的推荐已变：

- **A（推荐，分两步走）**：本 Sprint 先做 T1 轮询对比更新（60s 内感知取消，
  零部署前提、零平台写操作）；**T1b webhook 订阅作为同 Sprint 或下 Sprint 的
  增量**，待有公网 URL 且用户批准平台写配置后启用，把取消感知压到秒级。
  轮询路径的取消传导逻辑两步共用，webhook 只是触发器提前。
- B：一步到位只做 webhook（秒级），轮询维持现状不动——**不推荐**：
  webhook 无投递保证且配置有部署前提，单独依赖它等于把库存释放押在
  best-effort 通道上。

**执行方式（D1b）**——检测到取消后：

- **A（推荐，自动）**：即自动走 `OrderService.cancel()`
  （释放 Reserved / 对 Picked 建拦截）。理由：买家取消是**平台既成事实**，
  无需商家审核（会议纪要），人工确认只是把库存多锁几天；
  释放/拦截链路 Sprint 3/4 已有幂等保护；webhook 与轮询双通道重复触发
  也有幂等键兜底。
- B（人工）：取消只标记 + 建异常，人工确认后才执行释放/拦截。
  适合担心「平台误报取消」的场景，代价是每单多一步操作。

## 决策 2：定时同步的默认开关与频率（T2）

- **A（推荐）**：开发栈默认开——订单 60s / Listing 300s（即代码安全下限），
  店铺开关默认开启（用户只有一家店，开了才有数据流入）。
- **B**：默认全关，用户在店铺页手动开启后再生效（更保守，但大概率重演
  「基础设施齐了却没人开」的现状）。

频率本身不建议再调：60s 已是调度器写死的下限，再快对 OZON 配额不友好。
若 T1b 落地，取消/时限的时效性由 webhook 秒级承担，轮询只做兜底与增量，
60s/300s 更无必要调快。

## 决策 3：是否新增 `SYNC_FAILED` 异常类型（T2 可选项）

AGENTS §53 列了它，但代码 `EXCEPTION_TYPES` 没有。新增枚举属业务规则变更
（§64/§98）。不加的后果：同步连续失败只能看日志/店铺概览，异常中心不显示。

## 决策 4：拦截暂存位兜底方式（T3）

- **A（推荐）**：拦截路径发现仓库无暂存位时**自动创建** `STAGING` 库位。
  一次到位，零 Schema 改动。
- **B**：回退 `DEFAULT`（仓库无库位时的既有兜底）——但该仓已有正式库位时
  `DEFAULT` 可能不存在，仍有失败面。

## 决策 5：平台状态历史的落点（T1 设计点）

§39 要求状态迁移可追溯，当前 `order_status_history` 只记 ERP 状态。

- **A（推荐）**：复用 `order_status_history`，加 `source`（ERP/PLATFORM）维度——
  一张表回答「订单什么时候从什么状态变成什么状态」。
- **B**：新表 `platform_status_history`——语义更纯，但查询要拼两处。

## 决策 6：是否存在「不经仓库直发」订单的正式路径（T1 关联）

ORD00000001 的实况：平台 `delivering`、系统从未发货——用户线下采购直发买家。
这类订单目前只能挂异常。是否提供「标记外部履约」动作
（订单行关账 + 记录原因，不产生库存流水——因为货从未进过系统）？

- **A（推荐，本期只做标记）**：提供最小动作，让异常可以正确关闭。
- **B（本期不做）**：继续挂异常，等 Sprint 12 退货/追踪一起设计。
- 注意：**这不改变库存**（货未入库就未出库），库存规则不受影响；
  但订单关账语义属业务规则，若做需更新 `orders.md`。

---

# 6. 本规划不做的事

1. **不做补货建议**——数据不足（1 SKU / 1 PO / 5 单），顺延 Sprint 10（§2.1）。
2. **不做渠道库存推送 / Allocator / 任何真实平台写操作**（Sprint 11 且需专项确认）。
3. **不做退货、物流追踪模块**（Sprint 12；T1 为其打基座）。
4. **不盲目接 OZON webhook**——事件类型与 payload 事实已核实（ozon.md §6.1，
   2026-09-13），但真实投递未验证、应答格式存在文档冲突（§6.4）、配置订阅
   属真实平台写操作且需公网 URL。因此 T1b 是**可选项**：轮询（T1）先落地，
   webhook 在部署条件与用户批准齐备后按 §6.4 实测再接。
   `TYPE_STOCKS_CHANGED`（渠道库存阶段）与聊天类事件本期不订阅。
5. **不做 WB / Yandex 适配器**。
6. **不做本地打印代理**（维持 Sprint 7 规划 §10.3.1 结论：待硬件与快递选型信息）。
7. **不改集成测试端口/Redis 冲突**（独立基础设施任务，沿用前一版记录）。
8. **不动 erpStatus 的状态机**——T1 只传导平台事实到既有 cancel 链路，
   不新增 ERP 状态（§98）。
9. **不清理 1323 条未映射存量**（用户只管有货的商品，D2 结论不变）。

---

# 7. 验收基线（供实施会话参考）

当前基线（2026-09-13，提交 `20b4791`，工作区干净）：

```text
lint / typecheck / check:arch / check:openapi   通过（Sprint 8 收尾状态）
单元测试 146 通过 / 集成测试 229 通过（--no-file-parallelism）
build                                           通过
```

数据基线：开发库含真实业务事实（1 SKU、1 笔收货、5 单、6 个 OPEN 异常、
1 个卡死拦截）——**不可重建**。真实数据操作（T3 的 ITC00000004、T4 走查）
按 §89 谨慎执行；集成测试仍用 `wcies_test`。

Migration 编号：Sprint 8 无新增（止于 `20260912_004`）。
本 Sprint 预计 Migration：0–1 个（T1 若选决策 5 的复用方案则 0 个；
选新表方案则 1 个）。

---

# 8. 参考索引

| 内容 | 路径 |
|---|---|
| 开发纪律（必读） | `AGENTS.md` |
| 上一版规划（Sprint 8） | `docs/WCIES_下一阶段规划_Sprint_8_批量建档与映射补齐.md` |
| Sprint 7 规划（含路线表、双轨期决策） | `docs/WCIES_下一阶段规划_Sprint_7_及后续.md` |
| 业务痛点来源 | `docs/会议纪要.md` |
| 订单业务规则（取消/拦截/时限） | `docs/business-rules/orders.md` |
| 采购/收货业务规则 | `docs/business-rules/purchase.md` |
| OZON 状态映射事实（含 cancelled） | `docs/integrations/ozon.md:99` |
| 决策记录 | `docs/decisions/0001`–`0013` |
| 术语表 | `CONTEXT.md` |
