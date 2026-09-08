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

# 3. Order 与 Shipment 分离（Sprint 4 实现）

1. Order ≠ Shipment ≠ Package（AGENTS.md §37）：`Order 1:N Shipment 1:N Package 1:N PackageItem`。
2. `shipments` / `packages` / `package_items` / `package_item_serials` / `shipping_labels` 已于 Sprint 4 落地；禁止把 `orders.tracking_number` / `orders.package_id` 当作物流模型。
3. 一个 Shipment 只属于一个 Warehouse（订单跨仓必须拆多张 Shipment，与 1 PickingTask = 1 Warehouse 一致）。
4. Shipment 状态（仓库履约阶梯，禁止直接使用物流轨迹状态）：

```text
DRAFT（预留） → READY_TO_PACK → PACKING → READY_TO_SHIP → SHIPPED
                                                     ↘ CANCELLED / EXCEPTION（预留）
```

创建即 `READY_TO_PACK`（进入条件：订单行全部 PICKED）；首个 Package 创建后进入 `PACKING`；全部待发数量打包且所有包裹 `SEALED` 后进入 `READY_TO_SHIP`；正式出库后 `SHIPPED`。

5. Package 状态：`OPEN → SEALED → SHIPPED`，另有 `CANCELLED` 与 `REPACK_REQUIRED`（已封箱包裹因拦截失去某行后必须重打包的可审计状态）。

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
SHIPPED        已随 Shipment 正式出库（Sprint 4；该行全部数量已离开库存）
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

Sprint 4 状态全集：

```text
NEW
ALLOCATING（预留值：Sprint 3 单事务摄入不进入）
READY_TO_PICK
PARTIALLY_BACKORDERED
BACKORDERED
PICKING
PICKED
PARTIALLY_SHIPPED（Sprint 4：部分行/数量已出库，其余仍待履约）
SHIPPED（Sprint 4：全部可履约行已出库）
CANCELLED
EXCEPTION
```

不包含 DELIVERED / RETURNED（后续 Sprint 再加入）。

## 汇总规则（清晰模型）

任一订单行履约状态变化后，按以下优先级重算订单状态：

1. `CANCELLED` 为终态，取消后不再重算。
2. 无任何可履约行（全部 mapping FAILED）→ `EXCEPTION`。
3. 存在未完成拣货的拣货任务行（订单行进入 CREATED/IN_PROGRESS 的 PickingTask 且未全部拣完）→ `PICKING`。
4. 全部可履约行（mapping != FAILED 且 fulfillment != RELEASED）均为 SHIPPED → `SHIPPED`。
5. 存在 SHIPPED 行但并非全部 → `PARTIALLY_SHIPPED`。
6. 全部可履约行均为 PICKED → `PICKED`。
7. 存在 BACKORDERED 行：
   - 存在 RESERVED/PICKED 行 → `PARTIALLY_BACKORDERED`；
   - 全部为 BACKORDERED → `BACKORDERED`。
8. 其余（全部 RESERVED）→ `READY_TO_PICK`。

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

## SHIPPED 行取消（Sprint 4）

已随 Shipment 出库的行**跳过**（保持 SHIPPED）：禁止仓内拦截，不释放、
不回库；找回走未来的 Return / Logistics 流程。

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

`order_interceptions`：Picked 取消的实体找回任务（Sprint 4 完整实现）。

状态（冻结）：

```text
CREATED → ASSIGNED → LOCATING → INTERCEPTED → RETURNED_TO_STOCK → CLOSED
                                    ↘ FAILED
```

规则：

1. 创建：`OrderService.cancel` 对每个 PICKED 行经 `ORDER_INTERCEPTION_PORT` 创建拦截任务，并发布 `ORDER_INTERCEPTION_REQUIRED` 领域事件（SYSTEM 通知立即落库；FEISHU 通知失败不得影响取消事务）。
2. 拦截范围：仅"已发生实体拣货且未出库"的商品。Shipment 已 `SHIPPED` 的行禁止仓内拦截（`INTERCEPTION_NOT_ALLOWED_AFTER_SHIPMENT`）。
3. 扫码验证（后端强制）：SKU 条码（`INTERCEPTION_SKU_MISMATCH`）、SN（SN 商品必须属于该订单 Reservation 且状态 PICKED，`INTERCEPTION_SERIAL_MISMATCH`）、目标回库 Bin（必须属于该仓库）。
4. 回库（原子事务）：解包（PackageItem / PackageItemSerial 移除；SEALED 包裹 → `REPACK_REQUIRED`，清空包裹 → `CANCELLED`；ShipmentItem 快照行删除；Shipment 阶梯重算）→ 库存 `RETURN_PICKED`（Picked - N，On Hand 不变，SN → IN_STOCK 回目标 Bin，Reservation → RELEASED）→ OrderItem → RELEASED。状态历史（`order_interception_histories`）逐跳记录，内部合并步骤也留痕。
5. 失败：`FAILED` 不动库存（Picked 保持），创建 `ORDER_INTERCEPTION_FAILED` 异常并发送通知。
6. 关闭：`RETURNED_TO_STOCK` / `FAILED` → `CLOSED`。

禁止 Picked 取消时自动恢复库存。

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
3. SN 状态：`IN_STOCK / RESERVED / PICKED / SHIPPED`（SHIPPED 于 Sprint 4 正式出库时进入；拦截回库时回到 IN_STOCK 并落回目标 Bin）。
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
SHIP:<reservationId>:<shipmentKey>   正式出库（shipmentKey = SHIPMENT:<shipmentId> 或调用方幂等键）
RETURN_PICKED:<reservationId>:<interceptionKey>   拦截回库（interceptionKey = INTERCEPT:<interceptionId>）
```

Shipment 出库幂等另有数据库层保障：`shipments` 行锁 + `SHIPPED` 状态检查，
重复调用返回幂等结果（`alreadyShipped = true`），不再次扣减库存。

## 异常幂等

同一 `(exception_type, reference)` 只允许一条 OPEN 异常（部分唯一索引兜底）；Backorder 重试失败不产生异常垃圾。

---

# 14. 事务边界（Sprint 3 实现约定；Sprint 4 扩展）

Sprint 4 在此基础上增加三个原子业务命令（显式 QueryRunner + Inventory 事务感知 API）：

```text
拣货扫码：PickingTaskItem 递增 + pickStockPartialInTx + OrderItem PICKED（单事务）
正式出库：shipStockPartialInTx + Package/Shipment/OrderItem SHIPPED（单事务）
拦截回库：解包 + returnPickedStockInTx + OrderItem RELEASED + 拦截状态（单事务）
```

订单状态汇总（recompute + history）在提交后执行，失败可重算，不破坏库存事实。

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

# 15A. Shipment 与 Packing（Sprint 4）

## 进入条件

只有 `OrderItem.fulfillmentStatus = PICKED` 的行可进入 Shipment（按仓拆分，
`shipment_items` 为数量快照）。`BACKORDERED / RESERVED / MAPPING_FAILED` 行禁止进入。
一个订单行最多归属一张未取消的 Shipment（`shipment_items.order_item_id` 全局唯一）。

## 打包（Packing）

```text
Picked Order Items → Create Package → 扫码 SKU → 数量校验 → Seal
```

1. 扫码装箱每次 1 件，条码由后端解析为 Internal SKU；打包**不改变库存**。
2. 错误 SKU：`PACKING_SKU_MISMATCH`；超量：`PACKING_QUANTITY_EXCEEDED`。
3. 数量完整性：Shipment 内全部包裹的 PackageItem 合计必须等于快照数量
   （`SHIPMENT_NOT_FULLY_PACKED`），且全部包裹 SEALED 后才允许出库。
4. SN 商品打包必须记录具体 SN（`package_item_serials`，全局唯一）；打包 SN
   必须已属于当前订单行的 Reservation（禁止装入其他订单的 SN），SN 状态保持 PICKED。
5. 并发：每张 Shipment 的打包操作按 Shipment 行锁 + Package 行锁串行化。

## 正式出库（Ship）

```text
READY_TO_SHIP → shipShipment() → SHIPPED
```

单一数据库事务内完成：逐行 `shipStockPartialInTx`（Picked - N / On Hand - N /
SN → SHIPPED）→ Packages → SHIPPED → Shipment → SHIPPED → OrderItems → SHIPPED。
任一步失败整体回滚（不存在"Shipment=SHIPPED 但库存未扣"或反向状态）。
人工可录入 `trackingNumber / carrierCode`（未来由平台 Adapter 自动填入）。

## 面单（Shipping Label）

`shipping_labels` 为平台无关元数据：Sprint 4 仅支持 `MANUAL_UPLOAD`
（经 ObjectStorageService 私有桶 + 短期签名 URL 查看/打印，支持 PDF/PNG/JPEG）；
`PLATFORM_API` 为未来预留。

# 15B. Picking 原子性（Sprint 4 P0）

PickingTaskItem 状态变化与 Inventory `Reserved → Picked` **必须原子提交**：

```text
锁 PickingTaskItem → 守卫递增 pickedQty → pickStockPartialInTx（同一 QueryRunner）
→ OrderItem → PICKED → COMMIT
```

任何一步失败整体 ROLLBACK（不再使用"先改 Picking 再失败补偿"）。
事务协调方案：Inventory 暴露事务感知公共 API（`pickStockPartialInTx` /
`shipStockPartialInTx` / `returnPickedStockInTx`），Picking/Shipment/Interception
模块持有事务边界但**不掌握库存计算**。

---

# 16. 修改本文档的条件

以下变更必须先修改本文档：

- 新增/删除 ERP 订单状态或合法迁移；
- 新增/删除订单行履约状态或映射状态；
- 新增/删除 Shipment / Package 状态或改变打包/出库规则；
- 改变拦截生命周期、回库规则或通知行为；
- 改变订单汇总状态优先级模型；
- 改变锁库存时机、缺货行为或 Backorder 逻辑；
- 改变取消类型与库存处理；
- 改变 Picking 进入条件、拆分或完成规则；
- 改变 SN 管理规则；
- 改变摄入幂等键。

不得先写代码，再让文档适配代码。
