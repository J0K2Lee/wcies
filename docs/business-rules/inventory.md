# WCIES Inventory Business Rules

> 本文档定义 WCIES 库存领域的业务事实、状态与合法变化。
>
> 所有涉及库存的代码修改，必须以本文档为准。
>
> 本文档只描述业务规则，不描述 Controller、ORM、Queue 等工程实现。

---

# 1. 核心原则

WCIES 中必须严格区分：

```text
Physical Inventory
Available Inventory
Channel Inventory
```

三者不是同一个概念。

### Physical Inventory

真实实体商品库存。

回答：

> 实际有多少货、在哪里？

### Available Inventory

当前仍可以继续承诺销售的库存。

### Channel Inventory

最终准备同步给某个平台、店铺的可售数量。

平台库存不得直接覆盖 ERP 实体库存。

---

# 2. 库存基本维度

实体库存至少按以下维度管理：

```text
SKU
+
Warehouse
+
Bin
+
Inventory Condition
```

其中：

- SKU：内部 SKU
- Warehouse：真实仓库
- Bin：库位，可为空
- Inventory Condition：库存质量状态

---

# 3. Inventory Condition

第一阶段使用：

```text
SELLABLE
QC_PENDING
DEFECTIVE
REPAIR
SCRAPPED
```

只有：

```text
SELLABLE
```

库存可以参与正常销售库存计算。

---

# 4. 核心库存数量

对可销售库存，需要区分：

```text
On Hand
Reserved
Picked
Safety Stock
```

## On Hand

ERP 当前记录的实体在库数量。

## Reserved

已经被订单占用，但货物尚未从库位拣出。

## Picked

已经从库位取出，但尚未正式出库。

## Safety Stock

为了防止超卖而保留、不向渠道承诺的数量。

---

# 5. Available

基本计算：

```text
Available
=
On Hand
- Reserved
- Picked
- Safety Stock
- Unavailable Quantity
```

其中不可销售 Condition 的库存：

不参与 SELLABLE Available。

## 5.1 实现约束（2026-09-12）

1. **只有 `SELLABLE` 余额计入 SELLABLE Available**。`QC_PENDING` / `DEFECTIVE` /
   `REPAIR` / `SCRAPPED` 的 on-hand **计入 On Hand 与物理可用**（货确实在库），
   但**不计入可售**。
2. 该规则必须在**同一套代码**内实现，不得各处自算：列表行、库位明细、SKU 汇总
   三处共用 `isSellableCondition()` 与 `sellableOf()`（`inventory-query.service.ts`）。
   Reservation 分配同样只认 `SELLABLE`，两者必须一致。
3. **违规后果**（2026-09-12 实测到的缺陷）：若聚合把非 SELLABLE 也算作可售，
   界面会显示「可售 5」而订单分配报「库存不足」——用户可能据此对平台承诺库存，造成超卖。
4. 回归测试固定该行为：`tests/integration/inventory.integration.spec.ts`
   的「non-sellable conditions never reach SELLABLE Available」两条。

---

# 6. Available 不是独立事实库存

`Available` 原则上通过当前库存状态实时计算。

不得把：

```text
On Hand
Reserved
Picked
Available
```

四个数字作为相互独立、都可修改的库存事实。

否则会产生：

```text
On Hand = 10
Reserved = 3
Picked = 1
Available = 9
```

这种无法解释的数据。

---

# 7. NO INVENTORY RECORD ≠ ZERO

这是库存同步的重要安全规则。

如果某个：

```text
SKU + Warehouse
```

根本不存在库存记录：

含义是：

```text
UNKNOWN / NOT INITIALIZED
```

而不是：

```text
0
```

因此平台库存同步遇到：

```text
NO_INVENTORY_RECORD
```

必须：

```text
SKIP
```

禁止直接：

```text
push 0
```

---

# 8. 库存余额与库存流水

系统必须同时拥有：

```text
InventoryBalance
InventoryTransaction
```

## InventoryBalance

回答：

> 现在有多少？

## InventoryTransaction

回答：

> 为什么变成这么多？

任何业务库存变化必须产生库存流水。

---

# 9. 禁止无流水库存修改

禁止出现：

```text
直接把库存从 10 改成 8
```

但没有业务原因和流水。

库存变化必须拥有明确来源，例如：

```text
PURCHASE_RECEIPT
ORDER_RESERVE
ORDER_RELEASE
ORDER_PICK
ORDER_SHIP
TRANSFER_OUT
TRANSFER_IN
RETURN_RECEIPT
STOCKTAKE_GAIN
STOCKTAKE_LOSS
MANUAL_ADJUSTMENT
SCRAP
```

---

# 10. 库存数量变化总表

| 操作 | On Hand | Reserved | Picked | Inventory 事件类型 |
|---|---:|---:|---:|---|
| 采购入库 / 初始入库 / 收货入库 | +N | 0 | 0 | RECEIVE / INITIAL_STOCK |
| 新订单锁库存 | 0 | +N | 0 | RESERVE |
| 释放未拣订单 | 0 | -N | 0 | RELEASE |
| 拣货（逐件） | 0 | -N | +N | PICK |
| 正式出库（Sprint 4） | -N | 0 | -N | SHIP |
| 拦截回库（Sprint 4） | 0（不变） | 0 | -N | RETURN_PICKED |
| 取消拣货并实体回库 | 0 | 0 | -N | RETURN_PICKED |
| 盘盈 | +N | 0 | 0 | MANUAL_ADJUSTMENT |
| 盘亏 | -N | 0 | 0 | MANUAL_ADJUSTMENT |
| 调拨发出 | -N | 0 | 0 | （调拨 Sprint） |
| 调拨接收 | +N | 0 | 0 | （调拨 Sprint） |
| 库内移位（同一 Event 两条流水） | 源 -N / 目标 +N | 0 | 0 | MOVE_BIN |

任何新增库存行为，都应先补充本表或对应规则。

---

# 11. 采购入库

商品真实入库完成后：

```text
On Hand + N
```

同时：

- 生成 InventoryTransaction；
- 记录 Warehouse；
- 记录 Bin；
- 如果 SKU 开启 SN 管理，登记具体 SN；
- 更新采购收货记录；
- 根据成本规则更新库存成本。

采购单创建但尚未收货：

不得增加 On Hand。

---

# 12. 新订单锁库存

平台新订单同步进入 ERP 后：

完成 SKU 映射。

库存充足：

```text
创建 InventoryReservation
Reserved + N
```

此时：

```text
On Hand 不变
```

因为实体商品仍在仓库中。

---

# 13. Reservation 必须可追溯

每个 Reservation 必须知道：

```text
Order
Order Item
SKU
Warehouse
Quantity
Status
```

禁止只保存：

```text
Reserved = 15
```

而无法回答：

> 哪些订单占用了这 15 件？

---

# 14. 库存不足订单

如果新订单无法成功锁定足够库存：

订单仍然保存。

订单行进入：

```text
BACKORDERED
```

并产生：

```text
ORDER_OUT_OF_STOCK
```

异常。

禁止：

```text
自动取消平台订单
```

也禁止：

单个缺货订单导致整批订单同步失败。

---

# 15. Reserved → Picked

仓库实际执行拣货时：

```text
Reserved - N
Picked + N
```

此时：

```text
On Hand 不变
```

含义：

商品已经从正常库位拿出来，

但尚未正式完成出库。

---

# 16. 为什么必须区分 Picked

例如订单已经锁定：

```text
Reserved = 1
```

这件商品仍可能在：

```text
A01-02
```

库位。

但一旦拣货：

商品可能已经位于：

- 拣货篮
- 工作台
- 待发货区域

因此取消订单时不能再简单认为：

商品仍在原库位。

---

# 17. 拣货扫描

仓库拣货必须校验：

```text
SKU
Quantity
```

如果 SKU 开启：

```text
serial_tracking = true
```

还必须校验：

```text
SN
```

错误 SKU：

禁止确认。

数量不足：

禁止完成。

SN错误：

禁止完成。

---

# 18. 正式出库（Sprint 4 实现）

Shipment 完成全部校验后执行 `shipShipment()`，库存侧调用 Inventory 的
`ReservationService.shipStockPartialInTx`（事务感知公共 API，与
Shipment/Package/OrderItem 状态更新共用同一数据库事务）：

```text
Picked - N
On Hand - N
SN: PICKED → SHIPPED
```

事件类型为 `SHIP`（幂等键 `SHIP:<reservationId>:<shipmentKey>`）。

部分出库支持：`inventory_reservation_lines.shipped_qty` 记录每行已出库数量；
全部行 `shipped_qty == picked_qty` 时 Reservation Header 进入 `CONSUMED`，
否则保持 `PICKED`（余量仍可拦截）。重复出库同一 Shipment 返回幂等结果，
不得再次扣减库存、不得再次产生流水。

---

# 19. Reserved 状态订单取消

订单仍处于：

```text
Reserved
```

且商品尚未拣货：

允许释放 Reservation。

变化：

```text
Reserved - N
```

On Hand：

```text
不变
```

释放可以根据订单与仓库规则：

- 自动释放
- 人工释放

但必须留下业务记录。

---

# 20. Picked 状态订单取消

如果订单已经：

```text
Picked
```

禁止直接：

```text
Picked - N
```

并把商品重新当成可售。

必须创建：

```text
Interception Task
```

因为系统必须确认：

> 实体商品是否真的被找回。

---

# 21. 拦截成功回库

正确流程：

```text
订单取消
↓
创建 Interception Task
↓
仓库找到商品
↓
扫描 Order / Package
↓
扫描 SKU
↓
扫描 SN（如需要）
↓
扫描目标 Bin
↓
确认实体回库
```

完成后：

```text
Picked - N
On Hand 不变（绝不 +N）
SN: PICKED → IN_STOCK（回到扫码目标 Bin，reservation/picking 占用清空）
Reservation: PICKED → RELEASED（明确取消终态，不得保持 PICKED）
OrderItem: PICKED → RELEASED（取消终态）
```

Sprint 4 实现：`ReservationService.returnPickedStockInTx`，事件类型
`RETURN_PICKED`（幂等键 `RETURN_PICKED:<reservationId>:<interceptionKey>`），
回库数量 = 该 Reservation 剩余未出库的 Picked 数量（`picked_qty - shipped_qty`，
支持部分出库后取消的场景）。回库与 Package 解除、SN 更新、订单行终态
在**同一事务**内完成。

必须生成对应库存流水。

---

# 22. 拦截失败

如果商品无法找到：

禁止人工直接点击：

```text
恢复库存
```

应：

```text
Interception = FAILED
```

并进入异常中心。

后续根据：

- 是否已经实际交给物流；
- 是否丢失；
- 是否退回；

走对应业务处理。

---

# 23. SKU 扫错时禁止库存变化

扫码发现：

订单要求：

```text
SKU-A
```

员工扫描：

```text
SKU-B
```

系统必须：

```text
BLOCK
```

不能：

```text
提示错误但仍允许继续
```

任何失败扫码：

不得产生库存状态变化。

---

# 24. SN 管理

当：

```text
SKU.serial_tracking = true
```

库存必须能够追踪到具体单件。

SN至少拥有状态：

```text
IN_STOCK
RESERVED
PICKED
SHIPPED
IN_TRANSIT
DELIVERED
RETURNING
QC_PENDING
DEFECTIVE
SCRAPPED
```

SN状态必须与库存业务动作同步变化。

---

# 25. SN唯一占用

同一 SN：

不能同时被两个订单拣货。

已经：

```text
PICKED
SHIPPED
```

的 SN：

禁止再次用于其他订单。

---

# 26. 调拨

调拨必须区分：

```text
Source Warehouse
Transit
Target Warehouse
```

不能在调拨发出时：

直接给目标仓增加库存。

---

# 27. 调拨发出

例如深圳仓发出：

```text
100
```

则：

深圳仓：

```text
On Hand -100
```

同时调拨单记录：

```text
In Transit = 100
```

产生：

```text
TRANSFER_OUT
```

流水。

---

# 28. 调拨接收

目标仓实际确认：

```text
98
```

则：

目标仓：

```text
On Hand +98
```

在途：

```text
100 - 98 = 2
```

剩余2件：

不能自动消失。

必须继续：

```text
IN_TRANSIT
```

或：

```text
TRANSFER_DIFFERENCE
```

异常。

---

# 29. 部分调拨收货

系统必须支持：

```text
发100

第一次收60
第二次收38
剩余2
```

不得要求：

一次性完成整个调拨。

---

# 30. 平台仓库存

平台仓仍属于：

```text
Warehouse
```

但是平台 API 返回的库存数字：

属于：

```text
Platform Inventory / Snapshot
```

不能未经业务确认直接覆盖：

ERP实体调拨账。

---

# 31. 平台仓对账

例如：

ERP认为：

```text
OZON FBO = 100
```

平台API返回：

```text
98
```

系统应该：

```text
记录差异
↓
Exception Center
```

而不是：

直接：

```text
ERP On Hand = 98
```

除非后续明确执行：

库存调整 / 对账确认。

---

# 32. Channel Inventory

平台最终推送库存：

不得直接等于：

```text
On Hand
```

必须经过：

```text
On Hand
↓
Reserved
↓
Picked
↓
Safety Stock
↓
Available
↓
Inventory Allocator
↓
Channel Inventory
```

---

# 33. Inventory Allocator

分配器负责：

> 决定 Available Inventory 中有多少准备分配给某 Store。

当前允许模式：

```text
SHARED
FIXED
RATIO
MAX_LIMIT
```

---

# 34. SHARED

```text
Channel Target = Available
```

适用于：

多个渠道共同使用实时库存。

---

# 35. FIXED

例如规则：

```text
Fixed = 20
```

则：

```text
push = min(20, Available)
```

当前默认禁止主动超卖。

---

# 36. RATIO

例如：

```text
ratio = 50%
Available = 100
```

则：

```text
Target = 50
```

最终仍不得超过：

```text
Available
```

---

# 37. MAX_LIMIT

例如：

```text
Available = 500
Max Limit = 30
```

平台只展示：

```text
30
```

用于控制平台暴露库存。

---

# 38. 分配规则优先级

规则匹配：

```text
SKU + Store
↓
Store Default
↓
System Default
```

具体 SKU 规则优先级最高。

---

# 39. 当前禁止主动超卖

第一阶段：

```text
oversell = false
```

Allocator最终结果不得主动大于系统允许库存。

如果现实业务之后确实需要主动超卖：

必须单独修改业务规则。

AI不得自行启用。

---

# 40. Safety Stock

Safety Stock维度：

```text
SKU + Warehouse
```

例如：

```text
On Hand = 20
Reserved = 3
Picked = 2
Safety = 5
```

则：

```text
Available = 10
```

---

# 41. Safety Stock不会减少On Hand

Safety Stock只是：

销售保护量。

它不是：

实体库存状态。

因此设置：

```text
Safety Stock = 5
```

不得：

```text
On Hand -5
```

---

# 42. 手工库存调整

允许管理员执行：

```text
Manual Adjustment
```

但必须输入：

- SKU
- Warehouse
- Bin
- Adjustment Quantity
- Reason
- Remark

例如：

```text
+2
盘点补录

-1
商品损坏
```

必须写：

```text
InventoryTransaction
```

以及：

```text
Operation Log
```

---

# 43. 手工调整不能修改 Reserved / Picked 来“修数据”

普通库存调整只处理：

实体库存事实。

如果：

```text
Reserved
Picked
```

异常：

应修复对应：

- Reservation
- Picking
- Interception

业务记录。

禁止用手工库存调整绕开业务状态。

---

# 44. 盘点

盘点必须：

先记录：

```text
System Quantity
```

再录入：

```text
Counted Quantity
```

系统计算：

```text
Difference
```

确认盘点后：

才产生：

```text
STOCKTAKE_GAIN
```

或：

```text
STOCKTAKE_LOSS
```

库存流水。

---

# 45. 退货

退回商品不得直接进入：

```text
SELLABLE
```

首先进入：

```text
QC_PENDING
```

完成质检后：

转为：

```text
SELLABLE
DEFECTIVE
REPAIR
SCRAPPED
```

之一。

---

# 46. 退货无法关联订单

如果实体退货：

无法找到原始订单：

仍然必须保存退货事实。

进入：

```text
RETURN_ORDER_NOT_FOUND
```

异常。

不得为了无法匹配订单：

直接把商品塞回正常库存。

---

# 47. InventoryTransaction要求

每条库存流水至少应能够追踪：

```text
SKU
Warehouse
Bin
Transaction Type
Quantity Before
Quantity Change
Quantity After
Reference Type
Reference ID
Operator
Created At
Idempotency Key
```

---

# 48. Reference

库存流水必须尽可能关联业务单据。

例如：

```text
PURCHASE_RECEIPT
→ PurchaseReceipt

ORDER_RESERVE
→ OrderItem

ORDER_SHIP
→ Shipment / OrderItem

TRANSFER_OUT
→ StockTransfer

RETURN_RECEIPT
→ ReturnReceipt
```

禁止大量出现：

```text
reference = null
```

的不明库存流水。

---

# 49. 幂等

同一个业务动作重复请求：

不得重复改变库存。

例如：

```text
ORDER_RESERVE:orderItem123
```

收到两次：

最终只能：

```text
Reserved +1
```

一次。

不得：

```text
Reserved +2
```

---

# 50. 平台重复事件

Webhook、订单补拉、人工补同步：

都可能重复出现同一个业务事件。

库存系统不得假设：

```text
同一事件只会来一次
```

所有平台触发的库存业务必须考虑幂等。

---

# 51. 并发

库存业务必须保证：

同一库存行同时被多个订单操作时：

不会超卖。

核心场景：

```text
On Hand = 1
Available = 1
```

两个订单同时请求1件：

最终：

```text
Order A = RESERVED
Order B = BACKORDERED
```

或相反。

禁止：

两个都成功。

---

# 52. 禁止正常业务负库存

所有主动库存业务必须验证：

```text
On Hand >= 0
Reserved >= 0
Picked >= 0
```

以及合法关系。

例如：

```text
Reserved + Picked
```

不得超过对应允许范围。

---

# 53. 外部异常负库存

如果历史数据或平台异常导致：

库存账出现不合理情况：

不得静默：

```text
max(stock, 0)
```

把问题隐藏。

必须保留事实并产生异常。

---

# 54. Bin规则

同一个 SKU：

当前通常放一个 Bin，

但系统数据模型必须允许：

```text
SKU → 多Bin
```

同一个 Bin：

允许：

```text
多个SKU
```

因此不能建立：

```text
bin.sku_id
```

这种一对一结构。

---

# 55. Move Bin

库内移位：

```text
Bin A
→
Bin B
```

不会改变整个 Warehouse 的 On Hand。

但是需要留下：

库存位置变化记录。

涉及SN商品：

具体SN位置也必须更新。

---

# 56. 禁止直接删除库存记录

一旦某个：

```text
SKU + Warehouse + Bin
```

产生库存历史：

不得为了：

```text
quantity = 0
```

就物理删除相关历史。

余额行是否保留可由技术实现决定，

但库存流水必须长期保留。

---

# 57. 关键状态变化摘要

## Purchase

```text
不存在 / 0
↓
On Hand
```

## Order

```text
Available
↓
Reserved
↓
Picked
↓
Shipped
```

## Cancel before pick

```text
Reserved
↓
Available
```

## Cancel after pick

```text
Picked
↓
Interception
↓
实体回库
↓
Available
```

## Transfer

```text
Source On Hand
↓
In Transit
↓
Target On Hand
```

## Return

```text
Returned Physical Item
↓
QC_PENDING
↓
SELLABLE / DEFECTIVE / REPAIR / SCRAPPED
```

---

# 58. 修改本文档的条件

以下变更必须先修改或同步修改本文档：

- 增加新的库存数量概念；
- 增加新的 Inventory Condition；
- 改变 Available 公式；
- 改变 Reservation 逻辑；
- 改变 Picked 逻辑；
- 改变取消订单库存处理；
- 改变调拨逻辑；
- 改变退货入库逻辑；
- 开启主动超卖；
- 新增库存分配模式；
- 修改库存事务类型。

不得先写代码，再让文档适配代码。

---

# 59. 当前冻结规则

当前库存领域冻结以下规则：

1. Internal SKU 是库存唯一商品身份。
2. 实体库存与渠道库存严格分离。
3. Available由库存状态推导。
4. NO_INVENTORY_RECORD不等于0。
5. 所有库存变化必须写流水。
6. 所有库存占用必须有Reservation。
7. Reserved和Picked必须分离。
8. Picked订单取消不得直接恢复库存。
9. 调拨必须存在在途阶段。
10. 平台仓API库存只能用于同步和对账，不能静默覆盖ERP账。
11. Safety Stock不改变On Hand。
12. 当前禁止主动超卖。
13. 单个订单缺货进入BACKORDERED，不阻塞整批订单。
14. 库存业务必须幂等。
15. 库存并发必须防止双重占用。
16. 正常业务不得主动产生负库存。
17. 退货必须经过QC_PENDING。
18. 手工调整不得绕过Reservation/Picked等业务状态。
19. 库存流水必须关联业务来源。
20. 修改库存核心规则必须先更新本文档。

---

# 60. Sprint 2 Inventory Core 实现约定

以下为 Sprint 2 库存核心已实现并经验证的操作性约定（与上文规则一致，作为实现基线）。

## 60.1 数量与公式

- 所有库存数量为 `NUMERIC(18,3)`；服务端统一使用整数毫单位（bigint）运算，序列化为字符串（见 `common/utils/quantity.ts`）。
- `Physical Available = On Hand - Reserved - Picked`（按 Balance 行计算；Reserve / Move Bin 的可占用/可移动判断以此为准）。
- `Sellable Available = max(Physical Available - Safety Stock, 0)`（仅作为计算字段返回，不落库）。
- Reserve 依据 Physical Available 判定，不扣减 Safety Stock；Safety Stock 只影响 Sellable。

## 60.2 数据模型

- `inventory_balances`：唯一维度 `(sku_id, warehouse_id, bin_id, inventory_condition)`；DB CHECK 保证三个数量非负且 `reserved + picked <= on_hand`。0 余额行保留，与"从未初始化"可区分。
- `inventory_safety_stocks`：维度 `(sku_id, warehouse_id)`，策略数据，变更不产生流水。
- `inventory_reservations`（Header：业务来源/幂等键/状态）+ `inventory_reservation_lines`（按 Bin 的分配行，含 `picked_qty` 为部分拣货预留）。
- `inventory_events`（一个业务事件 = 一个幂等键）+ `inventory_transactions`（明细行，行幂等键为 `<event key>#<line>`，`transaction_no` 为 `<event_no>-<line>`）。
- Reservation 状态机：`ACTIVE → PICKED → CONSUMED`；`ACTIVE → RELEASED`；`PICKED → ACTIVE`（unpick）。`CANCELLED` 保留给未来订单取消流程，Sprint 2 无进入该状态的迁移。

## 60.3 库位规则

- 存放库存的仓库必须至少有一个库位；无实体库位管理的仓库在首次入库时自动创建系统虚拟库位 `DEFAULT`。
- 指定 `binId` 时必须属于同一仓库；跨仓移动属于未来 Transfer。

## 60.4 操作与事件类型

- `initializeStock → INITIAL_STOCK`（允许数量 0 以建立零余额记录）；`receiveStock → RECEIVE`（未来采购收货底层能力）。
- `reserveStock → RESERVE`（跨 Bin 贪心分配，按 bin_code 顺序）；`release/pick/unpick/ship → RELEASE/PICK/UNPICK/SHIP`。
- `moveBin → MOVE_BIN`（同一 Event 两条流水：源 -N / 目标 +N；不得移动 Reserved/Picked 占用部分）。
- `adjustStock → MANUAL_ADJUSTMENT`（仅 On Hand；不得使结果为负或低于占用；必须填写原因）。
- Reference 类型：`MANUAL / TEST / ORDER / IMPORT`（Reservation 第一阶段仅 `TEST / MANUAL / ORDER`）。

## 60.5 并发与幂等

- 写路径统一为：候选行按 `bin_code` 排序 → 逐行 `SELECT ... FOR UPDATE` → 重算可用量 → 变更 → 写 Event/Transaction → 提交。
- Reservation 幂等键落在 Header 与 Event 上（均唯一）；重复/并发同键请求返回首次结果（`idempotentReplay=true`），同键不同参数返回冲突错误。
- 生命周期操作可携带幂等键（`<OP>:<reservationId>:<clientKey>`）实现重放；不携带时由状态机拒绝重复执行（409），绝不重复扣减。
- INITIAL_INVENTORY 导入行幂等键：`INITIAL_INVENTORY:<importJobId>:<excelRowNumber>`；同一文件内重复库存维度行被拒绝。

## 60.6 已冻结实现决策

- Balance 行的创建只通过 `initializeStock / receiveStock / moveBin 目标`（`INSERT ... ON CONFLICT DO NOTHING` + FOR UPDATE）；查询不产生 Balance 副作用。
- Reservation / Picked / On Hand 的任何变化都必须且只能经 Inventory 模块 Service；流水与事件为审计数据，无删除接口。

---

# 61. Sprint 3 Inventory 扩展实现约定（部分拣货 + SN）

以下为 Sprint 3 在 Sprint 2 基线上新增并经验证的操作性约定（与上文规则一致）。

## 61.1 部分拣货（PICK 逐件累计）

- 新增 `ReservationService.pickStockPartial(reservationId, { quantity, serialNumbers?, operator, idempotencyKey?, remark? })`：一次从 Reserved → Picked 移动 ≤ 全量的数量。
- 实现方式与整单 PICK 相同：行按 `bin_code` 排序、逐行 FOR UPDATE、贪心扣除 `line.pickedQty`（`picked_qty` 字段即为此预留）；行拣满 → 行状态 PICKED；全部行拣满 → Header PICKED（部分拣货期间 Header 保持 ACTIVE，`pickedAt` 在首次拣货时记录）。
- 事件类型仍为 `PICK`；事件幂等键 `PICK:<reservationId>:<clientKey>`。Picking 模块的 scanKey 为 `PTI<pickingTaskItemId>#<结果计数>`，保证同一扫码重放幂等、并发不超卖。
- UNPICK / RELEASE / SHIP 仍为整单操作；部分拣货后的 Reservation 处于 ACTIVE 且存在已拣行时，RELEASE 被状态机拒绝（先由上层业务约束：部分拣货中的订单禁止取消）。

## 61.2 InventorySerial（单件追踪明细）

- `inventory_serials`：`serial_number` 全局 UNIQUE；状态 `IN_STOCK / RESERVED / PICKED / SHIPPED`（SHIPPED 留给 Shipment 阶段）；`reservation_id` / `picking_task_item_id` 为占用追溯。
- SN 不是第二库存事实源：数量事实仍是 `inventory_balances`；涉及 Serial Tracking SKU 的库存动作，Balance 与 SN 必须同事务一致。
- `initializeStock / receiveStock`：`serial_tracking = true` 的 SKU 必须提供与数量一致（数量必须为整数件）的 SN 列表，超集/缺失均拒绝；非 SN 商品携带 SN 列表直接拒绝（422）。
- `reserveStock`：SN 商品按已分配的 Reservation 行所在 Bin 逐行选取 IN_STOCK SN（按 serial_number 排序）标记 RESERVED；某 Bin SN 不足即整体回滚并返回 `INVENTORY_INSUFFICIENT_STOCK`。
- `releaseReservation`：该 Reservation 名下 RESERVED SN 回到 IN_STOCK；`pickStockPartial` / `pickStock`：携带的 SN（必须属于该 Reservation 且状态 RESERVED）→ PICKED 并写入 `picking_task_item_id`；`unpickStock`：PICKED SN → RESERVED。
- SN 数量不变式：同一 `(sku, warehouse)` 下 `IN_STOCK + RESERVED + PICKED` 的 SN 件数必须等于对应 Balance 的 `onHand - (非 SN 维度的差异)`——由同事务写入保证，不做异步对账。