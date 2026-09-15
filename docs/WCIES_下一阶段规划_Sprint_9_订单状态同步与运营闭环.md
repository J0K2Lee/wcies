# WCIES 下一阶段规划（Sprint 9：订单状态同步与运营闭环）

> 依据：`AGENTS.md`、`docs/WCIES_下一阶段规划_Sprint_7_及后续.md`（v7）、
> `docs/WCIES_下一阶段规划_Sprint_8_批量建档与映射补齐.md`（v1）、
> `docs/WCIES_下一阶段规划_Sprint_8.5_建档并映射增强.md`（已交付）、
> `docs/WCIES_修复任务书_Sprint_8.5R1_人工验收问题修复.md`（已交付）、
> Sprint 0–8.5R1 提交记录、开发库真实数据核查（2026-09-14，提交 `67aeee2`）、
> `docs/会议纪要.md`。
>
> **状态（v4）：§5 的 7 个决策点已由用户逐项确认并定稿，本文件可用于编写实施任务书。**
>
> **实施状态（2026-09-14 实施会话）**：T1 / T2 / T3 / T6 的代码与测试**已交付**
> （含 migration `20260914_002` platform_status_history、ORDER_SYNC 定向回读刷新、
> `SYNC_FAILED` 异常、拦截 STAGING 兜底、标记外部履约端点与前端、店铺同步开关、
> 300s ENV 默认）；`docs/business-rules/orders.md` 已同步更新（§7 平台状态更新、
> §8 取消收口与外部履约、§9 拦截暂存位、§15B SYNC_FAILED、§16 时限重算）。
> **T4 与 T5.2 的真实数据走查属人工验收项**（收货/拣货/发货实操、≥48h 定时同步
> 观察），未在本会话完成；开发库 ON-002 开关设置见提交说明。
>
> 修订历史：
> - **v4（2026-09-14，本版）**：§5 决策全部定稿并并入各任务——
>   轮询 **300s** 且本期**不做 webhook**、Order 自动轮询默认开 / Listing 仅手动 +
>   店铺页切换按钮、新增 `SYNC_FAILED` 异常类型、拦截自动创建暂存位、
>   **平台状态历史选方案 B（新表）**（按实测：拼接成本 ~0.1ms，见 §5 决策 5）、
>   提供「标记外部履约」动作、两条无靶子测试数据**已清理**（§1.6）；
>   新增 **T6**；数据基线按清理后的实测值更新。
> - v3（2026-09-14）：Sprint 8.5（`6745293`）与 8.5R1（`6677192`）+ 分类搜索 /
>   条码前缀（`67aeee2`）交付后**按实测重盘现状**——数据基线、异常构成、卡死拦截的真实
>   状态、决策索引与验收基线全部更新；**T3/T4 因靶子失效而改写**；新增需用户拍板的
>   数据收口项（§5 决策 7）；§1.3/§1.6 增补两条由实测发现的问题（时限异常不再重算、
>   孤立拦截异常）。
> - v2（2026-09-13）：核实 OZON webhook 事件清单后修订决策 1/2（官方规范 v2.1
>   14 种订阅类型与 payload 全部存在，详见 `docs/integrations/ozon.md` §6）；
>   T1 增补可选 T1b；新发现一处应答格式文档冲突（ozon.md §6.4）。
> - v1.5（2026-09-14）：建档增强移至 Sprint 8.5；T4 走查的「建档并映射」以增强版执行。
> - v1：Sprint 8 收尾盘点 + Sprint 9 范围建议（原路线「补货建议」顺延一期）。

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

## 1.2 真实数据状态（**2026-09-14 实测，含决策 7 清理后**）

| 项 | 数量 | 说明 |
|---|---|---|
| `products` / `skus` | **5 / 5** | 8.5-T8 走查新建 4 个——**快速建档已实战** |
| `sku_barcodes` | 5 | 4 条 `INTERNAL` 为旧前缀 `WCSKU…`（决策 0017 不迁移）；新生成的为 `W…` |
| `platform_listings` / `platform_listing_skus` | **1324 / 1324** | 变体行：**MAPPED 5 / UNMAPPED 1319** |
| `categories` / `platform_category_mappings` | **7941 / 7365** | 一级 26 / 二级 542 / 三级 7365，另 8 条历史测试分类 |
| `inventory_balances` | **1** | on_hand **1** / reserved 0 / picked 0 |
| `inventory_transactions` | **1** | 仅一条 `RECEIVE`（09-11 19:05）；无 pick / release / return 流水 |
| `orders` / `order_items` | **5 / 5** | ORD00000001–04、47（人工测试单已于决策 7 清理） |
| `purchase_orders` / `purchase_receipts` | 2 / 1 | |
| `order_interceptions` / `picking_tasks` / `package_items` / `inventory_serials` | **0** | 拦截与拣货发货从未在真实数据上走通 |
| `system_exceptions` OPEN | **5** | 全部是 `ORDER_OUT_OF_STOCK`（见下） |
| `notifications` | 10 | **全部是孤儿**（指向已删除的拦截 ITC00000001–09 / 订单 ORD00000037–44）——见 §1.6 |

**OPEN 异常构成（清理后）**：

| 异常 | 数量 | 说明 |
|---|---|---|
| `ORDER_OUT_OF_STOCK` | **5** | ORD00000001/02/03/04/47 —— **全部是「映射已修好、只等货」** |
| 其他 | 0 | 孤立拦截异常 EXC00000010 与测试单异常 EXC00000015 已按决策 7 清理 |
| （历史）`ORDER_SKU_MAPPING_FAILED` | 4 | 全部已 RESOLVED（3 个由 8.5-T8 闭合，1 个更早闭合） |

## 1.3 关键发现一：订单同步存在「一次性摄入」缺口（代码证据，仍然成立）

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

后果：

1. **平台取消永远不可见**。买家在 OZON 取消订单无需商家审核（会议纪要原文），
   而 `ORDER_SYNC` 再跑多少遍也看不到 `cancelled`——Reserved 库存被永久占用；
   BACKORDERED 单会被白白采购。
2. **平台发货/送达不可见**。`ORD00000001` 平台 `delivering`（09-11 起）、时限 09-11 已过，
   而系统仍是 `BACKORDERED` + 缺货异常——用户在系统外完成了这笔订单，系统毫无感知。
3. **时限倒计时是静态快照，且过期后不会重报**：`raiseDeadlineExceptionIfNear`
   **只在摄入时调用一次**（`order-ingestion.service.ts:161` 是唯一调用点，定义在 :452，
   关闭在 `order.service.ts:526`）。当前 4 张订单时限已过，异常中心 **0 条**
   `ORDER_SHIPMENT_DEADLINE_NEAR`——与第 1/2 点是同一个根因。
4. **平台状态可能为 NULL**：对比更新必须容忍 `platform_status IS NULL` 的历史行
   （人工构造的摄入请求可以不带平台状态），不得因「看起来空」被清理或改写。

> **决策 0016 的影响**：订单解析自 2026-09-14 起只认 `platform_sku_id` / `seller_sku`，
> `offer_id` 退出解析链路。OZON 订单行始终携带 `sku`，对真实订单无影响。

## 1.4 关键发现二：定时同步从未开启（配置证据）

Sprint 5 已实现调度器（`webhook-scheduler.processors.ts`），**基础设施是齐的**，但
「最后一公里」全部缺失（2026-09-14 复查不变）：

| 层 | 现状 |
|---|---|
| ENV | `ORDER_SYNC_INTERVAL_SECONDS` / `LISTING_SYNC_INTERVAL_SECONDS` **未设置**（`docker-compose.yml`、`.env.example` 均无；代码默认 0 = 关） |
| 店铺设置 | `ON-002 香港玩具店`（唯一活跃店铺）的 `settings` 为 **NULL** → `readStoreSyncSettings` 返回 `{}` → 两个开关都是 false（**即使设了 ENV 也不会自动跑**） |
| 界面 | 全 `apps/web` 无同步开关入口；店铺页无 settings 编辑 |

实测同步记录（`sync_jobs`）：`ORDER_SYNC` 最后 2026-09-14 02:08（手动，0 增量）、
`LISTING_SYNC` 最后 09-11 11:01、`CATEGORY_TREE_SYNC` 09-13 19:29（7933）、
`PRODUCT_ENRICHMENT_SYNC` 09-13 19:29（2648）——**没有任何一次是调度器自动跑出来的**。

> 调度器门槛是**双重**的：`interval > 0` **且** 店铺 `settings.sync.*Enabled === true`
> （`webhook-scheduler.processors.ts:72-84`）。因此决策 2 落地要同时做 ENV 默认值与
> 店铺设置写入口，缺一个都仍然不会自动同步。手动触发（`POST /sync/orders`、
> `/sync/listings`）不受开关限制。

## 1.5 真实订单的时限压力（2026-09-14 实测）

```
订单号          ERP状态       平台状态            时限（UTC）        现状
ORD00000001    BACKORDERED   delivering          2026-09-11 21:00  已过期，平台侧已发货（线下）
ORD00000047    BACKORDERED   awaiting_packaging  2026-09-13 10:48  已过期
ORD00000002    BACKORDERED   awaiting_deliver    2026-09-13 21:00  已过期
ORD00000003    BACKORDERED   awaiting_deliver    2026-09-14 23:00  今天到期
ORD00000004    BACKORDERED   awaiting_packaging  2026-09-16 21:00  —
```

**5 张真实订单全部卡在缺货**，且**时限异常一条都没有**。
「先售后采」的赛跑正在真实发生，而系统对平台侧的后续变化完全无感。

## 1.6 关键发现三：测试数据残留，已按决策 7 清理

v2 据 Sprint 7/8 的现场记录写着「ITC00000004 拦截失败，库存保持 Picked」，v3 实测该
表述已不成立（拦截表 0 行、其订单行已删除、`picked_qty = 0`、流水只有一条收货）。
通知表还原了真相：**ORD00000037–44 与 ITC00000001–09 这一整套测试场景已被删除**，
只留下指向它们的异常与通知。

**2026-09-14 按用户决策 7 执行清理**（脚本
`scripts/cleanup-test-residue-2026-09-14.ts`，默认 dry-run、`--apply` 才删除、
硬编码业务键、生产环境拒跑、单事务）：

| 清理对象 | 明细 |
|---|---|
| 孤儿拦截异常 `EXC00000010` | 1 行（指向不存在的 ITC00000004） |
| 人工测试单 `ORD00000048`（`platform_order_id = MOCK-D-001`） | 订单 1 + 订单行 1 + 状态历史 2 + 异常 1 |

清理后：orders 6 → **5**、order_items 6 → **5**、OPEN 异常 7 → **5**、异常总数 11 → **9**。

**同源遗留（未清理，待确认）**：`notifications` 表仍有 **10 条孤儿通知**，全部指向
已删除的拦截任务与订单（ORD00000037–44 / ITC00000001–09，见 §1.2）。它们与本次清理的
异常属于同一批被删除的测试场景，但不在决策 7 的授权范围内，脚本已将其列入预演报告但
**未删除**。建议一并清理（同一脚本可扩展），需要用户一句确认。

**对规划的影响**：T3 的「现场卡死案例」前提作废——拦截路径对暂存位的依赖**在代码层面
仍是未验证的缺陷面**（Sprint 8 T4b 只做了界面引导），需用集成测试覆盖（§3 T3）。

---

# 2. 下一阶段的核心判断

## 2.1 原路线 Sprint 9「补货建议」必须顺延（判断不变，数据略好）

| 补货建议需要的 | 现有（2026-09-14） |
|---|---|
| 采购历史（多次、多 SKU） | 2 张采购单、1 张已确认收货 |
| 销量历史 | 5 张订单、**0 张已发货** |
| 在管 SKU 基数 | 5 |

没有一张订单走到 SHIPPED，销量与周转率都是空的。
**顺延一期，把 Sprint 10 补货建议的前置（数据积累）继续作为本 Sprint 的验收产出（§3 T4）。**

## 2.2 本 Sprint 的定位：让系统与现实保持一致

Sprint 7 补了「货进系统」，Sprint 8 / 8.5 补了「商品进系统」，
**Sprint 9 补「变化进系统」**——平台侧每天发生的事（新订单、取消、发货、时限调整）
必须自动、及时地反映进来。

| 缺口 | 现状（2026-09-14） | 对应任务 |
|---|---|---|
| 已摄入订单的状态变化被跳过（§1.3） | 1 张单平台 `delivering` 而系统 `BACKORDERED`；4 张过期时限无异常 | T1 |
| 定时同步全关（§1.4） | 从未自动跑过；店铺 `settings` 为 NULL；无任何界面开关 | T2 |
| 拦截暂存位未兜底（§1.6） | 缺陷面在代码层，缺真实场景与测试 | T3 |
| 真实走查与数据积累未完成（§1.2） | 5 张缺货单等货；拣货/发货从未走通 | T4 |
| 线下直发订单无正式出口（§1.3 第 2 点） | ORD00000001 只能挂异常 | T6 |

## 2.3 与会议纪要的对应关系

| 会议纪要痛点 | 本 Sprint | 后续 |
|---|---|---|
| 「商家无法实时获知订单取消状态…缺乏系统化的取消信息同步机制」 | **T1 + T2 直接解决**（取消自动进系统 + 定时拉取） | — |
| 「库存变动应与订单状态强关联：取消+退货应回加库存」 | T1 取消传导复用既有释放/拦截链路（Sprint 3/4 已建） | 退货回流 = Sprint 12 |
| 「退货批次无法对应原始订单」 | 不在本期 | Sprint 12（退货模块） |
| 「高货值丢货需前置信息同步」 | 不在本期 | Sprint 12（追踪） |

---

# 3. Sprint 9 实施范围（决策已并入）

## T1 已摄入订单的平台状态更新（核心）

**目标**：`ORDER_SYNC` 再遇到已存在的订单时，从「跳过」改为「对比更新」。

1. **只更新平台事实字段**：`platform_status`、`shipment_deadline`、`raw_data`。
   **绝不**直接改 `erpStatus`（§38）。`platform_status IS NULL` 的历史行不得被清理或改写。
2. **取消传导 = 自动执行**（决策 1-D1b=A）：平台状态变为 `cancelled` 时，直接调用
   **既有** `OrderService.cancel()`——Reserved 行释放 Reservation、Picked 行建 Interception。
   - **无 Reservation 的行**（本 Sprint 的真实主角：5 张 BACKORDERED 单）取消时应
     **没有库存动作**，只关闭订单与 `ORDER_OUT_OF_STOCK` 异常；该语义属订单状态机规则，
     实施前在任务书中定稿并更新 `docs/business-rules/orders.md`。
3. **时限重算**：`shipment_deadline` 变化要落库，且**已过期/临近的时限必须能被重新评估
   并报异常**（当前只在摄入时判一次）。触发时机、去重与关闭条件在任务书中定。
4. **发货/送达差异可见化**：平台 `delivering/delivered` 而系统未发货的订单在订单页明确
   标记（ORD00000001 这类）；正式出口见 T6。
5. **幂等**：状态无变化不写库；同一取消事件重复同步不得重复释放
   （复用 `ORDER_RELEASE:<orderItemId>` 既有幂等键）。
6. **历史落点 = 新表 `platform_status_history`**（决策 5，**方案 B**，依据见 §5）：
   平台状态迁移单独成表，与 ERP 状态机表物理隔离；订单详情页把两张表的时间线按
   `created_at` 合并（在 `OrderService.getDetail` 已有的 `Promise.all` 里并行取，见 §5 实测）。
7. **数据源零新增**：用现有 `ORDER_SYNC` 轮询（`ozon.mapper.ts:121` 已提取
   `posting.status`）；**本期不做 webhook**（决策 1）。
8. 单条订单更新失败不得拖垮整批同步（§36）。

## T2 定时同步开启（Sprint 5 调度器的最后一公里）

1. **ENV 默认值**进 `docker-compose.yml`：`ORDER_SYNC_INTERVAL_SECONDS=**300**`
   （决策 1：300s 级轮询即可；调度器下限是 60s，300s 合法且对配额友好）。
   **`LISTING_SYNC_INTERVAL_SECONDS` 不设**（决策 2：Listing 仅手动）。
2. **店铺同步开关**（决策 2：开发栈默认开、可手动关闭、店铺页加切换按钮）：
   - 店铺管理页暴露 `settings.sync.orderSyncEnabled / listingSyncEnabled` 两个开关，
     走既有 `PATCH /stores/:id`（`UpdateStoreRequestDto.settings` 已存在，**无后端契约缺口**）；
   - `settings` 实测整列为 NULL，写入口必须能处理 null 起始值，且**不得覆盖** settings 里
     其它既有键（读-改-写）；
   - 落地后把开发库唯一店铺 `ON-002` 设为 `orderSyncEnabled=true`（Listing 保持 false）
     ——这是**开发数据设置**，不是业务规则。
3. **同步新鲜度可见**：基于既有 `GET /sync/stores/:storeId/overview`（已含最近同步与连续
   失败）在店铺概览/首页显示「最近一次成功同步时间」，超期标红；建议把 8.5 新增的
   `CATEGORY_TREE_SYNC` / `PRODUCT_ENRICHMENT_SYNC` 一并展示（只展示不告警）。
4. **新增 `SYNC_FAILED` 异常类型**（决策 3 同意）：`EXCEPTION_TYPES` 增加枚举
   （现 5 项：`ORDER_SKU_MAPPING_FAILED` / `ORDER_OUT_OF_STOCK` / `ORDER_INVALID_STATE` /
   `ORDER_INTERCEPTION_FAILED` / `ORDER_SHIPMENT_DEADLINE_NEAR`），同步更新
   `docs/business-rules/orders.md` 的异常清单与前端标签映射；触发条件（连续失败 N 次）
   在任务书中定，**去重**（同一店铺同一 syncType 保持一条 OPEN）。

## T3 拦截路径暂存位兜底

1. **无暂存位时自动创建 `STAGING` 库位**（决策 4 = A）：一次到位、零 Schema 改动
   （`bin_code` 自由字符串，决策 0010/0011 已核实）。创建动作记 operation log。
2. **验证以集成测试为准**（现场靶子已不存在）：覆盖「仓库无暂存位 → 拦截仍能完成」；
   真实数据验证并入 T4 的拣货/发货链路。
3. 行为变化同步更新 `docs/business-rules/orders.md`（拦截章节）。

## T4 Sprint 8 真实数据验收（结转）+ 数据积累

**同时是 Sprint 10（补货建议）的数据前提。**

1. **5 张真实缺货单**（ORD00000001/02/03/04/47）：登记采购 → 扫码收货 → 重试分配 →
   拣货 → 发货走到底，把 `ORDER_OUT_OF_STOCK` 清零或给出明确结论；
2. **补足 ≥5 个新商品**（8.5-T8 已建 4 个），每个走完整链路；
3. 一轮 ≥20 行 Excel 导出→补填→双导入闭环；
4. **首次走通拣货 / 发货 / 包裹**（当前 `picking_tasks` / `package_items` 均为 0）；
5. 产出物：SKU 基数、采购历史、销售历史——为补货建议攒米。

## T5 验收

1. **集成测试**（新增）：
   - 平台取消传导：Reserved 订单 → 同步到 cancelled → Reservation 释放、可售恢复；
   - **无 Reservation 的 BACKORDERED 订单**取消 → 无库存动作、关闭缺货异常；
   - Picked 取消：同步 cancelled → 建 Interception，不直接恢复库存（§78 Case 3 的同步触发版）；
   - 重复同步同一取消：只释放一次；状态无变化的重复同步：零写入；
   - **时限重算**：摄入时不临近、之后过期 → 再同步能报 `ORDER_SHIPMENT_DEADLINE_NEAR`；
   - **拦截无暂存位**：仓库无 STAGING 时拦截仍能完成（T3）；
   - **店铺开关**：`orderSyncEnabled=false` 时调度器不派发（反之派发）；
   - **平台状态历史**：迁移写入 `platform_status_history`，订单详情返回合并时间线。
2. **真实数据**（手工）：
   - 开启定时同步后观察 ≥48h：订单自动流入、无 `SYNC_ALREADY_RUNNING` 噪音；
   - 5 张缺货单清零或明确结论；T4 的 ≥5 商品 + ≥20 行 Excel + 首次拣货发货记录；
   - T6 的线下直发单（ORD00000001）走完「标记外部履约」并关闭异常。

## T6 「标记外部履约」动作（决策 6 = A，v4 新增）

**问题**：ORD00000001 平台 `delivering`、时限已过、系统从未发货（用户线下采购直发买家），
目前只能挂异常。

**范围（最小动作）**：订单级动作——订单行关账 + 记录原因/操作人 + 不产生库存流水
（货从未进过系统，§14 账本不受影响），并关闭该订单的缺货/时限异常。

**边界**：不新增 ERP 状态（§98），只标记与关账；订单关账语义属业务规则，
实施前更新 `docs/business-rules/orders.md`。

---

# 4. 后续阶段建议（Sprint 10 起）

| 阶段 | 范围 | 前置依赖 | 变化 |
|---|---|---|---|
| Sprint 10 | 补货建议（基于采购历史与销量） | **本 Sprint T4 的数据积累** | 顺延一期（原 Sprint 9） |
| Sprint 11 | 渠道库存推送（Allocator + OZON 写接口，真实平台写需专项确认） | 在管 SKU/库存基数 | 顺延一期（原 Sprint 10） |
| Sprint 12 | 退货 + 物流追踪（退货批次对单、TRACKING_STALLED/LOST） | **本 Sprint T1 的状态同步基座** | 会议纪要第二痛点 |
| Sprint 13 | 财务（成本、对账） | 采购成本数据（moving_average_cost 已在记账） | — |
| Backlog | **OZON webhook 接入**（秒级取消/时限推送，T1b 原文见 v3）；WB / Yandex 适配器 | 公网可达 URL + 平台写操作批准 | 本期不做 |

双轨期风险提示继续有效（Sprint 7 规划决策 5）：推送能力就绪前，
平台侧库存人工维护，系统库存视为内部账。

> v4 备注：Sprint 8.5 / 8.5R1 已提前消化商品域体验负债（类目、品牌、图片、建档、
> 映射解析规则、条码格式、分类搜索），因此上述阶段表不含商品域任务；
> Sprint 10 的唯一硬前置仍是 T4 的数据积累。

---

# 5. 决策记录（2026-09-14 用户逐项确认，已定稿，不再开放）

| # | 决策点 | 用户结论 | 落地要点 |
|---|---|---|---|
| 1 | 平台取消的感知路径与执行方式 | **A + 300s 级轮询**；取消检测后**自动执行**（D1b=A） | 本期只做轮询，不做 webhook；轮询周期 **300s**（非 60s）；取消直接走 `OrderService.cancel()` |
| 2 | 定时同步的默认开关与频率 | **A 的变体**：Order 自动开（300s）；**Listing 仅手动**；可手动关闭；**店铺页加切换按钮** | ENV 只设 `ORDER_SYNC_INTERVAL_SECONDS=300`；店铺页两个开关走 `PATCH /stores/:id`；`ON-002` 开发数据设为开 |
| 3 | 是否新增 `SYNC_FAILED` 异常类型 | **同意新增** | 枚举 + `orders.md` 异常清单 + 前端标签；去重（同店同类型一条 OPEN） |
| 4 | 拦截暂存位兜底方式 | **A：自动创建 `STAGING` 库位** | 零 Schema 改动；记 operation log；集成测试覆盖 |
| 5 | 平台状态历史的落点 | **B（新表 `platform_status_history`）**——「拼接性能消耗低则 B」 | 实测拼接成本 ≈ 0.1ms（见下），故选 B；订单详情合并两表时间线 |
| 6 | 「不经仓库直发」订单的正式路径 | **A：本期只做标记** | 订单级关账 + 原因记录，不产生库存流水；需更新 `orders.md` |
| 7 | 两条「无靶子」异常与测试单收口 | **按测试数据清理** | **已执行**（§1.6）；同源孤儿通知 10 条**未清理**，待确认 |

**决策 5 的实测依据**（2026-09-14）：

```text
场景：订单详情时间线，方案 B = 两张表各一次按 order_id 的查询 + 按 created_at 合并
实测：EXPLAIN (ANALYZE, BUFFERS) → Execution Time 0.106ms，6 行结果，Buffers shared hit=5
表量级：order_status_history 每单约 2.7 行；10k 订单 ≈ 8 万行，两表各自 (order_id, created_at) 索引
结论：拼接成本可忽略；B 的语义隔离收益（平台状态词表 / 写入方 / 参与人与 ERP 状态机完全不同）
      大于一次额外索引探测的代价 → 选 B
```

**决策 7 的清理记录**：脚本 `scripts/cleanup-test-residue-2026-09-14.ts`
（dry-run 默认、`--apply` 执行、业务键硬编码、`NODE_ENV=production` 拒跑、单事务）。
执行结果：订单 6→5、order_items 6→5、OPEN 异常 7→5、异常总数 11→9。
**遗留**：10 条孤儿通知（指向 ORD00000037–44 / ITC00000001–09）——建议以同一脚本扩展清理，
需用户确认后执行。

---

# 6. 本规划不做的事

1. **不做补货建议**——数据不足（2 PO / 5 单 / 0 已发货），顺延 Sprint 10（§2.1）。
2. **不做渠道库存推送 / Allocator / 任何真实平台写操作**（Sprint 11 且需专项确认）。
3. ~~**不做退货、物流追踪模块**（Sprint 12；T1 为其打基座）~~。
   **已废止（2026-09-15）**：双轴任务书（`docs/WCIES_任务书_订单双轴标签与平台物流事实链路.md`）
   按用户指示将 Sprint 12 的物流停滞判定（ORDER_TRACKING_STALLED）与退货/退款
   模块提前实施完毕（`docs/business-rules/returns.md`）；物流轨迹查询接口经规范
   核实不存在（A6），TRACKING_LOST 等剩余范围仍留待后续 Sprint。
4. **本期不接 OZON webhook**（决策 1）：事件类型与 payload 事实已核实
   （ozon.md §6.1），但真实投递未验证、应答格式存在文档冲突（§6.4）、配置订阅属真实平台写
   操作且需公网 URL。列入 backlog，轮询（T1）已覆盖时效性需求。
5. **不做 WB / Yandex 适配器**。
6. **不做本地打印代理**（维持 Sprint 7 规划 §10.3.1 结论）。
7. **不改集成测试端口/Redis 冲突**（独立基础设施任务）。
8. **不动 erpStatus 的状态机**（T1 只传导平台事实到既有 cancel 链路；T6 只标记不新增状态）。
9. **不清理未映射存量**（用户只管有货的商品；当前 **1319** 条）。
10. **不改已定规则**：`offer_id` 不参与解析（决策 0016）、内部条码前缀 `W`（决策 0017）。
11. **不做 Listing 自动同步**（决策 2：仅手动触发 `POST /sync/listings`）。

---

# 7. 验收基线（供实施会话参考）

当前基线（2026-09-14，工作区提交 `67aeee2` + 规划修订，工作区干净）：

```text
lint / typecheck / check:arch / check:openapi   通过
单元测试 176 通过 / 集成测试 238 通过（27 文件，--poolOptions.forks.singleFork）
build                                           通过
```

数据基线（§1.2，2026-09-14 实测，决策 7 清理后）：开发库含真实业务事实
（5 SKU、1 笔收货、**5** 订单、**5** 个 OPEN 异常、7941 类目、7365 类目映射、
1324 变体行、10 条孤儿通知）——**不可重建**。
真实数据操作（T3/T4/T6、决策 7 的后续）按 §89 谨慎执行；集成测试仍用 `wcies_test`。

Migration 编号：**最新为 `20260914_001`**（Sprint 8.5 的类目两张表）。
本 Sprint 预计 Migration：**1 个**（T1 决策 5 选 B → `platform_status_history`；
若同时落地 `SYNC_FAILED` 枚举则无额外 Schema——枚举是代码常量）。

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
| 订单业务规则（取消/拦截/时限/异常清单） | `docs/business-rules/orders.md` |
| 主数据规则（条码格式、映射解析） | `docs/business-rules/master-data.md` |
| 采购/收货业务规则 | `docs/business-rules/purchase.md` |
| OZON 状态映射事实（含 cancelled） | `docs/integrations/ozon.md` §Posting 字段映射 |
| 一次性测试数据清理脚本 | `scripts/cleanup-test-residue-2026-09-14.ts` |
| 决策记录 | `docs/decisions/0001`–`0017`（0016 映射解析、0017 内部条码前缀） |
| 术语表 | `CONTEXT.md` |
