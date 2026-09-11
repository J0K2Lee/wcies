# WCIES 下一阶段规划（Sprint 7 及后续）

> 依据：`AGENTS.md`、`docs/` 全部业务规则与架构文档、Sprint 0–6 任务书、`docs/会议纪要.md`、
> 以及 2026-09-11 生产数据的实际状态（用户真实 OZON 数据已同步）。
>
> 本文件是**规划**，不是实施任务书。实施前需先确认第 5 节的决策点。

---

# 1. 现状盘点（有证据，非推测）

## 1.1 已完成

| Sprint | 范围 | 状态 |
|---|---|---|
| 0 | 工程初始化：Monorepo、Auth、BullMQ、MinIO、日志、错误信封、OpenAPI 链路、CI | 已完成 |
| 1 | 主数据：Product/SKU/条码/图片、平台/店铺/凭证、仓库/库位、店仓绑定、Listing 映射、导入 | 已完成 |
| 2 | 库存核心：Balance/SafetyStock/Reservation/Transaction、可用量、并发控制、幂等、初期库存导入 | 已完成 |
| 3 | 订单核心 + 拣货：摄入、SKU 解析、库存占用、Backorder、扫码校验、取消处理 | 已完成 |
| 4 | 发货 + 拦截：Shipment/Package 出库闭环、Picked 取消的拦截回库 | 已完成 |
| 5 | 平台集成基座 + OZON：Client/Adapter/Mapper、同步引擎（Listing/Order/Webhook）、游标/单飞/幂等 | 已完成（真实冒烟未执行） |
| 6 | 手工测试修复（两轮，35 条问题） | 已完成 |

## 1.2 系统当前能力边界

**已打通的业务闭环**：主数据 → 库存 → 订单 → 拣货 → 发货 → 拦截。

**平台集成现状**（`apps/api/src/modules/integration/`）：
- 只有 `ozon/` 一个适配器。
- OZON 适配器**只读**：`validateCredential` / `fetchListings` / `fetchOrders` / `processWebhook` / `fetchOrdersByPlatformIds`。
  **没有任何写操作**（无推库存、无调价、无发货、无取消）。
- 同步类型只有两种：`LISTING_SYNC` / `ORDER_SYNC`（`sync/sync.constants.ts:4`）。

**尚无实现的规划模块**（对照 `docs/WCIES_工程架构与_Monorepo_目录设计_V1.md:985-1089`）：

| 模块 | 规划内容 | 现状 |
|---|---|---|
| Purchase 采购 | Supplier / PurchaseOrder / PurchaseReceipt | 无模块目录 |
| Transfer 调拨 | transferOut / transferIn（跨仓） | 无（仅有同仓 MoveBin） |
| Return 退货 | ReturnOrder / ReturnQC | 无 |
| Finance 财务 | 成本、汇率、对账 | 无 |
| **Inventory Allocator** | 实体可售 → 渠道库存的分配（AGENTS.md §21 冻结规则） | **无**（全仓库搜索 `allocator` 无结果） |
| WB / Yandex 适配器 | 平台扩展 | 无 |

## 1.3 真实数据状态（关键）

用户已把 1324 个 OZON 商品同步进系统。数据库实测：

| 项 | 数量 | 含义 |
|---|---|---|
| `platform_listings` | 1324 | 平台商品已全量同步 |
| `platform_listing_skus` 未映射 | **1323** | 几乎全部未映射 |
| `platform_listing_skus` 已映射 | 1 | 仅用户手工测的那一个 |
| `products` / `skus` | **各 1 个** | 内部主数据几乎为空 |
| `inventory_balances` | **0** | 系统内没有任何库存 |
| `orders` | 4 | 全部曾因映射失败进异常 |

**这三个数字连起来说明一件事：系统当前无法承接真实业务。**

```
1323 个商品未映射  →  订单进来必然映射失败  →  无法占用库存
                        ↓
                 即使映射好了，inventory_balances = 0  →  仍然必然缺货（BACKORDERED）
```

## 1.4 业务侧诉求（`docs/会议纪要.md`）

会议纪要明确了团队自己排的优先级：

1. **库存管理为最底层基础**——"必须先理清实体库存与线上商品的映射关系"。
2. **商品管理次之**——"建立线上商品与线下库存 SKU 的映射表，解决同一商品在不同平台命名不一致"。
3. **订单管理依赖库存**——"订单状态流转需驱动库存变动，否则流程断裂"。

会议指出的核心痛点：取消信息不同步导致丢货风险、退货无法对应原订单、库存变动未与订单联动、
打包环节无核验。待办三项：订单取消登记表、打包监控+重量记录、评估马帮。

**这些诉求与本规划的方向一致**：先把库存与映射这两层基础夯实，再谈流程深化。

---

# 2. 下一阶段的核心判断

## 2.1 为什么不能直接做采购/调拨/退货/财务

这四个模块是规划中剩下的"大块"，但它们**都建立在库存数据之上**。
当前 `inventory_balances` 为 0——没有库存事实，采购入库无处可入、调拨无货可调、退货无货可退。

**先有库存，才有围绕库存的流程。** 直接开做四大模块会得到一堆操作空数据的界面。

## 2.2 为什么渠道库存推送（Allocator）是刚需而非优化

AGENTS.md §21 是冻结规则：

> 实体可售库存和渠道推送库存必须通过 Inventory Allocator 分离。

当前系统**完全没有这个能力**，而业务现实是：

- 平台上的 1324 个商品**正在售卖**，平台侧库存由卖家手工维护（或平台默认值）。
- 系统内的库存一旦建立，两边就会**立即不一致**。
- 如果系统不推送库存，平台库存会停留在手工值 → 超卖风险（AGENTS.md §22 明令 `oversell = false`）。
- 如果推送了却不走 Allocator，就是用实体库存直接覆盖渠道库存 → 违反 §12、§21。

**结论：库存初始化与渠道推送必须同阶段做，不能一个先行。** 只建库存不推送，等于给自己造了一个
与平台不一致的第二事实源。

## 2.3 建议的下一阶段定位

**Sprint 7 = 让系统能吃下真实业务**（打通"商品建档 → 映射 → 库存 → 推送"这条主链路），
而不是继续铺新模块。

理由：Sprint 0–6 建成了**完整的流程骨架**（订单→拣货→发货→拦截全通，测试 181 条覆盖），
但这个骨架**没有血肉**——主数据 1 个 SKU、库存 0 条。当前最高价值的投入是让真实数据流进来，
验证骨架确实能跑通真实规模（1300+ 商品、真实订单），而不是在空数据上继续加模块。

---

# 3. Sprint 7 建议范围

## T1 商品/SKU 批量建档（从平台数据反向生成）

**问题**：1324 个商品要手工在系统里建 SKU，不现实。用户在对话中已明确此阻塞。

**方向**：增加"从平台商品批量生成内部 SKU"的能力。已同步的 `platform_listings` 已带
`platform_product_id` / `offer_id` / `title`，是现成的数据源。

**需要决策**（见 §5 决策 1）：生成策略——
- 方案 A：一个平台商品生成一个 Product + 一个 SKU（贴合用户实际：其商品均为单 SKU）。
- 方案 B：只生成 Product，SKU 由人工补充。
- 方案 C：以 offer_id 为主键生成，标题作名称。

**产出**：批量建档接口 + 界面（勾选/全选平台商品 → 生成 SKU → 回填映射）。
**要求**：幂等（重复执行不重复建档）、可预览（先看会生成什么再确认）、错误逐行可读
（复用 `ImportJob` 的 row/field/code 结构）。

## T2 映射批量补齐

**问题**：1323 条未映射。单条人工映射不现实；T1 完成后可自动回填大部分。

**方向**：
- T1 生成 SKU 时**顺带建立映射**（该商品 → 新建的 SKU），一次动作解决两件事。
- 补充"按 offer_id / platform_sku_id 匹配导入"作为兜底（Excel 导入已有
  `LISTING_MAPPING` 模板，`apps/api/src/modules/import/handlers/listing-mapping-import.handler.ts`）。

**注意**：现有 `LISTING_MAPPING` 导入模板已实现且**已受决策 0012 约束**
（必须至少一个平台标识），可直接复用，无需新写。

## T3 库存初始化导入

**问题**：`inventory_balances = 0`。真实库存必须先进入系统。

**现状**：`INITIAL_INVENTORY` 导入模板已存在
（`apps/api/src/modules/import/handlers/initial-inventory-import.handler.ts`），
模板列：`sku_code | warehouse_code | bin_code | quantity | remark`。
**能力已具备，缺的是"把真实盘点数据整理成这个格式"**——这属于数据准备，不是开发。

**需要确认**：真实库存数据的粒度（是否已有库位级盘点？还是只有 SKU 级总量？）。
若只有 SKU 级，需要决定落到哪个库位（可用虚拟 `DEFAULT` 库位，系统已支持
`ensureDefaultBin`）。

## T4 渠道库存推送（Inventory Allocator + OZON 写接口）

**这是本 Sprint 技术含量最高、风险最大的部分**，因为它是**第一次对平台做真实写操作**。

**需要实现**：
1. **Allocator**：按 AGENTS.md §21 的分配模式（`SHARED` / `FIXED` / `RATIO` / `MAX_LIMIT`）
   把实体可售量分配到渠道。Sprint 7 建议**只实现 `SHARED`**（最简：渠道可用 = 实体可售），
   其余模式留待有真实需求时再加。
2. **渠道库存快照**：记录"上次推给平台的值"，用于变更检测（只推变化量，减少 API 调用）。
3. **OZON 写接口**：`POST /v1/product/import/stocks`（**具体 endpoint 与字段必须先依据
   官方文档核实**——AGENTS.md §88 明令不得凭记忆猜测；`docs/ozon-seller-openapi.json`
   是已有的官方规范，应先查证）。
4. **推送任务**：入 BullMQ（AGENTS.md §50），按 `Store + SyncType` 隔离与单飞（§43/§45）。
5. **NO_INVENTORY_RECORD ≠ ZERO**（§20，硬规则）：SKU+仓无库存记录时**跳过该 SKU**，
   不得推 0。这一条必须有测试。

**必须遵守**：
- 推送前需 **store 级 opt-in**（Sprint 5 已建立该模式，定时同步默认关闭）。
- 首次推送必须有**人工确认**，建议先支持"预览将推送什么"再执行。
- 真实写操作需用户明确知情（AGENTS.md §92）。

## T5 库存同步状态可见

**方向**：让用户能看到"系统库存 vs 平台库存"的差异。这是 T4 的安全网——
推送出问题（限流、失败、被平台拒绝）必须可见，否则用户不知道平台库存是否可信。

**可复用**：`SyncJob` 已有完整字段（status/cursor/successCount/failedCount/error），
`Exception` 体系已有。缺的是"库存推送"这个 syncType 与对应异常类型
（`INVENTORY_SYNC_FAILED`，AGENTS.md §53 已列出该类型但未实现）。

---

# 4. 后续阶段建议（Sprint 8+）

按依赖顺序，**不建议跳序**：

| 阶段 | 范围 | 前置依赖 | 理由 |
|---|---|---|---|
| Sprint 8 | 采购（Supplier / PO / 收货入库） | Sprint 7 库存可用 | 采购入库是库存的主要来源；`moving_average_cost` 预留字段等它在实现（`master-data.md:50`） |
| Sprint 9 | 调拨 + 退货 | Sprint 8 多仓有货 | 调拨需多仓库存；退货需 `RETURN_TEMP` 仓（系统已有该 warehouseType） |
| Sprint 10 | 财务（成本、对账） | Sprint 8 采购成本数据 | 财务需要采购/物流成本作为输入 |
| 按需 | WB / Yandex 适配器 | 无（可并行） | 取决于业务是否要扩平台；底座已就绪，新增平台不改 Inventory Core（AGENTS.md §32） |

**会议纪要的未覆盖诉求**（建议纳入 Sprint 9 或独立评估）：
- 订单取消登记表（字段：订单号/下单时间/发货状态/取消时间/原因/物理位置/处理单位）
- 打包环节监控 + 重量记录
- 退货临时仓（`RETURN_TEMP` 已存在）

---

# 5. 需要用户决策的点

以下事项**在实施前必须确认**，我不擅自决定：

## 决策 1：商品/SKU 批量建档的生成策略

用户商品均为单 SKU（实测 1324 商品 / 1324 条 SKU 行 / 0 个多 SKU 商品）。
是按"一商品一 SKU"直接生成，还是保留"先建 Product 再人工建 SKU"的两步？

## 决策 2：Allocator 首批支持哪些分配模式

AGENTS.md §21 列出 `SHARED` / `FIXED` / `RATIO` / `MAX_LIMIT` 四种。
建议 Sprint 7 只做 `SHARED`（渠道可用 = 实体可售），其余按需再加。
是否同意？

## 决策 3：渠道库存推送的触发方式

- 手动触发（用户在界面点"推送库存"）
- 定时触发（BullMQ 周期任务，按 store opt-in）
- 事件触发（库存变动后自动推）

建议 Sprint 7 做**手动 + 定时**，事件触发留后（自动推送风险最高，且需要防抖/合并）。

## 决策 4：首次真实推送的时机

这是**对真实店铺的写操作**。按 AGENTS.md §92，实施前需明确：
- 是否先在某一个店铺试点？
- 是否需要"只记录不推送"的演练模式（dry-run）先验证？
- 推送失败的回滚策略？

## 决策 5：WB / Yandex 是否纳入近期规划

取决于业务是否计划扩平台。若近期不扩，Sprint 8+ 的排序不受影响。

---

# 6. 本规划不做的事

明确边界，避免范围蔓延：

1. **不改动已冻结的架构规则**（AGENTS.md §101 的 30 条）。
2. **不引入新依赖**（§73），除非实施时说明必要性并获批准。
3. **不做真实平台写操作**，直到决策 4 确认。
4. **不动 25 行 `platform_sku_id = "0"` 的历史数据**——它们靠 offer_id 仍可解析，
   清理属于独立的数据决策（用户已同意代码层守卫，数据层未定）。
5. **不做前端 Design System 迁移的收尾**（Phase 2 报告列出的剩余页面）——
   除非 Sprint 7 涉及具体页面时顺带处理。

---

# 7. 验收基线（供实施会话参考）

当前基线（2026-09-11，提交 `fa37246`）：

```
lint              通过
typecheck         通过（packages + api + web）
check:arch        通过（5 条规则）
check:openapi     通过（137 schemas / 154 responses / 15 required DTOs）
单元测试          133 通过（17 文件）
集成测试          181 通过（20 文件，必须 --no-file-parallelism）
build             通过
```

**集成测试必须串行**：20 个测试文件中 3 个共用端口 3111、6 个共用 Redis DB 8
（`tests/integration/*.spec.ts`），并行会随机 ECONNRESET。这是既有缺陷，
修它需要给每个测试文件分配独占端口——属于独立的基础设施任务，未纳入本规划。

**集成测试库 `wcies_test` 可安全重建**：`npx tsx scripts/ensure-test-db.ts`
从迁移 + 种子重建（该脚本有环境守卫，拒绝非 test 库）。

---

# 8. 参考索引

| 内容 | 路径 |
|---|---|
| 开发纪律（必读） | `AGENTS.md` |
| 架构总览 | `docs/architecture/overview.md` |
| 总体架构设计 | `docs/WCIES_跨境电商综合管理系统——总体技术架构设计_V1.md` |
| 模块与目录规划 | `docs/WCIES_工程架构与_Monorepo_目录设计_V1.md`（模块职责 `:961-1138`） |
| 业务规则 | `docs/business-rules/{inventory,orders,master-data}.md` |
| 决策记录 | `docs/decisions/0001-0012` |
| OZON 集成事实 | `docs/integrations/ozon.md` + `docs/ozon-seller-openapi.json`（官方规范） |
| 业务诉求 | `docs/会议纪要.md` |
| 前端重构缺口 | `docs/web-redesign-phase2-report.md:138-152`（API Gap 表） |
| Sprint 5 遗留 | `handoff/wcies-sprint5-final-report.md:199-213` |
| 术语表 | `CONTEXT.md` |
