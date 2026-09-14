# WCIES 下一阶段规划（Sprint 9：订单状态同步与运营闭环）

> 依据：`AGENTS.md`、`docs/WCIES_下一阶段规划_Sprint_7_及后续.md`（v7）、
> `docs/WCIES_下一阶段规划_Sprint_8_批量建档与映射补齐.md`（v1）、
> `docs/WCIES_下一阶段规划_Sprint_8.5_建档并映射增强.md`（已交付）、
> `docs/WCIES_修复任务书_Sprint_8.5R1_人工验收问题修复.md`（已交付）、
> Sprint 0–8.5R1 提交记录、开发库真实数据核查（2026-09-14，提交 `67aeee2`）、
> `docs/会议纪要.md`。
>
> 本文件是**规划**，不是实施任务书。实施前需先确认第 5 节的决策点。
>
> 修订历史：
> - **v3（2026-09-14，本版）**：Sprint 8.5（`6745293`）与 8.5R1（`6677192`）+ 分类搜索 /
>   条码前缀（`67aeee2`）交付后**按实测重盘现状**——数据基线、异常构成、卡死拦截的真实
>   状态、决策索引与验收基线全部更新；**T3/T4 因靶子失效而改写**；新增需用户拍板的
>   数据收口项（§5 决策 7）；§1.3/§1.6 增补两条由实测发现的问题（时限异常不再重算、
>   孤立拦截异常）。
> - v2（2026-09-13）：按用户要求核实 OZON webhook 事件清单后修订决策 1/2——
>   官方规范 v2.1 内含 14 种订阅类型完整枚举与各事件 payload（取消/时限/
>   状态事件全部存在，详见 `docs/integrations/ozon.md` §6，2026-09-13 核对）。
>   T1 增补可选 T1b（webhook 加速路径）；「不做的事」第 4 条相应改写；
>   新发现一处应答格式文档冲突（ozon.md §6.4）待实测定论。
> - v1.5（2026-09-14）：建档增强（多变体挂靠、类目体系、品牌/尺寸预填、SKU 图片、
>   保存并下一变体）移至 **Sprint 8.5** 执行。T4 走查中的「建档并映射」环节以
>   **增强版**执行（含类目/品牌/图片）。
> - v1：Sprint 8 收尾盘点 + Sprint 9 范围建议。
>   **核心变更：原路线的 Sprint 9「补货建议」顺延一期**，理由见 §2.1。

---

# 1. 现状盘点（有证据，非推测）

## 1.1 Sprint 8 / 8.5 / 8.5R1 已完成

| 任务 | 内容 | 状态 |
|---|---|---|
| 8-T1 | Listing 快速建档（Product + SKU +（可选）条码 + 映射，单事务，失败整体回滚） | ✅ 已提交 |
| 8-T2 | 未映射清单导出 Excel（与导入模板逐列对齐；导入改为 BIND 既有同步行） | ✅ 已提交 |
| 8-T3 | 未映射工作台（mapping-stats 计数、`hasOrderException` 派生标记、异常命中行置顶） | ✅ 已提交 |
| 8-T4a/T4b | 移动加权平均成本收尾；暂存位交互引导 | ✅ 已提交 |
| 8-T5 | 真实数据走查（≥5 新商品 + ≥20 行 Excel 闭环） | ⏳ **部分执行**（8.5-T8 完成建档环节，剩余见 §3 T4） |
| 8.5-T1/T2 | 建档 `FOR UPDATE` 串行化；多变体默认挂靠同一 Product | ✅ 已提交 |
| 8.5-T3 | 类目体系：双语树缓存 + 复合键映射 + 一键导入（7933 节点落库） | ✅ 已提交 |
| 8.5-T4/T5/T6 | 品牌快建、v4 属性（尺寸/重量）预填、商品图 CDN 预览 + 异步转存自有桶 | ✅ 已提交 |
| 8.5-T7 | 「保存并下一变体」连续建档（前端） | ✅ 已提交 |
| 8.5-T8 | 真实数据走查：类目导入 + 3 个 mapping-failed 异常建档映射（转 BACKORDERED）+ 图片转存 | ✅ 已提交 |
| 8.5R1 | 人工验收 8 项修复（建档采购价 / 名称预填 Offer ID / 图片放大、类目性能、**映射解析去 Offer ID = 决策 0016**、SKU 编辑表单、SKU 图片放大） | ✅ 已提交 |
| 8.5R1+ | 分类管理模糊搜索；内部条码前缀 `WCSKU` → `W`（**决策 0017**） | ✅ 已提交 |

提交时测试基线：Unit **176** 通过；Integration **238**（27 文件，串行）通过；
lint / typecheck / check:arch / check:openapi / build 全部通过。

## 1.2 真实数据状态（**2026-09-14 开发库实测**，与 v2 的 09-13 快照不同）

| 项 | 数量 | 说明 |
|---|---|---|
| `products` / `skus` | **5 / 5** | 8.5-T8 走查新建 4 个（此前只有 1 条测试数据）——**快速建档已实战** |
| `sku_barcodes` | 5 | 其中 4 条 `INTERNAL` 为旧前缀 `WCSKU…`（按决策 0017 不迁移）；新生成的为 `W…` |
| `platform_listings` / `platform_listing_skus` | **1324 / 1324** | 变体行：**MAPPED 5 / UNMAPPED 1319**（v2 记录未映射 1323） |
| `categories` | **7941** | 8.5 类目导入产物：一级 26 / 二级 542 / 三级 7365，另 8 条历史测试分类 |
| `platform_category_mappings` | 7365 | `(platform_id, category_id, type_id)` 复合键 |
| `inventory_balances` | **1** | on_hand **1** / reserved 0 / **picked 0** |
| `inventory_transactions` | **1** | 仅一条 `RECEIVE`（09-11 19:05）；**无 pick / release / return 流水** |
| `orders` | **6** | ORD00000001–04、47、**48**（48 为人工构造的摄入测试单，见 §1.6） |
| `purchase_orders` / `purchase_receipts` | **2 / 1** | |
| `order_interceptions` / `order_interception_histories` | **0 / 0** | **拦截表为空**——见 §1.6 |
| `picking_tasks` / `package_items` / `inventory_serials` | 0 / 0 / 0 | 从未在真实数据上走完拣货发货 |
| `system_exceptions` OPEN | **7** | 构成见下表（v2 记录 OPEN 6） |

**OPEN 异常构成（2026-09-14 实测）**：

| 异常 | 数量 | 说明 |
|---|---|---|
| `ORDER_OUT_OF_STOCK` | **5** | ORD00000001/02/03/04/47 —— **全部是「映射已修好、只等货」**；映射失败已不再是障碍 |
| `ORDER_SKU_MAPPING_FAILED` | **1** | ORD00000048：人工构造的摄入测试单（`platform_sku_id = NO-SUCH-MAPPING`、无对应 Listing）——**建档并映射修不了它** |
| `ORDER_INTERCEPTION_FAILED` | **1** | EXC00000010：指向**已不存在**的 ITC00000004 与**已删除**的订单行（§1.6） |
| `ORDER_SHIPMENT_DEADLINE_NEAR` | **0** | 4 张订单的时限已过期，却一条时限异常都没有——见 §1.3 第 3 点 |
| （历史）`ORDER_SKU_MAPPING_FAILED` | 4 | **已 RESOLVED**：ORD00000001/02/03 于 8.5-T8 建档映射时闭合，ORD00000004 更早（Sprint 8 期）闭合 |

## 1.3 关键发现一：订单同步存在「一次性摄入」缺口（代码证据，仍然成立）

这是本规划**最重要的发现**，直接对应会议纪要的第一痛点。**2026-09-14 复查代码未变。**

`order-ingestion.service.ts:83-88`：

```typescript
const existing = await this.orderRepo.findByStoreAndPlatformOrder(...);
if (existing !== null) {
  return this.buildResult(existing, true);   // duplicates = true，直接返回
}
```

**订单一旦摄入，后续同步永远跳过。** 全仓复查确认：没有任何代码路径会更新已存在订单的
`platform_status`（`order.repository.ts` 无 update platformStatus；webhook 处理器只认
`NEW_POSTING`，见 `apps/api/src/modules/sync/services/webhook.service.ts:157`）。

后果（对照 `docs/integrations/ozon.md` §Posting 字段映射——`awaiting_packaging /
awaiting_deliver / delivering / delivered / cancelled` 全是已知事实）：

1. **平台取消永远不可见**。买家在 OZON 取消订单无需商家审核（会议纪要原文），
   而我们的 `ORDER_SYNC` 再跑多少遍也看不到 `cancelled`——
   Reserved 库存被永久占用；BACKORDERED 单会被白白采购（缺货货到后无法交付）。
2. **平台发货/送达不可见**。真实数据**已出现分裂案例且证据比 v2 更强**：
   `ORD00000001` 平台 `delivering`（09-11 起）、时限 09-11 已过，而系统仍是
   `BACKORDERED` + `ORDER_OUT_OF_STOCK`——用户在系统外完成了这笔订单，系统毫无感知。
3. **时限倒计时是静态快照，且过期后不会重报**（v3 补充实测）：
   `raiseDeadlineExceptionIfNear` **只在摄入时调用一次**
   （`order-ingestion.service.ts:161` 是唯一调用点，定义在 :452，关闭在
   `order.service.ts:526`）。当前 4 张订单时限已过（01/02/47 已过期、03 今天到期），
   异常中心 **0 条** `ORDER_SHIPMENT_DEADLINE_NEAR`。这与第 1/2 点是**同一个根因**：
   摄入一次后再无评估。
4. **平台状态可能为 NULL**：`ORD00000048` 的 `platform_status` 为 null（人工构造的
   摄入请求未带平台状态）。T1 的对比更新必须容忍 null，不得据此清理任何东西。

> **决策 0016 的影响（v3 新增）**：映射解析自 2026-09-14 起只认
> `platform_sku_id` / `seller_sku`，`offer_id` 退出解析链路。OZON 订单行始终携带
> `sku`，因此对真实订单**无影响**；但**人工构造的测试单**（如 ORD00000048）不会被
> 任何映射「修好」——它本来就没有可映射的平台变体。

## 1.4 关键发现二：定时同步从未开启（配置证据）

Sprint 5 已实现调度器（`webhook-scheduler.processors.ts`）：按 ENV 间隔 + 店铺
`settings.sync.orderSyncEnabled / listingSyncEnabled` 派发，且有 `failStaleRunning`
崩溃恢复与单飞保护——**基础设施是齐的**（`readStoreSyncSettings` 在
`sync.constants.ts:55`，调度器 :61-62 读 ENV、:69 读店铺设置）。

但「最后一公里」全部缺失（2026-09-14 复查不变）：

| 层 | 现状 |
|---|---|
| ENV | `ORDER_SYNC_INTERVAL_SECONDS` / `LISTING_SYNC_INTERVAL_SECONDS` **未设置**（`docker-compose.yml`、`.env.example` 均无；代码默认 0 = 关） |
| 店铺设置 | `ON-002 香港玩具店`（唯一活跃店铺）的 `settings` 为 **NULL**（v2 记录为「空」，实测是整列为 null） |
| 界面 | 全 `apps/web` 无任何同步开关入口（grep 无 `orderSyncEnabled`） |

实测同步记录（`sync_jobs`）：

| 任务 | 最后运行 | 结果 | 触发方式 |
|---|---|---|---|
| `ORDER_SYNC` | **2026-09-14 02:08** | 成功 0 / 失败 0 | 手动（8.5 走查期间） |
| `LISTING_SYNC` | 2026-09-11 11:01 | 成功 1324 | 手动 |
| `CATEGORY_TREE_SYNC` | 2026-09-13 19:29 | 成功 7933 | 手动（8.5 类目工具） |
| `PRODUCT_ENRICHMENT_SYNC` | 2026-09-13 19:29 | 成功 2648 | 手动（8.5 类目工具） |

**结论不变**：没有任何一次是调度器自动跑出来的。订单不会自己进来，时限预警、
待采购视图全部依赖用户记得手动点同步——v2 的「两天零增量」现在应表述为
「**从未有过自动增量**」。8.5 新增的两类同步（类目树 / 属性补齐）同样是手动低频任务，
应一并纳入 T2 的「同步新鲜度可见」。

## 1.5 真实订单的时限压力（2026-09-14 实测，与 v2 的 09-13 快照不同）

```
订单号          ERP状态       平台状态            时限（UTC）        现状
ORD00000001    BACKORDERED   delivering          2026-09-11 21:00  已过期，平台侧已发货（线下）
ORD00000047    BACKORDERED   awaiting_packaging  2026-09-13 10:48  已过期
ORD00000002    BACKORDERED   awaiting_deliver    2026-09-13 21:00  已过期
ORD00000003    BACKORDERED   awaiting_deliver    2026-09-14 23:00  今天到期
ORD00000004    BACKORDERED   awaiting_packaging  2026-09-16 21:00  —
ORD00000048    EXCEPTION     （null）             （null）          人工测试单
```

与 v2 的差异：01–03 的 ERP 状态已从 `EXCEPTION` 变为 `BACKORDERED`（8.5-T8 建档映射的
成果），但**5 张真实订单全部卡在缺货**，且**时限异常一条都没有**（§1.3 第 3 点）。
「先售后采」的赛跑正在真实发生，而系统对平台侧的后续变化完全无感。

## 1.6 关键发现三（v3 新增）：一条孤立拦截异常，「库存保持 Picked」不再成立

v2 据 Sprint 7/8 的现场记录写着「ITC00000004 拦截失败，库存保持 Picked，真实卡死案例」。
**2026-09-14 实测该表述已不成立**：

| 证据 | 实测值 |
|---|---|
| `order_interceptions` | **0 行**（拦截任务本身不存在） |
| `order_interception_histories` | 0 行 |
| 异常 EXC00000010 的 `details` | `{orderItemId: fcc4cffa-…, interceptionNo: ITC00000004}` |
| 该 `orderItemId` | **在 `order_items` 中不存在**（订单行已被删除） |
| `inventory_balances.picked_qty` | **0**（库存不是 Picked 状态） |
| `inventory_transactions` | 仅 1 条 `RECEIVE`，**无 pick / return 流水** |
| `picking_tasks` / `package_items` / `inventory_serials` | 0 / 0 / 0 |

即：**这条 OPEN 异常指向两个都不存在的对象**，而账本处于「1 件在库、无占用」的干净状态。
无法从现存数据复原当时的时间线（流水与拦截记录都不在），可能是某次开发库清理/重建
留下的残留。

**对规划的影响**：
- T3 的「现场卡死案例」前提作废，**不能再拿 ITC00000004 当验收靶子**（§3 T3 已改写）；
- 拦截路径对暂存位的依赖**在代码层面仍是未验证的缺陷面**（Sprint 8 T4b 只做了界面引导），
  需要新的真实场景或集成测试来覆盖；
- 这条孤立异常如何收口，是**需要用户拍板的数据决定**（§5 决策 7）。

---

# 2. 下一阶段的核心判断

## 2.1 原路线 Sprint 9「补货建议」必须顺延（判断不变，数据略好）

| 补货建议需要的 | 现有（2026-09-14） |
|---|---|
| 采购历史（多次、多 SKU） | 2 张采购单、1 张已确认收货 |
| 销量历史 | 6 张订单、**0 张已发货** |
| 在管 SKU 基数 | 5 |

比 v2 的「1 SKU / 1 PO / 5 单」略好，但**仍然不足以支撑补货算法**：没有一张订单走到
SHIPPED，销量与周转率都是空的。
**顺延一期，把 Sprint 10 补货建议的前置（数据积累）继续作为本 Sprint 的验收产出之一（§3 T4）。**

## 2.2 本 Sprint 的定位：让系统与现实保持一致

Sprint 7 补了「货进系统」，Sprint 8 / 8.5 补了「商品进系统」，
**Sprint 9 补「变化进系统」**——平台侧每天发生的事（新订单、取消、发货、时限调整）
必须自动、及时地反映进来。三个缺口按因果排序（v3 按实测更新了「现状」列）：

| 缺口 | 现状（2026-09-14） | 对应任务 |
|---|---|---|
| 已摄入订单的状态变化被跳过（§1.3） | 1 张单平台 `delivering` 而系统 `BACKORDERED`；4 张过期时限无异常 | T1 |
| 定时同步全关（§1.4） | 从未自动跑过；店铺 `settings` 为 NULL；无任何界面开关 | T2 |
| 异常收口与真实走查未完成（§1.2/§1.6） | 5 张缺货单等货、1 条孤立拦截异常、1 条测试单异常；拣货发货从未走通 | T3/T4 |

## 2.3 与会议纪要的对应关系

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
   **绝不**直接改 `erpStatus`（§38 平台状态与 ERP 状态分离）。`platform_status` 为
   null 的历史行（如 ORD00000048）不得因「看起来空」被清理或改写。
2. **取消传导**：检测到平台状态变为 `cancelled`（ozon.md 已登记的状态值，不是猜测）时，
   调用**既有** `OrderService.cancel()` 链路——Reserved 行释放 Reservation、Picked 行建
   Interception（Sprint 3/4 已实现并测试）。自动还是人工确认，见决策 D1。
   - **无 Reservation 的行**（本 Sprint 的真实主角：5 张 BACKORDERED 单）取消时应当
     **没有库存动作**，只关闭订单与 `ORDER_OUT_OF_STOCK` 异常。
     该语义属订单状态机规则，实施前在任务书中定稿并更新 `docs/business-rules/orders.md`。
3. **时限重算，不只是「平台调整要跟」**（v3 新增）：`shipment_deadline` 变化要落库，
   且**已过期/临近的时限必须能被重新评估并报异常**——当前 `ORDER_SHIPMENT_DEADLINE_NEAR`
   只在摄入时判一次（§1.3 第 3 点）。与取消/发货差异同源，建议在同一处对比更新里处理
   （触发时机、去重与关闭条件在任务书中定）。
4. **发货/送达差异可见化**：平台 `delivering/delivered` 而系统未发货的订单
   （ORD00000001 这类「线下履约」），在订单页给出明确标记。是否提供
   「标记外部履约」的正式路径，见决策 D6。
5. **幂等**：状态无变化不写库；同一取消事件重复同步不得重复释放
   （复用 `ORDER_RELEASE:<orderItemId>` 既有幂等键）。
6. **历史**：平台状态迁移必须可追溯（§39）。落点设计（复用
   `order_status_history` 加来源维度 vs 新表）在任务书中定，本规划不预设（决策 5）。
7. **数据源零新增**：用现有 `ORDER_SYNC` 再轮询即可（`ozon.mapper.ts:121`
   已提取 `posting.status`）。轮询是**不依赖公网 URL 的基线路径**；webhook 加速路径见 T1b。
8. 单条订单更新失败不得拖垮整批同步（§36）。

## T1b（可选，依赖决策 D1b）Webhook 取消/时限事件接入

**前提事实已核实（2026-09-13，官方规范 v2.1，详见 `docs/integrations/ozon.md` §6.1）**：
OZON 订阅类型共 14 种，其中与本 Sprint 直接相关的三种全部存在且 payload 有官方定义：

| 事件 | 对 WCIES 的意义 |
|---|---|
| `TYPE_POSTING_CANCELLED`（带 `reason{id,message}`、`old/new_state`） | 取消的**秒级推送**（轮询要等下一周期）；reason 恰好是会议纪要要求的「取消原因」登记字段 |
| `TYPE_CUTOFF_DATE_CHANGED`（`new/old_cutoff_date`） | `shipment_deadline` 变化的推送（官方标注测试期、可能为空——回读式处理天然兜底） |
| `TYPE_STATE_CHANGED`（push 模型词表） | 平台状态迁移推送（注意词表差异，见 ozon.md §6.2，回读规避） |

要点：

1. **架构零新增**：复用 Sprint 5 已建的 webhook 链路（raw event → 队列 → 回读入库），
   处理器位于 `apps/api/src/modules/sync/services/webhook.service.ts`，目前只认
   `NEW_POSTING`（:157），扩展取消/时限两个分支即可。
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
   频率不必再调快（对 OZON 配额友好）。
2. **店铺同步开关 UI**：店铺管理页暴露
   `settings.sync.orderSyncEnabled / listingSyncEnabled`。注意实测现状是
   **`settings` 整列为 NULL**（不是「空对象」），写入口必须能处理 null 起始值
   （后端 `readStoreSyncSettings` 已消费该结构，只缺写入口）。
3. **同步新鲜度可见**：店铺概览/首页显示「最近一次成功同步时间」，超过 N 小时未成功标红
   ——回答「系统到底在不在跑」。**建议把 8.5 新增的 `CATEGORY_TREE_SYNC` /
   `PRODUCT_ENRICHMENT_SYNC` 一并展示**（低频手动任务，只展示不告警）。
4. 可选（决策 D3）：连续失败进异常中心 `SYNC_FAILED`
   （AGENTS §53 已列该类型，代码 `EXCEPTION_TYPES` 实测**确实没有**——枚举新增属业务
   规则变更，需确认）。

## T3 拦截路径暂存位兜底（v3 改写：靶子失效，缺陷面仍在）

**事实（2026-09-14 实测）**：v2 依赖的 ITC00000004「库存保持 Picked」**已不成立**——
拦截记录与其订单行都不存在，账本干净（§1.6）。因此：

1. **不再以 ITC00000004 为验收靶子**；该异常如何收口见决策 7。
2. **代码缺陷面照旧存在**：拦截执行/完成路径对暂存位的依赖没有兜底
   （Sprint 8 T4b 只做了界面引导）。修复方案二选一（决策 D4）：
   无暂存位时**自动创建** `STAGING` 库位（`bin_code` 自由字符串，零 Schema 改动），
   或回退 `DEFAULT`。
3. **验证方式改判**：用**集成测试**覆盖「仓库无暂存位 → 拦截仍能完成」，
   再用真实数据走查（T4 的拣货/发货链路里自然会遇到）验证；
   若行为变化，同步更新 `docs/business-rules/orders.md`（拦截章节）。

## T4 Sprint 8 真实数据验收（结转）+ 数据积累（v3 改写：靶子重定义）

**这一项同时是 Sprint 10（补货建议）的数据前提。**

v2 的原靶子（4 个 `ORDER_SKU_MAPPING_FAILED`）**已被 8.5-T8 消化 3 个**，剩下的
ORD00000048 是人工构造的摄入测试单（无平台变体可映射），**建档并映射修不了它**
（决策 7）。因此走查靶子改为：

1. **5 张真实缺货单**（ORD00000001/02/03/04/47）——它们现在卡在**缺货**而不是映射：
   登记采购 → 扫码收货 → 重试分配 → 拣货 → 发货走到底（能走多远走多远，
   一次性把 `ORDER_OUT_OF_STOCK` 清零或给出明确结论）；
2. **补足 ≥5 个新商品**：8.5-T8 已建 4 个，再建若干即可达标；
   每个商品走完整链路（建档并映射 → 采购 → 收货 → 拣货 → 发货）；
3. 一轮 ≥20 行 Excel 导出→补填→双导入闭环（Sprint 8 T5 原文要求）；
4. **首次走通拣货 / 发货 / 包裹**：当前 `picking_tasks` / `package_items` 均为 0，
   这是购买与收货之外的整条履约链路第一次被真实数据验证；
5. 产出物：SKU 基数、采购历史、销售历史——为补货建议攒米。

## T5 验收

1. **集成测试**（新增）：
   - 平台取消传导：Reserved 订单 → 同步到 cancelled → Reservation 释放、可售恢复；
   - **无 Reservation 的 BACKORDERED 订单**取消 → 无库存动作、关闭缺货异常；
   - Picked 取消：同步 cancelled → 建 Interception，不直接恢复库存（§78 Case 3 的同步触发版）；
   - 重复同步同一取消：只释放一次；
   - 状态无变化的重复同步：零写入；
   - **时限重算**：摄入时不临近、之后过期 → 再同步能报 `ORDER_SHIPMENT_DEADLINE_NEAR`；
   - **拦截无暂存位**：仓库无 STAGING 时拦截仍能完成（T3 的方案）。
2. **真实数据**（手工）：
   - 开启定时同步后观察 ≥48h：订单自动流入、无 SYNC_ALREADY_RUNNING 噪音；
   - 5 张缺货单清零或给出明确结论；ORD00000048 与孤立拦截异常按决策 7 收口；
   - T4 的 ≥5 商品 + ≥20 行 Excel + 首次拣货发货走查记录。

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

> v3 备注：Sprint 8.5 / 8.5R1 已提前消化了商品域的多数体验负债（类目、品牌、图片、
> 建档、映射解析规则、条码格式、分类搜索），因此上述阶段表**不再包含商品域任务**；
> Sprint 10 的唯一硬前置仍是 T4 的数据积累。

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

**感知路径（D1a）**：

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
  也有幂等键兜底。**v3 补充**：当前 5 张真实单都是 BACKORDERED（无 Reservation），
  自动取消对它们零库存风险。
- B（人工）：取消只标记 + 建异常，人工确认后才执行释放/拦截。
  适合担心「平台误报取消」的场景，代价是每单多一步操作。

## 决策 2：定时同步的默认开关与频率（T2）

- **A（推荐）**：开发栈默认开——订单 60s / Listing 300s（即代码安全下限），
  店铺开关默认开启（用户只有一家店，开了才有数据流入）。
- **B**：默认全关，用户在店铺页手动开启后再生效（更保守，但**实测已证明后果**：
  基础设施齐了两个月，从未自动跑过一次，见 §1.4）。

频率本身不建议再调：60s 已是调度器写死的下限，再快对 OZON 配额不友好。
若 T1b 落地，取消/时限的时效性由 webhook 秒级承担，轮询只做兜底与增量，
60s/300s 更无必要调快。

## 决策 3：是否新增 `SYNC_FAILED` 异常类型（T2 可选项）

AGENTS §53 列了它，代码 `EXCEPTION_TYPES` 实测没有（现有 5 项：
`ORDER_SKU_MAPPING_FAILED` / `ORDER_OUT_OF_STOCK` / `ORDER_INVALID_STATE` /
`ORDER_INTERCEPTION_FAILED` / `ORDER_SHIPMENT_DEADLINE_NEAR`）。新增枚举属业务规则变更
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

ORD00000001 的实况（v3 更新）：平台 `delivering`、时限 09-11 已过、系统 `BACKORDERED`
+ 缺货异常——用户线下采购直发买家，系统从未发货。这类订单目前只能挂异常。
是否提供「标记外部履约」动作（订单行关账 + 记录原因，**不产生库存流水**——因为货从未
进过系统）？

- **A（推荐，本期只做标记）**：提供最小动作，让异常可以正确关闭。
- **B（本期不做）**：继续挂异常，等 Sprint 12 退货/追踪一起设计。
- 注意：**这不改变库存**（货未入库就未出库），库存规则不受影响；
  但订单关账语义属业务规则，若做需更新 `orders.md`。

## 决策 7（v3 新增）：两条「无靶子」异常与测试单如何收口

这是**数据决定**，不是技术决定——两条异常都属于 §89 意义上的「歧义数据」，
不得由实现方静默处理。

**7.1 孤立拦截异常 EXC00000010**（`ORDER_INTERCEPTION_FAILED`）：
指向已不存在的 ITC00000004 与已删除的订单行，账本干净（§1.6）。选项：

- **A（推荐）**：以**正式业务动作**关闭——把异常置 `IGNORED`/`RESOLVED` 并在备注里写明
  「目标对象已不存在，库存账本无 Picked 占用（2026-09-14 核对）」，保留可追溯记录；
- B：保留 OPEN 挂账，等 Sprint 12 拦截/退货一起处理（异常中心长期多一条噪音）；
- C：追溯重建当时的场景（需要一笔真实的「已拣货 → 取消 → 拦截」业务流，
  建议放到 T4 走查里**重新制造一次真实拦截**，而不是复原历史）。

**7.2 人工测试单 ORD00000048**（`ORDER_SKU_MAPPING_FAILED`）：
它是通过 `/orders/ingest` 人工构造的摄入测试（`platform_sku_id = NO-SUCH-MAPPING`、
`platform_status` 为 null、无对应 Listing），**任何映射动作都修不好它**。选项：

- **A（推荐）**：把它当测试数据显式收口——**先确认**它不在任何真实业务链路里，
  再决定是关闭其异常并保留订单（历史可追溯），还是经用户确认后按测试数据清理；
- B：给它挂一个真实的平台变体（等于伪造业务事实）——**不推荐**，会污染订单履历；
- C：保留现状不动，接受异常中心常驻一条无法关闭的异常——**不推荐**，
  它会让「异常清零」的验收标准永远达不成。

> 注：`orders` 属业务历史，AGENTS §89/§99 不鼓励删除；选项 A 的推荐路径是
> **关闭异常 + 保留订单**，除非用户明确要求清理测试单。

---

# 6. 本规划不做的事

1. **不做补货建议**——数据不足（2 PO / 6 单 / 0 已发货），顺延 Sprint 10（§2.1）。
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
9. **不清理未映射存量**（用户只管有货的商品，D2 结论不变；当前 **1319** 条，
   已从 v2 的 1323 减少）。
10. **不改已定规则**：`offer_id` 不参与解析（决策 0016）、内部条码前缀 `W`（决策 0017）
    为本期已交付的确定结论，Sprint 9 不得回退或「顺便优化」。

---

# 7. 验收基线（供实施会话参考）

当前基线（2026-09-14，提交 `67aeee2`，工作区干净）：

```text
lint / typecheck / check:arch / check:openapi   通过
单元测试 176 通过 / 集成测试 238 通过（27 文件，--poolOptions.forks.singleFork）
build                                           通过
```

数据基线（§1.2，2026-09-14 实测）：开发库含真实业务事实（5 SKU、1 笔收货、
6 订单、7 个 OPEN 异常、7941 类目、7365 类目映射、1324 变体行）——**不可重建**。
真实数据操作（T3 的暂存位验证、T4 走查、决策 7 的收口）按 §89 谨慎执行；
集成测试仍用 `wcies_test`。

Migration 编号：**最新为 `20260914_001`**（Sprint 8.5 的类目两张表）；
Sprint 8 无 Schema 变更，8.5R1 至本轮修复**零 Schema 变更**。
本 Sprint 预计 Migration：0–1 个（T1 若选决策 5 的复用方案则 0 个；
选新表方案则 1 个）。

---

# 8. 参考索引

| 内容 | 路径 |
|---|---|
| 开发纪律（必读） | `AGENTS.md` |
| Sprint 8.5 规划（已交付） | `docs/WCIES_下一阶段规划_Sprint_8.5_建档并映射增强.md` |
| Sprint 8.5R1 修复任务书（已交付） | `docs/WCIES_修复任务书_Sprint_8.5R1_人工验收问题修复.md` |
| 上一版规划（Sprint 8） | `docs/WCIES_下一阶段规划_Sprint_8_批量建档与映射补齐.md` |
| Sprint 7 规划（含路线表、双轨期决策） | `docs/WCIES_下一阶段规划_Sprint_7_及后续.md` |
| 业务痛点来源 | `docs/会议纪要.md` |
| 订单业务规则（取消/拦截/时限） | `docs/business-rules/orders.md` |
| 主数据规则（含条码格式、映射解析） | `docs/business-rules/master-data.md` |
| 采购/收货业务规则 | `docs/business-rules/purchase.md` |
| OZON 状态映射事实（含 cancelled） | `docs/integrations/ozon.md` §Posting 字段映射 |
| 决策记录 | `docs/decisions/0001`–`0017`（0016 映射解析、0017 内部条码前缀） |
| 术语表 | `CONTEXT.md` |
