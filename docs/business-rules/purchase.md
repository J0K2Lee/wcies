# WCIES Purchase Business Rules（Sprint 7）

> 本文档定义 WCIES 采购领域的业务事实、状态与合法变化（Sprint 7 固化）。
>
> 所有涉及采购/收货的代码修改，必须以本文档为准。
>
> 规则来源：Sprint 7 任务书、决策 `docs/decisions/0013`、用户 2026-09-12 确认
> （Q1 引用类型 / Q2 移动平均 / Q4 暂存方案 A）；用户 2026-09-17 人工测试建议
> （#6 人工指定采购时间 / #10 创建时可选生成收货草稿及取消联动）。

---

# 1. 核心原则

采购域回答两个不同的问题：

```text
采购单（Purchase Order）   → 买了吗？（意图，可取消，不碰库存）
收货单（Purchase Receipt） → 货到了吗？（不可逆库存事实）
```

两者是不同单据、不同生命周期（决策 0013）。禁止把两者合并成一张单据，
禁止用采购单直接产生库存变化。

---

# 2. 供应商与货源

1. **供应商（Supplier）可空**。仅可复用的固定供应商进 `suppliers` 主数据
   （编码 `SUP%04d`，集中式序号表单作用域 `supplier`）。
2. **货源说明（source_note）可空**。一次性网购（淘宝/1688 单次下单）在
   采购单/收货单的 `source_note` 写一行自由文本（≤500 字符），**不进主数据**。
3. 两者都可空；UI 二选一引导，全空提示但不阻断（决策 0013 §3）。
4. 供应商状态 `ACTIVE / INACTIVE`；删除沿用**零引用才可物理删除**
   （决策 0003）：被采购单或收货单引用 → `SUPPLIER_IN_USE`（409）。
5. 供应商停用只是不可再被新单引用，历史单据引用保留。

---

# 3. 采购单（Purchase Order）

## 3.1 数据要素

```text
po_no                  业务编号 PO%06d（集中式序号表，作用域 purchase_order）
receiving_warehouse_id 目标仓（必填，2026-10-21 决策 0023）：货送到哪个仓
supplier_id            供应商（可空）
source_note            货源说明（可空，一次性网购）
status                 状态机（见 3.2）
ordered_at             下单（采购）时间；创建时可人工指定，缺省为创建时刻
expected_at            预计到货（可空，人工填）
remark / created_by / created_at / updated_at
```

明细（`purchase_order_items`）：

```text
po_id           所属采购单
sku_id          内部 SKU（必填）
quantity        采购数量 numeric(18,3)
unit_cost       单位成本 numeric(18,4)（可空）
received_quantity  已收货数量（默认 0，只由收货确认累加）
remark
```

`order_item_id` 列保留（历史数据仍可查/回显，AGENTS §99 不删列），但
**2026-10-21 起不再写入、不再参与任何判定**：采购不再挂订单行，补货语义
改为「为某 SKU 在某仓补缺口」，归属由 SKU × 目标仓 + 分配优先级实时派生
（见 §3.5）。

## 3.2 状态机

```text
ORDERED → PARTIALLY_RECEIVED → RECEIVED
    └──→ CANCELLED（未收货前可取消）
```

1. `ORDERED`：已登记下单。创建即此状态。
2. `PARTIALLY_RECEIVED`：有收货但 `received_quantity < quantity`（由收货确认自动重算）。
3. `RECEIVED`：全部明细 `received_quantity >= quantity`（由收货确认自动重算）。
4. `CANCELLED`：意图撤回。**仅未发生任何收货**（所有明细 `received_quantity = 0`）
   时允许；取消不触碰库存。已 `RECEIVED` 或 `PARTIALLY_RECEIVED` 的单不可取消
   （`PURCHASE_ORDER_INVALID_STATE`）。
5. 状态迁移由收货确认/取消操作驱动；禁止随意手改状态。
6. **短装结案（2026-11-03）**：`PARTIALLY_RECEIVED` 的单在「供应商不再发货」时
   可由操作员结案剩余数量（§4.5），结案后 `received + closed >= quantity` 即
   重算为 `RECEIVED`。**不新增状态**——短装事实由行上的 `closed_quantity` 与列表
   「短装结案」标签表达，避免状态机扩散。
6. 取消采购单时，在**同一事务**内将其关联的全部 `DRAFT` 收货单置为 `CANCELLED`，
   并逐单记录取消日志。草稿从未碰库存，联动取消无库存影响；已 `RECEIVED` 的收货单
   不会被此操作触及（可取消的采购单必然无任何收货）。规则来源：用户 2026-09-17 人工测试建议。

## 3.3 创建与修改

1. 整单创建在**一个事务**内（表头 + 全部明细），`po_no` 服务端生成。
2. 仅 `ORDERED` 状态可修改（表头字段与明细数量）；已收货的单不可改数量
   （`PURCHASE_ORDER_INVALID_STATE`）。
3. 明细 `sku_id` 必须是已存在的内部 SKU。
4. `quantity` 必须为正数（最多 3 位小数）。
5. 创建时可人工指定 `ordered_at`（采购时间），缺省为创建时刻。
6. **目标仓必填（2026-10-21，决策 0023）**：`receiving_warehouse_id` 必填，
   必须是已存在的仓库（否则 `WAREHOUSE_NOT_FOUND`，整单不落库）。采购单一旦
   有未取消的收货记录就不能再改目标仓（库存事实落在原仓）。
   目标仓决定三件事：收货单在哪个仓入库、缺口在哪算、渠道库存补给哪个仓。
7. **用途（purpose）**：
   - `STOCK`（默认）：采购单页备货，不校验缺口，同 SKU 可多张并存。
   - `REPLENISH`：订单页按缺口补货，创建时做缺口校验（见 §3.5）。
8. 创建时可同时传入可选收货参数 `receipt`：只含默认库位 `defaultBinId`（可选），
   传 `{}` 即"同时生成收货草稿"。系统在创建采购单的**同一事务**内，按全部明细的
   未收数量生成一张关联 `DRAFT` 收货单，逐行预填 `sku / quantity / unit_cost /
   purchase_order_item_id`，继承供应商与货源，语义与既有 `generateFromPo` 一致；
   备注为 `从采购单 {poNo} 创建时自动生成`。草稿仓库恒为采购单目标仓；草稿创建
   失败则采购单与草稿整体回滚，并分别记录成功创建的单据日志。
   **自动生成的只是独立草稿，不入账库存、不更新成本；仍可独立编辑，确认收货仍走 §4.3。**
   库位预填规则见 §4.1.1（决策 0021）：未显式传 `defaultBinId` 时逐 SKU 解析默认库位。
   规则来源：用户 2026-09-17 人工测试建议。
9. **批量生成收货单（2026-10-13，采购单页多选）**：`POST /purchase-receipts/from-po/batch`
   接受 `{ items: [{ poId }] }`（单批 ≤50），逐单复用 `generateFromPo` 的全部规则
   （收货仓 = 采购单目标仓；未收数量预填；只建 DRAFT 不碰库存），
   **单笔失败只记录结果、不拖垮整批**；返回逐单草稿号/失败明细。
10. **防重复草稿（2026-10-15，决策 0021）**：`generateFromPo`（含批量与 PO 创建时
    同步生成）在生成前检查该采购单是否已有**未取消**的收货单——已有 `DRAFT` 时拒绝并
    返回 `PURCHASE_RECEIPT_DUPLICATE_DRAFT`（409，消息含已有 `PR` 号），引导操作者编辑
    确认那张草稿；已有 `RECEIVED` 而无 `DRAFT` 时允许（分批到货）；已取消的草稿不计入。
    原因：两张按同一未收数量预填的草稿先后确认会累加超量，撞 DB CHECK 报不可读的 500。
11. **剩余数量口径（2026-11-03）**：草稿预填、超收守卫、在途与补货缺口统一使用
    `剩余 = quantity − received_quantity − closed_quantity`。短装结案的数量不会再
    到货，因此必须从在途里扣掉，否则缺口被虚覆盖、补货采购会被
    `PURCHASE_SKU_GAP_COVERED` 拒绝。

## 3.4 防重复采购（SKU × 仓 缺口守卫，2026-10-21 决策 0023）

补货采购（`purpose = REPLENISH`）在创建事务内按 `(sku_id, receiving_warehouse_id)`
重算缺口，并加 **PostgreSQL advisory lock**（键 `po-gap:<skuId>:<warehouseId>`）
串行化同一缺口上的并发登记，锁内复查后：

| 条件 | 结果 |
|---|---|
| `缺口 = 0`（在途已覆盖全部需求） | 拒绝 `PURCHASE_SKU_GAP_COVERED`（409），消息给出需求/在途数量 |
| `本次数量 > 缺口` | 拒绝 `PURCHASE_ORDER_INVALID_STATE`（409），消息给出缺口 |
| `0 < 本次数量 ≤ 缺口` | 通过 |

备货采购（`purpose = STOCK`，采购单页发起）不受此限制：同一 SKU 允许多张备货单。

> 取代原「同一订单行重复登记」守卫（`PURCHASE_ORDER_ITEM_ALREADY_ORDERED`）。
> 原守卫的语义是"一张订单行只允许买一次"，但它无法回答"另一张更早的订单行
> 抢走了这次采购"——那正是用户 2026-10-21 提出的场景。新守卫以缺口为单位，
> 天然覆盖重复下单，且不再依赖订单行链接。

## 3.5 订单行采购覆盖（派生，不落库）

`order_items` 不存采购字段，采购单也不挂订单行。覆盖关系完全由 SQL 现算
（AGENTS.md §13：派生值不得成为第二事实源）。

```text
需求(SKU, 仓) = 该仓服务店铺下，该 SKU 未分配行（BACKORDERED ∪ PENDING，
                MAPPED，订单非 CANCELLED/SHIPPED）的数量之和
在途(SKU, 仓) = 该 SKU + 该目标仓所有未取消采购单的 max(quantity − received, 0) 之和
缺口          = max(0, 需求 − 在途)
```

**覆盖分配**：在途数量按分配优先级逐行切分，累计量 ≤ 在途即该行 `COVERED`：

```text
is_urgent DESC → platform.priority ASC → shipment_deadline ASC NULLS LAST → item.created_at ASC
```

（与 ADR 0022 的库存分配优先级一致：加急 > 平台 > 时限 > 先后。）

**行归属仓**：与订单分配同一规则——该订单店铺 `ACTIVE` 绑定中 `priority` 最小、
非 FBO 优先的那一个（`warehouse_platform_bindings`）。

| 派生覆盖 | 判定 | 界面 |
|---|---|---|
| `COVERED`（已采购） | 该行累计需求 ≤ 该 SKU×仓 在途 | 蓝色「已采购」徽标（仅在缺货行显示） |
| `SHORT`（仍缺） | 该行累计需求 > 在途 | 显示「缺口 N」+「登记采购」入口 |

- 派生服务由 purchase 模块提供只读查询；order 模块经端口
  （`ORDER_PROCUREMENT_PORT`）组装，不得 import purchase 的 Repository（AGENTS.md §9）。
- 未映射 SKU 的订单行（`skuId = NULL`）、店铺无绑定仓的行 → 覆盖为 NULL。
- **不再有「已到货」**：货一到仓，库存增加事件触发自动分配，缺货行直接变成已占用，
  行随之离开缺货集合。到货不会停在某个中间状态等待人工「重新分配」。
- 订单列表筛选口径：
  - 「已采购」= 存在 `COVERED` 的缺货行；
  - 「待采购」视图（`pendingProcurement=true`）= 存在 `SHORT` 的缺货行。

---

# 4. 收货单（Purchase Receipt）

## 4.1 数据要素

```text
receipt_no          业务编号 PR%06d（集中式序号表，作用域 purchase_receipt）
purchase_order_id   来源采购单（可空 → 直接收货，无采购登记）
supplier_id         供应商（可空，从采购单预填）
source_note         货源说明（可空）
warehouse_id        收货仓库（必填）
status              DRAFT / RECEIVED / CANCELLED
received_at         实际收货确认时间
remark / created_by / created_at / updated_at
```

明细（`purchase_receipt_items`）：

```text
receipt_id              所属收货单
purchase_order_item_id  来源采购明细（可空）
sku_id                  内部 SKU（必填）
quantity                本次实收数量（必须 > 0）
unit_cost               单位成本 numeric(18,4)（可空）
bin_id                  目标库位（可空 → 走库存层既有库位解析规则）
serial_numbers          SN 列表（SN 管理商品必填，与数量一致；jsonb 字符串数组）
remark
```

支持**分批到货**：一张采购单可对应多张收货单，`received_quantity` 逐张累加。

## 4.1.0 收货仓 = 采购单目标仓（2026-10-21，决策 0023）

从采购单生成收货单（`generateFromPo` / 批量 / 创建采购单时同步生成）时：

1. 收货单 `warehouse_id` **恒等于**采购单的 `receiving_warehouse_id`；
2. 请求若显式传了不同的仓库 → 拒绝 `PURCHASE_RECEIPT_WAREHOUSE_MISMATCH`（422），
   不生成草稿；
3. 前端不再询问仓库，只显示目标仓供确认。

原因：缺口是按 `SKU × 仓` 计算的。货记到 A 仓而缺货发生在 B 仓，账面上"在途已
覆盖"，实际却发不出货——这个闭环必须由收货仓强制对齐来保证。

直接收货（无来源采购单、手工录入明细）仍可自由选择仓库，它不参与缺口覆盖。

## 4.1.1 收货默认库位（2026-10-15，决策 0021）

生成收货草稿（`generateFromPo` / 批量生成 / 创建采购单时同步生成）时，为**每一行**
解析默认库位写入明细 `bin_id`，只是**预填、可逐行改**：

1. **SKU 现存货位优先**：该 SKU 在本仓 `SELLABLE` 且 `on_hand > 0` 的库位中取
   `on_hand` 最大者；并列按 `bin_code` 升序取第一个。
2. **无现货则暂存位**：无正数 `SELLABLE` 在库时用本仓 `ST` 区第一个库位；**不存在
   时自动创建一个**（`zone='ST', rackNumber=1, level='1'`），本批无货 SKU 共用，
   写库位操作日志。
3. **仓库完全没有库位**时保持 `null`（走虚拟 `DEFAULT`，决策 0013 §8 不放宽）。
4. **显式传入的 `defaultBinId` 覆盖全部行**（保留原契约）。
5. 默认值不约束确认：库位可能放满，操作者可在草稿里改成别的库位或新建库位。

## 4.2 状态机

```text
DRAFT → RECEIVED（确认收货，不可逆）
    └─→ CANCELLED（仅 DRAFT 可取消）
```

1. `DRAFT`：草稿，可改明细、可取消。
2. `RECEIVED`：已确认。**不可撤销、不可改数量**——库存已入账，修正必须走
   库存调整（保持流水可追溯）。重复确认返回幂等结果，不重复入账。
3. `CANCELLED`：草稿作废，从未碰过库存。

## 4.2.1 批量删除（用户指示 2026-10-17）

采购单 / 收货单列表支持勾选后**批量删除**（物理删除）。安全边界以「是否产生过
库存事实」为准：

| 单据 | 可删除条件 | 拒绝条件 |
|---|---|---|
| 收货单 | `DRAFT` / `CANCELLED`（从未入库） | `RECEIVED`：库存已入账，删除会让账实失去凭证（改走库存调整） |
| 采购单 | 无 `RECEIVED` 收货单**且**所有明细 `received_quantity = 0`；其未入库的收货单（DRAFT/CANCELLED）随采购单一并删除 | 已发生收货（任一明细已收或存在 RECEIVED 单）：走「取消」或后续退货 |

- 逐笔独立：单笔失败只记录结果、不拖垮整批；返回每单的失败码与可读原因。
- 删除前写 `operation_logs`（`action = DELETE`，记录单号与原状态），保留审计痕迹。
- 事务内 `SELECT ... FOR UPDATE` 锁单后复查状态，避免与并发确认收货竞态。
- API：`POST /api/v1/purchase-orders/batch-delete`、
  `POST /api/v1/purchase-receipts/batch-delete`（body `{ ids: string[] }`，最多 200）。

## 4.2.2 批量收货（用户需求 2026-10-20）

收货单列表支持勾选多张草稿后**批量收货**。语义完全复用 §4.3 单笔确认：
每张单仍是**独立事务**（整单入账或整单回滚）——库存入账、超收校验、采购单
已收数量累加、移动平均成本、提交后库存事件广播都不变，不另写一套库存逻辑。

- 只对勾选中的 `DRAFT` 单发起；`RECEIVED` / `CANCELLED` 在前端跳过并提示
  （后端对已确认单仍按幂等重放处理）。
- 逐笔独立：单笔失败（超收、仓库缺失、空单、并发状态变化）只记录结果，
  不拖垮整批；返回逐单失败码与可读原因（AGENTS §36）。
- 已确认的单（含并发被他人确认）由 `confirm()` 幂等重放，结果标
  `idempotentReplay = true`，**绝不重复入账**。
- API：`POST /api/v1/purchase-receipts/batch-confirm`（body `{ ids: string[] }`，
  最多 200）。

## 4.2.3 列表搜索与「采购商品」列（用户指示 2026-10-17）

采购单 / 收货单列表的搜索框（`keyword`）除单号 / 货源说明 / 供应商外，**同时
模糊匹配明细中的 SKU 编码与 SKU 名称**（如搜 `A7` 或 `玄影` 可命中含该 SKU 的单）。
实现为对明细表的 `EXISTS` 子查询，不改变分页与排序。

两个列表新增「采购商品」列：显示**明细第一行**（`created_at, id` 排序）的 SKU 名称
与数量，格式 `迈从-A7 V3 Ultra+-鼠标-玄影x1`（SKU 编码作为悬浮提示）。
多行明细的行数仍在「明细」列显示（`N 行 / M 件`）。

## 4.3 确认收货（本域核心业务动作）

```text
校验（DRAFT / 仓库存在 / 明细非空 / 数量 > 0）
  ↓ 单个数据库事务
逐行 receiveStockInTx（condition = SELLABLE）
  referenceType  = PURCHASE_RECEIPT
  referenceId    = <收货单ID>
  幂等键          = PURCHASE_RECEIPT:<收货单ID>:<明细ID>
  ↓
累加来源采购明细 received_quantity
  ↓
重算来源采购单状态（ORDERED → PARTIALLY_RECEIVED → RECEIVED）
  ↓
更新成本（见 4.4）
  ↓
收货单 → RECEIVED、received_at
  ↓ 提交后
Operation Log
```

硬性约束：

1. **必须经 `InventoryService` 写库存**（`receiveStockInTx`，事务感知 API）；
   purchase 模块持有事务边界但**绝不直接改 `inventory_balances`**（AGENTS.md §10）。
2. **整单一个事务**：任一行失败全部回滚（不存在「行1入账、行2失败」的中间态）。
3. 幂等键 `PURCHASE_RECEIPT:<receiptId>:<itemId>`；重复确认同一收货单
   返回幂等结果。
4. 入库 condition 固定 `SELLABLE`（待检/残品收货属未来需求，走库存调整）。
5. SN 管理商品必须提供与数量一致的 SN 列表（库存层强制；非 SN 商品禁止提供）。
6. `bin_id` 可空时走库存层既有解析：仓库无库位 → 虚拟 `DEFAULT`；有库位 →
   必须显式指定（不放宽，决策 0013 §8）。暂存需求用显式暂存库位 + `MOVE_BIN`。
   为减少这个拦截，生成草稿时已按 §4.1.1 预填默认库位。
7. 收货**不自动触发任何订单分配**——为哪张订单买的货，由人工点该订单的
   「重试分配」决定归属（系统不猜）。
8. **超收前置校验（2026-10-15，决策 0021；2026-11-03 更新口径）**：事务内、
   行锁之后逐行校验本次数量 ≤ 来源采购明细剩余数量
   （`quantity - received_quantity - closed_quantity`，已结案的短装数量不可再收）。超出则抛
   `PURCHASE_RECEIPT_EXCEEDS_ORDERED`（409，含 SKU / 采购量 / 已收 / 本次），
   整单回滚、不写库存。这是兜底（正常流程由 §3.3.9 防重挡住），避免撞 DB CHECK
   后回落成不可读的 500。

## 4.5 短装结案（2026-11-03，用户批准）

**问题**：部分收货本身已支持（多张收货单累加 `received_quantity`），但供应商少发
且不再补时没有任何出口——采购单永久停在 `PARTIALLY_RECEIVED`，剩余数量永久计入
在途，缺口被虚覆盖，补货采购被 `PURCHASE_SKU_GAP_COVERED` 拒绝，订单缺货永远补不上。

**动作**：`POST /api/v1/purchase-orders/:id/close-remaining`

```json
{
  "reason": "供应商确认缺货，不再补发",
  "items": [{ "itemId": "…", "quantity": "2" }]
}
```

- `items` 省略 = 所有还有剩余的行；`quantity` 省略 = 该行全部剩余。
- **允许部分关闭**（关 2 件、留 3 件继续等货），供应商分批承诺很常见。

**硬性边界**：

1. **不是收货**：只写 `purchase_order_items.closed_quantity`（+ `closed_at/by/reason`），
   **不写 `received_quantity`、不产生库存流水、不动移动加权成本**（AGENTS §10/§14）。
2. **原因必填**（≤500 字），写操作日志 `CLOSE_REMAINING` 与行上 `close_reason`（§39）。
3. **有未取消草稿时拒绝**（`PURCHASE_RECEIPT_DUPLICATE_DRAFT`）：草稿很可能就是这批货，
   先取消/确认草稿再结案，否则草稿确认会撞超收守卫，体验更差。
4. **并发兜底在 SQL**：`closed_quantity + qty <= quantity - received_quantity`，
   并发结案只有一个成功；DB 另有 CHECK `received + closed <= quantity`。
5. 结案后 `received + closed >= quantity` → 采购单重算为 `RECEIVED`；
   列表显示「短装结案」标签（`closed_quantity > 0` 且状态 RECEIVED）。
6. 结案后该行不能再收货；剩余数量 = 0 时「生成收货单」会拒绝（§4.3 前置校验）。

**接口/字段**：`CloseRemainingRequestDto` / `CloseRemainingResultDto`；
明细 DTO 新增 `closedQuantity / closedAt / closeReason`，列表 DTO 新增
`closedQuantity`（标签用）。

---

## 4.4 移动加权平均成本（用户确认 Q2）

确认收货时，对带 `unit_cost` 的明细更新 `skus.moving_average_cost`：

```text
新平均成本 = (原平均成本 × 原在库数量 + 本次单位成本 × 本次数量) / (原在库数量 + 本次数量)
```

1. 「原在库数量」= 该 SKU 全仓 `on_hand` 合计（全部 Condition，确认事务内读取，
   含本次已入账数量）。
2. 原平均成本为 NULL（无历史成本）→ 以本次单位成本为新平均成本。
3. `unit_cost` 为空的明细**不更新成本**（成本未知不能臆造）。
4. 计算在确认事务内用数据库 NUMERIC 运算完成，结果保留 4 位小数（AGENTS.md §58 禁 FLOAT）。
5. 未确认收货（DRAFT）不得改变成本。
6. `skus.latest_purchase_price`（最近采购价）**随收货确认更新**（2026-11-09）：
   确认时用本次明细 `unit_cost` 覆盖为快照值（不等权、不加权），`unit_cost`
   为空不写；与 `moving_average_cost`（加权成本）互不覆盖。

---

# 5. 库存交互边界

1. purchase 模块只能通过 Inventory 模块公开 Service 写库存（`receiveStockInTx`），
   禁止 import 库存 Repository/Entity（AGENTS.md §9/§10，check-architecture Rule 3/4）。
2. 采购单创建/取消**不产生任何库存变化与流水**。
3. 收货确认产生 `RECEIVE` 事件与流水，`reference_type = PURCHASE_RECEIPT`
   （用户确认 Q1 新增该引用类型，inventory.md §60.4）。
4. 收货数量精度与库存一致：`numeric(18,3)`，服务端整数毫单位运算。

---

# 6. 收货作业（扫码 / 条码 / 库位）

1. **扫码入库**：收货明细录入支持扫 SKU 条码 → 后端解析条码 → 得到内部 SKU
   加入明细。条码全局唯一（不区分店铺，与 Listing Resolver 的 store-scoped 规则不同）。
2. **新货没条码**：当场补建——绑定供应商条码（EAN/MANUFACTURER）或生成内部条码
   `W%08d`（决策 0017，2026-09-14 起；此前签发的 `WCSKU%08d` 继续有效）；一个 SKU 多码并存，不覆盖已有条码。
3. **库位现状**：选库位时显示该库位当前已有 SKU 与数量（供人工判断容量），
   不做自动容量校验（决策 0009 系列，商品尺寸差异大）。
4. **SN**：用商品自带序列号（收货时逐件录入/扫描），系统不生成 SN。

---

# 7. 编号规则

沿用集中式序号表（决策 0001；登记于 master-data.md §1）：

| 对象 | 编码 | 作用域 |
|---|---|---|
| 供应商 | `SUP%04d` | `supplier` |
| 采购单 | `PO%06d` | `purchase_order` |
| 收货单 | `PR%06d` | `purchase_receipt` |

编号服务端生成，创建后不可改。

---

# 8. 错误码

| 错误码 | 场景 |
|---|---|
| `SUPPLIER_NOT_FOUND` | 供应商不存在 |
| `SUPPLIER_CODE_ALREADY_EXISTS` | 供应商编码重复 |
| `SUPPLIER_IN_USE` | 供应商被采购/收货单引用，不可删除 |
| `PURCHASE_ORDER_NOT_FOUND` | 采购单不存在 |
| `PURCHASE_ORDER_INVALID_STATE` | 采购单状态不允许该操作（改数量/取消） |
| `PURCHASE_SKU_GAP_COVERED` | 补货采购时该 SKU 在该仓已无缺口（在途已覆盖全部需求，2026-10-21 决策 0023） |
| `PURCHASE_RECEIPT_NOT_FOUND` | 收货单不存在 |
| `PURCHASE_RECEIPT_INVALID_STATE` | 收货单状态不允许该操作 |
| `PURCHASE_RECEIPT_EMPTY` | 收货单无明细不可确认 |
| `PURCHASE_RECEIPT_DUPLICATE_DRAFT` | 采购单已有未取消的收货草稿，拒绝重复生成（决策 0021） |
| `PURCHASE_RECEIPT_EXCEEDS_ORDERED` | 本次收货数量超出采购未收数量（决策 0021） |
| `PURCHASE_RECEIPT_WAREHOUSE_MISMATCH` | 收货单请求的仓库与采购单目标仓不一致（2026-10-21 决策 0023） |
| `WAREHOUSE_NOT_FOUND` | 采购单目标仓 / 收货仓库不存在 |

> 已废弃：`PURCHASE_ORDER_ITEM_ALREADY_ORDERED`（被 `PURCHASE_SKU_GAP_COVERED` 取代）、
> `PURCHASE_RECEIPT_WAREHOUSE_MISSING`、`PURCHASE_ORDER_LINE_NOT_ORDERED`
> （后两者随「订单行去收货」入口一起下线，2026-10-21）。

统一错误信封（AGENTS.md §66）。

---

# 9. 幂等与并发

1. 收货确认幂等键 `PURCHASE_RECEIPT:<receiptId>:<itemId>` 落在库存事件上
   （唯一约束兜底）；同键不同参数返回冲突错误。
2. 重复确认已 `RECEIVED` 的收货单：状态检查直接返回幂等结果，不再触碰库存。
3. 防重复采购检查与采购单创建在同一事务内（先查后插 + 提交；并发双击由
   业务唯一性语义约束——同一订单行允许在取消后重新登记，故不建数据库唯一索引）。
4. 生成收货单防重复草稿检查（§3.3.9）在生成事务前进行（先查后建）；并发双击由
   同一 PO 的草稿存在性检查收窄（检查→插入非强原子，双开极端窗口仍由确认时的
   超收校验 §4.3.8 兜底为可读错误）。

---

# 10. 修改本文档的条件

以下变更必须先修改本文档：

- 采购单/收货单新增或删除状态；
- 改变采购时间默认值/人工指定语义、创建时生成草稿或取消联动规则；
- 改变确认收货的事务/幂等/成本规则；
- 改变收货默认库位解析规则（决策 0021）；
- 改变生成收货单的防重复草稿规则（决策 0021）；
- 改变防重复采购规则；
- 改变订单行采购状态派生规则；
- 改变供应商/货源语义；
- 改变收货库位或 SN 规则；
- 新增采购域错误码。

不得先写代码，再让文档适配代码。
