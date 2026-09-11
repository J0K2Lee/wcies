# WCIES 下一阶段规划（Sprint 7 及后续）

> 依据：`AGENTS.md`、`docs/` 全部业务规则与架构文档、Sprint 0–6 任务书、`docs/会议纪要.md`、
> 用户 2026-09-11 的业务澄清，以及生产数据的实际状态。
>
> 本文件是**规划**，不是实施任务书。实施前需先确认第 5 节的决策点。
>
> **2026-09-11 修订**：入口从「初始库存导入」改为「采购入库」。原判断有误，理由见 §1.5。

---

# 1. 现状盘点（有证据，非推测）

## 1.1 已完成

| Sprint | 范围 | 状态 |
|---|---|---|
| 0 | 工程初始化：Monorepo、Auth、BullMQ、MinIO、日志、错误信封、OpenAPI 链路、CI | 已完成 |
| 1 | 主数据：Product/SKU/条码/图片、平台/店铺/凭证、仓库/库位、店仓绑定、Listing 映射、导入 | 已完成 |
| 2 | 库存核心：Balance/SafetyStock/Reservation/Transaction、可用量、并发控制、幂等 | 已完成 |
| 3 | 订单核心 + 拣货：摄入、SKU 解析、库存占用、Backorder、扫码校验、取消处理 | 已完成 |
| 4 | 发货 + 拦截：Shipment/Package 出库闭环、Picked 取消的拦截回库 | 已完成 |
| 5 | 平台集成基座 + OZON：Client/Adapter/Mapper、同步引擎、游标/单飞/幂等 | 已完成（真实冒烟未执行） |
| 6 | 手工测试修复（两轮，35 条问题） | 已完成 |

## 1.2 系统当前能力边界

**已打通的业务闭环**：主数据 → 库存 → 订单 → 拣货 → 发货 → 拦截。

**平台集成现状**（`apps/api/src/modules/integration/`）：
- 只有 `ozon/` 一个适配器，且**只读**：`validateCredential` / `fetchListings` / `fetchOrders` /
  `processWebhook` / `fetchOrdersByPlatformIds`。**无任何写操作**。
- 同步类型只有两种：`LISTING_SYNC` / `ORDER_SYNC`（`sync/sync.constants.ts:4`）。

**尚无实现的规划模块**（对照 `docs/WCIES_工程架构与_Monorepo_目录设计_V1.md:985-1089`）：
Purchase 采购、Transfer 调拨、Return 退货、Finance 财务、Inventory Allocator、WB/Yandex 适配器。

## 1.3 真实数据状态（关键）

| 项 | 数量 |
|---|---|
| `platform_listings`（已同步平台商品） | 1324 |
| `platform_listing_skus` 未映射 | **1323** |
| `platform_listing_skus` 已映射 | 1 |
| `products` / `skus` | **各 1 个** |
| `inventory_balances` | **0** |
| `orders` | 4 |

## 1.4 用户业务模型（2026-09-11 澄清）

用户明确了三点，直接决定 Sprint 7 的范围：

1. **入库必须先做**，且必须是「真实的收货动作」，**不能用「调整初始库存」代替**——
   因为初始库存是账目调整，**无法建立库存与实物来源的关系**。
2. **大部分商品是「先售卖，再进货」**，只有一部分是备货销售。
3. **核心诉求是管理「有货的商品」**——即需要跟踪实体库存的那部分商品。

## 1.5 原判断的修正

本文档初版把「库存初始化导入」列为进入系统的入口，**这个判断是错的**：

- `INITIAL_INVENTORY` 导入（`initial-inventory-import.handler.ts`）本质是**开账余额**，
  它只回答「系统上线时账上有多少」，不回答「这批货从哪来、谁送来的、什么时候到的」。
- 用户要的恰恰是后者——**库存与实物的对应关系**。

而 `docs/WCIES_跨境电商综合管理系统——总体技术架构设计_V1.md:2580-2620` §87
「第一阶段真正需要跑通」的链路，起点本来就是**采购入库**，不是初始库存：

```text
创建Product/SKU
↓
建立平台映射
↓
采购入库          ← 缺失的就是这一环
↓
进入Warehouse/Bin
↓
形成Inventory Balance
↓
Allocator计算渠道库存
↓
推送OZON
↓
平台生成订单
↓
订单同步
↓
库存Reservation
↓
拣货
↓
扫码校验
↓
Shipment / Label
↓
出库
↓
物流同步
```

**用户的口径与架构文档一致，初版规划偏离了。**

---

# 2. 下一阶段的核心判断

## 2.1 链路中真正缺失的只有「入库」一环

把用户要验证的链路与现有能力逐段对照：

| 链路环节 | 现有能力 | 状态 |
|---|---|---|
| **入库**（收货） | `POST /inventory/receive` 存在，但标注 "future purchase-receipt primitive"；**无业务单据、无界面、无供应商概念** | ❌ **缺失** |
| 销售（订单同步 → 占用） | `ORDER_SYNC` + `ListingResolver` + `ReservationService` | ✅ 可用（181 条集成测试覆盖） |
| 拣货 | Picking 模块 + 扫码校验 | ✅ 可用 |
| 出库 | Shipment / Package + 面单 | ✅ 可用 |

**「先售卖，再进货」这条路径现有系统也已支持**：

```text
订单进来 → 映射成功但库存为 0 → BACKORDERED + ORDER_OUT_OF_STOCK 异常 ✅ 已支持
                                        ↓
                              （用户去采购，货到）
                                        ↓
                          入库 → 重试分配 → RESERVED ✅ 已支持
                                        ↓
                                   拣货 → 出库 ✅ 已支持
```

`retry-allocation` 在 2026-09-11 刚修好（提交 `880b0b7`），包括
「映射修复后重试」与「修复后仍缺货正确落到 BACKORDERED」两条路径。

**结论：Sprint 7 只需要补齐「入库」，链路即可端到端跑通——这是投入产出比最高的一步。**

## 2.2 为什么采购入库不能做成「再加一个导入模板」

`POST /inventory/receive` 已经是可用的**库存原语**（走 `InventoryService.receiveStock`，
写 `InventoryTransaction`，符合 AGENTS.md §10/§14）。缺的不是库存操作，而是**它前面的业务单据**：

- 没有单据，就答不出「这 10 件是谁送的、什么价、哪张单」——这正是用户要的**实物来源**。
- 没有单据，`InventoryTransaction.referenceType` 只能继续用 `MANUAL`，
  对账时无法区分「盘盈调整」与「真实到货」。
- 没有单据，将来做采购成本（`moving_average_cost`）时没有数据来源。

## 2.3 「有货的商品」这个诉求对范围的影响

用户说核心是管理**有货的商品**，而非全量。这降低了 Sprint 7 的紧迫度排序：

- **不需要**先解决 1323 条未映射（那是全量经营，属于后续）。
- **只需要**能对「要跟踪库存的那些商品」建 SKU、建映射、收入库、卖出、拣货、发货。
- 因此**批量建档（原 T1）可以后移**——用户完全可以用现有的单条界面，
  对少量「有货商品」建档并验证链路。

**Sprint 7 的定位因此收敛为：把「入库」补上，并用真实数据验证端到端链路。**

---

# 3. Sprint 7 建议范围

## T1 供应商主数据（最小）

**为什么需要**：实物来源的第一要素是「谁送的」。没有供应商，「建立库存与实物的关系」就缺一半。

**范围**：
- `suppliers` 表：编码（业务编号，沿用集中式序号表 `business_code_sequences`）、名称、
  联系人/电话、备注、状态。
- 标准 CRUD + 零引用删除（沿用决策 0003 的既有模式）。
- 界面：放在「商品」或新建「采购」一级菜单下（决策点见 §5）。

**编码规则**：需新增一类业务编码前缀（如 `SUP%04d`），按 `master-data.md §1` 的表格登记。
**注意**：新增编码规则属于业务规则变更，需同步更新 `docs/business-rules/master-data.md`。

## T2 收货入库单（本 Sprint 核心）

**这是「入库」的业务载体**，也是本 Sprint 唯一的必做项。

### 数据模型

```text
purchase_receipts          收货单（表头）
  receipt_no               业务编号（集中式序号）
  supplier_id              供应商（可空？见决策 2）
  warehouse_id             收货仓库
  status                   DRAFT / RECEIVED / CANCELLED
  received_at              实际收货时间
  remark
  created_by / created_at

purchase_receipt_items     收货单明细
  receipt_id
  sku_id                   内部 SKU
  quantity                 数量（NUMERIC，只增不减）
  unit_cost                单位成本（可空，见决策 3）
  bin_id                   目标库位（可空 → 用 ensureDefaultBin）
  remark
```

### 状态机

```text
DRAFT ──确认收货──> RECEIVED
  │                    │
  └──取消──> CANCELLED  └── 不可撤销（如需修正走库存调整）
```

**关键约束**：
- **确认收货**才写库存：`PurchaseReceiptService.confirm()` → 逐行调用
  `InventoryService.receiveStock()`（新增引用类型，见决策 4）。
  采购模块**绝不直接改 `inventory_balances`**（`工程架构文档:1005-1008` 明令）。
- 收货单一旦 `RECEIVED` 不可改数量——库存已入账，改数量必须走调整（保持流水可追溯）。
- 同一收货单重复确认必须幂等（`idempotencyKey = PURCHASE_RECEIPT:<receiptId>`）。
- 整单在一个数据库事务内确认，任一行失败全部回滚。

### 界面

- 收货单列表（筛选：供应商 / 状态 / 日期 / 仓库）
- 新建收货单：选供应商 + 仓库 → 加行（SKU 搜索 + 数量 + 单位成本 + 库位）→ 保存草稿或直接确认
- 确认前**预览**：本次将入库哪些 SKU、各多少、入到哪个库位

## T3 端到端链路验证（本 Sprint 的验收）

这条链路是用户明确要求验证的，应作为 Sprint 7 的**验收场景**写成集成测试 + 手工验收脚本：

```text
1. 建立 Product + SKU（或复用 SKU000010001）
2. 建立平台映射（已有的「人工映射」入口）
3. 建收货单：供应商 X → 仓库 ZG-01 → SKU × N 件 → 确认收货
       ↓ 断言：inventory_balances.on_hand = N
       ↓ 断言：inventory_transactions 有对应流水，reference = 该收货单
4. 订单进来（真实订单同步 或 手工摄入）→ 占用库存
       ↓ 断言：reservation RESERVED，available 减少
5. 生成拣货任务 → 扫码拣货
       ↓ 断言：Reserved → Picked
6. 发货
       ↓ 断言：On Hand 减少，订单行 SHIPPED
```

**注意**：第 4-6 步的代码已存在且有测试覆盖，本 Sprint 要验证的是
**「入库产生的库存能被订单正常消费」**这条衔接——特别是库存落在哪个库位、
拣货扫码能否找到该库位、可用量计算是否正确。

## T4（后移）商品/SKU 批量建档

原初版 T1。用户已确认当前诉求是「有货的商品」，可先用单条界面处理；
待链路验证通过、需要覆盖全量 1323 条时再做。**保留为 Sprint 8 候选。**

---

# 4. 后续阶段建议（Sprint 8+）

按依赖顺序，**不建议跳序**：

| 阶段 | 范围 | 前置依赖 | 理由 |
|---|---|---|---|
| Sprint 8 | 商品/SKU 批量建档 + 映射批量补齐 | 无 | 覆盖全量经营（1323 条）；Sprint 7 验证过单条链路后再放量 |
| Sprint 9 | 渠道库存推送（Allocator + OZON 写接口） | Sprint 8（有足够库存数据） | 见下方风险说明 |
| Sprint 10 | 采购计划（PurchaseOrder）+ 补货 | Sprint 7（收货）、Sprint 8 | 「先售卖再进货」需要「缺货 → 该买什么」的聚合 |
| Sprint 11 | 调拨 + 退货 | Sprint 10 | 调拨需多仓有货；退货需 `RETURN_TEMP` 仓（已存在该类型） |
| Sprint 12 | 财务（成本、对账） | Sprint 10（采购成本数据） | `moving_average_cost` 需采购价作为输入 |
| 按需 | WB / Yandex 适配器 | 无（可并行） | 底座已就绪，新增平台不改 Inventory Core（§32） |

## 关于渠道库存推送的时机（重要风险提示）

初版把 Allocator 放在 Sprint 7。**修订后建议后移**，理由是范围已在 §2.3 收敛；
但必须明确风险，不能沉默：

- 用户的商品**正在平台上售卖**，平台侧库存目前由人工维护。
- 系统内建立库存后，若**不推送**，两边会不一致：系统显示有货、平台可能显示缺货（或少卖）。
- 若**推送但不走 Allocator**，就是用实体库存直接覆盖渠道库存，违反 AGENTS.md §12/§21。

**因此：在推送能力就绪前，平台侧库存应继续人工维护，系统内库存视为内部账。**
这个「双轨期」必须被用户知情并接受——见 §5 决策 5。

---

# 5. 需要用户决策的点

## 决策 1：收货单是否必须有供应商

- **A（推荐）**：必填。每批货都能追溯到来源。
- **B**：可空（临时/自采/退货返修等场景无供应商）。

推荐 A，但保留可空的字段设计以便将来放宽；若选 B，需在文档写明「无供应商收货」的适用场景。

## 决策 2：是否本 Sprint 就做采购单（PurchaseOrder）

- **A（推荐）**：**不做**。只做收货单。理由：用户是「先售卖再进货」，采购单是计划文档，
  在补货聚合（Sprint 10）之前价值有限；且 `工程架构文档:996` 列的四张表
  （Supplier/PO/POItem/Receipt）一次做完属于范围蔓延（AGENTS.md §74）。
  收货单预留 `purchase_order_id` 可空字段，将来接入无需改表。
- **B**：与收货单一起做。范围明显变大。

推荐 A。

## 决策 3：单位成本与移动加权平均

`docs/WCIES_跨境电商综合管理系统——总体技术架构设计_V1.md:2509-2520` §86 规定：

> 采购成本采用**移动加权平均**，入库时更新成本。采购未收货不得提前改变库存成本。

而 `moving_average_cost` 当前是预留字段（`master-data.md:50` 写明「采购 Sprint 实现」）——
**本 Sprint 就是那个采购 Sprint**。选项：

- **A（推荐）**：收货单记录 `unit_cost`（可空），确认收货时更新 `moving_average_cost`。
  符合架构文档规定，且成本数据从第一批货就开始积累。
- **B**：本 Sprint 只记录 `unit_cost`，暂不计算移动加权平均（等财务 Sprint）。
  风险：将来补算时历史收货单可能缺成本数据。

推荐 A。**注意**：这会改变 SKU 成本语义，必须同步更新 `master-data.md` 与
`docs/business-rules/inventory.md`（AGENTS.md §86 把 Cost 列为必须同步文档的业务）。

## 决策 4：新增库存引用类型

当前 `INVENTORY_REFERENCE_TYPES = ['MANUAL', 'TEST', 'ORDER', 'IMPORT']`
（`inventory/enums/inventory.constants.ts:76`）。收货入库需要新增一种（如
`PURCHASE_RECEIPT`），以便流水可按来源对账。

**这属于业务状态/枚举变更**（AGENTS.md §98 要求不得自行增加），需你确认。
不加的后果：收货流水与手工调整无法区分。

## 决策 5：平台库存的「双轨期」是否接受

见 §4 风险提示。在渠道库存推送就绪前，平台侧库存继续人工维护。
**需要你明确知情并接受**：此期间系统库存与平台库存可能不一致，且系统不会自动纠正。

## 决策 6：收货单归属哪个菜单

- **A**：新建「采购」一级菜单（为 Sprint 10 的采购单预留位置）。
- **B**：放在「库存」菜单下作为「收货入库」。

推荐 A，避免将来采购单做好后再迁菜单。

---

# 6. 本规划不做的事

1. **不做初始库存导入作为入库手段**——用户已明确否决（见 §1.5）。
2. **不改动已冻结的架构规则**（`AGENTS.md` §101 的 30 条；架构文档 §90 的 30 条）。
3. **不引入新依赖**（§73）。
4. **不做真实平台写操作**（推送库存/发货/调价）——留待 Sprint 9 且需专项确认。
5. **不做全量 1323 条的批量建档**——用户当前只关心有货商品（§2.3）。
6. **不动 25 行 `platform_sku_id = "0"` 的历史数据**——代码层已加守卫（提交 `fa37246`），
   数据层清理是独立决策。
7. **不做前端 Design System 收尾迁移**，除非 Sprint 7 涉及的页面顺带处理。

---

# 7. 验收基线（供实施会话参考）

当前基线（2026-09-11，提交 `b2b145f`）：

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
修它需给每个测试文件分配独占端口——独立的基础设施任务，未纳入本规划。

**集成测试库 `wcies_test` 可安全重建**：`npx tsx scripts/ensure-test-db.ts`
从迁移 + 种子重建（该脚本有环境守卫，拒绝非 test 库）。

**开发库当前无库存数据**：`inventory_balances = 0`，Sprint 7 的验证不会破坏既有事实。

---

# 8. 参考索引

| 内容 | 路径 |
|---|---|
| 开发纪律（必读） | `AGENTS.md` |
| 第一阶段完整链路 | `docs/WCIES_跨境电商综合管理系统——总体技术架构设计_V1.md:2580-2620` §87 |
| 采购模块职责与边界 | `docs/WCIES_工程架构与_Monorepo_目录设计_V1.md:985-1008` §31 |
| 采购成本规则 | `docs/WCIES_跨境电商综合管理系统——总体技术架构设计_V1.md:2509-2520` §86 |
| 业务规则 | `docs/business-rules/{inventory,orders,master-data}.md` |
| 决策记录 | `docs/decisions/0001-0012` |
| OZON 集成事实 | `docs/integrations/ozon.md` + `docs/ozon-seller-openapi.json` |
| 业务诉求（会议纪要） | `docs/会议纪要.md` |
| 架构总览 | `docs/architecture/overview.md` |
| 术语表 | `CONTEXT.md` |
