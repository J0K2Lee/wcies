# WCIES Agent Task
## Sprint 3 — Order Core + Picking Workflow

### 任务目标

在已完成：

```text
Sprint 0 Engineering Foundation
Sprint 1 Master Data
Sprint 2 Inventory Core
```

基础上，实现 WCIES 的：

```text
Order Core
Order Item
Order Status History
Order Ingestion
SKU Resolution
Inventory Reservation Integration
Backorder
Picking Task
Picking Task Item
Barcode Scan Validation
SN Scan Interface Reservation
Order Cancellation Inventory Handling
Exception Integration
```

本 Sprint 目标是打通：

```text
标准化订单输入
↓
创建 Order / OrderItem
↓
Listing Resolver
↓
Inventory Reservation
↓
RESERVED / BACKORDERED
↓
Picking Task
↓
仓库扫码
↓
Picked
```

本 Sprint **不接真实 OZON / WB / Yandex API**。

---

# 一、开始任务前

先执行：

```text
git status
```

确认工作区干净。

必须阅读：

```text
AGENTS.md

docs/business-rules/inventory.md
docs/business-rules/orders.md

docs/architecture/*
```

重点阅读现有：

```text
ListingResolverService
InventoryService
InventoryReservation
InventoryEvent
InventoryTransaction
Warehouse / Bin
Barcode
Store
```

实现。

不得重新实现另一套：

```text
Reservation
Inventory Ledger
SKU Resolver
```

---

# 二、Sprint 3 第一任务：完善 orders.md

当前：

```text
docs/business-rules/orders.md
```

只是骨架。

正式编码 Order Core 前，先根据本任务书把以下规则固化到该文档：

1. Platform Status 与 ERP Status 分离；
2. Order 与 OrderItem 分离；
3. Order 与 Shipment 分离；
4. 新订单何时锁库存；
5. 缺货行为；
6. Backorder；
7. OrderItem 库存履约状态；
8. 取消订单；
9. Reserved取消；
10. Picked取消；
11. PickingTask规则；
12. 状态历史；
13. 幂等。

不得新增本任务书之外的业务规则。

---

# 三、明确不做

本 Sprint 禁止实现：

```text
OZON真实API
WB真实API
Yandex真实API

Webhook真实接入
平台订单Cron
平台库存推送

ShippingLabel真实获取
物流轨迹
正式Shipment出库流程

Purchase
Transfer
Return
Finance
Allocator
```

允许：

建立 Shipment 所需的关联字段或接口边界。

但不要实现 Shipment 模块业务。

---

# 四、Order模型

建立：

```text
orders
```

字段建议：

```text
id UUID PK

order_no VARCHAR UNIQUE NOT NULL

store_id UUID NOT NULL

platform_order_id VARCHAR NOT NULL

platform_status VARCHAR NULL

erp_status VARCHAR NOT NULL

fulfillment_mode VARCHAR NULL

currency VARCHAR NULL

ordered_at TIMESTAMPTZ NOT NULL

raw_data JSONB NULL

remark TEXT NULL

created_at
updated_at
```

必须：

```text
UNIQUE(store_id, platform_order_id)
```

禁止：

```text
UNIQUE(platform_order_id)
```

---

# 五、ERP Order Status

Sprint 3 建议只使用内部必要状态：

```text
NEW
ALLOCATING
READY_TO_PICK
PARTIALLY_BACKORDERED
BACKORDERED
PICKING
PICKED
CANCELLED
EXCEPTION
```

不要在本 Sprint 加：

```text
SHIPPED
DELIVERED
RETURNED
```

作为实际业务流程。

Shipment Sprint 再加入对应状态迁移。

如认为需要预留枚举值：

可以定义，但禁止让当前业务进入尚未实现的状态。

---

# 六、OrderItem

建立：

```text
order_items
```

字段至少：

```text
id UUID PK

order_id UUID NOT NULL

line_no INTEGER NOT NULL

platform_product_id VARCHAR NULL
platform_sku_id VARCHAR NULL
seller_sku VARCHAR NULL
offer_id VARCHAR NULL

listing_sku_id UUID NULL
sku_id UUID NULL

quantity NUMERIC(18,3) NOT NULL

fulfillment_status VARCHAR NOT NULL

mapping_status VARCHAR NOT NULL

raw_data JSONB NULL

created_at
updated_at
```

---

# 七、Order Item Mapping Status

至少：

```text
PENDING
MAPPED
FAILED
```

如果：

平台订单行无法解析 Internal SKU：

```text
mapping_status = FAILED
```

并创建：

```text
ORDER_SKU_MAPPING_FAILED
```

异常。

不得猜测 SKU。

---

# 八、Order Item Fulfillment Status

Sprint 3至少：

```text
PENDING
RESERVED
BACKORDERED
PICKED
RELEASED
```

严格区分：

Order Status

和：

OrderItem Fulfillment Status。

---

# 九、Order Status History

建立：

```text
order_status_history
```

至少：

```text
id
order_id
from_status
to_status
reason
operator_id
created_at
```

每一次 ERP Order Status 变化：

必须写 History。

禁止只改：

```text
orders.erp_status
```

---

# 十、平台状态

保存：

```text
platform_status
```

但：

禁止直接：

```text
order.erpStatus = platformStatus
```

必须经过：

```text
OrderStatusService
```

解释。

Sprint 3没有真实Adapter，所以只建立边界。

---

# 十一、OrderIngestionService

实现：

```text
OrderIngestionService
```

接受一个 WCIES 内部标准 DTO：

```text
NormalizedOrderInput
```

它不是某个平台 DTO。

至少：

```text
storeId
platformOrderId
platformStatus
fulfillmentMode
orderedAt
currency
items[]
rawData
```

Item：

```text
platformProductId?
platformSkuId?
sellerSku?
offerId?
quantity
rawData?
```

---

# 十二、禁止平台字段污染

`OrderIngestionService` 内：

不得出现：

```text
OZON
WB
YANDEX
```

判断。

如果需要处理平台差异：

应该在未来 Adapter / Mapper完成。

---

# 十三、订单摄入幂等

唯一业务键：

```text
storeId + platformOrderId
```

重复摄入同订单：

不得：

- 创建第二张订单；
- 重复创建OrderItem；
- 重复Reservation；
- 重复InventoryTransaction。

---

# 十四、Raw Data

必须保留：

```text
Order.raw_data
OrderItem.raw_data
```

供未来平台API排查。

统一模型不能覆盖原始平台事实。

---

# 十五、Listing Resolver接入

每个 Order Item：

通过现有：

```text
ListingResolverService
```

解析 Internal SKU。

必须：

```text
Store Scoped
```

不得写第二套Resolver。

---

# 十六、Resolver优先级

按照现有 Listing Resolver 已实现契约使用。

不得在 OrderModule 自行写：

```text
offerId → sku
platformSkuId → sku
```

查询。

如果现有Resolver不足：

扩展Resolver公开接口。

不要绕过。

---

# 十七、Mapping失败

一个订单中：

```text
3 items
```

其中：

```text
2 mapped
1 failed
```

必须：

保存整张Order。

失败行：

```text
mapping_status = FAILED
```

创建：

```text
ORDER_SKU_MAPPING_FAILED
```

异常。

其他行：

仍然可以继续 Reservation。

---

# 十八、单行失败不得阻塞订单摄入

原则：

```text
尽可能行级失败
```

不能因为一个 Item Mapping失败：

整个订单数据库事务完全不存在。

但订单基本结构创建必须保持一致。

---

# 十九、库存锁定

成功 Mapping 后：

调用现有：

```text
InventoryService / ReservationService
```

创建库存 Reservation。

禁止 OrderModule：

直接修改：

```text
reserved_qty
inventory_balances
```

---

# 二十、Reserve Reference

Order Item产生 Reservation 时：

建议：

```text
referenceType = ORDER_ITEM
referenceId = orderItem.id
```

幂等Key：

```text
ORDER_RESERVE:<orderItemId>
```

不要使用平台订单字符串作为库存内部唯一引用。

---

# 二十一、库存足够

Reservation成功：

```text
OrderItem.fulfillment_status
=
RESERVED
```

---

# 二十二、库存不足

Inventory Core返回：

```text
INVENTORY_INSUFFICIENT_STOCK
```

OrderIngestion：

不得失败整个订单。

该行：

```text
fulfillment_status
=
BACKORDERED
```

并创建：

```text
ORDER_OUT_OF_STOCK
```

异常。

不得：

创建负库存。

不得：

自动取消平台订单。

---

# 二十三、Order汇总状态

建议：

如果所有可履约Item：

```text
RESERVED
```

则：

```text
READY_TO_PICK
```

如果：

部分RESERVED

部分BACKORDERED：

```text
PARTIALLY_BACKORDERED
```

如果：

全部需要库存的Item都是BACKORDERED：

```text
BACKORDERED
```

如果存在Mapping Failed：

根据已有可履约项继续处理，

Order可以：

```text
EXCEPTION
```

或保留业务汇总状态并附Exception。

请采用一个清晰模型，

并在 `orders.md` 明确。

---

# 二十四、Backorder重试

实现：

```text
retryBackorder(orderItemId)
```

或批量等价能力。

逻辑：

```text
BACKORDERED
↓
重新尝试reserveStock
↓
成功 → RESERVED
失败 → BACKORDERED
```

不得重复创建异常垃圾。

已有未解决异常：

更新/保留即可。

---

# 二十五、Exception Center

如果现有：

```text
system_exceptions
```

已经存在：

复用。

如果 Sprint 0/1 尚未真正实现：

本 Sprint建立最小：

```text
system_exceptions
```

至少：

```text
id
exception_type
severity
status
reference_type
reference_id
store_id
message
details JSONB
created_at
resolved_at
```

---

# 二十六、Exception Type

本 Sprint至少：

```text
ORDER_SKU_MAPPING_FAILED
ORDER_OUT_OF_STOCK
ORDER_INVALID_STATE
```

---

# 二十七、Exception状态

至少：

```text
OPEN
RESOLVED
IGNORED
```

不得物理删除历史异常。

---

# 二十八、Picking Task

建立：

```text
picking_tasks
```

字段至少：

```text
id UUID

picking_no VARCHAR UNIQUE

warehouse_id UUID NOT NULL

status VARCHAR NOT NULL

created_at
started_at
completed_at

created_by
assigned_to NULL
```

---

# 二十九、Picking Task Item

建立：

```text
picking_task_items
```

字段至少：

```text
id

picking_task_id

order_id
order_item_id

sku_id

reservation_id

required_qty
picked_qty

status

created_at
updated_at
```

---

# 三十、Picking Task Status

至少：

```text
CREATED
IN_PROGRESS
COMPLETED
CANCELLED
```

---

# 三十一、Picking Item Status

至少：

```text
PENDING
PICKED
```

如扫码失败：

不新增业务状态。

只是：

拒绝该扫码操作。

---

# 三十二、Picking Task创建条件

只有：

```text
RESERVED
```

Order Item：

才能进入Picking Task。

以下不能进入：

```text
BACKORDERED
MAPPING_FAILED
RELEASED
```

---

# 三十三、按仓拆Picking Task

一个 Order 如果未来涉及多个 Warehouse：

必须按Warehouse拆Picking Task。

Sprint 3即使测试数据单仓：

模型也必须：

```text
1 PickingTask = 1 Warehouse
```

禁止：

一个PickingTask跨仓。

---

# 三十四、Picking生成

实现：

```text
createPickingTask(...)
```

输入可以：

- Order；
- 多个Order；
- 选定OrderItems。

第一阶段优先实现简单：

```text
从指定 READY_TO_PICK Order
生成 PickingTask
```

但底层模型不要绑死“一单一个PickingTask”。

---

# 三十五、扫描识别

Picking扫描使用：

```text
SKU Barcode
```

输入：

```text
barcode
```

通过现有：

```text
sku_barcodes
```

解析 Internal SKU。

禁止前端自己判断Barcode对应SKU。

后端负责验证。

---

# 三十六、错误SKU

PickingTaskItem要求：

```text
SKU-A
```

扫描：

```text
SKU-B
```

必须：

```text
BLOCK
```

返回明确错误：

```text
PICKING_SKU_MISMATCH
```

不得改变任何库存。

---

# 三十七、正确SKU

扫描正确：

调用现有：

```text
InventoryService.pickStock()
```

或 Reservation Pick能力。

不得：

PickingModule直接修改：

```text
reserved_qty
picked_qty
```

---

# 三十八、多Item完整性

一个Order：

```text
3 OrderItems
```

必须：

全部正确Pick完成，

才能：

```text
PickingTask = COMPLETED
```

或对应Warehouse Task全部Items完成。

---

# 三十九、Quantity扫描

当前3C场景大多一件。

但必须支持：

```text
quantity > 1
```

至少能够：

- 一次确认整行数量；
- 或逐件Scan计数。

建议 Sprint 3：

**逐件扫码累计 pickedQty**

更符合仓库流程。

---

# 四十、重复扫描

如果：

```text
requiredQty = 2
```

已经：

```text
pickedQty = 2
```

再扫描：

必须拒绝：

```text
PICKING_QUANTITY_EXCEEDED
```

不得多Pick。

---

# 四十一、SN预留接口

Sprint 2尚未实现完整 InventorySerial 生命周期。

因此本 Sprint：

不要伪造SN库存。

但 Picking API 设计必须预留：

```text
serialNumber?
```

如果：

```text
sku.serial_tracking = true
```

当前系统还无法完成真正SN验证时：

明确：

```text
PICKING_SERIAL_TRACKING_NOT_IMPLEMENTED
```

或者将SN支持划为Sprint 3内最小实现。

---

# 四十二、SN建议

由于用户已确认某些SKU必须单件SN管理，

建议 Sprint 3 **实现最小 InventorySerial**：

```text
inventory_serials
```

至少：

```text
id
sku_id
warehouse_id
bin_id
serial_number UNIQUE
status
reservation_id NULL
picking_task_item_id NULL
created_at
updated_at
```

状态：

```text
IN_STOCK
RESERVED
PICKED
SHIPPED
```

本 Sprint只真正使用：

```text
IN_STOCK
RESERVED
PICKED
```

`SHIPPED`留给Shipment阶段。

---

# 四十三、SN与库存数量一致性

如果实现InventorySerial：

不能把SN做成另一个独立库存事实源。

InventoryBalance：

仍然是数量事实。

SN：

是单件追踪明细。

涉及Serial Tracking SKU的库存动作：

Balance和Serial状态必须同事务一致。

---

# 四十四、SN入库

由于 Sprint 2现有 initialize/receive 没有SN：

如果SKU：

```text
serial_tracking = true
```

并且本Sprint开始真正管理SN，

必须扩展：

```text
initialize/receive
```

要求提供对应数量SN列表。

不得：

On Hand = 10

但只有：

8个SN。

---

# 四十五、SN实现边界

如果加入SN会显著扩大任务范围：

先完成非SN订单/拣货闭环，

再作为：

```text
S3-SN
```

独立切片。

但 Sprint 3最终完成定义前：

必须至少形成经过测试的SN基础闭环。

因为这是已确认业务需求。

---

# 四十六、Picking页面

新增：

```text
/operations/picking
```

或：

```text
/picking
```

建议面向仓库人员：

比普通管理页面更大、更简单。

---

# 四十七、Picking页面重点

显示：

```text
Picking No

Warehouse

Orders Count

Items Progress

Status
```

进入Task：

突出：

```text
待拣SKU
图片
SKU Code
名称
目标Bin
Required
Picked
Barcode Scan Input
```

---

# 四十八、扫码输入

页面应适配：

```text
USB / Bluetooth Scanner
```

本质键盘输入。

扫码框：

- 自动聚焦；
- Enter提交；
- 成功后重新聚焦；
- 错误大红提示；
- 成功明显提示。

无需本Sprint做浏览器硬件API。

---

# 四十九、目标库位

PickingTaskItem应能够展示：

Reservation Lines对应的：

```text
Bin
Quantity
```

让仓库知道去哪里找。

---

# 五十、多Bin拣货

如果Reservation：

```text
A01 = 2
A02 = 3
```

Picking UI必须能够展示：

```text
A01 ×2
A02 ×3
```

不得只显示：

SKU总数5。

---

# 五十一、扫码与Bin校验

第一阶段：

扫描SKU必须严格。

是否要求：

先扫描Bin再扫描SKU：

可以先不强制。

但后续仓库高可靠流程会需要。

建议 API预留：

```text
binBarcode?
```

---

# 五十二、取消订单

实现内部：

```text
cancelOrder()
```

本 Sprint由：

人工/API测试触发。

不接平台取消事件。

---

# 五十三、Reserved订单取消

如果 OrderItem：

```text
RESERVED
```

则：

调用：

```text
releaseReservation()
```

然后：

```text
fulfillment_status = RELEASED
```

Order对应状态：

更新。

---

# 五十四、Backordered订单取消

如果：

```text
BACKORDERED
```

没有库存锁定。

取消：

直接：

```text
RELEASED
```

或等价取消终态。

不得执行库存Release。

---

# 五十五、Picked订单取消

如果：

```text
PICKED
```

禁止：

直接：

```text
unpick
release
恢复Available
```

必须创建：

```text
OrderInterception
```

任务。

---

# 五十六、Order Interception

建立：

```text
order_interceptions
```

至少：

```text
id

order_id
order_item_id NULL

warehouse_id

status

reason

created_at
assigned_at
intercepted_at
returned_to_stock_at
closed_at

assigned_to NULL
```

---

# 五十七、Interception状态

使用已冻结：

```text
CREATED
ASSIGNED
LOCATING
INTERCEPTED
FAILED
RETURNED_TO_STOCK
CLOSED
```

本 Sprint至少实现：

创建。

完整飞书和扫码回库：

可以下一仓库/通知Sprint继续。

但不得：

Picked取消时自动恢复库存。

---

# 五十八、Notification边界

如果现有 Notification尚未实现：

本 Sprint不要直接调用飞书Webhook。

Picked取消：

发布：

```text
ORDER_INTERCEPTION_REQUIRED
```

Domain Event。

可先记录：

Notification Pending / Log。

真实飞书发送后续完成。

---

# 五十九、Order API

至少：

```text
GET /api/v1/orders
GET /api/v1/orders/:id

POST /api/v1/orders/ingest
POST /api/v1/orders/:id/cancel

POST /api/v1/orders/items/:itemId/retry-allocation
```

`ingest`：

当前仅管理员 / 开发测试入口。

后续SyncService复用：

```text
OrderIngestionService
```

而不是HTTP接口。

---

# 六十、Picking API

至少：

```text
GET /api/v1/picking-tasks

POST /api/v1/picking-tasks

GET /api/v1/picking-tasks/:id

POST /api/v1/picking-tasks/:id/start

POST /api/v1/picking-tasks/:id/scan

POST /api/v1/picking-tasks/:id/complete
```

如Service能自动完成：

`complete`可以只验证全部Item已Pick。

---

# 六十一、Order列表

前端：

```text
/orders
```

显示：

```text
Order No
Platform
Store
Platform Order ID
Ordered At
ERP Status
Platform Status
Items
Reserved
Backordered
Exceptions
```

---

# 六十二、Order详情

建议：

Drawer / Page：

```text
Order Summary
Items
Reservation
Status History
Exceptions
Picking
Raw Data（管理员）
```

---

# 六十三、缺货突出展示

BACKORDERED：

必须明显：

```text
红色/警告 Badge
```

并可执行：

```text
重新尝试分配
```

---

# 六十四、Mapping Failed展示

必须与：

```text
BACKORDERED
```

区分。

一个是：

```text
不知道是什么SKU
```

一个是：

```text
知道SKU但没库存
```

UI和错误码不得混淆。

---

# 六十五、Order Ingestion Import/Test

为了在无真实平台API情况下验收：

可以新增：

```text
Mock / Manual Order JSON
```

开发入口。

推荐：

固定 JSON Fixture。

不要增加复杂Excel订单导入。

---

# 六十六、Mock订单Fixture

至少准备：

### Case A

单SKU正常订单。

### Case B

多SKU正常订单。

### Case C

一个SKU缺货。

### Case D

一个Listing无法映射。

### Case E

同一订单重复摄入。

### Case F

跨两个Store相同platformOrderId。

---

# 六十七、必须测试：正常订单

库存：

```text
SKU-A = 10
```

Order：

```text
SKU-A ×2
```

结果：

```text
OrderItem = RESERVED
Inventory Reserved +2
Order = READY_TO_PICK
```

---

# 六十八、必须测试：缺货

库存：

```text
SKU-A = 1
```

订单：

```text
SKU-A ×2
```

结果：

```text
Order存在
OrderItem = BACKORDERED
Inventory不变
Exception = ORDER_OUT_OF_STOCK
```

---

# 六十九、必须测试：部分缺货

订单：

```text
SKU-A ×1
SKU-B ×1
```

其中：

```text
A有库存
B无库存
```

结果：

```text
A = RESERVED
B = BACKORDERED
```

A的Reservation必须保留。

整单不能Rollback消失。

---

# 七十、必须测试：Mapping Failed

订单行：

平台SKU无映射。

结果：

```text
Order保存
OrderItem mapping=FAILED
skuId=NULL
Exception=ORDER_SKU_MAPPING_FAILED
```

不得：

猜SKU。

---

# 七十一、必须测试：订单幂等

相同：

```text
storeId + platformOrderId
```

摄入10次。

最终：

```text
1 Order
正确数量OrderItems
1次Reservation
1组InventoryEvent
```

---

# 七十二、必须测试：跨Store同订单号

```text
Store A platformOrderId = 123
Store B platformOrderId = 123
```

必须：

允许两张独立订单。

---

# 七十三、必须测试：Backorder自愈

第一次：

库存不足：

```text
BACKORDERED
```

后来：

initialize/receive库存。

执行：

```text
retryBackorder
```

结果：

```text
RESERVED
Exception resolved
Order状态重新计算
```

---

# 七十四、必须测试：Picking正确扫码

Reservation：

```text
SKU-A
```

扫码：

SKU-A Barcode。

结果：

```text
Inventory
Reserved -1
Picked +1

Picking Item pickedQty +1
```

---

# 七十五、必须测试：扫码错SKU

要求：

```text
SKU-A
```

扫码：

```text
SKU-B
```

结果：

```text
PICKING_SKU_MISMATCH
```

Inventory：

完全不变。

---

# 七十六、必须测试：多商品完整性

Task：

```text
SKU-A
SKU-B
SKU-C
```

只完成：

A/B。

不得：

```text
PickingTask COMPLETED
```

C完成后：

才允许Completed。

---

# 七十七、必须测试：重复超量扫描

required：

```text
2
```

扫描正确条码：

3次。

第3次：

必须失败。

最终：

```text
pickedQty=2
```

---

# 七十八、必须测试：多Bin

Reservation：

```text
A01 ×2
A02 ×3
```

PickingTask：

必须准确保留并展示两条Bin需求。

不得丢失库位来源。

---

# 七十九、必须测试：Reserved Cancel

流程：

```text
Order RESERVED
↓
Cancel
```

结果：

```text
Reservation RELEASED
Reserved Qty恢复
OrderItem RELEASED
```

---

# 八十、必须测试：Backorder Cancel

结果：

不调用库存Release。

OrderItem进入取消终态。

---

# 八十一、必须测试：Picked Cancel

流程：

```text
Reserve
Pick
Cancel
```

结果必须：

```text
Picked库存保持
Interception创建
```

不得：

```text
Picked -N
Reserved +N
```

或直接恢复可售。

---

# 八十二、必须测试：Order History

每个主要状态变化：

必须有：

```text
order_status_history
```

记录。

确保：

不能出现当前Order状态改变但History没有记录。

---

# 八十三、事务边界

Order Ingestion涉及：

```text
Order
OrderItem
Inventory Reservation
Exception
```

注意：

部分行允许业务失败。

因此不要简单用一个：

```text
整个订单大事务，任一Item失败全部Rollback
```

需要设计：

订单基础记录

与：

Item allocation

之间合理事务边界。

最终报告必须说明。

---

# 八十四、并发订单摄入

同一订单：

两个 Worker 同时 ingest。

必须：

通过：

```text
UNIQUE(store_id, platform_order_id)
```

+ 幂等逻辑

保证：

只存在一张Order。

不能靠：

“Queue应该不会重复”。

---

# 八十五、Picking并发

同一 PickingTaskItem：

两个扫码请求同时到达。

必须：

不能超过：

```text
requiredQty
```

应有：

行锁/事务。

不能只靠前端禁按钮。

---

# 八十六、NUMERIC

继续复用 Sprint 2：

```text
quantity.ts
```

统一策略。

禁止：

Order/Picking重新创建数量计算方法。

---

# 八十七、Architecture Check

Sprint 3完成前增强检查：

至少确保：

```text
OrderModule
PickingModule
```

不得 import：

```text
Inventory Repository
InventoryBalance Entity
```

只能调用 Inventory 公共 Service。

---

# 八十八、测试数据清理

Sprint 2报告指出：

集成测试不断向 dev 数据库追加 PERF 数据。

本 Sprint必须改善。

推荐：

测试使用：

```text
独立 Test Database
```

并：

每个Suite隔离前缀/事务/清理。

不得继续无限污染：

开发业务数据库。

---

# 八十九、不要误删开发真实数据

改测试隔离时：

不得：

```text
TRUNCATE dev database
```

必须确认：

```text
NODE_ENV=test
DATABASE=wcies_test
```

才允许破坏性清理。

---

# 九十、性能

当前订单量：

20–50单/天。

不需要复杂优化。

订单列表：

5000 Order测试数据下：

正常分页即可。

主要目标：

无明显N+1。

---

# 九十一、Migration

建议：

```text
create_orders
create_order_items
create_order_status_history

create_system_exceptions

create_picking_tasks
create_picking_task_items

create_order_interceptions

create_inventory_serials（如实现）

add_order_picking_indexes
```

按实际依赖拆分。

---

# 九十二、OpenAPI

全部新增API：

Swagger完整。

完成后：

```text
openapi:export
api-client:generate
```

前端使用：

```text
@wcies/api-client
```

---

# 九十三、GUI验收

至少实际浏览器验证：

1. Orders列表正常；
2. 正常订单摄入；
3. 缺货订单Badge；
4. Mapping Failed明显；
5. Backorder重新分配；
6. Picking Task创建；
7. Barcode正确扫描；
8. 错误SKU扫描被阻止；
9. 多Item未完成不可结束；
10. Order历史可查看。

---

# 九十四、Git提交建议

例如：

```text
feat(order): add order core and status history

feat(order): add normalized ingestion and inventory allocation

feat(exception): add order exceptions

feat(picking): add picking tasks and scan workflow

feat(order): add cancellation and interception behavior

feat(serial): add serial tracking foundation

feat(web): add order and picking UI

test(order): add ingestion idempotency and allocation tests

test(picking): add scan and concurrency tests
```

不强制提交数量。

---

# 九十五、最终验证

必须运行：

```text
pnpm lint
pnpm typecheck
pnpm check:arch
pnpm test
pnpm test:integration
pnpm build
```

并执行：

空库全部Migration + Seed。

---

# 九十六、Sprint 3最终报告

按以下结构：

## 1. 完成内容

## 2. Order Model

## 3. Order / Item 状态机

## 4. Order Ingestion事务策略

## 5. Inventory Integration

## 6. Backorder逻辑

## 7. Picking Model

## 8. Barcode Scan

## 9. Serial Tracking

## 10. Cancellation / Interception

## 11. Exception Center

## 12. API

## 13. Frontend

## 14. Tests

## 15. GUI Acceptance

## 16. Migration

## 17. Architecture Check

## 18. 新增决策

## 19. 未完成项

## 20. 风险

## 21. Git

## 22. 下一步

Sprint 3完成后：

**停止。**

不得自行开始真实平台同步。

---

# 九十七、Sprint 3完成定义

必须满足：

```text
Order模型可靠
OrderItem模型可靠
Store+PlatformOrderId幂等

Listing Resolver正确接入

正常订单自动Reservation
缺货进入BACKORDERED
Mapping失败进入异常
部分失败不阻塞正常Item

OrderStatusHistory完整

PickingTask工作
PickingTaskItem工作
多Bin信息保留

扫码正确SKU成功
错误SKU严格阻止
超量扫描严格阻止
多Item完整性检查有效

Reserved取消释放库存
Backorder取消不碰库存
Picked取消不恢复库存
Interception创建

SN基础闭环可工作

Order/Picking不直接修改Inventory表

测试数据不再污染dev业务库

OpenAPI通过
Web可操作
Migration空库通过

lint通过
typecheck通过
architecture check通过
unit通过
integration通过
build通过
```

才可以将：

**WCIES Sprint 3 — Order Core + Picking Workflow**

标记完成。