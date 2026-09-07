# WCIES 跨境电商综合管理系统
## 工程架构与 Monorepo 目录设计 V1

---

# 1. 文档目标

本文档定义 WCIES 的实际代码组织方式，包括：

- Monorepo 根目录
- Web 前端目录
- NestJS 后端目录
- 业务模块目录
- 数据库 Entity / Migration
- Platform Adapter
- BullMQ Worker
- DTO
- 公共模块
- 测试目录
- OpenAPI Client
- 配置管理
- 架构依赖规则
- Vibe Coding 代码纪律

总体目标：

> 任何新功能进入项目时，都能快速判断“这段代码应该放哪里”。

---

# 2. Monorepo 总体结构

推荐：

```text
wcies/
│
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── shared/
│   ├── api-client/
│   ├── platform-contracts/
│   ├── eslint-config/
│   └── tsconfig/
│
├── database/
│   └── migrations/
│
├── docs/
│
├── docker/
│
├── scripts/
│
├── tests/
│
├── .github/
│
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
├── docker-compose.yml
├── tsconfig.base.json
└── README.md
```

---

# 3. Workspace 管理

使用：

```text
pnpm workspace
```

`pnpm-workspace.yaml`：

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

第一阶段：

不引入 Nx。

不强制引入 Turborepo。

原因：

当前只有一名程序员，工程依赖较少。

优先保证：

- 简单
- 可理解
- AI容易操作

未来 CI / 构建时间明显增加以后，再考虑 Turborepo。

---

# 4. apps/web

前端：

```text
apps/web
```

技术：

```text
React
TypeScript
Vite
Ant Design
React Router
TanStack Query
```

推荐结构：

```text
apps/web/src/
│
├── app/
│   ├── App.tsx
│   ├── router.tsx
│   └── providers.tsx
│
├── layouts/
│   ├── AppLayout.tsx
│   └── AuthLayout.tsx
│
├── pages/
│
├── features/
│
├── components/
│
├── api/
│
├── hooks/
│
├── stores/
│
├── utils/
│
├── types/
│
└── assets/
```

---

# 5. pages 和 features 的区别

必须明确：

## pages

代表一个路由页面。

例如：

```text
pages/
├── dashboard/
├── products/
├── sku/
├── inventory/
├── orders/
├── warehouse/
└── settings/
```

页面只负责：

- 布局
- Query 参数
- 调用 feature
- 组合组件

---

## features

负责真正的业务 UI。

例如：

```text
features/inventory/
│
├── components/
├── hooks/
├── queries/
├── mutations/
├── schemas/
└── utils/
```

例如：

```text
features/inventory/components/
├── InventoryTable.tsx
├── InventoryDetailDrawer.tsx
├── SafetyStockForm.tsx
└── ReservationTable.tsx
```

---

# 6. 前端禁止出现业务核心计算

例如禁止：

```typescript
const available =
  onHand - reserved - picked - safetyStock;
```

作为最终业务判断。

前端可以展示后端返回的计算结果。

但不能据此自行决定：

- 是否能锁库存
- 是否可以出库
- 是否可以调拨

真正业务判断必须发生在 Backend。

---

# 7. 前端 API

建议：

```text
apps/web/src/api/
```

只负责：

- API client 配置
- auth interceptor
- error handler

实际接口 Client：

尽可能来自：

```text
packages/api-client
```

自动生成。

---

# 8. packages/api-client

后端通过：

```text
OpenAPI
```

生成 TypeScript Client。

目录：

```text
packages/api-client/
```

禁止前端大量手写：

```typescript
fetch("/api/v1/...")
```

推荐调用：

```typescript
inventoryApi.getInventory(...)
```

这样接口变更可以通过：

TypeScript 编译错误

快速发现。

---

# 9. apps/api 总体结构

NestJS 后端：

```text
apps/api/src/
```

推荐：

```text
apps/api/src/
│
├── main.ts
├── app.module.ts
│
├── modules/
│
├── common/
│
├── infrastructure/
│
├── database/
│
├── config/
│
├── workers/
│
└── health/
```

---

# 10. modules

业务模块放：

```text
modules/
```

第一阶段建议：

```text
modules/
│
├── product/
├── inventory/
├── warehouse/
├── order/
├── picking/
├── shipment/
├── purchase/
├── transfer/
├── return/
├── finance/
├── sync/
├── exception/
├── notification/
├── store/
├── platform/
└── integration/
```

---

# 11. 模块内部统一结构

每个核心业务模块尽量遵循：

```text
inventory/
│
├── inventory.module.ts
│
├── controllers/
│
├── services/
│
├── entities/
│
├── repositories/
│
├── dto/
│
├── enums/
│
├── events/
│
├── errors/
│
├── mappers/
│
└── tests/
```

不是所有模块都必须拥有全部目录。

按实际需要创建。

---

# 12. Controller 职责

Controller 只负责：

```text
HTTP
↓
DTO Validation
↓
调用 Service
↓
Response
```

禁止：

```text
Controller
↓
直接 Repository
```

更禁止：

```text
Controller
↓
直接 SQL
```

例如正确：

```text
InventoryController
        ↓
InventoryService.reserveStock()
```

---

# 13. Service 职责

Service 负责：

**业务规则。**

例如：

```text
InventoryService
```

负责：

- 库存检查
- Reservation
- Picked
- 出库
- 库存事务
- 幂等
- 并发锁

---

# 14. Repository 职责

Repository：

只负责数据访问。

例如：

```text
InventoryRepository
```

可以提供：

```text
findBalance()
lockBalanceForUpdate()
saveBalance()
findReservation()
```

但：

Repository 不决定业务。

禁止：

```text
InventoryRepository.shipOrder()
```

因为“订单出库”是业务行为。

---

# 15. Entity

TypeORM Entity 放：

```text
modules/<domain>/entities/
```

例如：

```text
inventory/entities/
├── inventory-balance.entity.ts
├── inventory-reservation.entity.ts
├── inventory-transaction.entity.ts
└── inventory-serial.entity.ts
```

---

# 16. Entity 不等于 DTO

严禁：

```text
Controller
直接返回 TypeORM Entity
```

必须经过：

```text
Entity
↓
Mapper
↓
Response DTO
```

这样数据库字段调整不会污染API。

---

# 17. DTO 分类

建议：

```text
dto/
├── request/
└── response/
```

例如：

```text
inventory/dto/request/
├── reserve-stock.dto.ts
├── release-reservation.dto.ts
└── adjust-stock.dto.ts
```

```text
inventory/dto/response/
├── inventory-balance.dto.ts
└── inventory-transaction.dto.ts
```

---

# 18. Domain Error

业务错误不能随便：

```typescript
throw new Error("没库存");
```

建立明确错误类型。

例如：

```text
InventoryError
├── InsufficientStockError
├── InvalidReservationStateError
├── SerialNumberNotFoundError
├── SerialNumberUnavailableError
└── InventoryRecordMissingError
```

---

# 19. 全局错误处理

NestJS 建：

```text
common/filters/
```

例如：

```text
global-exception.filter.ts
```

统一返回：

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

---

# 20. API正常返回格式

建议统一：

```json
{
  "success": true,
  "data": {}
}
```

分页：

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 50,
    "total": 238
  }
}
```

---

# 21. HTTP 状态码

建议：

```text
200
正常查询/修改

201
创建成功

400
请求格式错误

401
未认证

403
无权限

404
资源不存在

409
业务状态冲突

422
业务规则不允许

429
限流

500
系统异常

503
外部平台不可用
```

例如：

库存不足：

可采用：

```text
409
```

错误码：

```text
INVENTORY_INSUFFICIENT_STOCK
```

---

# 22. Inventory Module

这是整个系统核心模块。

结构建议：

```text
inventory/
│
├── inventory.module.ts
│
├── controllers/
│   └── inventory.controller.ts
│
├── services/
│   ├── inventory.service.ts
│   ├── reservation.service.ts
│   ├── inventory-query.service.ts
│   └── inventory-allocation.service.ts
│
├── repositories/
│   ├── inventory-balance.repository.ts
│   ├── inventory-reservation.repository.ts
│   └── inventory-transaction.repository.ts
│
├── entities/
│
├── dto/
│
├── enums/
│
├── errors/
│
└── tests/
```

---

# 23. InventoryService 不要变成 God Service

虽然库存只能统一由库存模块修改：

也不能把所有逻辑写在：

```text
inventory.service.ts
```

5000行。

建议拆：

```text
InventoryService
```

负责协调。

专门：

```text
ReservationService
InventoryMovementService
InventoryQueryService
InventoryAllocationService
SerialInventoryService
```

---

# 24. Stock Mutation 与 Query 分离

推荐：

```text
InventoryQueryService
```

负责：

- 查询库存
- Available计算
- 聚合
- 仓库库存
- SKU库存

而：

```text
InventoryService
```

负责：

- receive
- reserve
- release
- pick
- ship
- adjust

这样读写职责更清楚。

---

# 25. Order Module

结构：

```text
order/
├── order.module.ts
├── controllers/
├── services/
│   ├── order.service.ts
│   ├── order-ingestion.service.ts
│   └── order-status.service.ts
├── repositories/
├── entities/
├── dto/
├── enums/
├── errors/
└── tests/
```

---

# 26. Order Ingestion

专门建立：

```text
OrderIngestionService
```

负责：

```text
平台订单
↓
去重
↓
解析
↓
Listing映射
↓
创建Order
↓
创建OrderItem
↓
尝试Reservation
```

不要把这些逻辑放进：

```text
OzonAdapter
```

Adapter只是转换平台数据。

---

# 27. Order 状态更新

状态机操作：

统一经过：

```text
OrderStatusService
```

禁止：

```typescript
order.status = 'SHIPPED';
await repository.save(order);
```

随意修改。

正确：

```text
orderStatusService.transition(
  order,
  OrderStatus.SHIPPED
)
```

并自动写：

```text
OrderStatusHistory
```

---

# 28. Warehouse Module

负责：

```text
Warehouse
Bin
Warehouse Configuration
StoreWarehouseBinding
```

但：

库存数量仍由 Inventory Module负责。

WarehouseModule 不能直接改库存。

---

# 29. Picking Module

建议单独模块：

```text
picking/
```

而不是全部塞进Warehouse。

负责：

```text
PickingTask
PickingTaskItem
Batch Picking
SKU Scan
SN Scan
Pick Confirmation
```

调用：

```text
InventoryService.pickStock()
```

---

# 30. Shipment Module

负责：

```text
Shipment
Package
PackageItem
ShippingLabel
Tracking
```

结构：

```text
shipment/
├── shipment.service.ts
├── label.service.ts
├── tracking.service.ts
└── ...
```

---

# 31. Purchase Module

负责：

```text
Supplier
PurchaseOrder
PurchaseOrderItem
PurchaseReceipt
```

真正入库时：

```text
PurchaseReceiptService
↓
InventoryService.receiveStock()
```

采购模块不能直接：

```text
inventory_balance + 100
```

---

# 32. Transfer Module

调拨流程：

```text
TransferService
```

调用：

```text
InventoryService.transferOut()
InventoryService.transferIn()
```

在途状态：

由调拨模块管理。

库存账：

仍由 InventoryService负责。

---

# 33. Return Module

退货负责：

```text
ReturnOrder
ReturnItem
ReturnReceipt
ReturnQC
```

货回来：

先：

```text
QC_PENDING
```

QC确认后：

调用：

```text
InventoryService.returnToStock()
```

---

# 34. Finance Module

Finance 第一阶段可以晚做UI。

但代码边界先固定：

```text
finance/
├── raw/
├── normalization/
├── settlement/
├── cost/
└── report/
```

建议明确：

平台原始财务数据

与

统一财务流水

分离。

---

# 35. Platform Module

负责：

```text
Platform
Store
Credential
Fulfillment Config
```

不负责调用平台API。

平台 API 接入属于：

```text
Integration Module
```

---

# 36. Integration Module

建议结构：

```text
integration/
│
├── platform-adapter.interface.ts
├── platform-adapter.registry.ts
│
├── ozon/
│   ├── ozon.module.ts
│   ├── ozon.adapter.ts
│   ├── ozon.client.ts
│   ├── ozon.mapper.ts
│   ├── ozon.rate-limiter.ts
│   └── types/
│
├── wildberries/
│   ├── wildberries.adapter.ts
│   └── ...
│
└── yandex/
    └── ...
```

---

# 37. Adapter Interface

建议正式冻结为：

```typescript
export interface PlatformAdapter {
  readonly platformCode: string;

  validateCredential(
    credential: PlatformCredentialContext,
  ): Promise<void>;

  fetchListings(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformListingRaw>>;

  fetchOrders(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformOrderRaw>>;

  fetchInventory(
    context: StoreContext,
  ): Promise<PlatformInventoryRaw[]>;

  pushInventory(
    context: StoreContext,
    items: PlatformInventoryPushItem[],
  ): Promise<PlatformPushResult>;

  fetchShippingLabel(
    context: StoreContext,
    request: ShippingLabelRequest,
  ): Promise<ShippingLabelResult>;

  fetchTracking(
    context: StoreContext,
    shipments: TrackingRequest[],
  ): Promise<TrackingResult[]>;

  fetchFinance?(
    context: StoreContext,
    request: FinanceSyncRequest,
  ): Promise<FinanceSyncResult>;

  processWebhook?(
    context: StoreContext,
    payload: unknown,
  ): Promise<PlatformWebhookEvent[]>;
}
```

平台适配器统一契约是整个系统扩平台能力的核心，新增平台应主要通过新 Adapter 完成，而不侵入库存和订单领域。fileciteturn1file0L242-L272

---

# 38. Adapter 返回统一模型

Adapter 不把 OZON 原始数据直接交给 OrderService。

应该：

```text
OZON API DTO
↓
OzonMapper
↓
PlatformOrderRaw
↓
OrderIngestionService
```

WB/Yandex一样。

---

# 39. rawData仍然保留

Mapper统一以后：

仍保存：

```text
rawData
```

用于排查。

即：

统一模型

和：

平台原始JSON

同时保留。

---

# 40. Platform Client

每个平台：

```text
*.client.ts
```

只负责：

- HTTP请求
- Token/Header
- Timeout
- Retry
- Rate Limit
- API日志

不应该：

处理订单库存业务。

---

# 41. Sync Module

建议：

```text
sync/
├── sync.module.ts
├── services/
│   ├── sync-dispatcher.service.ts
│   ├── order-sync.service.ts
│   ├── inventory-sync.service.ts
│   ├── listing-sync.service.ts
│   └── finance-sync.service.ts
├── entities/
│   └── sync-job.entity.ts
└── processors/
```

---

# 42. Sync Dispatcher

负责：

```text
同步哪个Store
同步哪种类型
是否已有Running任务
创建SyncJob
发送BullMQ Job
```

例如：

```text
dispatch(
 storeId,
 ORDER_SYNC
)
```

---

# 43. SyncJob 维度

所有任务按：

```text
Store + Sync Type
```

隔离。

这一点必须作为数据库和队列设计共同约束；凭证、游标、任务状态及错误都不能只按平台共享。fileciteturn1file2L18-L23

---

# 44. BullMQ Queues

第一阶段建议不要一个平台一条Queue。

按业务类型划分：

```text
wcies.order-sync
wcies.inventory-sync
wcies.tracking-sync
wcies.finance-sync
wcies.notification
wcies.import
wcies.webhook
```

Job Data携带：

```text
platformCode
storeId
syncType
```

---

# 45. 为什么不建议：

```text
ozon-queue
wb-queue
yandex-queue
```

因为以后业务：

```text
Order Sync
Inventory Sync
Finance Sync
```

的：

- 重试
- 超时
- 并发

要求不同。

按业务划分更合理。

---

# 46. Processor

例如：

```text
workers/order-sync.processor.ts
```

只负责：

```text
Job
↓
OrderSyncService.execute(...)
```

Processor不写复杂业务逻辑。

---

# 47. BullMQ Job Id

建议：

```text
jobId =
syncType:storeId:timeBucket
```

或明确的业务幂等键。

避免同一时刻重复创建大量同类任务。

---

# 48. 同步单飞

除了BullMQ JobId：

数据库仍需检查：

```text
SyncJob RUNNING
```

避免：

进程重启 / Queue重试

导致重复运行。

---

# 49. Webhook Module

Webhook入口：

```text
/api/v1/webhooks/:platform/:storeId
```

流程：

```text
收到请求
↓
快速验证签名
↓
保存 external_raw_event
↓
发送 BullMQ job
↓
返回成功
```

不要在 HTTP 请求中执行：

```text
锁库存
大量订单处理
库存推送
```

---

# 50. Webhook 原始事件

建议独立表：

```text
external_raw_events
```

保存：

```text
platform
store
eventType
externalEventId
payload
receivedAt
processedAt
status
```

---

# 51. 幂等责任边界

需要区分三层。

## API事件幂等

例如：

Webhook Event ID。

## 业务实体幂等

例如：

```text
store_id + platform_order_id
```

## 库存业务幂等

例如：

```text
ORDER_RESERVE:<order_item_id>
```

三层不能混成一个。

---

# 52. 配置管理

```text
apps/api/src/config/
```

建议：

```text
app.config.ts
database.config.ts
redis.config.ts
storage.config.ts
security.config.ts
queue.config.ts
```

---

# 53. 环境变量

`.env`

只保存：

真正环境级配置。

例如：

```text
DATABASE_URL
REDIS_URL
JWT_SECRET
CREDENTIAL_ENCRYPTION_KEY
S3_ENDPOINT
S3_ACCESS_KEY
S3_SECRET_KEY
```

不要保存：

```text
OZON_STORE_A_WAREHOUSE_ID
```

这种业务数据。

店铺仓库关系必须存数据库。

将平台仓绑定从进程级环境变量下沉为业务数据，是多店铺和多仓模型正确运行的基础。fileciteturn1file2L47-L54

---

# 54. Secret原则

`.env`

禁止提交Git。

生产环境：

未来可以考虑：

- Docker Secret
- Vault
- 云 Secret Manager

MVP阶段：

安全服务器上的 `.env.production`

可以接受。

---

# 55. Database目录

建议：

```text
apps/api/src/database/
├── database.module.ts
├── datasource.ts
└── subscribers/
```

Migration统一放：

```text
database/migrations/
```

---

# 56. 禁止 synchronize:true

生产环境：

TypeORM：

```text
synchronize: false
```

所有数据库结构变化：

必须使用 Migration。

---

# 57. Migration 命名

例如：

```text
20260908_001_create_products.ts

20260908_002_create_skus.ts

20260908_003_create_inventory_core.ts
```

原则：

一个Migration围绕一个明确领域变更。

---

# 58. Migration不可随意修改

Migration 一旦进入：

开发共享环境

或：

生产环境

原则上禁止修改原文件。

应该新建：

```text
migration
```

修正。

---

# 59. shared package

```text
packages/shared
```

允许：

- 基础Result类型
- 通用日期工具
- 通用Enum
- 通用分页类型
- 无业务依赖工具

禁止：

```text
InventoryService
OrderEntity
```

进入 shared。

---

# 60. platform-contracts

建议：

```text
packages/platform-contracts
```

存：

```text
PlatformAdapter interface
PlatformOrderRaw
PlatformListingRaw
PlatformInventoryRaw
PlatformWebhookEvent
```

这样：

Adapter

和：

业务层

依赖同一契约。

---

# 61. 不要建立巨大 types 包

禁止最后出现：

```text
packages/types/
```

里面放几百个完全不同领域类型。

优先：

按领域就近存放。

只有跨应用真正共享的才进入 package。

---

# 62. docs

强烈建议正式建立：

```text
docs/
│
├── architecture/
│   ├── overview.md
│   ├── modules.md
│   └── dependency-rules.md
│
├── business-rules/
│   ├── inventory.md
│   ├── orders.md
│   ├── warehouse.md
│   ├── transfer.md
│   └── returns.md
│
├── api/
│
├── database/
│
├── integrations/
│   ├── ozon.md
│   ├── wildberries.md
│   └── yandex.md
│
└── decisions/
```

---

# 63. business-rules/inventory.md

这份必须成为：

**库存圣经。**

明确：

```text
On Hand
Reserved
Picked
Available
Safety Stock
```

以及：

```text
receive
reserve
release
pick
ship
transfer
return
adjust
```

的合法变化。

Vibe Coding修改库存代码前：

必须先读这份。

---

# 64. 订单状态规则文档

```text
docs/business-rules/orders.md
```

明确：

平台状态：

和：

ERP状态

之间的映射。

以及：

合法状态迁移。

---

# 65. 集成知识库

每个平台一份：

```text
docs/integrations/ozon.md
```

记录：

- Authentication
- Endpoint
- Rate limit
- Pagination
- Cursor
- Order Status
- Warehouse Mapping
- Inventory API
- Label API
- 已知坑
- 实测结果

不要让这些知识散落在代码注释和聊天记录里。

---

# 66. AGENTS.md

根目录正式使用：

```text
AGENTS.md
```

目的：

让每次新的 AI Coding Session 先读取统一规则。

此前设计中通过 AGENTS.md、受限导入和自动架构检查限制 AI 越界的方向应继续作为工程基本纪律。fileciteturn1file0L306-L325

---

# 67. AGENTS.md 第一组：硬性规则

必须明确：

```text
1. 禁止直接修改 inventory_balances。
2. 库存变更只能调用 InventoryService。
3. 所有库存变更必须写 InventoryTransaction。
4. Controller不能直接访问Repository。
5. Platform Adapter不能直接修改订单和库存。
6. 新平台必须实现PlatformAdapter。
7. Entity不得直接作为API Response。
8. 外部事件必须考虑幂等。
9. 不得自行增加业务状态。
10. 修改状态机前必须更新业务规则文档。
```

---

# 68. 第二组：代码规范

例如：

```text
单个Service建议≤300行。

单个函数建议≤50行。

禁止any进入核心库存/财务代码。

禁止静默catch。

禁止magic string业务状态。

枚举统一定义。

涉及库存的Service必须有Integration Test。
```

不要过于机械要求：

所有文件必须低于固定行数。

但超过约300–400行：

AI必须主动评估拆分。

---

# 69. 架构依赖方向

最重要规则：

```text
Controller
    ↓
Service
    ↓
Repository

Integration Adapter
    ↓
Platform Contracts

Order Service
    ↓
Inventory Service
```

禁止：

```text
Repository
↓
Controller
```

禁止：

```text
Inventory
↓
OzonAdapter
```

Inventory 不应该知道：

什么是OZON。

---

# 70. Module Dependency

建议大体：

```text
Product
   ↑
Order
   ↓
Inventory
   ↑
Warehouse

Purchase
   ↓
Inventory

Picking
   ↓
Inventory

Shipment
   ↓
Inventory

Transfer
   ↓
Inventory

Return
   ↓
Inventory
```

---

# 71. Sync依赖

```text
Sync
↓
Platform Adapter

Sync
↓
OrderService

Sync
↓
InventoryAllocationService
```

但：

```text
InventoryService
```

不依赖：

```text
SyncModule
```

---

# 72. Notification

所有模块允许：

```text
publish Domain Event
```

Notification订阅：

```text
ORDER_INTERCEPTION_REQUIRED
TRANSFER_DIFFERENCE
SYNC_FAILED
```

而不是：

每个Service直接调用飞书。

---

# 73. Domain Event

MVP阶段不需要 Kafka。

可以使用：

```text
NestJS EventEmitter
```

进行应用内部事件。

例如：

```text
OrderInterceptionRequiredEvent
```

NotificationService监听：

发送站内 + 飞书。

---

# 74. 什么时候用BullMQ，什么时候用EventEmitter

EventEmitter：

适合：

```text
应用内部快速事件
```

例如：

订单拦截以后触发通知。

BullMQ：

适合：

```text
异步
可重试
可能耗时
外部IO
```

例如：

OZON同步。

---

# 75. 测试目录

模块单测：

```text
modules/inventory/tests/
```

跨模块集成测试：

```text
tests/integration/
```

完整业务流程：

```text
tests/e2e/
```

---

# 76. 数据库集成测试

库存相关：

不要全部 Mock Repository。

必须有一组：

真实 PostgreSQL Test DB。

验证：

```text
Transaction

FOR UPDATE

Unique Constraint

Rollback

Concurrency
```

因为这些正是库存正确性的核心。

---

# 77. Testcontainers

后续推荐：

```text
Testcontainers
```

自动启动：

PostgreSQL

Redis

用于集成测试。

MVP初始阶段：

也可先用独立 Docker Compose test profile。

---

# 78. Mock Adapter

Integration层必须实现：

```text
MockPlatformAdapter
```

用于：

```text
测试订单同步
测试库存推送
测试物流
```

不依赖真实平台。

---

# 79. Adapter Contract Test

所有 Adapter 应跑同一套基础测试：

```text
fetchOrders结果满足统一契约

fetchInventory满足契约

pushInventory错误结构统一

分页Cursor正确

限流可恢复
```

这样以后增加新平台更安全。

---

# 80. scripts

```text
scripts/
```

建议第一阶段建立：

```text
check-architecture.ts

generate-api-client.ts

seed-dev-data.ts

reset-dev-db.ts

verify-env.ts
```

---

# 81. check-architecture

自动检查至少：

```text
Controller直接import Repository

integration import inventory repository

web import api Entity

跨模块直接引用内部Repository

违规目录依赖
```

---

# 82. CI

第一阶段 GitHub Actions 或其他Git CI：

```text
install
↓
lint
↓
typecheck
↓
unit test
↓
architecture check
↓
build
```

数据库Integration Test：

可以随后加入。

---

# 83. Docker开发环境

建议：

```text
docker-compose.yml
```

包括：

```text
postgres
redis
minio
```

Web/API：

开发时可以本地pnpm启动。

这样热更新体验更好。

---

# 84. Docker生产环境

生产：

```text
web
api
worker
postgres
redis
object-storage
reverse-proxy
```

全部Docker。

---

# 85. Worker部署

代码初期可以仍放：

```text
apps/api
```

但运行入口分开：

```text
main.ts

worker.ts
```

生产形成：

```text
API Container

Worker Container
```

使用同一代码镜像。

---

# 86. 为什么推荐API/Worker分进程

API：

处理用户请求。

Worker：

执行：

- 平台同步
- Excel导入
- 物流查询
- 财务拉取

如果 Worker因为第三方 API 卡死：

不能拖垮ERP页面。

---

# 87. Worker代码目录

建议：

```text
apps/api/src/workers/
├── worker.module.ts
├── order-sync.processor.ts
├── inventory-sync.processor.ts
├── tracking-sync.processor.ts
├── finance-sync.processor.ts
├── notification.processor.ts
└── import.processor.ts
```

---

# 88. 日志

统一推荐：

结构化 JSON Log。

字段：

```text
requestId
userId
storeId
platform
jobId
orderId
skuId
```

按业务附加。

---

# 89. Request ID

每个HTTP请求：

产生：

```text
requestId
```

并贯穿：

Controller

Service

Database Log

API调用。

便于排查。

---

# 90. Job ID

后台任务：

产生：

```text
jobId
syncJobId
```

平台API日志：

关联：

```text
syncJobId
```

这样以后可以从：

Dashboard失败任务

追到具体API请求。

---

# 91. 数据库 Query Logging

生产不要打开：

全部SQL日志。

只：

- 慢查询
- 错误
- 调试环境详细日志

否则订单量上来后日志非常吵。

---

# 92. 导入中心

Excel Import：

必须单独模块。

不要：

每个页面各自实现xlsx解析。

流程：

```text
Upload
↓
Object Storage
↓
ImportJob
↓
BullMQ
↓
Parse
↓
Validate
↓
Import Rows
↓
Report
```

---

# 93. Import Job

建议：

```text
import_job
import_job_row
```

允许：

- 查看成功数
- 错误数
- 错误行
- 重试

---

# 94. 模块禁止互相直接改表

例如：

Purchase：

不能：

```text
UPDATE skus SET moving_average_cost
```

如果成本规则属于库存成本领域：

应该调用对应：

```text
InventoryCostService
```

或者后续：

```text
CostService
```

---

# 95. 模块内部允许事务协调

一个业务操作可能跨模块。

例如：

采购入库：

```text
PurchaseReceipt
+
Inventory
+
Cost
```

需要同一事务。

推荐建立：

```text
Application Service
```

协调。

例如：

```text
ReceivePurchaseService
```

负责开启事务并调用不同领域能力。

---

# 96. 不要过早做DDD复杂化

虽然采用：

Domain Module思想。

但第一阶段不要强制加入：

```text
Aggregate Root
Value Object
Domain Repository Interface
CQRS
Event Sourcing
```

除非某个模块确实有必要。

避免为了架构漂亮增加开发负担。

---

# 97. 建议代码层次

目前足够：

```text
Controller

Application / Domain Service

Repository

Entity
```

加：

```text
Adapter
Worker
```

已经能满足系统需要。

---

# 98. 第一阶段实际模块依赖图

```text
                         ┌────────────┐
                         │    Web     │
                         └─────┬──────┘
                               │
                               ▼
                         ┌────────────┐
                         │ Controller │
                         └─────┬──────┘
                               │
              ┌────────────────┼──────────────────┐
              ▼                ▼                  ▼
            Order           Purchase           Picking
              │                │                  │
              └────────┬───────┴─────────┬────────┘
                       ▼                 ▼
                  Inventory         Shipment
                       ▲                 │
                       │                 │
               Warehouse             Tracking
                       
Sync ──────► PlatformAdapter
 │
 ├────────► Order
 │
 └────────► Inventory Allocation

Notification ◄──── Domain Events
```

---

# 99. 第一批代码目录

Sprint 0先建立：

```text
apps/web

apps/api

packages/shared

packages/api-client

packages/platform-contracts

docs

scripts

database/migrations
```

API先建立：

```text
modules/
├── product
├── inventory
├── warehouse
├── order
├── platform
├── store
├── sync
├── exception
└── integration
```

先不要把所有空模块都生成出来。

---

# 100. 第一批真正实现的模块

顺序：

```text
Product
↓
Warehouse
↓
Inventory
↓
Store
↓
Platform Mapping
↓
Order
↓
Sync
↓
Ozon Adapter
```

---

# 101. Sprint 0 完成标准

Sprint 0不是：

“项目能Hello World”。

应该至少达到：

1. Monorepo启动。
2. React能运行。
3. NestJS能运行。
4. PostgreSQL连接正常。
5. Redis连接正常。
6. Migration能执行。
7. Swagger可访问。
8. 全局Validation工作。
9. 全局Error Filter工作。
10. 日志有RequestId。
11. BullMQ测试队列工作。
12. MinIO/Object Storage可用。
13. ESLint工作。
14. Architecture Check工作。
15. Unit Test工作。
16. Docker Compose工作。
17. CI基础流程工作。

---

# 102. Sprint 1开始条件

只有 Sprint 0 骨架稳定以后：

才正式开发：

```text
Product
SKU
Barcode
Warehouse
Bin
Inventory
```

避免业务代码建立在不断变化的工程结构上。

---

# 103. Vibe Coding操作原则

每次让AI开发任务：

应该指定：

```text
目标模块
允许修改目录
相关业务规则文档
输入
输出
事务要求
错误码
测试要求
禁止事项
```

---

# 104. 示例 Prompt

例如：

```text
实现 InventoryService.reserveStock。

允许修改：
apps/api/src/modules/inventory/**
tests/integration/inventory/**

先阅读：
docs/business-rules/inventory.md
AGENTS.md

输入：
skuId
warehouseId
orderId
orderItemId
quantity
idempotencyKey

要求：
- PostgreSQL事务
- 对InventoryBalance使用FOR UPDATE
- 检查可用库存
- 库存不足抛InsufficientStockError
- 创建InventoryReservation
- 更新reservedQty
- 写InventoryTransaction
- 保证idempotencyKey幂等
- 添加并发Integration Test

禁止：
- 直接修改其他模块Repository
- 修改业务规则
- 使用any
```

这种Prompt比：

```text
“帮我做库存锁定”
```

可靠得多。

---

# 105. 工程架构冻结规则

以下规则建议现在冻结：

1. Monorepo使用pnpm。
2. Web与API分离。
3. Backend使用NestJS领域模块。
4. Controller保持薄。
5. Repository只负责数据访问。
6. Entity不直接暴露API。
7. DTO与Entity分离。
8. 库存只能通过Inventory模块修改。
9. Platform API只能通过Adapter访问。
10. Sync按Store隔离。
11. 耗时同步进入BullMQ。
12. Webhook先入原始事件再异步处理。
13. Migration管理Schema。
14. 禁止生产`synchronize=true`。
15. 外部输入必须校验。
16. 所有核心业务错误使用明确错误码。
17. 核心模块必须有自动化测试。
18. Vibe Coding必须遵守AGENTS.md。
19. 平台业务知识进入docs/integrations。
20. 核心业务规则进入docs/business-rules。

---

# 106. 下一阶段

工程架构冻结以后，下一步应该进入：

## Sprint 0 工程初始化规格

具体定义：

- package.json
- pnpm workspace
- TypeScript配置
- ESLint
- Prettier
- Vite初始化
- NestJS初始化
- TypeORM DataSource
- PostgreSQL
- Redis
- BullMQ
- MinIO
- Docker Compose
- Swagger
- ValidationPipe
- Error Filter
- Logger
- Health Check
- Migration命令
- CI
- AGENTS.md第一版

形成真正可以直接交给程序员或 Vibe Coding Agent 执行的初始化任务清单。