# WCIES Agent Task
## Sprint 4 — Shipment、Package、正式出库与订单拦截闭环

## 一、Sprint 4 目标

在已完成：

- Sprint 0 Engineering Foundation
- Sprint 1 Master Data
- Sprint 2 Inventory Core
- Sprint 3 Order Core + Picking

基础上，实现仓库履约后半段：

```text
READY_TO_PICK
↓
Picking
↓
PICKED
↓
Shipment
↓
Package
↓
Shipping Ready
↓
正式出库
↓
SHIPPED
```

以及取消订单后的：

```text
Picked Order Cancelled
↓
Interception
↓
找到实体商品
↓
扫描 Package / SKU / SN / Bin
↓
Return To Stock
↓
关闭拦截任务
```

Sprint 4 完成后，WCIES 必须具备完整的内部仓库履约闭环。

---

# 二、开始前必须检查

执行：

```bash
git status
```

并阅读：

```text
AGENTS.md

docs/business-rules/inventory.md
docs/business-rules/orders.md

docs/architecture/*
```

重点阅读现有：

```text
InventoryService
ReservationService
pickStockPartial
InventorySerial
OrderService
PickingService
OrderInterception
Exception
ObjectStorageService
```

不得重新实现第二套库存或订单状态机。

---

# 三、P0 前置任务：修复 Picking 原子性

Sprint 3报告指出：

```text
PickingTaskItem pickedQty递增
↓
Inventory pickStockPartial
```

当前不是一个数据库事务。

这是 Sprint 4 开始前必须解决的问题。

目标：

> PickingTaskItem状态变化与Inventory Reserved→Picked必须原子提交。

---

# 四、Picking 原子性要求

以下动作必须在同一事务成功或失败：

```text
锁 PickingTaskItem
↓
确认 pickedQty < requiredQty
↓
锁 Reservation / Balance
↓
Reserved -1
↓
Picked +1
↓
更新 Reservation Line
↓
更新 PickingTaskItem.pickedQty
↓
更新 InventorySerial（如适用）
↓
Inventory Event / Transaction
↓
必要时更新OrderItem状态
↓
COMMIT
```

任何一步失败：

```text
ROLLBACK
```

不得继续依赖：

“先改Picking，再失败补偿”。

---

# 五、不得破坏 Inventory 边界

修复原子性不能通过：

```text
PickingModule直接UPDATE inventory_balances
```

完成。

应设计 Inventory 暴露的：

```text
transaction-aware public service
```

或 Application Service 协调同一 QueryRunner / EntityManager。

要求：

- Inventory仍拥有库存规则；
- Picking不掌握库存计算；
- 但整个业务命令可以共享同一数据库事务。

最终报告必须说明采用的事务协调方案。

---

# 六、Sprint 4 不做

本 Sprint禁止：

```text
真实OZON API
真实WB API
真实Yandex API

真实平台订单同步
平台库存推送
平台Webhook

Finance
Purchase完整业务
Transfer完整业务
Return完整售后模块
```

Shipping Label 先实现：

**平台无关的文件/元数据模型与手工上传能力。**

真实平台面单获取留给 Platform Integration Sprint。

---

# 七、Shipment 模型

建立：

```text
shipments
```

至少：

```text
id UUID PK

shipment_no VARCHAR UNIQUE NOT NULL

order_id UUID NOT NULL

warehouse_id UUID NOT NULL

status VARCHAR NOT NULL

shipping_method VARCHAR NULL

tracking_number VARCHAR NULL

carrier_code VARCHAR NULL

external_shipment_id VARCHAR NULL

shipped_at TIMESTAMPTZ NULL

created_at
updated_at
```

---

# 八、Shipment Status

Sprint 4 使用：

```text
DRAFT
READY_TO_PACK
PACKING
READY_TO_SHIP
SHIPPED
CANCELLED
EXCEPTION
```

不得直接使用物流轨迹状态作为 Shipment Status。

---

# 九、Order 与 Shipment 分离

必须支持：

```text
Order
1
↓
N
Shipment
```

禁止设计成：

```text
orders.tracking_number
orders.package_id
```

作为核心物流模型。

---

# 十、Package

建立：

```text
packages
```

字段至少：

```text
id UUID PK

package_no VARCHAR UNIQUE

shipment_id UUID NOT NULL

status VARCHAR NOT NULL

tracking_number VARCHAR NULL

label_file_id UUID NULL

weight_kg NUMERIC NULL

length_cm NUMERIC NULL
width_cm NUMERIC NULL
height_cm NUMERIC NULL

created_at
updated_at
```

---

# 十一、Package Item

建立：

```text
package_items
```

字段：

```text
id

package_id

order_item_id

sku_id

quantity

created_at
```

必须支持：

```text
一个Package
→ 多SKU
```

也必须允许：

```text
一个Order
→ 多Package
```

---

# 十二、Package Status

至少：

```text
OPEN
SEALED
SHIPPED
CANCELLED
```

---

# 十三、创建 Shipment 条件

只有已经完成相应仓库 Picking 的商品：

才允许创建 Shipment。

至少要求：

```text
OrderItem.fulfillmentStatus = PICKED
```

禁止：

```text
BACKORDERED
RESERVED
MAPPING_FAILED
```

商品进入 Shipment。

---

# 十四、按仓库创建 Shipment

一个 Shipment：

只能属于一个 Warehouse。

如果一个订单未来来自两个仓：

必须拆两个 Shipment。

这与现有：

```text
1 PickingTask = 1 Warehouse
```

保持一致。

---

# 十五、Packing

Sprint 4需要实现基础打包：

```text
Picked Order Items
↓
Create Package
↓
Add Package Items
↓
Verify Quantities
↓
Seal Package
```

---

# 十六、Package数量完整性

系统必须防止：

```text
Picked Qty = 2
Package Qty = 3
```

也不得漏装后：

直接将 Shipment 标记 READY_TO_SHIP。

必须校验：

```text
Shipment内 Package Items合计
=
该Shipment需要发出的Picked数量
```

---

# 十七、扫码打包

Package增加扫码能力：

```text
scan SKU barcode
```

后端解析 Internal SKU。

规则与 Picking 类似：

错误SKU：

```text
PACKING_SKU_MISMATCH
```

超量：

```text
PACKING_QUANTITY_EXCEEDED
```

不得改变库存。

---

# 十八、SN 商品打包

`serial_tracking=true` SKU：

Package必须保存具体SN。

建议建立：

```text
package_item_serials
```

或等价关系。

必须保证：

打包SN：

已经属于当前 OrderItem / PickingTask。

禁止：

将别的订单SN装入Package。

---

# 十九、Shipping Label

建立：

```text
shipping_labels
```

字段至少：

```text
id

shipment_id
package_id NULL

label_type

object_key

mime_type

source

external_label_id NULL

created_at
```

Sprint 4支持：

```text
MANUAL_UPLOAD
```

未来：

```text
PLATFORM_API
```

---

# 二十、面单文件

必须使用现有：

```text
ObjectStorageService
```

不得直接使用 S3 SDK。

文件默认 Private。

打印时使用：

Signed URL / 正式打印接口。

---

# 二十一、打印边界

本 Sprint至少做到：

- 查看面单；
- 打开PDF；
- 浏览器打印；
- 支持A4/PDF。

热敏打印自动化可后续增强。

不要因为打印问题引入桌面程序。

---

# 二十二、正式出库

Shipment完成所有校验后：

执行：

```text
shipShipment()
```

这个业务动作必须调用现有 Inventory：

```text
shipStock()
```

最终变化：

```text
Picked - N
On Hand - N
```

SN：

```text
PICKED → SHIPPED
```

OrderItem：

```text
PICKED → SHIPPED
```

Shipment：

```text
READY_TO_SHIP → SHIPPED
```

Package：

```text
SEALED → SHIPPED
```

---

# 二十三、正式出库必须原子

类似 Picking P0：

Shipment出库必须保证：

```text
Inventory
Reservation
Serial
OrderItem
Shipment
Package
```

关键状态更新处于可靠事务中。

不得出现：

```text
Shipment = SHIPPED
但库存没扣
```

或：

```text
库存已经扣
Shipment仍READY_TO_SHIP
```

---

# 二十四、OrderItem增加SHIPPED

Sprint 4正式增加：

```text
OrderItem.fulfillmentStatus = SHIPPED
```

并更新：

```text
docs/business-rules/orders.md
```

---

# 二十五、Order增加SHIPPED

当全部应该发货的 OrderItems：

```text
SHIPPED
```

Order：

```text
SHIPPED
```

如果部分Shipment已经发货：

建议增加：

```text
PARTIALLY_SHIPPED
```

只有在本 Sprint确实支持部分Shipment发货时才增加。

不要仅为了预留而增加未使用状态。

---

# 二十六、Shipment 幂等

正式出库必须提供：

```text
idempotencyKey
```

相同 Shipment 重复点击：

不得再次：

```text
On Hand -N
```

---

# 二十七、Shipment不能重复出库

数据库 / Service双重保证：

```text
SHIPPED Shipment
```

再次调用 ship：

返回幂等结果或：

```text
SHIPMENT_ALREADY_SHIPPED
```

不得再次产生库存流水。

---

# 二十八、Tracking Number

Sprint 4允许：

人工录入：

```text
trackingNumber
carrierCode
```

未来 Adapter：

自动填入。

不要因为没有真实平台API阻塞 Shipment。

---

# 二十九、Order Interception正式完成

Sprint 3已经存在：

```text
order_interceptions
```

本 Sprint继续实现完整生命周期。

状态：

```text
CREATED
ASSIGNED
LOCATING
INTERCEPTED
FAILED
RETURNED_TO_STOCK
CLOSED
```

---

# 三十、Interception适用范围

只有：

已经发生实体拣货的商品取消：

才进入Interception。

如果商品已经：

```text
SHIPPED
```

不再使用普通仓内 Interception。

未来进入：

Return / Logistics流程。

---

# 三十一、Interception Task页面

新增：

```text
/interceptions
```

列表至少：

```text
Interception No
Order
Warehouse
SKU
Package
Status
Created At
Assigned To
```

---

# 三十二、Interception Detail

显示：

```text
订单信息
取消原因
需要找回SKU
数量
SN
原Picking Bin
Package（如已打包）
当前状态
操作历史
```

---

# 三十三、开始查找

操作：

```text
CREATED
→
LOCATING
```

如分配员工：

可先：

```text
CREATED
→ ASSIGNED
→ LOCATING
```

---

# 三十四、拦截扫描

找到商品后：

必须扫描：

```text
Order / Package
SKU
Serial Number（需要时）
Target Bin
```

至少：

SKU + Bin 必须由后端验证。

---

# 三十五、拦截错误SKU

必须：

```text
INTERCEPTION_SKU_MISMATCH
```

并阻止继续。

不得恢复库存。

---

# 三十六、拦截SN

SN商品：

必须扫描正确：

```text
serialNumber
```

并确认：

该SN属于当前订单/拣货记录。

否则：

```text
INTERCEPTION_SERIAL_MISMATCH
```

---

# 三十七、回库动作

成功找回并扫描目标Bin：

执行：

```text
returnPickedStock()
```

或合理等价 Inventory API。

库存变化：

由于 Picked 商品此前 On Hand 未减少：

```text
Picked - N
```

On Hand：

```text
不增加
```

商品重新成为可售。

---

# 三十八、不要错误 OnHand +1

这是本 Sprint 必须重点测试的规则。

Picked取消回库：

不能：

```text
On Hand +1
```

因为在 Picking阶段：

On Hand 从未减少。

正确：

```text
Picked -1
```

然后 Available自然恢复。

---

# 三十九、Interception与Reservation

成功回库后：

Reservation进入：

```text
RELEASED
```

或明确的取消终态。

不得保持：

```text
PICKED
```

---

# 四十、SN回库

成功回库：

```text
InventorySerial
PICKED → IN_STOCK
```

更新：

```text
warehouse
bin
reservation=NULL
picking_task_item=NULL
```

或符合现有模型的等价处理。

必须和Balance同事务。

---

# 四十一、Interception成功

状态：

```text
LOCATING
↓
INTERCEPTED
↓
RETURNED_TO_STOCK
↓
CLOSED
```

允许内部Service一次完成中间步骤，

但状态历史必须可追踪。

---

# 四十二、Interception失败

找不到商品：

```text
FAILED
```

不得恢复库存。

创建或更新：

```text
ORDER_INTERCEPTION_FAILED
```

异常。

---

# 四十三、已打包但未出库取消

如果商品已经 Package：

但 Shipment 尚未 SHIPPED：

Interception仍可以执行。

必须：

先从 Package 中解除/取消对应PackageItem

或将Package标记需要重新打包。

不得：

商品回库了，

Package仍显示包含该SKU。

---

# 四十四、Sealed Package取消

如果：

```text
Package = SEALED
```

且其中商品发生取消：

必须：

```text
Package → OPEN / REPACK_REQUIRED
```

或者新增清晰状态。

如果新增状态：

必须更新业务规则文档。

推荐：

```text
REPACK_REQUIRED
```

比静默重新OPEN更容易审计。

---

# 四十五、已SHIPPED订单取消

如果 Shipment：

```text
SHIPPED
```

禁止仓内Interception。

返回明确：

```text
INTERCEPTION_NOT_ALLOWED_AFTER_SHIPMENT
```

以后交给 Return / Logistics。

---

# 四十六、Notification Module

Sprint 3只发布了：

```text
ORDER_INTERCEPTION_REQUIRED
```

本 Sprint建立正式：

```text
NotificationModule
```

但真实飞书集成可以拆成独立小切片。

---

# 四十七、Notification模型

建立：

```text
notifications
```

至少：

```text
id

type
channel

reference_type
reference_id

recipient NULL

title
content

status

attempt_count

sent_at
failed_at

created_at
```

---

# 四十八、Notification Status

```text
PENDING
SENT
FAILED
CANCELLED
```

---

# 四十九、Notification Channel

当前：

```text
SYSTEM
FEISHU
```

SYSTEM必须工作。

FEISHU：

如果没有现成Webhook配置：

只实现 Adapter / Provider边界。

不得凭空猜真实配置。

---

# 五十、领域事件消费

当：

```text
ORDER_INTERCEPTION_REQUIRED
```

发生：

Notification模块创建：

```text
SYSTEM Notification
```

如果配置了有效飞书：

可以异步入BullMQ发送。

业务模块不得直接：

```text
fetch(feishuWebhook)
```

---

# 五十一、通知失败

飞书失败：

不得影响订单取消事务。

Notification：

```text
FAILED
```

可以重试。

Exception/日志记录。

---

# 五十二、Shipment API

至少：

```text
GET  /api/v1/shipments
POST /api/v1/shipments

GET  /api/v1/shipments/:id

POST /api/v1/shipments/:id/packages

POST /api/v1/packages/:id/items/scan
POST /api/v1/packages/:id/seal

POST /api/v1/shipments/:id/ship
```

可以根据REST结构合理调整。

---

# 五十三、Label API

至少：

```text
POST /api/v1/shipments/:shipmentId/labels
GET  /api/v1/shipments/:shipmentId/labels
```

multipart上传。

---

# 五十四、Interception API

至少：

```text
GET /api/v1/interceptions
GET /api/v1/interceptions/:id

POST /api/v1/interceptions/:id/assign
POST /api/v1/interceptions/:id/start
POST /api/v1/interceptions/:id/scan
POST /api/v1/interceptions/:id/return-to-stock
POST /api/v1/interceptions/:id/fail
POST /api/v1/interceptions/:id/close
```

具体可合并，

但能力必须完整。

---

# 五十五、Notification API

至少：

```text
GET /api/v1/notifications
GET /api/v1/notifications/:id
POST /api/v1/notifications/:id/retry
```

---

# 五十六、Shipment前端

新增导航：

```text
仓库作业
├─ 拣货
├─ 发货
└─ 拦截
```

---

# 五十七、发货列表

路径：

```text
/shipments
```

展示：

```text
Shipment No
Order
Warehouse
Packages
Tracking
Status
Created
Shipped At
```

---

# 五十八、发货工作台

Shipment Detail：

```text
待发商品
已打包Package
Package进度
面单
Tracking Number
出库确认
```

---

# 五十九、Package UI

支持：

```text
新建Package
↓
扫码SKU
↓
数量进度
↓
Seal
```

错误SKU：

大红提示。

正确SKU：

大绿提示。

与Picking工作台保持一致的仓库操作体验。

---

# 六十、出库确认

属于危险操作。

必须二次确认：

```text
确认正式出库？
出库后实体库存将扣减。
```

不要误触即发货。

---

# 六十一、Interception UI

仓库员工进入：

```text
/interceptions/:id
```

使用类似Picking的大按钮/扫码界面。

重点：

```text
要找什么
在哪里找
订单
SKU
图片
SN
目标回库Bin
```

---

# 六十二、必须测试：Picking原子性

模拟：

Inventory操作在中途抛异常。

最终：

```text
PickingTaskItem.pickedQty
Inventory Reserved
Inventory Picked
Reservation
```

必须全部保持原状态。

---

# 六十三、必须测试：Picking进程异常模型

至少通过Integration Test证明：

不能再出现：

```text
pickedQty +1
但Inventory没有Pick
```

Sprint 3报告中的风险必须正式关闭。

---

# 六十四、必须测试：正常Shipment

流程：

```text
Order PICKED
↓
Shipment
↓
Package
↓
Seal
↓
Ship
```

结果：

```text
OrderItem SHIPPED
Shipment SHIPPED
Package SHIPPED

Inventory:
OnHand -N
Picked -N

SN:
PICKED → SHIPPED
```

---

# 六十五、必须测试：Shipment幂等

`shipShipment()` 重复10次。

库存只能扣一次。

Transaction只能产生一组。

---

# 六十六、必须测试：未完全打包禁止出库

Picked：

```text
3件
```

Package：

```text
2件
```

Ship：

必须失败：

```text
SHIPMENT_NOT_FULLY_PACKED
```

---

# 六十七、必须测试：Package错误SKU

Package需要SKU-A。

扫描SKU-B：

```text
PACKING_SKU_MISMATCH
```

Package / Inventory均不变。

---

# 六十八、必须测试：Package超量

需要2件。

扫3次。

第3次拒绝。

---

# 六十九、必须测试：多SKU Package

一个Package：

```text
SKU-A ×1
SKU-B ×2
```

支持并正确Seal。

---

# 七十、必须测试：一Order多Package

必须可以：

```text
Order
├─ Package 1
└─ Package 2
```

所有Package合计正确后：

Shipment才可Ready。

---

# 七十一、必须测试：Picked Cancel回库

初始：

```text
OnHand=10
Picked=2
```

Interception成功回库2：

最终：

```text
OnHand=10
Picked=0
```

不是：

```text
OnHand=12
```

---

# 七十二、必须测试：Interception错误SKU

错误SKU扫码：

库存完全不变。

---

# 七十三、必须测试：Interception SN错误

目标SN：

```text
SN001
```

扫描：

```text
SN002
```

必须拒绝。

---

# 七十四、必须测试：Interception失败

状态：

```text
FAILED
```

库存Picked保持。

不得自动恢复。

---

# 七十五、必须测试：已打包取消

商品已在OPEN Package：

拦截成功后：

Package Item同步移除/失效。

数据必须一致。

---

# 七十六、必须测试：SEALED取消

Package：

```text
SEALED
```

取消产生Interception后：

应进入：

```text
REPACK_REQUIRED
```

或最终确认的等价状态。

---

# 七十七、必须测试：已Ship不能仓内拦截

Shipment已SHIPPED：

调用Interception回库：

必须拒绝。

---

# 七十八、必须测试：SN Shipment

SN商品：

完整：

```text
IN_STOCK
↓
RESERVED
↓
PICKED
↓
SHIPPED
```

Balance与SN状态始终一致。

---

# 七十九、必须测试：Notification

Picked取消：

产生：

```text
SYSTEM notification
```

即使通知Provider失败：

订单/Interception创建仍成功。

---

# 八十、事务测试

人工模拟：

```text
Inventory ship成功前
Package状态更新失败
```

整个发货业务应Rollback。

不得形成半出库。

---

# 八十一、架构检查升级

必须确保：

Shipment

Packing

Interception

不能直接：

```text
import InventoryRepository
import InventoryBalanceEntity
```

必须经过Inventory公开业务Service。

---

# 八十二、NUMERIC

继续复用：

```text
common/utils/quantity.ts
```

Shipment / Package不得重新实现：

```text
Number(quantity)
```

式散乱数量逻辑。

---

# 八十三、测试数据

继续使用独立：

```text
wcies_test
```

不得回到dev库进行Integration污染。

---

# 八十四、性能

当前量级低。

重点正确性。

列表不得出现明显N+1：

- Shipment → Package Count
- Package → Item Count
- Interception → SKU/Order
- Notification → Reference

---

# 八十五、Migration建议

至少：

```text
create_shipments
create_packages
create_package_items
create_package_item_serials

create_shipping_labels

extend_order_fulfillment_status

extend_package_status_if_needed

extend_interceptions

create_notifications

add_shipment_indexes
```

按实际依赖拆分。

---

# 八十六、Business Rules文档

必须同步更新：

```text
docs/business-rules/orders.md
docs/business-rules/inventory.md
```

新增：

- SHIPPED
- Shipment
- Package
- Packing
- Interception回库
- SN SHIPPED
- Picked取消后的完整行为

---

# 八十七、GUI验收

至少浏览器验证：

1. Picking原有流程仍工作；
2. 创建Shipment；
3. 创建Package；
4. 正确SKU打包；
5. 错误SKU被阻止；
6. Package Seal；
7. 上传/查看面单；
8. 正式出库；
9. Inventory正确下降；
10. Order进入SHIPPED；
11. Picked取消产生Interception；
12. Interception扫码回库；
13. 回库后Picked下降但OnHand不增加；
14. Notification可看到。

---

# 八十八、最终验证

必须运行：

```bash
pnpm lint
pnpm typecheck
pnpm check:arch
pnpm test
pnpm test:integration
pnpm build
```

全部通过。

---

# 八十九、空库验证

建立全新测试数据库：

```text
all migrations
↓
seed
↓
Sprint 4 acceptance setup
```

必须全部成功。

---

# 九十、最终报告要求

报告必须包含：

## 1. P0 Picking原子性修复

重点说明：

- Sprint 3风险怎么关闭；
- 最终事务边界。

## 2. Shipment Model

## 3. Package Model

## 4. Packing流程

## 5. Shipment出库事务

## 6. Inventory Integration

## 7. SN生命周期

## 8. Interception完整流程

## 9. Notification

## 10. API

## 11. Frontend

## 12. Tests

## 13. GUI Acceptance

## 14. Migration

## 15. Architecture Check

## 16. 新增业务/架构决策

## 17. 未完成项

## 18. 风险

## 19. Git Commits

## 20. 下一步

Sprint 4完成后：

**停止。**

不得自行开始真实平台Adapter。

---

# 九十一、Sprint 4完成定义

只有以下全部满足：

```text
Picking业务与Inventory真正原子

Shipment模型工作
Package模型工作
Packing扫码工作

错误SKU严格阻止
超量严格阻止
多SKU Package工作
多Package工作

正式出库工作
Inventory正确扣减
OrderItem SHIPPED
Order SHIPPED

SN → SHIPPED工作

Shipment幂等
出库事务Rollback可靠

Picked Cancel不直接恢复库存
Interception任务工作
扫码回库工作
SN回库工作

回库只减Picked
绝不错误增加OnHand

已打包取消保持Package一致
已Ship订单不能仓内拦截

SYSTEM Notification工作
业务模块不直接调用飞书

Inventory边界不被破坏

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

才可以标记：

**WCIES Sprint 4 — Shipment & Interception**

完成。