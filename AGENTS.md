# WCIES — AI Coding Rules

> 本项目为跨境电商综合管理系统 WCIES。
>
> 开发模式：**单人开发 + Vibe Coding，AI 是主要代码生产者。**
>
> 本文件是项目根级开发纪律。所有 AI Coding Session 在修改代码前必须阅读本文件。
>
> 本文件中的 **MUST / MUST NOT / 禁止 / 必须** 均属于硬性规则，不得自行绕过。

---

# 1. 项目目标

WCIES 服务于多平台、多店铺、多仓库跨境电商业务。

当前平台：

- OZON
- Wildberries
- Yandex Market

核心业务领域：

- SKU（唯一商品主数据；2026-10-13 决策 0020 起不再有独立 Product 层）
- Platform Listing
- Warehouse / Bin
- Inventory
- Order
- Picking
- Shipment
- Purchase
- Transfer
- Return
- Finance
- Sync
- Exception
- Notification
- Platform Integration

核心业务原则：

> **Internal SKU + Physical Inventory Ledger + Business Event + Platform Adapter**

是系统的核心。

系统首先保证：

1. 库存正确；
2. 数据可追溯；
3. 平台同步幂等；
4. 业务边界清晰；
5. 异常可见；
6. AI不能自行改变业务规则。

---

# 2. 开始编码前必须执行

每次开始任务前：

1. 阅读本 `AGENTS.md`；
2. 阅读本次任务对应的 `docs/business-rules/*.md`；
3. 阅读相关模块现有代码；
4. 阅读相关数据库 Entity / Migration；
5. 阅读相关 API / Adapter Contract；
6. 确认现有测试；
7. 明确允许修改的目录；
8. 不得从任务描述之外自行创造新的业务规则。

如果需求与文档冲突：

**停止架构推断，以当前用户明确确认的业务规则为准。**

如果代码与业务规则文档冲突：

**不得静默选择其中一个。必须指出冲突。**

---

# 3. 当前技术栈

## Frontend

- TypeScript
- React
- Vite
- Ant Design
- React Router
- TanStack Query
- Zustand（按需）

## Backend

- TypeScript
- Node.js LTS
- NestJS
- TypeORM
- REST API
- OpenAPI / Swagger

## Data

- PostgreSQL
- Redis
- S3-compatible Object Storage

## Async

- BullMQ

## Infrastructure

- pnpm Monorepo
- Docker
- Docker Compose

---

# 4. Monorepo结构

主要目录：

```text
wcies/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── shared/
│   ├── api-client/
│   └── platform-contracts/
├── database/
│   └── migrations/
├── docs/
├── scripts/
├── tests/
└── AGENTS.md
```

不得自行引入新的顶级架构层。

例如不得未经确认自行增加：

- microservices/
- services/
- backend-v2/
- core-v2/
- event-sourcing/
- cqrs/
- kubernetes/

如果确有必要，必须先说明原因。

---

# 5. 总体依赖方向

基本依赖方向：

```text
Web
 ↓
REST / OpenAPI
 ↓
Controller
 ↓
Application / Domain Service
 ↓
Repository
 ↓
PostgreSQL
```

平台集成：

```text
Sync / Business Service
 ↓
PlatformAdapter
 ↓
Platform Client
 ↓
External Platform API
```

禁止反向依赖。

---

# 6. Controller规则

Controller只允许负责：

- HTTP
- Params / Query / Body解析
- DTO Validation
- Auth / Permission Guard
- 调用Service
- 返回Response DTO

Controller **禁止**：

- 直接调用Repository；
- 直接执行SQL；
- 直接修改Entity；
- 编写库存计算；
- 编写订单状态机；
- 调用平台HTTP API；
- 编写复杂业务逻辑。

正确：

```text
InventoryController
    ↓
InventoryService.reserveStock()
```

错误：

```text
InventoryController
    ↓
InventoryRepository
    ↓
UPDATE inventory_balances
```

---

# 7. Service规则

业务规则必须位于对应业务模块 Service。

例如：

- `SkuService`
- `BarcodeService`
- `InventoryService`
- `OrderService`
- `PurchaseService`
- `TransferService`
- `ShipmentService`

模块之间必须通过公开 Service 交互。

禁止：

```text
OrderModule
直接import InventoryRepository
```

正确：

```text
OrderService
↓
InventoryService
```

---

# 8. Repository规则

Repository只负责：

- 查询
- 锁行
- 保存
- 数据访问

Repository不得决定业务规则。

允许：

```text
findBalance()
lockBalanceForUpdate()
saveBalance()
findReservation()
```

禁止：

```text
shipOrder()
cancelOrder()
calculateAvailableStock()
```

这些属于业务逻辑。

---

# 9. 跨模块访问规则

禁止跨模块 import 对方内部实现：

```text
modules/inventory/repositories/*
modules/inventory/entities/*
modules/inventory/internal/*
```

其他模块只能使用该模块公开导出的：

- Service
- Public DTO
- Contract
- Public Event

不得通过深层路径绕过模块边界。

---

# 10. Inventory 是核心安全边界

**任何业务库存变化只能通过 Inventory 模块执行。**

其他模块禁止直接：

```sql
UPDATE inventory_balances
```

禁止：

```typescript
balance.onHandQty -= 1;
repository.save(balance);
```

统一通过库存业务接口，例如：

```text
receiveStock()
reserveStock()
releaseReservation()
pickStock()
unpickStock()
shipStock()
transferOut()
transferIn()
returnToStock()
moveBin()
adjustStock()
```

---

# 11. 库存三个层级

必须严格区分：

## Physical Inventory

真实实体库存。

## Available Inventory

实际还能出售的数量。

## Channel Inventory

准备同步给某平台/店铺的数量。

禁止混淆三者。

平台库存数字不能直接覆盖实体库存。

---

# 12. 库存核心数量定义

核心库存：

```text
On Hand
Reserved
Picked
Safety Stock
```

基本可售：

```text
Available
=
On Hand
- Reserved
- Picked
- Safety Stock
- Unavailable Stock
```

前端可以展示计算结果。

但最终库存校验只能由后端执行。

---

# 13. Available不得成为第二事实源

除非有明确架构决策：

**不得把 Available Qty 作为独立事实库存永久维护。**

Available 应由当前库存状态推导。

禁止出现：

```text
onHand = 10
reserved = 3
available = 9
```

这种无法保证一致的数据结构。

---

# 14. InventoryBalance 与 InventoryTransaction 分离

`InventoryBalance`：

回答：

> 现在有多少？

`InventoryTransaction`：

回答：

> 为什么变成这么多？

**任何库存变动必须生成 InventoryTransaction。**

没有流水的库存修改属于架构违规。

---

# 15. InventoryReservation

订单库存占用必须拥有独立 Reservation。

不能只修改：

```text
reservedQty += N
```

却不知道这些库存被谁占用。

Reservation必须能够关联：

- Order
- OrderItem
- SKU
- Warehouse
- Quantity
- Status

---

# 16. Reserved 与 Picked 必须分离

必须区分：

```text
Reserved
```

订单已经占用，但商品仍可能在货架。

与：

```text
Picked
```

商品已经从库位取出。

禁止把两者合并。

原因：

订单取消后的处理完全不同。

---

# 17. 库存事务规则

任何修改库存的业务操作必须在数据库事务中完成。

基本模式：

```text
BEGIN

SELECT inventory balance
FOR UPDATE

业务校验

修改余额

写业务记录

写 InventoryTransaction

更新关联状态

COMMIT
```

任一步失败：

```text
ROLLBACK
```

---

# 18. 库存并发

库存扣减/占用不得使用：

“先查询再普通UPDATE”

这种非锁定方式。

必须使用：

- PostgreSQL行级锁；
- 或经过明确验证的等效并发控制。

核心库存场景必须测试：

```text
库存1件
同时2个订单
```

结果必须：

```text
1成功
1缺货
```

绝不能两个都成功。

---

# 19. 负库存

正常主动业务操作禁止产生负库存。

如果因为：

- 平台同步延迟
- 外部数据延迟
- 历史数据异常

产生理论负库存：

必须：

- 保留事实；
- 创建异常；
- 禁止静默修正；
- 通过正式库存业务动作恢复。

---

# 20. NO_INVENTORY_RECORD ≠ ZERO

这是库存同步硬规则：

```text
没有Inventory记录
```

不能解释为：

```text
库存 = 0
```

如果某个：

```text
SKU + Warehouse
```

不存在库存账本行：

平台库存同步必须：

```text
SKIP
```

不得：

```text
push 0
```

除非业务明确确认该SKU库存实际就是0。

---

# 21. 库存分配器

实体可售库存和渠道推送库存必须通过：

```text
Inventory Allocator
```

分离。

允许的分配模式由业务规则文档定义，例如：

- SHARED
- FIXED
- RATIO
- MAX_LIMIT

禁止直接人工修改平台渠道库存结果作为长期事实源。

---

# 22. 超卖

当前架构默认：

```text
oversell = false
```

禁止主动向平台承诺超过系统允许可售库存的数量。

如果平台实际订单超过库存：

订单行进入：

```text
BACKORDERED
```

并创建异常。

不得因为单条缺货让整批订单同步失败。

---

# 23. SKU身份规则（唯一商品主数据）

> 2026-10-13 修订（决策 `docs/decisions/0020-移除商品层级分类品牌下沉SKU.md`）：
> Product/SPU 层级已从系统删除。本节与原「Product / SKU 双层」表述冲突之处，
> 以本节为准。

**Internal SKU 是唯一商品主数据。**

不存在独立的 Product / SPU 主数据层：分类（category）与品牌（brand）是
SKU 自身字段（`skus.category_id` / `skus.brand_id`），SKU 可独立修改。

Internal SKU 是：

- 库存
- 订单
- 采购
- 成本
- SN
- 调拨
- 售后

的统一商品身份。

编码规则：`sku_code` = `SKU%09d` 全局单序列（决策 0020 D2），生成后冻结；
`/api/v1/products*` 路由与商品页已删除（D6），前端不得引用。

---

# 24. Internal SKU 与 Platform SKU 分离

平台上的：

- Product ID
- SKU ID
- Offer ID
- Seller SKU
- nmID
- 其他平台标识

不得成为内部库存主键。

必须映射到 Internal SKU。

> 平台侧 `product_id` / `description_category_id` 等字段与已删除的内部
> Product 层**同名异物**：integration 层与 `platform_category_mappings`
> 中的这些平台字段不得因本次改造而改动。

---

# 25. Listing模型规则

必须支持：

```text
一个内部SKU
→ 多个平台
→ 多个Store
→ 多个Listing
```

并且支持：

```text
同一Store内
同一Internal SKU
→ 多个商品链接
```

因此禁止建立：

```text
UNIQUE(sku_id, store_id)
```

这种限制。

---

# 26. Listing Resolver必须Store Scoped

所有平台SKU反查必须包含：

```text
storeId
```

禁止：

```text
resolveByOfferId(offerId)
```

这种全局解析。

正确：

```text
resolveByOfferId(storeId, offerId)
```

不同店铺允许存在相同平台字符串ID。

---

# 27. Platform与Store分离

业务实体：

```text
Platform
↓
Store
```

一个平台可以有多个Store。

所有平台同步业务必须知道：

```text
storeId
```

禁止只有：

```text
platform = OZON
```

却不知道是哪一个店铺。

---

# 28. Store与Credential分离

Credential不是Store。

结构：

```text
Store
↓
PlatformCredential
```

一个Store未来可以拥有：

- MAIN_API
- ADS_API
- FINANCE_API
- WEBHOOK
- 轮换密钥

不得把凭证记录当成店铺主数据。

---

# 29. Credential安全

所有平台凭证必须：

- 服务端加密存储；
- 前端不读取明文；
- 日志禁止输出明文；
- API Response禁止返回密文；
- Credential更新必须记录操作日志但不得记录Secret内容。

禁止：

将平台Key写入代码。

---

# 30. Store与Warehouse多对多

禁止：

```text
warehouse.store_id
```

这种单店绑定设计。

使用：

```text
StoreWarehouseBinding
```

表示：

```text
Store
+
Warehouse
+
Fulfillment Mode
+
Platform Warehouse ID
```

同一个深圳仓允许被多个店铺共享。

---

# 31. 平台专属履约规则

平台履约语义：

例如：

- OZON_RFBS
- OZON_FBO
- WB_FBW
- YANDEX_FBY

只能存在于：

- Binding
- Adapter
- Platform Mapper
- 平台配置

不得污染 Inventory Core。

Inventory模块不应知道：

“什么是OZON FBO”。

---

# 32. Platform Adapter规则

所有外部平台API必须通过：

```text
PlatformAdapter
```

访问。

禁止业务模块直接：

```text
axios.post(OZON_URL)
```

新增平台应主要完成：

```text
NewPlatformAdapter
+
Platform Client
+
Mapper
+
Registry
```

不得为了新平台修改 Inventory Core。

---

# 33. Adapter / Client / Mapper职责

## Adapter

实现统一平台业务能力。

## Client

负责：

- HTTP
- Auth
- Timeout
- Retry
- Rate Limit
- Request Logging

## Mapper

负责：

```text
平台DTO
→
WCIES统一模型
```

三者不得全部写进一个巨型文件。

---

# 34. 平台原始数据

重要平台对象必须尽可能保留：

```text
rawData JSONB
```

例如：

- Order
- Listing
- Tracking
- Finance
- Webhook

统一模型不能代替原始数据留存。

---

# 35. Order唯一性

平台订单唯一键必须：

```text
store_id + platform_order_id
```

不得只使用：

```text
platform_order_id
```

全局唯一。

---

# 36. Order与OrderItem

订单必须拆分：

```text
Order
1:N
OrderItem
```

订单行可以拥有自己的库存履约状态，例如：

```text
PENDING
RESERVED
BACKORDERED
PICKED
SHIPPED
RELEASED
```

禁止因为一行失败而无必要使整张同步任务失败。

---

# 37. Order != Shipment

必须严格区分：

```text
Order
Shipment
Package
```

禁止把平台订单号直接当物流包裹模型。

系统必须能够支持：

- 一订单多商品；
- 一订单多包裹；
- 一个Shipment多个Package；
- Package多个SKU。

---

# 38. Order状态与Platform状态分离

必须保存：

```text
platformStatus
```

和：

```text
erpStatus
```

平台状态不得直接作为ERP业务状态。

所有ERP状态迁移必须通过：

```text
OrderStatusService
```

或对应状态机。

禁止随处直接：

```typescript
order.status = 'SHIPPED';
```

---

# 39. Order Status History

所有重要订单状态迁移必须保留历史。

必须能够回答：

> 订单什么时候从什么状态变成什么状态？

禁止只保存当前状态。

---

# 40. 新订单库存规则

平台生成新订单并成功映射SKU后：

尝试创建：

```text
InventoryReservation
```

库存足够：

```text
RESERVED
```

库存不足：

```text
BACKORDERED
+
Exception
```

不得自动取消平台订单。

---

# 41. 取消订单规则

如果订单商品仍处于：

```text
Reserved
```

根据配置：

可自动或人工释放Reservation。

如果已经：

```text
Picked
```

禁止直接恢复库存。

必须：

```text
Create Interception Task
```

---

# 42. Picked订单取消

正确流程：

```text
Order Cancelled
↓
Interception Task
↓
Notification
↓
找到实物
↓
扫描SKU
↓
扫描SN（需要时）
↓
扫描Bin
↓
Return To Stock
```

只有实体商品真正回到库位：

才恢复可售库存。

---

# 43. 平台同步必须Store Scoped

同步任务最小隔离维度：

```text
Store + SyncType
```

例如：

```text
OZON-A / ORDER
OZON-B / ORDER
WB-A / INVENTORY
```

必须独立维护：

- Credential
- Cursor
- Running Lock
- Retry
- SyncJob
- Error

一个店失败：

不得影响其他店铺。

---

# 44. SyncJob

每次同步必须记录：

- storeId
- syncType
- status
- cursor
- startedAt
- finishedAt
- successCount
- failedCount
- retryCount
- error

不得进行“无记录同步”。

---

# 45. 同步单飞

同一个：

```text
Store + SyncType
```

同时只允许一个运行中的任务。

必须通过：

- Queue Job控制；
- 数据库SyncJob守卫；

至少双重保护。

---

# 46. 同步游标

Cursor必须按：

```text
Store + SyncType
```

独立保存。

禁止平台级共享Cursor。

---

# 47. Webhook

Webhook HTTP入口必须：

```text
验证
↓
保存Raw Event
↓
入BullMQ
↓
快速返回
```

禁止在Webhook HTTP请求中执行长时间业务操作。

---

# 48. external_raw_events

Webhook原始事件必须可追溯。

至少保存：

- platform
- storeId
- eventType
- externalEventId
- payload
- receivedAt
- processedAt
- status

---

# 49. 幂等规则

必须区分三层幂等：

## 外部事件幂等

Webhook / API Event。

## 业务实体幂等

例如：

```text
storeId + platformOrderId
```

## 库存操作幂等

例如：

```text
ORDER_RESERVE:<orderItemId>
ORDER_RELEASE:<orderItemId>
```

禁止依赖“应该不会重复调用”。

---

# 50. BullMQ

以下长任务必须进入BullMQ：

- Order Sync
- Inventory Sync
- Tracking Sync
- Finance Sync
- Webhook Processing
- Notification
- Excel Import
- 大型文件导出

HTTP Controller不得阻塞等待大型平台同步完成。

---

# 51. BullMQ Processor规则

Processor只负责：

```text
Job
↓
调用Service
```

Processor不得成为业务Service。

---

# 52. Domain Event与Notification

业务模块不得直接调用：

```text
FeishuWebhook.send()
```

业务模块发布事件：

例如：

```text
ORDER_INTERCEPTION_REQUIRED
TRANSFER_DIFFERENCE
SYNC_FAILED
```

Notification模块决定：

- SYSTEM
- FEISHU
- 未来其他渠道

---

# 53. Exception Center

业务异常应进入统一异常体系。

例如：

- ORDER_OUT_OF_STOCK
- ORDER_SKU_MAPPING_FAILED
- NEGATIVE_INVENTORY
- INVENTORY_SYNC_FAILED
- ORDER_CANCEL_AFTER_PICK
- TRANSFER_DIFFERENCE
- SERIAL_NUMBER_ERROR
- TRACKING_STALLED
- TRACKING_LOST
- RETURN_ORDER_NOT_FOUND
- API_CONNECTION_ERROR

---

# 54. 本地SKU未刊登不是异常

以下状态：

```text
Internal SKU没有平台Listing
```

本身不是异常。

但：

平台订单已进入，平台SKU无法映射Internal SKU：

属于：

```text
ORDER_SKU_MAPPING_FAILED
```

严重异常。

---

# 55. Database规则

主数据库：

```text
PostgreSQL
```

生产环境：

```text
TypeORM synchronize = false
```

所有Schema修改必须：

```text
Entity
+
Migration
```

同时提交。

禁止：

手工修改生产Schema后不写Migration。

---

# 56. Migration规则

Migration一旦进入共享环境或生产：

原则上不修改原文件。

需要修正：

新建Migration。

禁止AI为了“让Migration更漂亮”重写历史Migration。

---

# 57. 主键与业务编号

数据库主键：

```text
UUID
```

业务编号：

独立字段。

例如：

```text
UUID = 数据库身份
SKU000001 = 业务身份
```

不得混用。

---

# 58. 金额

所有财务金额：

数据库使用：

```text
NUMERIC / DECIMAL
```

禁止：

```text
FLOAT
DOUBLE
```

处理财务金额。

---

# 59. 时间

数据库时间统一：

```text
TIMESTAMPTZ
```

保存UTC。

前端根据用户时区显示。

禁止服务器本地时区成为业务事实源。

---

# 60. JSONB使用规则

适合：

- 平台Raw Data
- 平台Extra Data
- 灵活配置
- 外部Payload

不适合：

- 库存数量
- 核心关系
- OrderItem
- SKU映射
- Warehouse关系
- 财务金额

核心业务结构必须结构化。

---

# 61. Entity != API DTO

TypeORM Entity不得直接返回前端。

正确：

```text
Entity
↓
Mapper
↓
Response DTO
```

禁止：

Controller直接：

```typescript
return repository.find();
```

---

# 62. 外部输入验证

所有外部输入必须验证，包括：

- HTTP Body
- Query
- Params
- Webhook
- Excel Import
- Platform API Response

HTTP层使用：

- DTO
- ValidationPipe

平台数据使用明确Mapper/Schema校验。

---

# 63. TypeScript规则

全项目：

```text
strict = true
```

核心业务模块禁止：

```text
any
```

如果第三方数据确实未知：

优先：

```text
unknown
```

再显式解析。

---

# 64. magic string禁止

禁止到处写：

```typescript
status === 'picked'
```

业务状态必须集中定义：

- enum
- const union
- typed constant

状态新增属于业务规则修改。

AI不得自行新增。

---

# 65. 错误处理

业务错误必须使用明确Domain Error。

禁止：

```typescript
throw new Error('库存有问题');
```

应使用：

```text
InsufficientStockError
InvalidReservationStateError
SkuNotFoundError
```

并拥有稳定错误码。

---

# 66. 错误Response

统一格式：

```json
{
  "success": false,
  "error": {
    "code": "INVENTORY_INSUFFICIENT_STOCK",
    "message": "库存不足",
    "details": {}
  },
  "requestId": "..."
}
```

不得为不同模块自行发明Response格式。

---

# 67. 日志

必须使用结构化日志。

重要上下文尽可能包含：

- requestId
- userId
- storeId
- platform
- syncJobId
- orderId
- skuId

禁止日志写：

- Password
- API Secret
- Token
- Credential明文
- 完整敏感买家信息

---

# 68. Object Storage

文件通过统一：

```text
ObjectStorageService
```

访问。

业务模块禁止直接依赖：

- MinIO SDK
- AWS SDK
- OSS SDK

文件默认私有。

使用Signed URL访问。

---

# 69. Excel Import

Excel导入必须通过：

```text
ImportJob
```

统一处理。

禁止每个业务页面分别写一套Excel解析。

至少必须提供：

- Row Number
- Error Code
- Error Message
- Success Count
- Failure Count

---

# 70. Frontend规则

前端主要负责：

- 展示
- 输入
- 搜索
- 筛选
- 表格
- 扫码交互
- 打印交互

业务事实以Backend返回为准。

---

# 71. TanStack Query

服务端数据统一优先使用：

```text
TanStack Query
```

不要把后端主数据复制进Zustand长期维护。

Zustand仅用于必要客户端全局状态。

---

# 72. API Client

前端优先使用：

```text
OpenAPI生成的api-client
```

禁止到处手写：

```typescript
fetch('/api/v1/...')
```

除非有明确原因。

---

# 73. 禁止擅自安装依赖

AI **禁止擅自安装新依赖或升级依赖版本。**

如任务确有需要：

必须先说明：

1. 为什么现有依赖不能完成；
2. 准备增加什么；
3. 影响哪些模块。

依赖变化必须明确出现在变更中。

---

# 74. 禁止过早复杂化

未经明确需求，禁止自行引入：

- Microservices
- Kafka
- Event Sourcing
- CQRS
- Kubernetes
- Service Mesh
- GraphQL
- Elasticsearch
- MongoDB作为核心业务库

当前架构优先：

```text
Modular Monolith
+
PostgreSQL
+
Redis/BullMQ
```

---

# 75. 代码文件大小

不使用绝对机械的250行硬限制。

但：

- Service超过约300–400有效行；
- 单函数超过约50–80行；
- 单文件承担多个明显职责；

必须主动评估拆分。

原则：

> 单一职责优先，而不是为了满足行数强行拆文件。

测试文件可适当更长。

---

# 76. 测试要求

核心业务改动必须有测试。

特别是：

- Inventory
- Order State
- Allocator
- Transfer
- Cost
- Sync Idempotency
- Listing Resolver

不能只依赖手工测试。

---

# 77. 库存测试不得全部Mock

库存模块必须存在真实PostgreSQL Integration Test。

必须验证：

- Transaction
- FOR UPDATE
- Unique Constraint
- Rollback
- Concurrency

Repository全部Mock不能证明库存系统正确。

---

# 78. 必测库存场景

至少长期保留：

## Case 1

库存1件，同时2个Reservation：

```text
1成功
1失败
```

## Case 2

重复事件：

```text
只产生1次Reservation
只产生1次InventoryTransaction
```

## Case 3

Picked订单取消：

```text
不直接恢复库存
创建Interception
```

## Case 4

不存在InventoryBalance：

```text
库存同步SKIP
不得push 0
```

---

# 79. Listing测试

必须验证：

- 一个Internal SKU对应多个Listing；
- 同一Store同一SKU多个链接；
- 不同Store允许相同Offer字符串；
- Resolver严格Store Scoped。

---

# 80. Adapter Contract Test

所有平台Adapter应尽可能使用共同契约测试。

验证：

- 标准返回类型
- 分页Cursor
- API Error
- Retry
- Rate Limit
- Mapping

---

# 81. Architecture Check

必须保留自动架构检查。

至少检查：

1. Controller不得import Repository；
2. Web不得import Backend Entity；
3. Integration不得import Inventory Repository；
4. 业务模块不得跨模块import内部Repository；
5. 禁止明显越界依赖。

架构纪律不能只靠AI“记住”。

---

# 82. 提交前检查

至少运行：

```text
lint
typecheck
architecture check
relevant unit tests
```

涉及库存核心时：

还必须运行对应Integration Test。

---

# 83. CI

主CI至少：

```text
install
↓
lint
↓
typecheck
↓
check:architecture
↓
unit tests
↓
build
```

库存核心上线前：

Integration Test也必须进入CI。

---

# 84. 文档规则

长期有效业务知识必须进入：

```text
docs/
```

而不是只存在于：

- 聊天记录
- AI上下文
- 临时代码注释

---

# 85. docs目录

重点：

```text
docs/architecture/
docs/business-rules/
docs/integrations/
docs/database/
docs/decisions/
```

---

# 86. 业务规则文档

修改以下业务时：

必须同步更新文档：

- Inventory
- Order State
- Transfer
- Return
- Cost
- Allocator

例如修改：

```text
Picked订单取消逻辑
```

必须更新：

```text
docs/business-rules/orders.md
```

或相关规则文档。

---

# 87. 平台知识

各平台API知识写入：

```text
docs/integrations/ozon.md
docs/integrations/wildberries.md
docs/integrations/yandex.md
```

至少记录：

- Endpoint
- Authentication
- Pagination
- Rate Limit
- Status Mapping
- Warehouse Mapping
- 已知坑
- 验证日期

平台API属于易变化外部依赖。

实现前优先依据：

当前官方文档和真实响应。

---

# 88. 不猜平台API

如果当前代码库/文档没有足够信息：

不得凭记忆猜测：

- Endpoint
- Field
- Status
- Rate Limit
- Webhook格式

必须明确说明：

缺少平台接口事实。

不得让猜测进入生产Adapter。

---

# 89. 数据迁移安全

涉及真实业务历史数据迁移：

必须：

1. 先备份；
2. 先查重；
3. 歧义数据报错；
4. 禁止静默丢弃；
5. 禁止“取第一条”猜映射。

---

# 90. 开发环境与生产环境

生产环境属于高风险环境。

默认所有开发/测试操作：

只允许在开发环境。

禁止AI主动连接、修改、迁移、部署生产环境。

只有用户明确要求生产操作时：

才允许进入生产流程。

---

# 91. 生产操作硬规则

用户明确要求生产操作后，仍必须：

1. 确认目标环境；
2. 确认备份；
3. 检查Migration；
4. 检查环境变量；
5. 检查凭证；
6. 执行最小改动；
7. 验证Health；
8. 验证核心数据；
9. 保留回滚路径。

---

# 92. 真实平台写操作

以下属于真实外部业务写操作：

- Push Inventory
- 修改商品
- 调价
- 发货
- 取消
- 财务写操作
- 真实Webhook配置

测试环境调用真实平台写API前：

必须确认用户知道该操作会影响真实店铺。

禁止把真实平台写操作当普通单元测试。

---

# 93. destructive脚本

包含以下行为的脚本：

- truncate
- reset database
- delete all
- drop schema
- clear queue
- purge storage

必须检查：

```text
NODE_ENV
```

和明确环境。

生产环境默认拒绝执行。

---

# 94. Vibe Coding任务规范

每个任务最好明确：

```text
Goal

Allowed directories

Required reading

Inputs

Expected behavior

Business rules

Transaction requirements

Errors

Tests

Forbidden changes
```

---

# 95. AI修改范围

AI只应修改完成当前任务真正必要的文件。

禁止：

“顺便重构整个项目”。

禁止：

为统一风格大范围修改无关模块。

如果发现值得重构的地方：

报告即可。

除非任务明确允许。

---

# 96. 不允许静默架构迁移

不得自行进行：

- TypeORM → Prisma
- REST → GraphQL
- React → Next.js
- NestJS → FastAPI
- PostgreSQL → MongoDB
- pnpm → npm/yarn

这类架构变更。

必须由用户明确决策。

---

# 97. 不允许修改业务规则来适配代码

如果现有实现难以满足业务规则：

修改代码。

不能：

为了代码方便

偷偷简化业务规则。

例如不能将：

```text
Picked取消 → Interception
```

改成：

```text
Picked取消 → 自动释放
```

只因为实现更简单。

---

# 98. 不自行增加状态

如果业务状态枚举中没有：

```text
SOME_NEW_STATE
```

AI不得因为编码方便自行增加。

状态机属于产品业务设计。

需要新增时：

先明确原因并更新规则文档。

---

# 99. 不自行删除“看起来没用”的字段

以下字段可能用于：

- 对账
- 排查
- 历史兼容
- 平台原始数据

AI不能仅因当前代码没有使用：

就自行删除数据库字段。

Schema删除必须经过明确业务确认和Migration设计。

---

# 100. 完成任务后的自检

在宣布任务完成前必须检查：

### Scope

是否只修改了必要范围？

### Architecture

是否违反模块边界？

### Data

是否有Migration遗漏？

### Inventory

是否绕过InventoryService？

### Idempotency

外部事件/库存动作是否可能重复？

### Security

是否泄露Secret？

### Errors

错误码是否明确？

### Tests

测试是否覆盖核心规则？

### Docs

业务规则或架构是否需要更新？

### Build

lint / typecheck / test 是否通过？

---

# 101. WCIES架构级冻结规则

以下规则属于当前系统架构基本契约：

1. Internal SKU 是统一库存身份（2026-10-13 决策 0020：同时是唯一商品主数据）。
2. Platform SKU只是外部映射。
3. 一个SKU允许多个平台Listing。
4. 同一Store一个SKU允许多个商品链接。
5. Store与Credential分离。
6. Store与Warehouse通过Binding关联。
7. Physical Inventory与Channel Inventory分离。
8. InventoryBalance与InventoryTransaction分离。
9. 所有库存变化必须经过Inventory模块。
10. 所有库存变化必须有流水。
11. Reservation必须关联具体业务来源。
12. Reserved与Picked必须分离。
13. Order与Shipment分离。
14. Shipment与Package分离。
15. Platform Status与ERP Status分离。
16. Sync必须按Store隔离。
17. Cursor必须按Store + SyncType隔离。
18. 外部事件必须幂等。
19. 单条业务异常不得无必要阻塞整批同步。
20. NO_INVENTORY_RECORD不得解释为0库存。
21. Channel Inventory必须经过Allocator。
22. 当前默认禁止主动超卖。
23. 新平台必须通过PlatformAdapter接入。
24. 平台特有数据不得污染Inventory Core。
25. 业务数据修改必须可追溯。
26. AI不得直接创造业务规则。
27. AI不得直接修改库存表绕过InventoryService。
28. AI不得擅自操作生产环境。
29. Schema变更必须有Migration。
30. 库存正确性优先于理论极限性能。

---

# 102. 当前开发阶段

当前项目按 Sprint 推进。

进行具体任务时：

以当前最新：

```text
docs/
```

中的 Sprint规格和业务规则为准。

不得因为本文件列出了未来模块：

就提前实现未来Sprint功能。

遵守：

> **只实现当前Sprint明确范围。**

避免范围蔓延。