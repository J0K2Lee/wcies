# WCIES Order Business Rules

> 本文档定义 WCIES 订单领域的业务事实、状态与合法变化（Sprint 3 固化）。
>
> 所有涉及订单的代码修改，必须以本文档为准。
>
> 本文档规则来源：Sprint 3 任务书（Order Core + Picking Workflow）与 AGENTS.md 已冻结约束；未新增任务书之外的业务规则。

---

# 1. Platform Status 与 ERP Status 分离

订单必须同时保存两个状态维度：

```text
orders.platform_status  平台原始状态（平台字符串，仅作事实保存与展示）
orders.erp_status       WCIES 内部履约状态（ERP 状态机管理）
```

规则：

1. 禁止 `order.erpStatus = platformStatus` 直接赋值。
2. 平台状态必须经 `OrderStatusService`（状态机）解释后才允许驱动 ERP 状态迁移。
3. Sprint 3 无真实平台 Adapter，仅建立该边界：平台状态作为事实落库，不参与状态机计算。
4. 所有 ERP 状态迁移必须通过 `OrderStatusService`，禁止业务代码随处直接修改 `orders.erp_status`。

---

# 2. Order 与 OrderItem 分离

```text
orders 1:N order_items
```

1. 订单头保存店铺、平台单号、状态与原始数据；订单行保存平台商品标识、SKU 映射、数量与履约状态。
2. 订单行拥有独立库存履约状态（见 §6），一行失败不得无必要阻塞整张订单（AGENTS.md §36）。
3. 订单唯一业务键：`UNIQUE(store_id, platform_order_id)`；`order_no`（ORD 前缀流水号）仅为内部展示编号，不作为唯一性依据。

---

# 3. Order 与 Shipment 分离

1. Order ≠ Shipment ≠ Package（AGENTS.md §37）。
2. Sprint 3 不实现 Shipment 模块业务，仅保留关联边界（库存 CONSUMED/SHIP 能力已由 Inventory Core 提供，Sprint 3 订单状态不进入 SHIPPED/DELIVERED）。
3. 禁止把平台订单号当作物流包裹模型。

---

# 4. 新订单何时锁库存

1. 订单摄入（`OrderIngestionService`）接收 WCIES 内部标准 DTO `NormalizedOrderInput`（非任何平台 DTO）。
2. 订单基础记录（Order + OrderItems，状态 PENDING）先落库。
3. 每个 Order Item 依次：
   - 通过 `ListingResolverService` 做 Store Scoped SKU 解析（禁止在 OrderModule 写第二套 Resolver）；
   - 解析成功（mapping_status = MAPPED）后立即尝试创建 `InventoryReservation`。
4. Reservation 引用规则（复用 Inventory Core 既有 `RESERVATION_REFERENCE_TYPES`，引用粒度为订单行）：

```text
referenceType = ORDER          （既有枚举值；引用粒度为行）
referenceId   = orderItem.id
幂等键        = ORDER_RESERVE:<orderItemId>
```

5. 禁止 OrderModule 直接修改 `inventory_balances` / `reserved_qty`（AGENTS.md §10/§19）。
6. 仓库选择：Sprint 3 使用该店铺 `store_warehouse_bindings` 中 `is_inventory_source = true` 的 ACTIVE 绑定里 `priority` 最小的仓库；同优先级时非 FBO 模式优先（FBO 平台仓库存由平台管理）；多仓决策属于未来 Shipment/Allocator 阶段。

---

# 5. 缺货行为与 Backorder

库存不足（Inventory Core 返回 `INVENTORY_INSUFFICIENT_STOCK`）时：

1. 订单与订单行必须保存，不得回滚消失。
2. 该订单行 `fulfillment_status = BACKORDERED`。
3. 创建 `ORDER_OUT_OF_STOCK` 异常。
4. 禁止创建负库存；禁止自动取消平台订单。
5. 其他库存充足的行正常 RESERVED，其 Reservation 保留。

## Backorder 重试

`retryBackorder(orderItemId)`（API：`POST /orders/items/:itemId/retry-allocation`）：

```text
BACKORDERED / PENDING
↓
重新尝试 reserveStock（同一幂等键 ORDER_RESERVE:<orderItemId>）
↓
成功 → RESERVED，解决（RESOLVED）对应 OPEN 异常，订单状态重算
失败 → 保持 BACKORDERED，不新建异常（已有未解决异常保留）
```

---

# 6. OrderItem 库存履约状态

```text
PENDING        已保存，尚未尝试分配
RESERVED       已创建 InventoryReservation
BACKORDERED    映射成功但库存不足
PICKED         已完成拣货（pickedQty == requiredQty）
RELEASED       订单取消后的取消终态
```

严格区分 Order ERP 状态与 OrderItem 履约状态；行状态是库存事实，订单状态是业务汇总。

## Mapping Status（与履约状态正交）

```text
PENDING   未解析
MAPPED    已解析到 Internal SKU
FAILED    无法解析（skuId = NULL，禁止猜测 SKU）
```

映射失败行创建 `ORDER_SKU_MAPPING_FAILED` 异常，不阻塞其他行继续 Reservation。

---

# 7. Order ERP 状态机

Sprint 3 状态全集：

```text
NEW
ALLOCATING（预留值：Sprint 3 单事务摄入不进入）
READY_TO_PICK
PARTIALLY_BACKORDERED
BACKORDERED
PICKING
PICKED
CANCELLED
EXCEPTION
```

不包含 SHIPPED / DELIVERED / RETURNED（Shipment Sprint 再加入）。

## 汇总规则（清晰模型）

任一订单行履约状态变化后，按以下优先级重算订单状态：

1. `CANCELLED` 为终态，取消后不再重算。
2. 无任何可履约行（全部 mapping FAILED）→ `EXCEPTION`。
3. 存在未完成拣货的拣货任务行（订单行进入 CREATED/IN_PROGRESS 的 PickingTask 且未全部拣完）→ `PICKING`。
4. 全部可履约行（mapping != FAILED 且 fulfillment != RELEASED）均为 PICKED → `PICKED`。
5. 存在 BACKORDERED 行：
   - 存在 RESERVED/PICKED 行 → `PARTIALLY_BACKORDERED`；
   - 全部为 BACKORDERED → `BACKORDERED`。
6. 其余（全部 RESERVED）→ `READY_TO_PICK`。

存在部分 mapping FAILED 但仍有可履约行时：订单保留业务汇总状态，映射失败以挂接异常呈现（UI 明确区分“不知道是什么 SKU”与“知道 SKU 但没库存”）。

## 摄入初始状态

摄入成功后订单直接进入按行结果汇总出的状态（NEW 仅作为创建历史记录的起点，历史链：`null → NEW → <汇总状态>`）。

---

# 8. 取消订单

内部 `cancelOrder()`：Sprint 3 由人工/API 测试触发，不接平台取消事件。

## Reserved 取消

```text
OrderItem = RESERVED
↓
releaseReservation()
↓
fulfillment_status = RELEASED
```

库存 `Reserved - N`，On Hand 不变；订单状态 → CANCELLED。

## Backordered 取消

```text
OrderItem = BACKORDERED
↓
无库存锁定，禁止调用库存 Release
↓
fulfillment_status = RELEASED
```

## PENDING / 映射失败行取消

直接 `RELEASED`，不触碰库存。

## Picked 取消（拦截）

```text
OrderItem = PICKED
↓
禁止 unpick / release / 恢复 Available
↓
创建 OrderInterception（每行一条）
↓
发布 ORDER_INTERCEPTION_REQUIRED 领域事件（Sprint 3 记录结构化日志 + 操作日志，不直接调用飞书）
↓
OrderItem 保持 PICKED，Picked 库存保持
```

## 拣货中取消（部分拣货）

订单存在**未完成**且已产生扫码进度的拣货（关联 PickingTaskItem pickedQty > 0 且任务状态为 CREATED/IN_PROGRESS）时：拒绝取消并创建 `ORDER_INVALID_STATE` 异常；需先完成或取消拣货任务。已完成拣货的 PICKED 行走上文拦截流程。零进度拣货任务在取消订单时一并置 CANCELLED（无库存影响）。

---

# 9. Order Interception（拦截）

`order_interceptions`：Picked 取消的实体找回任务。

状态（冻结）：

```text
CREATED → ASSIGNED → LOCATING → INTERCEPTED → RETURNED_TO_STOCK → CLOSED
                                    ↘ FAILED
```

Sprint 3 只实现创建（CREATED）；完整扫码回库与通知在后续仓库/通知 Sprint。禁止 Picked 取消时自动恢复库存。

---

# 10. PickingTask 规则

## 进入条件

只有 `fulfillment_status = RESERVED` 的订单行可进入 PickingTask。BACKORDERED / 映射失败 / RELEASED 行禁止进入。

## 拆分规则

```text
1 PickingTask = 1 Warehouse
```

一个订单跨多仓时必须按仓拆分多个 PickingTask；模型不绑定“一单一个 Task”，支持多单合单拣货（Sprint 3 首阶段实现“从单个 READY_TO_PICK 订单生成”）。

## 状态

```text
PickingTask:  CREATED → IN_PROGRESS → COMPLETED
                              ↘ CANCELLED（仅零扫码进度时允许）
PickingTaskItem: PENDING → PICKED
```

扫码失败不新增业务状态，仅拒绝该次扫码操作。

## 完成条件

Task 内全部 Items 达到 requiredQty 才允许 COMPLETED；多 Item 缺一不可。

## 数量与扫码

- 逐件扫码累计 `pickedQty`（每次扫码 = 1 件）。
- `pickedQty + 1 > requiredQty` 时拒绝：`PICKING_QUANTITY_EXCEEDED`。
- 扫码识别使用 SKU Barcode，经 `sku_barcodes` 后端解析；禁止前端自行判断 Barcode 对应 SKU。
- 错误 SKU：`PICKING_SKU_MISMATCH`，任何库存不得变化。
- 同 Task 内多行同 SKU：按行创建顺序拣最早 PENDING 行（同 SKU 实体件可互换；UI 可显式指定行）。

## 目标库位

PickingTaskItem 展示 Reservation Lines 的 Bin × Quantity（多 Bin 分别展示，如 A01×2 / A02×3），不得只显示 SKU 总数。API 预留 `binBarcode?`（第一阶段不强制先扫 Bin）。

## 库存动作

正确扫码经 Inventory Core 的部分拣货能力（`pickStockPartial`，单次 1 件）执行：

```text
Reserved - 1, Picked + 1
```

Reservation 全部行拣完后 Header 进入 PICKED。PickingModule 禁止直接修改 `reserved_qty` / `picked_qty`。

## 并发

同一 PickingTaskItem 的并发扫码通过行锁 + `pickedQty <= requiredQty` 校验串行化，不得只靠前端禁用按钮。

---

# 11. SN（Serial Number）规则

1. `skus.serial_tracking = true` 的 SKU 为 SN 管理商品。
2. `inventory_serials` 是单件追踪明细，不是第二库存事实源；数量事实仍是 `inventory_balances`。SN 与 Balance 状态必须同事务一致。
3. SN 状态：`IN_STOCK / RESERVED / PICKED / SHIPPED`（SHIPPED 留给 Shipment 阶段）。
4. SN 入库：serial_tracking SKU 的 `initialize/receive` 必须提供与数量一致的 SN 列表（禁止 On Hand = 10 但只有 8 个 SN）；非 SN 商品提供 SN 列表则拒绝。
5. SN 保留：reserve 时按分配行所在 Bin 选取 IN_STOCK SN 标记 RESERVED；release 回 IN_STOCK；拣货扫码必须携带 `serialNumber`（SN 校验失败拒绝），拣货成功 SN → PICKED 并关联 picking_task_item_id。
6. SN 唯一占用：同一 SN 不能同时服务两个订单（全局 UNIQUE + 状态约束）。

---

# 12. 状态历史

1. 每次 ERP 订单状态变化必须写 `order_status_history`（from_status / to_status / reason / operator）。
2. 禁止只改 `orders.erp_status` 而不落历史。
3. 创建订单记录 `null → NEW`；其后每次重算产生的新状态都追加记录；状态未变化不写重复记录。

---

# 13. 幂等

## 订单摄入幂等

唯一业务键 `storeId + platformOrderId`（DB UNIQUE 兜底）：

重复摄入同订单不得：

- 创建第二张订单；
- 重复创建 OrderItem；
- 重复 Reservation；
- 重复 InventoryTransaction / InventoryEvent。

并发摄入同键：依赖 UNIQUE 约束 + 预检，只存在一张 Order。

## 库存动作幂等

```text
ORDER_RESERVE:<orderItemId>          预约
ORDER_RELEASE:<orderItemId>          取消释放
PICK:<reservationId>:<scanKey>       逐件拣货（scanKey 由 Picking 行号 + 结果计数派生）
```

## 异常幂等

同一 `(exception_type, reference)` 只允许一条 OPEN 异常（部分唯一索引兜底）；Backorder 重试失败不产生异常垃圾。

---

# 14. 事务边界（Sprint 3 实现约定）

订单基础记录与行级分配分离：

```text
事务 A：Order + OrderItems（PENDING）+ 历史(null→NEW)
逐行（各自独立事务/调用）：
  事务 Bn：SKU 解析结果 + mapping 状态落库
  事务 Cn：InventoryService.reserveStock（库存自有事务，行级 FOR UPDATE）
  事务 Dn：行履约状态 + 异常落库
事务 E：订单汇总状态重算 + 历史
```

- 单行映射失败 / 缺货只影响该行，订单与其余行保留。
- 并发重复摄入由 `UNIQUE(store_id, platform_order_id)` 兜底，冲突方转为幂等重放。
- 摄入中途失败留下的 PENDING 行可通过 `retry-allocation` 续作。

---

# 15. Exception Center（Sprint 3 最小实现）

`system_exceptions` 至少：exception_type / severity / status / reference_type / reference_id / store_id / message / details / created_at / resolved_at。

- 类型：`ORDER_SKU_MAPPING_FAILED` / `ORDER_OUT_OF_STOCK` / `ORDER_INVALID_STATE`。
- 状态：`OPEN / RESOLVED / IGNORED`；禁止物理删除历史异常。
- severity 取值：`LOW / MEDIUM / HIGH`（技术必需的分级字段）。

---

# 16. 修改本文档的条件

以下变更必须先修改本文档：

- 新增/删除 ERP 订单状态或合法迁移；
- 新增/删除订单行履约状态或映射状态；
- 改变订单汇总状态优先级模型；
- 改变锁库存时机、缺货行为或 Backorder 逻辑；
- 改变取消类型与库存处理；
- 改变 Picking 进入条件、拆分或完成规则；
- 改变 SN 管理规则；
- 改变摄入幂等键。

不得先写代码，再让文档适配代码。
