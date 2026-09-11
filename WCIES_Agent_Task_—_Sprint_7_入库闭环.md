# WCIES Agent Task — Sprint 7 入库闭环（采购登记 + 收货入库 + 发货时限）

> 本文件是**执行任务书**，交给其他会话执行。执行前必须完整阅读本文件与 `AGENTS.md`。
>
> 规划依据：`docs/WCIES_下一阶段规划_Sprint_7_及后续.md`（v7）。
> 本文件不重复规划文档的分析过程，只给出**可执行的任务分解、精确改动点与验收标准**。
>
> 生成时间：2026-09-12，基线提交 `570aab0`。

---

## 目录

- [第 0 节 使用说明](#第-0-节-使用说明)
- [第 1 节 环境与启动](#第-1-节-环境与启动)
- [第 2 节 当前基线](#第-2-节-当前基线)
- [第 3 节 已锁定决策](#第-3-节-已锁定决策)
- [第 4 节 待确认决策](#第-4-节-待确认决策)
- [第 5 节 事实基线](#第-5-节-事实基线)
- [第 6 节 任务分解与依赖](#第-6-节-任务分解与依赖)
- [第 7 节 T0 — 文档先行](#第-7-节-t0--文档先行阻塞其他任务)
- [第 8 节 T1 — 平台发货时限](#第-8-节-t1--平台发货时限)
- [第 9 节 T2 — 供应商与货源（轻量）](#第-9-节-t2--供应商与货源轻量)
- [第 10 节 T3 — 采购登记单](#第-10-节-t3--采购登记单核心)
- [第 11 节 T4 — 收货入库单](#第-11-节-t4--收货入库单核心)
- [第 12 节 T5 — 收货作业支持](#第-12-节-t5--收货作业支持)
- [第 13 节 T6 — 标签打印（浏览器）](#第-13-节-t6--标签打印浏览器)
- [第 14 节 T7 — 端到端链路验证](#第-14-节-t7--端到端链路验证)
- [第 15 节 验证与提交](#第-15-节-验证与提交)
- [第 16 节 附录](#第-16-节-附录)

---

## 第 0 节 使用说明

### 你的角色

你是 WCIES 项目的实现会话。本任务书由规划会话产出，所有分析已完成，你只需**按任务书实现**。

### 必读顺序

1. `AGENTS.md`（项目根，**硬性规则，不得绕过**）
2. 本文件全文
3. `docs/WCIES_下一阶段规划_Sprint_7_及后续.md`（了解为什么这样做）
4. 各任务指定的业务规则文档

### 允许修改的目录

```text
apps/api/src/modules/purchase/**        新建（本 Sprint 新增模块）
apps/api/src/modules/inventory/**       局部（引用类型、可用量）
apps/api/src/modules/order/**           局部（发货时限字段、采购状态派生）
apps/api/src/modules/product/**         局部（条码补建）
apps/web/src/pages/**                   前端页面
apps/web/src/design-system/**           仅当确需新增共享组件
database/migrations/**                  新增 Migration
tests/integration/**                    集成测试
tests/unit 或就近 *.spec.ts             单元测试
docs/**                                 文档
```

### 禁止事项（违反即任务失败）

1. **禁止直接修改 `inventory_balances`**——所有库存变化必须经 `InventoryService`
   （`AGENTS.md` §10）。采购/收货模块**不得** import 库存 Repository。
2. **禁止跨模块 import 内部实现**（§9）——只能通过对方公开 Service。
3. **禁止新增依赖**（§73）——如确需，先向用户说明理由并获批准。
4. **禁止自行新增业务状态枚举值**（§98）——见第 4 节待确认决策。
5. **禁止自行决定业务规则**（§26）——遇到本文件未覆盖的业务判断，**停下来问用户**。
6. **禁止修改已进入共享环境的 Migration**（§56）——需要修正就新建。
7. **禁止操作生产环境**（§90）。
8. **禁止顺手重构**（§95）——只改完成任务必需的文件。

### 工作方式

- 每个任务完成后**单独提交**（commit message 见第 15 节）。
- 提交前跑第 15 节的验证命令。
- 遇到与文档冲突：**不得静默选择其一，必须指出冲突**。

---

## 第 1 节 环境与启动

### 服务地址

| 服务 | 地址 |
|---|---|
| Web | http://localhost:5173 |
| API | http://localhost:3000 |
| Swagger | http://localhost:3000/api/docs |
| MinIO | http://localhost:9001 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### 常用命令

```bash
# 启动
pnpm dev                    # 同时起 web + api

# 数据库
pnpm db:migrate             # 跑迁移
pnpm db:migration:generate  # 由实体差异生成迁移（仍须人工审阅）
pnpm seed:dev               # 开发种子（管理员）
pnpm seed:sprint1           # Sprint 1 验收数据

# 质量门（提交前必跑）
pnpm lint
pnpm typecheck
pnpm check:arch             # 架构检查（5 条规则）
pnpm check:openapi          # OpenAPI 契约检查
pnpm --filter @wcies/api test        # 单元测试
pnpm build

# 集成测试（必须串行，见下）
npx vitest run --config vitest.config.integration.ts --no-file-parallelism

# OpenAPI 变更后（改了 Controller/DTO 必须做）
pnpm --filter @wcies/api build
pnpm openapi:export
pnpm api-client:generate
pnpm check:openapi
```

### 重要提醒

1. **集成测试必须用 `--no-file-parallelism`**。20 个测试文件中有 3 个共用端口 3111
   （`catalog-levels` / `orders` / `inventory-import`）、6 个共用 Redis DB 8，
   并行会随机 `ECONNRESET`。`--maxWorkers=1` **无效**，必须用 `--no-file-parallelism`。
2. **集成测试库 `wcies_test` 可安全重建**：`npx tsx scripts/ensure-test-db.ts`
   （从迁移 + 种子重建，脚本有环境守卫，拒绝非 test 库）。
3. **`docker exec` 操作 psql 必须带 `-i`**，否则读不到 stdin、静默退出、无任何输出：

```bash
# 正确
docker exec -i wcies-postgres psql -U wcies -d wcies_dev -c "select 1"

# 错误（看起来成功，实际什么都没做）
docker exec wcies-postgres psql -U wcies -d wcies_dev -c "select 1"
```

4. **`git add` 用显式路径**，不要 `git add -A`（会误纳入截图目录等）。

---

## 第 2 节 当前基线

### 代码状态

- 基线提交：`570aab0`
- 工作区：干净
- 最近 Migration 编号：`20260911_007_sku_units_g_mm_and_purchase_url.ts`（共 55 个）
  → **本 Sprint 新 Migration 从 `20260912_001` 开始编号**

### 质量门基线（必须保持或提升）

```text
lint              通过
typecheck         通过（packages + api + web）
check:arch        通过（5 条规则）
check:openapi     通过（137 schemas / 154 responses / 15 required DTOs）
单元测试          133 通过（17 文件）
集成测试          183 通过（20 文件，必须 --no-file-parallelism）
build             通过
```

### 数据库状态（开发库）

| 表 | 行数 | 说明 |
|---|---|---|
| `platform_listings` | 1324 | 用户真实 OZON 商品已同步 |
| `platform_listing_skus` | 1324 | **1323 未映射**、1 已映射 |
| `products` / `skus` | 各 1 | 内部主数据几乎为空 |
| `inventory_balances` | **0** | 无任何库存事实 |
| `orders` | 4 | 全部曾因映射失败进异常 |

**含义**：系统流程骨架完整（订单→拣货→发货→拦截全通，183 条集成测试覆盖），
但**没有真实业务数据流过**。本 Sprint 的目标就是让真实数据能流进来。

### 已知既有问题（不在本 Sprint 范围，但要知道）

1. 集成测试端口/Redis DB 冲突（见第 1 节）。
2. 25 行 `platform_sku_id = "0"` 的历史数据（代码层已加守卫，数据层未清理）。
3. 前端无自动化单测（不引入依赖，`AGENTS.md` §73）。

---

## 第 3 节 已锁定决策（不得重新讨论）

以下决策已在用户对话中确认，**直接实现，不要重新论证**。

| # | 决策 | 用户原话/依据 |
|---|---|---|
| D1 | **入库必须是真实收货动作**，不得用「调整初始库存」代替 | "入库需要先做…而不是通过调整初始库存直接改，这样无法建立库存与实物的关系" |
| D2 | **大部分商品是先售卖、再进货**；核心诉求是管理「有货的商品」 | 同上 |
| D3 | **采购登记必须做**，解决「已采了吗」（重复采购/漏采购） | "系统没有记录已采购，可能会发生重复采购或者未采购" |
| D4 | **供应商不是必填**——一次性网购卖家每次都不同 | "有些商品可能就网购一次，下次还可能还不同的卖家" |
| D5 | **一次性网购用自由文本货源说明**，不进供应商主数据 | 同上（`source_note` 方案） |
| D6 | **采购单与收货单分开**（意图 vs 不可逆的库存事实） | 用户同意推荐方案 |
| D7 | **收货要能扫码入库** | "收货需要扫码入库" |
| D8 | **库区（zone）只是标签**，不建独立实体 | 用户答"方案 A（库区只是标签）" |
| D9 | **库位容量不做自动校验**——商品尺寸差异大，只能人工判断 | "是否只能人工确定？"（用户认可） |
| D10 | **待检（QC_PENDING）不计入可售** | 用户答"修：待检不算可售（推荐）"，**已实现**（提交 `4f38ecd`） |
| D11 | **标签打印本期用浏览器实现**，先跑通主流程 | "条码打印功能先用浏览器实现，先跑主要流程" |
| D12 | **打印子系统（本地代理）本期不做**，只留输出格式约定 | 用户同意，见规划文档 §10.3.1 |
| D13 | **新到货没条码 → 收货时补建条码**（多码已支持） | 规划文档 §10.2 |
| D14 | **SN 用商品自带的**（后端链路已完整），不做 SN 自动生成 | 规划文档 §10.4/§10.5 |

---

## 第 4 节 待确认决策

**执行前必须就以下各项与用户确认**。这些属于业务规则变更（`AGENTS.md` §98），
AI 不得自行决定。每项给出推荐值，用户确认后即可实施。

### Q1：新增库存引用类型

**问题**：收货入库的库存流水当前只能标 `MANUAL`（与手工调整无法区分）。

```typescript
// apps/api/src/modules/inventory/enums/inventory.constants.ts:76
export const INVENTORY_REFERENCE_TYPES = ['MANUAL', 'TEST', 'ORDER', 'IMPORT'] as const;
```

**推荐**：新增 `PURCHASE_RECEIPT`，使流水可按来源对账。

**不加的后果**：收货流水与手工调整无法区分，对账困难。

### Q2：单位成本与移动加权平均

**背景**：`docs/WCIES_跨境电商综合管理系统——总体技术架构设计_V1.md:2509-2520` §86 规定
「采购成本采用移动加权平均，入库时更新成本」；`skus.moving_average_cost` 字段注释写明
「预留字段，恒为 NULL（采购 Sprint 实现）」——**本 Sprint 就是那个采购 Sprint**。

**推荐**：收货单记 `unit_cost`（可空），确认收货时更新 `moving_average_cost`。

**影响**：会改变 SKU 成本语义，必须同步更新
`docs/business-rules/master-data.md`（§4 第 3 条）与 `docs/business-rules/inventory.md`。

### Q3：发货时限预警方式

**背景**：OZON `shipment_date` 已在 `orders.raw_data` 中，但未提取、未展示。

**推荐**：
- 展示（列表/详情显示剩余时间）——**必做**
- 分档标识（已超时 / <24h / <3天 / 正常）——**必做**
- 进异常中心（`ORDER_SHIPMENT_DEADLINE_NEAR`）——**需确认**：
  这是新增异常类型，当前 `EXCEPTION_TYPES` 只有 4 种
  （`apps/api/src/modules/exception/enums/exception.constants.ts:8`）。

### Q4：暂存库位方案（收货后上架）

**背景**：现有规则（见第 5 节 F5）——收货时 `binId` 可省略**仅当该仓没有库位**，
自动用虚拟 `DEFAULT` 位；**已有库位则必须显式指定**。

用户希望「先收货进暂存、之后逐渐上架」。两个选项：

- **A（推荐）**：显式建一个 `STAGING` 库位（按需），收货进它，之后 `MOVE_BIN` 上架。
- **B**：放宽 `resolveDimension` 规则，让已有库位的仓也能用 `DEFAULT`。

推荐 A（不改既有校验语义）。

### Q5：是否本 Sprint 做「批量上架」

`MOVE_BIN` 当前是**单 SKU、单次一对库位**（`MoveBinRequestDto`）。
若需「扫一次移动一批」需新增能力。**推荐本期不做**，用现有单条移动。

### Q6：自建 SN 是否需要

系统**没有 SN 自动生成**能力。若商品自带序列号（IMEI 等）则无需开发；
若要自建 SN 编号，属新增能力。**推荐先确认这类商品占比再决定**。

---

## 第 5 节 事实基线

以下事实**已核实**，执行时无需重新探索。引用格式：`文件:行号`。

### F1 库存核心（不可绕过的边界）

| 事实 | 位置 |
|---|---|
| 收货接口：`POST /inventory/receive`，标注 "future purchase-receipt primitive" | `apps/api/src/modules/inventory/controllers/inventory.controller.ts:140-165` |
| 收货 DTO 与 initialize 同构（`binId` 可选） | `apps/api/src/modules/inventory/dto/inventory.dto.ts:213-246` |
| 库位解析规则（三分支） | `apps/api/src/modules/inventory/services/inventory-dimension.ts:30` |
| 库存引用类型常量 | `apps/api/src/modules/inventory/enums/inventory.constants.ts:76` |
| Reservation 引用类型 | 同上 `:80` |
| 可售量推导（**只有 SELLABLE 计入**） | `apps/api/src/modules/inventory/services/inventory-query.service.ts:32`（`isSellableCondition`）、`:38`（`sellableOf`） |
| 库存变动接口全集 | `apps/api/src/modules/inventory/controllers/inventory.controller.ts`（receive/adjust/move-bin/reservations 系列） |

**关键约束**：`inventory_balances.bin_id` 为 **NOT NULL**——任何库存行必须挂在库位上。

### F2 订单

| 事实 | 位置 |
|---|---|
| 订单行字段（**无任何采购字段**，17 列已核对） | `apps/api/src/modules/order/entities/order-item.entity.ts` |
| 订单号生成（PG sequence `order_no_seq`，`ORD%08d`） | `apps/api/src/modules/order/repositories/order.repository.ts:32-37` |
| 订单履约状态全集 | `apps/api/src/modules/order/enums/order.constants.ts:31`（PENDING/RESERVED/BACKORDERED/PICKED/SHIPPED/RELEASED） |
| ERP 订单状态全集 | 同上 `:15`（含 `BACKORDERED` / `PARTIALLY_BACKORDERED` / `EXCEPTION`） |
| 订单行映射状态 | 同上 `:42`（PENDING/MAPPED/FAILED） |
| 重试分配入口（含 FAILED 行重新解析） | `apps/api/src/modules/order/services/order.service.ts:201`；`order-ingestion.service.ts` 的 `retryFailedMappingItem` |
| 订单状态 tab（前端） | `apps/web/src/pages/orders/OrdersPage.tsx:121-128` |

**重要**：`shipment_date` **已在 `orders.raw_data` 中**（4 单全部有值），
但**没有结构化列**，界面上看不到。T1 要做这件事。

### F3 条码与 SKU

| 事实 | 位置 |
|---|---|
| 一个 SKU 多码（最多一个 `is_primary`，DB 部分唯一索引） | `apps/api/src/modules/product/services/barcode.service.ts` |
| 条码类型 5 种 | `apps/api/src/modules/product/constants/barcode.constants.ts:5`（EAN/GTIN/MANUFACTURER/INTERNAL/OTHER） |
| 生成内部条码 `WCSKU%08d` | `barcode.service.ts:73`（`generateInternal`）；HTTP：`apps/api/src/modules/product/controllers/sku.controller.ts:157`（`POST /skus/:skuId/barcodes/generate-internal`） |
| **按条码查 SKU**（服务层已有，**HTTP 未暴露**） | `barcode.service.ts` 的 `findByBarcode`；调用方见 `picking.service.ts:205`、`interception.service.ts:293` |
| 条码全局唯一 | `database/migrations/20260908_008_create_sku_barcodes.ts:30` |
| 内部条码 PG sequence | `seq_internal_barcode`（决策 0001 记载） |

**T5 需要**：暴露「按条码查 SKU」的 HTTP 接口（拣货/拦截已有服务层方法，收货界面需要）。

### F4 SN（序列号）

| 事实 | 位置 | 结论 |
|---|---|---|
| SKU 开关 | `skus.serial_tracking`（`apps/api/src/modules/product/entities/sku.entity.ts:85`） | ✅ |
| 收货**强制** SN | `apps/api/src/modules/inventory/services/inventory.service.ts:125-157` | SN 商品必须提供与数量**完全一致**的 SN 列表 |
| 拣货**强制**扫 SN | `apps/api/src/modules/picking/services/picking.service.ts:244-257` | 必须匹配该库位已有的 SN |
| 打包/发货 SN | `apps/api/src/modules/shipment/services/packing.service.ts:112`、`shipment-ship.service.ts:176` | ✅ |
| 表结构 | `inventory_serials`（`id/serial_number/sku_id/warehouse_id/bin_id/status/reservation_id/picking_task_item_id/...`） | 已落库 |
| **无 SN 自动生成** | 全仓库无 `generateSerial` 类方法（已搜） | SN 须外部提供 |

### F5 库位与容量

| 事实 | 位置 |
|---|---|
| `warehouse_bins` **无容量字段**（12 列已核对） | `database/migrations/20260908_011_create_warehouse_bins.ts` |
| 库位编码格式（`{仓码}-{货架}-{层}[-{位}]`，货架补零≥2） | 决策 `docs/decisions/0010`、`0011` |
| 库位解析三分支 | `inventory-dimension.ts:30-60` |
| 批量建位（库区+起始架号+数量+层数） | `apps/api/src/modules/warehouse/services/warehouse-bin.service.ts` 的 `batchCreate` |
| 库区筛选 | `GET /warehouses/:id/bins?zone=` 与 `/bins/zones` |
| SKU 尺寸字段（选填） | `skus`：`weight_g` / `length_mm` / `width_mm` / `height_mm` / `volume_mm3` |

### F6 编号与编码

| 事实 | 位置 |
|---|---|
| 集中式序号表 + 取号服务 | `apps/api/src/infrastructure/business-code/business-code.service.ts` |
| 取号 API | `next(scopeKey)` / `nextWarehouseCode(type)` / `nextStoreCode(platform)` / `nextProductCode()` / `nextSkuCode(productId, seq)` |
| scope_key 约定 | `warehouse:{TYPE}` / `store:{PLATFORM}` / `brand` / `category` / `product` / `sku:{productId}`（决策 0001） |
| 订单/包裹用独立 PG sequence | `order_no_seq` → `ORD%08d`；`PKG%08d` |
| 编码规则文档 | `docs/business-rules/master-data.md` §1 |

**T2/T3/T4 需要**：为 `supplier` / `purchase_order` / `purchase_receipt` 新增 scope_key，
并在 `master-data.md` §1 表格登记（**属业务规则，须同步文档**）。

### F7 异常中心

| 事实 | 位置 |
|---|---|
| 异常类型只有 4 种 | `apps/api/src/modules/exception/enums/exception.constants.ts:8`（`ORDER_SKU_MAPPING_FAILED` / `ORDER_OUT_OF_STOCK` / `ORDER_INVALID_STATE` / `ORDER_INTERCEPTION_FAILED`） |
| severity：LOW/MEDIUM/HIGH | 同上 `:17` |
| status：OPEN/RESOLVED/IGNORED，禁止物理删除 | 同上 `:21` |
| 引用类型：ORDER / ORDER_ITEM / ORDER_INTERCEPTION | 同上 `:25` |
| 关闭异常（事务内） | `ExceptionService.resolveByReferenceInTx` |

### F8 同步

| 事实 | 位置 |
|---|---|
| 同步类型只有 2 种 | `apps/api/src/modules/sync/sync.constants.ts:4`（`LISTING_SYNC` / `ORDER_SYNC`） |
| OZON 适配器方法面 | `apps/api/src/modules/integration/ozon/ozon.adapter.ts`：`validateCredential` / `fetchListings` / `fetchOrders` / `processWebhook` / `fetchOrdersByPlatformIds` |
| OZON **只读**，无写操作 | 同上 |
| OZON 映射器（含 `sku: 0` 守卫） | `apps/api/src/modules/integration/ozon/ozon.mapper.ts` |

### F9 OZON 发货时限（T1 的数据来源）

**来源**：`docs/ozon-seller-openapi.json`（官方规范，已在仓库）。

```json
"shipment_date": {
  "type": "string", "format": "date-time",
  "description": "Дата и время, до которой необходимо собрать отправление.
                  ... По истечении этого времени начнёт применяться новый тариф"
}
```

> 译：**必须在此时间前完成拣货发货。超时后开始适用新费率**（`tariffication`）。

**已在数据中**：4 单全部有 `raw_data->>'shipment_date'`。实测剩余时间：

```
ORD00000001   5 小时 31 分   ← 最紧急
ORD00000002   2 天 5 小时
ORD00000003   3 天 7 小时
ORD00000004   5 天 5 小时
```

**这是平台事实字段，不是 ERP 状态**——不得与 `erpStatus` 混淆（`AGENTS.md` §38）。

### F10 Excel 导入（可复用）

| 类型 | 用途 | 位置 |
|---|---|---|
| `SKU` | SKU 建档（可同时创建 Product） | `apps/api/src/modules/import/handlers/sku-import.handler.ts:45` |
| `LISTING_MAPPING` | 映射导入（**已受决策 0012 约束**：必须至少一个平台标识） | `apps/api/src/modules/import/handlers/listing-mapping-import.handler.ts:34` |
| `INITIAL_INVENTORY` | 初始库存 | `apps/api/src/modules/import/handlers/initial-inventory-import.handler.ts:35` |
| `BARCODE` / `WAREHOUSE` / `BIN` | 主数据 | `apps/api/src/modules/import/handlers/master-data-import.handlers.ts:25/135/244` |

**处理契约**：`apps/api/src/modules/import/handlers/import-handler.ts`（`validate` + `importRow`）。
错误必须带 row/field/code。前端入口：`apps/web/src/pages/import/ImportPage.tsx`。

### F11 前端约定

| 事实 | 位置 |
|---|---|
| 设计系统组件 | `apps/web/src/design-system/`（PageHeader / FilterBar / DataTable / StatusBadge / PlatformTag / MetricCard / SectionCard / InfoGrid / ContextRail / EntitySummary / ActionMenu / EmptyState / DeleteConfirmModal） |
| API 调用 | `apps/web/src/api/hooks.ts`（`useApiQuery` / `apiPost` / `apiPatch` / `apiDelete`）；**禁止手写 fetch**（§72） |
| 校验错误已透出字段名 | `hooks.ts` 的 `describeValidationErrors`（2026-09-11 修复） |
| 路由注册 | `apps/web/src/app/App.tsx`；菜单 `apps/web/src/app/AppLayout.tsx` |
| 订单页 tab | `OrdersPage.tsx:121-128` |

---

## 第 6 节 任务分解与依赖

```text
T0 文档先行（阻塞 T1–T6，因为要改业务规则文档）
 │
 ├─> T1 平台发货时限          （独立，无 Migration 依赖）
 │
 ├─> T2 供应商与货源          （Migration）
 │     │
 │     └─> T3 采购登记单      （Migration，依赖 T2 的 supplier 表可空引用）
 │           │
 │           └─> T4 收货入库单（Migration，依赖 T3 的 purchase_order 关联）
 │                 │
 │                 └─> T5 收货作业支持（依赖 T4 的收货界面）
 │
 └─> T6 标签打印（浏览器）    （独立，但建议在 T5 之后，因共用 SKU 选择交互）
       │
       └─> T7 端到端链路验证  （依赖全部）
```

### 分配建议（可单会话串行，也可并行）

- **单会话串行**：按 T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 顺序做。
- **双会话并行**：会话 A 做 T1 + T6（独立），会话 B 做 T0 → T2 → T3 → T4 → T5。
  **但 T0 必须由 B 先完成**（文档改动会被 A 用到）。

### 任务规模估算

| 任务 | Migration | 后端 | 前端 | 测试 |
|---|---|---|---|---|
| T0 | 无 | 无 | 无 | 无 |
| T1 | 1 个（orders 加列） | 中 | 中 | 中 |
| T2 | 1 个（suppliers） | 小 | 小 | 小 |
| T3 | 1 个（purchase_orders ×2 表） | 大 | 大 | 中 |
| T4 | 1 个（purchase_receipts ×2 表） | 大 | 大 | 中 |
| T5 | 无 | 小 | 中 | 小 |
| T6 | 无 | 无 | 中 | 小 |
| T7 | 无 | 无 | 无 | 大（集成测试） |

---

## 第 7 节 T0 — 文档先行（阻塞其他任务）

**为什么先做**：本 Sprint 会改变多处业务规则，`AGENTS.md` §86 要求业务规则文档与
代码同步修改。先改文档可避免实现后补文档时的遗漏。

### 产出物

1. **`docs/decisions/0013-采购与收货单据分离.md`**（新建）

   内容要点：
   - 背景：用户「先售后采」业务模式，系统无采购登记导致重复/漏采购
   - 决策：采购单（意图，可取消）与收货单（不可逆库存事实）分离
   - 理由：生命周期不同；与 Order / Shipment 分离同理（`AGENTS.md` §37）
   - 影响：新增两张单据；订单行采购状态**派生**而非落库（`AGENTS.md` §13）

2. **`docs/business-rules/purchase.md`**（新建）

   参照 `docs/business-rules/inventory.md` 的结构。至少包含：
   - 供应商（可空）、货源说明（可空）语义
   - 采购单状态机：`ORDERED → PARTIALLY_RECEIVED → RECEIVED` / `CANCELLED`
   - 收货单状态机：`DRAFT → RECEIVED` / `CANCELLED`
   - **订单行采购状态派生规则**（待采购 / 已采购 / 已到货）
   - 防重复采购规则
   - 收货确认的事务要求（整单原子）
   - 编号规则（沿用集中式序号表）

3. **`docs/business-rules/master-data.md`** 追加编码规则

   在 §1 的编码表格中新增三行：供应商 `SUP%04d`、采购单 `PO%06d`、收货单 `PR%06d`
   （**具体格式待用户确认后再定稿**，见 Q1/第 4 节）。

4. **`docs/business-rules/orders.md`** 追加

   - 平台发货时限字段语义（**平台事实，非 ERP 状态**）
   - 订单行采购状态派生规则（与 `purchase.md` 呼应，避免重复——建议在此处只写引用）

5. **`CONTEXT.md`** 术语表追加

   | 中文 | 英文 | 说明 |
   |---|---|---|
   | 供应商 | Supplier | 可复用的货源主数据 |
   | 货源说明 | Source Note | 一次性采购的来源备注 |
   | 采购单 | Purchase Order | 采购意图登记 |
   | 收货单 | Purchase Receipt | 收货入库的业务凭证 |
   | 发货时限 | Shipment Deadline | 平台要求的发货截止时间 |

### 验收

- 文档已提交（单独 commit）
- 后续任务的实现与该文档**逐条对应**，不得出现文档与代码不一致

---

## 第 8 节 T1 — 平台发货时限

**目标**：把已在 `orders.raw_data` 中的 `shipment_date` 变成结构化字段并在界面可见。

### T1.1 Migration

新建 `database/migrations/20260912_001_add_order_shipment_deadline.ts`：

```sql
ALTER TABLE orders ADD COLUMN shipment_deadline timestamptz NULL;
```

**注意**：
- 字段名用 `shipment_deadline`（与 OZON 的 `shipment_date` 区分，
  前者是我们的语义命名，后者是平台字段名）。
- **必须保留 `raw_data`**（`AGENTS.md` §34）。结构化列是**补充**，不是替代。
- Entity 同步修改（`apps/api/src/modules/order/entities/order.entity.ts`），
  `AGENTS.md` §55 要求 Entity + Migration 同时提交。

### T1.2 映射器提取

**改动点**：`apps/api/src/modules/integration/ozon/ozon.mapper.ts`

`mapPostingToOrder` 增加 `shipmentDeadline` 输出：

```typescript
// 伪代码示意，实现时按现有 malformed() 风格做校验
const shipmentDeadline = parseIsoDate(posting.shipment_date, 'posting.shipment_date');
```

**注意**：
- `shipment_date` 在官方规范中**不标注 required**——**缺失或非法时置 NULL，不要抛错**
  （一个字段缺失不该让整单同步失败，见 `AGENTS.md` §49「单条异常不得无必要阻塞整批」）。
- 现有 `parseIsoDate` 遇到非法值会抛错，T1 需要**容错版本**或 try/catch 后置 NULL。
- 详细事实见第 5 节 F9。

### T1.3 摄入落库

**改动点**：`apps/api/src/modules/order/services/order-ingestion.service.ts`、
`apps/api/src/modules/order/repositories/order.repository.ts`、
`apps/api/src/modules/order/dto/order.dto.ts`

- 摄入时写入 `shipment_deadline`。
- DTO（列表/详情）增加 `shipmentDeadline` 字段。

### T1.4 前端展示

**改动点**：`apps/web/src/pages/orders/OrdersPage.tsx`

1. 订单列表增加「时限」列 / 或在现有列中以分档样式呈现。
2. 详情抽屉显示精确时间 + 剩余时间。
3. 右栏（context rail）显示剩余时间。

**分档规则**（按 Q3 确认后实现）：

| 分档 | 判定 | 呈现 |
|---|---|---|
| 已超时 | `deadline < now()` | 红色 + "已超时" |
| 紧急 | `< 24h` | 红色 |
| 临近 | `< 3 天` | 橙色 |
| 正常 | 其余 | 中性 |

**若用户确认 Q3 的异常类型**：新增后台检查（定时任务或同步时检查），
在临近超时时创建异常（**需先确认，见 Q3**）。

### T1.5 测试

- **单元测试**：`ozon.mapper.spec.ts` 增加
  - 正常 `shipment_date` → 正确解析
  - 缺失 `shipment_date` → `shipmentDeadline = null`（不抛错）
  - 非法格式 → `null`（不抛错）
- **集成测试**：`tests/integration/orders.integration.spec.ts` 增加
  - 摄入带时限的订单 → 列表/详情返回该字段

### T1.6 验收

- 订单页能看到剩余时间，且分档颜色正确
- `raw_data` 仍完整保留 `shipment_date`（回归验证）
- Migration up/down 均可执行

---

## 第 9 节 T2 — 供应商与货源（轻量）

**目标**：提供「可复用供应商」主数据；一次性采购用自由文本，不进主数据。

### T2.1 Migration

新建 `database/migrations/20260912_002_create_suppliers.ts`：

```sql
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(50) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  contact_name varchar(100) NULL,
  contact_phone varchar(100) NULL,
  status varchar(30) NOT NULL DEFAULT 'ACTIVE',
  remark text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**注意**：
- 编码用集中式序号表（新增 scope `supplier`），**不要**用 PG sequence
  （理由见决策 0001：动态作用域才用表；但供应商是单一作用域，
  也可用 PG sequence——**参照现有 brand/category 的做法**，
  `business-code.service.ts` 的 `nextBrandCode` 用的是 `next(scope)`）。
- 无删除标记：删除策略沿用**零引用才可物理删除**（决策 0003）。

### T2.2 后端

新建 `apps/api/src/modules/purchase/`（**本 Sprint 新建模块**）：

```text
apps/api/src/modules/purchase/
├── purchase.module.ts
├── controllers/
│   └── supplier.controller.ts
├── services/
│   └── supplier.service.ts
├── repositories/
│   └── supplier.repository.ts
├── entities/
│   └── supplier.entity.ts
├── dto/
│   └── supplier.dto.ts
└── errors/
    └── purchase-errors.ts
```

**接口**（沿用现有主数据 CRUD 模式，参照 `warehouse` 模块）：

```text
GET    /suppliers              列表（分页 + keyword/status 筛选）
POST   /suppliers              创建（code 可留空自动生成）
GET    /suppliers/:id          详情
PATCH  /suppliers/:id          更新
POST   /suppliers/:id/activate   启用
POST   /suppliers/:id/deactivate 停用
DELETE /suppliers/:id          删除（零引用校验，参照决策 0003）
```

**注册**：`apps/api/src/app.module.ts` 的 `imports` 加入 `PurchaseModule`。

**编码**：`BusinessCodeService` 增加 scope 常量与 `nextSupplierCode()`，
并在 `docs/business-rules/master-data.md` §1 登记。

### T2.3 前端

- 新建页面 `apps/web/src/pages/purchase/SuppliersPage.tsx`
- 路由 `apps/web/src/app/App.tsx`：`/suppliers`
- 菜单 `apps/web/src/app/AppLayout.tsx`：新建「采购」一级菜单（见 Q/决策 7 推荐 A）
- 使用设计系统组件（`PageHeader` / `FilterBar` / `DataTable` / `ActionMenu` / `DeleteConfirmModal`）

### T2.4 测试

- 集成测试：供应商 CRUD + 编码自动生成 + 零引用删除 + 被引用时拒绝删除

### T2.5 验收

- 可在界面维护供应商
- 删除被引用的供应商被拒（返回明确错误码）

---

## 第 10 节 T3 — 采购登记单（核心）

**目标**：登记「已采购」，消除重复采购/漏采购。**这是用户最直接的痛点。**

### T3.1 Migration

新建 `database/migrations/20260912_003_create_purchase_orders.ts`：

```sql
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_no varchar(50) NOT NULL UNIQUE,
  supplier_id uuid NULL REFERENCES suppliers(id),
  source_note varchar(500) NULL,          -- 一次性网购的来源说明
  status varchar(30) NOT NULL DEFAULT 'ORDERED',
  ordered_at timestamptz NOT NULL DEFAULT now(),
  expected_at timestamptz NULL,
  remark text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES skus(id),
  order_item_id uuid NULL REFERENCES order_items(id),  -- 为哪张订单采购（可空）
  quantity numeric(18,3) NOT NULL,
  unit_cost numeric(18,4) NULL,
  received_quantity numeric(18,3) NOT NULL DEFAULT 0,
  remark text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**约束与注意**：
- `status` 取值：`ORDERED` / `PARTIALLY_RECEIVED` / `RECEIVED` / `CANCELLED`
  （**新增业务状态，须在 T0 文档中定义并经用户确认**）。
- `order_item_id` **可空**（决策 8：支持备货采购）。
- `quantity` 用 `numeric(18,3)`（与库存数量精度一致，`AGENTS.md` §58 金额用 NUMERIC）。
- `unit_cost` 用 `numeric(18,4)`（与 `latest_purchase_price` 精度一致）。

### T3.2 业务服务

新建 `purchase-order.service.ts`。核心方法：

```typescript
create(dto, operator)                    // 创建采购单（含明细）
update(id, dto, operator)                // 仅 ORDERED 状态可改
cancel(id, operator)                     // 仅未收货可取消
list(filters, page)                      // 列表
getDetail(id)                            // 详情含明细
listPendingForOrderItems(orderItemIds)   // 派生采购状态用（见 T3.3）
```

**关键约束**：

1. **防重复采购**（用户点名的风险）：创建明细时，若该 `order_item_id` 已存在
   **未取消**的采购单明细，**拒绝**并返回冲突错误：
   ```text
   错误码：PURCHASE_ORDER_ITEM_ALREADY_ORDERED
   消息：该订单行已于 <时间> 登记采购（<PO号>）
   ```
2. 整单创建在**一个事务**内（表头 + 明细）。
3. 已 `RECEIVED` 的采购单不可取消、不可改数量。

### T3.3 订单行采购状态（**派生，不落库**）

**这是本 Sprint 的关键设计**。在 `order` 模块（或 purchase 模块提供的只读服务）实现派生：

```typescript
// 派生规则（AGENTS.md §13：派生值不得成为第二事实源）
type ProcurementState = 'NOT_ORDERED' | 'ORDERED' | 'ARRIVED';

// NOT_ORDERED：该订单行没有关联的未取消采购单
// ORDERED    ：有关联采购单，且所有关联明细的 received_quantity < quantity
// ARRIVED    ：有关联采购单，且 received_quantity >= quantity
```

**实现位置建议**：`purchase` 模块暴露只读查询服务
`PurchaseOrderService.getProcurementStatesByOrderItemIds(ids)`，
`order` 模块通过它组装响应。**order 不得 import purchase 的 Repository**（§9）。

**集成点**：订单列表/详情的 `OrderItemDto` 增加 `procurementState` 字段。

### T3.4 「待采购」视图

**这是用户每天要看的列表**：

```text
订单列表筛选：fulfillmentStatus = BACKORDERED 且 procurementState = NOT_ORDERED
```

- 后端：订单列表查询增加对应筛选参数
- 前端：`OrdersPage.tsx` 增加筛选器 / 或在订单页加一个快捷入口

### T3.5 前端

- 页面 `apps/web/src/pages/purchase/PurchaseOrdersPage.tsx`
- 订单详情：「登记采购」按钮（预填 SKU + 数量 + 当前 `order_item_id`）
- 采购单列表：筛选（状态/供应商/日期/关联订单）

### T3.6 测试

集成测试（`tests/integration/purchase.integration.spec.ts`，新建）：

1. 创建采购单 → 订单行派生状态变为 `ORDERED`
2. 重复为同一订单行登记 → **被拒**（`PURCHASE_ORDER_ITEM_ALREADY_ORDERED`）
3. 取消采购单 → 派生状态回到 `NOT_ORDERED`
4. 备货采购（无 `order_item_id`）不报错
5. 「待采购」筛选只返回 `BACKORDERED` + `NOT_ORDERED` 的行

### T3.7 验收

- 可为缺货订单行登记采购，状态立即反映
- 重复登记被拦（这是用户点名的风险）

---

## 第 11 节 T4 — 收货入库单（核心）

**目标**：真实收货动作，产生库存事实，并建立「库存与实物来源」的关系。

### T4.1 Migration

新建 `database/migrations/20260912_004_create_purchase_receipts.ts`：

```sql
CREATE TABLE purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no varchar(50) NOT NULL UNIQUE,
  purchase_order_id uuid NULL REFERENCES purchase_orders(id),
  supplier_id uuid NULL REFERENCES suppliers(id),
  source_note varchar(500) NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status varchar(30) NOT NULL DEFAULT 'DRAFT',
  received_at timestamptz NULL,
  remark text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id uuid NULL REFERENCES purchase_order_items(id),
  sku_id uuid NOT NULL REFERENCES skus(id),
  quantity numeric(18,3) NOT NULL,
  unit_cost numeric(18,4) NULL,
  bin_id uuid NULL REFERENCES warehouse_bins(id),
  remark text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### T4.2 确认收货（**本任务的核心逻辑**）

```typescript
async confirm(receiptId, operator) {
  // 1. 校验：状态必须为 DRAFT
  // 2. 校验：仓库存在、明细非空、数量 > 0
  // 3. 一个数据库事务内：
  //    for (const item of items) {
  //      await this.inventoryService.receiveStock({
  //        skuId, warehouseId, binId, quantity,
  //        condition: 'SELLABLE',
  //        referenceType: 'PURCHASE_RECEIPT',   // ← 需 Q1 确认
  //        referenceId: receiptId,
  //        idempotencyKey: `PURCHASE_RECEIPT:${receiptId}:${item.id}`,
  //        operator,
  //      });
  //      // 累加 purchase_order_items.received_quantity（若有来源采购明细）
  //    }
  // 4. 更新收货单状态为 RECEIVED、received_at
  // 5. 重算来源采购单状态（ORDERED → PARTIALLY_RECEIVED → RECEIVED）
  // 6. 记 Operation Log
}
```

**硬性约束**：

1. **必须调用 `InventoryService.receiveStock()`**，禁止直接改 `inventory_balances`
   （`AGENTS.md` §10；架构文档 `工程架构与_Monorepo_目录设计_V1.md:1004-1008` 明令）。
2. **整单一个事务**，任一行失败全部回滚。
3. **幂等**：`idempotencyKey = PURCHASE_RECEIPT:<receiptId>:<itemId>`。
4. `DRAFT` 可改明细；`RECEIVED` 后**不可改数量**（库存已入账，修正走库存调整）。
5. **SN 商品**：若 `sku.serial_tracking = true`，必须提供与数量一致的 SN 列表
   （库存层已强制，见第 5 节 F4；收货界面需支持录入 SN）。
6. **库位解析**：`bin_id` 可空时走 `resolveDimension` 的既有规则（第 5 节 F5）；
   若要支持暂存，见 Q4。

### T4.3 移动平均成本（**需 Q2 确认**）

若用户确认：
- 确认收货时，按 `(原库存成本 × 原数量 + 本次成本 × 本次数量) / 新数量` 更新
  `skus.moving_average_cost`。
- **未收货不得提前改变成本**（架构文档 §86）。
- 需同步更新 `docs/business-rules/master-data.md` §4。

### T4.4 前端

- 页面 `apps/web/src/pages/purchase/PurchaseReceiptsPage.tsx`
- 新建收货单：选仓库（+ 可选来源采购单/供应商）→ 加明细（SKU + 数量 + 成本 + 库位）
- **从采购单生成收货单**：一键预填（降低操作负担，见决策 6 的说明）
- **确认前预览**：本次将入库哪些 SKU、各多少、入到哪个库位

### T4.5 测试

集成测试（`tests/integration/purchase-receipt.integration.spec.ts`，新建）：

1. 创建收货单 → 确认 → `inventory_balances.on_hand` 正确增加
2. `inventory_transactions` 有流水，`reference_type = 'PURCHASE_RECEIPT'`，
   `reference_id = receiptId`（**验证 §14：任何库存变动必须有流水**）
3. 重复确认同一收货单 → 幂等（不重复入账）
4. 明细某行失败 → **整单回滚**（断言库存无变化）
5. 分批到货：一张采购单对应两张收货单 → `received_quantity` 累加、
   采购单状态 `PARTIALLY_RECEIVED` → `RECEIVED`
6. **SN 商品**：缺 SN 被拒；SN 数量不符被拒；SN 正确则入库成功
7. `RECEIVED` 后改数量被拒

### T4.6 验收

- 收货能真正产生库存（不是账目调整）
- 流水可追溯到收货单（这是「库存与实物关系」的技术落点）

---

## 第 12 节 T5 — 收货作业支持

**目标**：让收货能扫码、能处理「新货没条码」、能选/建库位。

### T5.1 暴露「按条码查 SKU」接口

**现状**：`barcode.service.ts` 的 `findByBarcode` 已存在，拣货/拦截在用；
但**没有 HTTP 接口**供收货界面调用（第 5 节 F3）。

**实现**：

```text
GET /barcodes/:barcode/resolve
→ { skuId, skuCode, skuName, matchedBarcode, barcodeType } | 404
```

**注意**：条码全局唯一（`AGENTS.md` / 迁移 `20260908_008:30`），
所以此查询**无需 storeId**（与 Listing Resolver 不同，后者必须 store-scoped §26）。
**这一点要在代码注释里写明**，避免后来者误加 store 维度。

### T5.2 收货界面扫码

**交互**：

```text
扫码框输入条码
  ├─ 命中 → 加入明细（SKU + 数量 1，可继续扫）
  └─ 未命中 → 提示「该条码未绑定任何 SKU」+ 提供绑定入口（T5.3）
```

### T5.3 当场补建条码（决策 D13）

**交互**：扫码未命中时，弹窗让用户选择：

```text
[ 绑定到当前 SKU ]  → 输入/选择 SKU → 调 POST /skus/:skuId/barcodes
[ 生成内部条码 ]    → 调 POST /skus/:skuId/barcodes/generate-internal
                      → 得到 WCSKU%08d
```

**注意**：一个 SKU 可有多码，**不要覆盖或替换**已有条码（第 5 节 F3）。

### T5.4 暂存库位（**需 Q4 确认**）

若用户选 A（推荐）：提供一个「暂存库位」选择/创建入口。
若选 B：需放宽 `resolveDimension`（`inventory-dimension.ts:30`）的规则——**改动更大，不推荐**。

### T5.5 库位现状显示（决策 D9）

**不做容量校验**。但明细录入选择库位时，**显示该库位当前已有的 SKU 与数量**，
供人工判断放不放得下。

**数据来源**：`GET /inventory?binId=<id>`（已存在，第 5 节 F1）。

### T5.6 测试

- 集成测试：按条码解析 SKU（命中/未命中）
- 集成测试：补建条码后可被解析
- 手工验证：扫码 → 加入明细 → 确认收货全流程

---

## 第 13 节 T6 — 标签打印（浏览器）

**范围**：**只用浏览器打印**（决策 D11）。不做本地打印代理（D12）。

### T6.1 条码标签（Code128）

**产出**：能打印内部条码 `WCSKU%08d`（或任意 SKU 条码）的标签。

**硬性约束**：
- **条码规格必须 Code128**——决策 `docs/decisions/0007-扫码载体选型Code128.md`。
  内部条码含字母，**不能用 EAN-13**。
- **不引入新依赖**（§73）。浏览器生成 Code128 需绘制方案：
  - 方案 A：用 SVG 手写 Code128 编码（无依赖，实现量中等）
  - 方案 B：Canvas 绘制（同上）
  - **若考虑引入条码库（如 JsBarcode），必须先向用户申请**（§73）
- 打印方式：新窗口 + `window.print()`（CSS `@media print` 控制排版）

### T6.2 面单复用

现有面单流程已可用（上传 PDF → 签名 URL → 浏览器打开打印，
`shipping-label.service.ts`）。**本期不需要改**，但建议：

- 在打包/发货页提供「批量打印面单」入口（多个 PDF 合并或逐个打开）

**注意**：OZON 官方面单接口（`/v2/posting/fbs/package-label`）属**平台写/读操作**，
**不在本期范围**（本 Sprint 所有平台交互仍为只读，见第 4 节 Q3 与规划文档 §4）。

### T6.3 输出格式约定（为将来打印代理准备）

**产出**：在设计上把「打印」抽象成一个**输出契约**，将来接本地代理时改动最小。

建议定义（写在 `docs/` 或代码注释中）：

```text
打印任务 = {
  type: 'SKU_LABEL' | 'BIN_LABEL' | 'SHIPPING_LABEL',
  payload: 该类型的结构化数据（条码值 / 面单 URL）,
  copies: number
}
```

**本期只实现浏览器消费该结构**，不实现代理。

### T6.4 测试

- 单元测试：Code128 编码正确性（若自行实现编码逻辑）
- 手工验证：打印预览、实际打印、**扫码枪能扫出正确值**（关键验收）

### T6.5 验收

- 能打印出可被扫码枪识别的 SKU 条码标签
- 面单可打印（已有能力，回归验证）

---

## 第 14 节 T7 — 端到端链路验证

**这是用户明确要求验证的链路**。必须写成**集成测试** + **手工验收脚本**。

### 链路 A：备货销售（先有货）

```text
1. 建立 Product + SKU
2. 建立平台映射（既有「人工映射」入口）
3. 建收货单 → 确认收货
       ↓ 断言 inventory_balances.on_hand = N
       ↓ 断言 inventory_transactions 有流水，reference = 该收货单
4. 订单进来 → 占用库存
       ↓ 断言 reservation RESERVED、available 减少、deadline 可见
5. 拣货 → 扫码
       ↓ 断言 Reserved → Picked
6. 发货
       ↓ 断言 On Hand 减少、订单行 SHIPPED
```

### 链路 B：先售后采（**用户的主营模式，重点验收**）

```text
1. 订单进来，库存为 0
       ↓ 断言 行 BACKORDERED + ORDER_OUT_OF_STOCK 异常
       ↓ 断言 procurementState = NOT_ORDERED
2. 「登记采购」→ 生成采购单（关联该订单行）
       ↓ 断言 procurementState = ORDERED
       ↓ 断言 重复登记被拒（防重复采购）
3. 货到 → 从采购单生成收货单 → 确认收货
       ↓ 断言 inventory_balances.on_hand = N
       ↓ 断言 采购单 received_quantity 累加、状态 → RECEIVED
       ↓ 断言 procurementState = ARRIVED
4. 重试分配（`POST /orders/items/:id/retry-allocation`）
       ↓ 断言 RESERVED
5. 拣货 → 发货（同链路 A）
```

**注意**：链路 A 的第 4–6 步代码已存在且有测试覆盖；本 Sprint 要验证的是
**「采购/收货产生的库存能被订单正常消费」**这条衔接——特别是
库存落在哪个库位、拣货扫码能否找到、可用量计算是否正确。

### 落地位置

新建 `tests/integration/purchase-e2e.integration.spec.ts`。

---

## 第 15 节 验证与提交

### 每个任务完成后

```bash
pnpm lint
pnpm typecheck
pnpm check:arch
pnpm --filter @wcies/api test
```

改了 Controller/DTO 的还要：

```bash
pnpm --filter @wcies/api build
pnpm openapi:export
pnpm api-client:generate
pnpm check:openapi
```

### 涉及库存/订单的改动

```bash
npx vitest run --config vitest.config.integration.ts --no-file-parallelism
```

**必须用 `--no-file-parallelism`**（`--maxWorkers=1` 无效，见第 1 节）。

### 全部完成后

```bash
pnpm lint && pnpm typecheck && pnpm check:arch && pnpm check:openapi
pnpm --filter @wcies/api test
npx vitest run --config vitest.config.integration.ts --no-file-parallelism
pnpm build
```

### 提交规范

每个任务**单独提交**，格式：

```text
feat(api-purchase): add supplier master data

<说明为什么，不是做了什么>

Verified: <验证方式与结果>
```

commit type 约定：`feat` / `fix` / `docs` / `test` / `refactor`。
scope 用模块名（`api-purchase` / `web-purchase` / `api-order` / `web-orders`）。

**提交前检查**（`AGENTS.md` §100）：

- [ ] 是否只改了必要范围？
- [ ] 是否违反模块边界（跨模块 import 内部实现）？
- [ ] 是否有 Migration 遗漏？
- [ ] 是否绕过 `InventoryService` 改库存？
- [ ] 幂等是否覆盖（外部事件 / 库存动作）？
- [ ] 是否泄露 Secret？
- [ ] 错误码是否明确？
- [ ] 测试是否覆盖核心规则？
- [ ] 业务规则文档是否同步？
- [ ] lint / typecheck / test 是否通过？

### GUI 验收

前端改动需**实际在浏览器验证**，并要求**Console 0 error**。
关键交互（扫码、确认收货、防重复登记）必须手工走一遍。

---

## 第 16 节 附录

### A. 已知坑

1. **`docker exec` 必须带 `-i`**，否则静默无输出（第 1 节）。
2. **集成测试必须 `--no-file-parallelism`**，`--maxWorkers=1` 无效。
3. **`git add` 用显式路径**，不要 `-A`（会误纳入截图目录）。
4. **prettier 重排会使行号偏移**——本文件的 `file:line` 引用基于提交 `570aab0`，
   若中途格式化过，行号可能偏移，以符号名搜索为准。
5. **antd v6 弃用项**：`Drawer width`→`size`、`Space direction`→`orientation`、
   `Alert message`→`title`。
6. **前端 React Query 失效需共享 queryKey 前缀**。
7. **批量建位不要改回区间输入**——已是「库区 + 起始架号 + 数量 + 层数」，
   服务端生成编码（决策 `0010`/`0011`）。
8. **映射必须至少一个平台标识**——决策 `0012`，
   `LISTING_SKU_MAPPING_IDENTIFIER_REQUIRED`。导入路径同样受限。
9. **可售量只由 SELLABLE 推导**——提交 `4f38ecd`，
   三处（列表/库位明细/SKU 汇总）共用 `isSellableCondition` + `sellableOf`，
   新增查询路径**必须复用**，不要另算。

### B. 关键错误码（本 Sprint 新增）

| 错误码 | 场景 |
|---|---|
| `PURCHASE_ORDER_ITEM_ALREADY_ORDERED` | 同一订单行重复登记采购 |
| `PURCHASE_ORDER_INVALID_STATE` | 采购单状态不允许该操作 |
| `PURCHASE_RECEIPT_INVALID_STATE` | 收货单状态不允许该操作 |
| `SUPPLIER_IN_USE` | 供应商被引用，不可删除 |
| `PURCHASE_RECEIPT_EMPTY` | 收货单无明细 |
| （待 Q1 确认）`INVENTORY_REFERENCE_TYPES` 新增值 | `PURCHASE_RECEIPT` |

**错误格式必须沿用统一信封**（`AGENTS.md` §66）：

```json
{ "success": false, "error": { "code": "...", "message": "...", "details": {} }, "requestId": "..." }
```

### C. 参考文档索引

| 内容 | 路径 |
|---|---|
| 开发纪律（必读） | `AGENTS.md` |
| 规划依据（含完整分析） | `docs/WCIES_下一阶段规划_Sprint_7_及后续.md` |
| 第一阶段目标链路 | `docs/WCIES_跨境电商综合管理系统——总体技术架构设计_V1.md:2580-2620` §87 |
| 采购模块职责与边界 | `docs/WCIES_工程架构与_Monorepo_目录设计_V1.md:985-1008` §31 |
| 采购成本规则 | 同上 `:2509-2520` §86 |
| 库存业务规则 | `docs/business-rules/inventory.md`（§5.1 为可售量实现约束） |
| 订单业务规则 | `docs/business-rules/orders.md` |
| 主数据与编码 | `docs/business-rules/master-data.md` §1 |
| 决策记录 | `docs/decisions/0001`–`0012` |
| OZON 集成事实 | `docs/integrations/ozon.md` |
| OZON 官方规范 | `docs/ozon-seller-openapi.json` |
| 扫码载体选型 | `docs/decisions/0007-扫码载体选型Code128.md` |
| 术语表 | `CONTEXT.md` |
| 既有 Sprint 任务书（格式参考） | `WCIES_Agent_Task_—_Sprint_6_手工测试修复.md` |

### D. 本 Sprint 明确不做

1. **不做初始库存导入作为入库手段**（用户已否决，D1）。
2. **不做渠道库存推送 / Allocator**（Sprint 10）。
3. **不做真实平台写操作**（推库存/发货/调价）——本 Sprint 平台交互仍只读。
4. **不做本地打印代理**（D12），只留输出格式约定。
5. **不做 SN 自动生成**（D14）——用商品自带 SN。
6. **不做批量上架**（Q5 推荐不做）。
7. **不做库位容量自动校验**（D9）。
8. **不做全量 1323 条批量建档**——用户当前只关心有货商品。
9. **不清理 25 行 `platform_sku_id = "0"`** 历史数据（代码守卫已加）。

### E. 完成标准

本 Sprint 完成的定义：

1. 第 7–14 节所有任务实现并通过各自验收
2. 第 15 节全部质量门通过（lint / typecheck / arch / openapi / 单测 / 集成 / build）
3. 链路 A 与链路 B 的集成测试全绿
4. GUI 手工验证通过，Console 0 error
5. 业务规则文档与代码一致
6. 每个任务独立提交，工作区干净
7. 向用户报告：完成项、未完成项（含原因）、发现的新问题
