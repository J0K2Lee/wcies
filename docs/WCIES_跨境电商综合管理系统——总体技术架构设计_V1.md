# WCIES 跨境电商综合管理系统
## 总体技术架构设计 V1

---

# 1. 文档目的

本文档定义 WCIES 当前阶段的总体技术架构、模块边界、技术栈、核心数据流、平台集成方式、库存架构、同步机制、异步任务、工程规范及部署结构。

本文档作为后续以下工作的统一技术依据：

- 数据库设计
- 后端模块开发
- 前端页面开发
- 平台 API 对接
- 库存同步
- 订单同步
- 仓库作业
- Vibe Coding
- 自动化测试
- 部署与维护

系统设计目标不是简单构建若干管理页面，而是形成一套以：

**内部 SKU + 实体库存账本 + 订单事件 + 平台适配器**

为核心的跨境电商 ERP。

---

# 2. 系统背景

WCIES 服务于深圳跨境电商团队。

当前运营平台包括：

- OZON
- Wildberries
- Yandex Market

当前店铺规模：

| 平台 | 店铺数量 |
|---|---:|
| OZON | 8 |
| Wildberries | 1 |
| Yandex Market | 2 |
| 合计 | 11 |

当前履约模式包括：

### OZON

- RFBS
- FBS
- FBO
- FBP

### Wildberries

- FBS
- FBW

### Yandex Market

- FBS
- FBY

未来系统需要继续支持：

- 新平台
- 新店铺
- 新履约模式
- 俄罗斯本土仓
- 第三方海外仓
- 更多自管仓

因此：

**任何平台、店铺、仓库、履约模式不得硬编码到核心业务逻辑。**

---

# 3. 核心设计原则

WCIES 必须遵守以下架构原则。

## 3.1 内部 SKU 是统一业务核心

所有平台商品最终必须映射到：

**Internal SKU**

平台 SKU、Offer ID、商品链接等均属于外部身份。

系统的：

- 库存
- 订单
- 采购
- 成本
- 调拨
- SN
- 退货

均围绕内部 SKU 运行。

---

# 4. 商品身份与平台身份分离

系统内部结构：

```text
Product / SPU
    ↓
Internal SKU
    ↓
Platform Listing SKU
    ↓
Platform Listing
    ↓
Store
    ↓
Platform
```

必须支持：

> 一个内部 SKU 映射多个平台、多个店铺、多个商品链接。

不得对：

```text
sku_id + store_id
```

建立“只能有一个 Listing”的业务限制。

平台商品映射必须独立建表。

---

# 5. 物理库存与渠道库存分离

WCIES 必须明确区分三个库存层级。

## 5.1 实体库存 Physical Inventory

回答：

> 商品真实在哪里？

维度：

```text
SKU
+
Warehouse
+
Bin
+
Inventory Condition
```

这是 ERP 的库存事实源。

---

## 5.2 可用库存 Available Inventory

回答：

> 当前实际上还能继续出售多少？

基本计算：

```text
Available

=

On Hand
- Reserved
- Picked
- Safety Stock
- Unavailable Stock
```

---

## 5.3 渠道库存 Channel Inventory

回答：

> 最终准备告诉某个平台某个店铺多少库存？

例如：

```text
深圳库存真实可售：80

OZON A：30
OZON B：20
WB：15
Yandex：15
```

渠道库存：

**不等于实体库存。**

平台库存数字不得直接反向覆盖实体库存。

这一“事实库存 / 渠道库存”分层是整个库存系统的基础。fileciteturn1file0L82-L90

---

# 6. 系统总体架构

总体架构：

```text
┌────────────────────────────┐
│        React Web/PWA       │
│       Ant Design UI        │
└──────────────┬─────────────┘
               │
               │ REST / OpenAPI
               ▼
┌────────────────────────────┐
│          NestJS API        │
│                            │
│ Product                    │
│ Inventory                  │
│ Warehouse                  │
│ Order                      │
│ Purchase                   │
│ Shipment                   │
│ Transfer                   │
│ Return                     │
│ Finance                    │
│ Sync                       │
│ Notification               │
│ Integration                │
└───────┬────────┬───────────┘
        │        │
        │        └──────────────┐
        ▼                       ▼
 PostgreSQL                  Redis
                                │
                                ▼
                              BullMQ

        │
        ├─────────────► Object Storage
        │
        └─────────────► External Platform APIs
                          │
                          ├─ OZON
                          ├─ Wildberries
                          └─ Yandex
```

---

# 7. 技术栈

## 7.1 前端

```text
TypeScript
React 19
Vite 8
Ant Design 6
React Router 8
TanStack Query 5
Zustand（按需）
```

---

## 7.2 后端

```text
TypeScript
Node.js 24 LTS
NestJS 11
TypeORM
REST API
OpenAPI / Swagger
```

---

## 7.3 数据层

```text
PostgreSQL 18
Redis
S3 Compatible Object Storage
```

---

## 7.4 异步任务

```text
BullMQ
```

---

## 7.5 基础设施

```text
Docker
Docker Compose
Nginx / Caddy
pnpm Monorepo
Git
ESLint
Prettier
```

---

# 8. 为什么采用前后端分离

WCIES 当前已经包括：

- 多店铺
- 多仓库
- 实时库存
- 扫码
- 订单
- 面单
- 物流
- SN
- 采购
- 调拨
- 退货
- 财务
- 后台同步任务

因此前端只负责：

- 数据展示
- 用户交互
- 扫码
- 表单
- 打印

所有核心业务规则必须位于后端。

例如：

前端不得自行执行：

```text
库存 - 1
```

只能调用：

```text
InventoryService.shipStock()
```

---

# 9. 前端架构

建议目录：

```text
apps/web/src/

├── app/
├── routes/
├── pages/
├── features/
├── components/
├── hooks/
├── services/
├── api/
├── stores/
├── types/
└── utils/
```

---

# 10. 前端数据职责

## TanStack Query

负责：

- API请求
- Query Cache
- Mutation
- 自动刷新
- Retry
- Loading
- Error

## React Router

负责：

- URL状态
- 页面导航
- 筛选条件
- 详情页

## Ant Design Form

负责：

- 表单状态
- 数据校验
- 输入交互

## Zustand

仅用于必要的客户端全局状态：

- 当前用户
- 当前仓库
- UI状态
- 扫码设备状态

不得将业务主数据长期复制到 Zustand。

---

# 11. 后端架构

NestJS 按业务领域拆分。

建议：

```text
apps/api/src/

├── modules/
│
│   ├── product/
│   ├── inventory/
│   ├── warehouse/
│   ├── order/
│   ├── purchase/
│   ├── shipment/
│   ├── transfer/
│   ├── return/
│   ├── finance/
│   ├── sync/
│   ├── notification/
│   ├── exception/
│   └── integration/
│
├── common/
├── infrastructure/
├── database/
└── config/
```

---

# 12. Domain Service 原则

每个领域负责自己的核心规则。

例如：

```text
ProductService
InventoryService
WarehouseService
OrderService
PurchaseService
ShipmentService
TransferService
ReturnService
FinanceService
SyncService
NotificationService
```

模块之间必须通过公开 Service 调用。

禁止：

```text
OrderModule
直接 UPDATE inventory_balances
```

正确方式：

```text
OrderService
    ↓
InventoryService.reserveStock()
```

---

# 13. InventoryService 是库存唯一入口

所有库存变化必须调用：

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

其他模块禁止直接更新库存余额。

---

# 14. 库存核心模型

库存主要由以下实体组成：

```text
InventoryBalance

InventoryReservation

InventoryTransaction

InventorySafetyStock

InventorySerial

InventoryChannelRule
```

---

# 15. Inventory Balance

代表：

**系统当前库存状态。**

核心维度：

```text
SKU
+
Warehouse
+
Bin
+
Condition
```

保存：

```text
On Hand
Reserved
Picked
```

不永久保存：

```text
Available
```

Available 由系统实时计算。

---

# 16. Inventory Transaction

任何库存变化必须生成：

**Inventory Transaction**

例如：

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

SCRAP

MANUAL_ADJUSTMENT
```

库存余额回答：

> 现在有多少？

库存流水回答：

> 为什么变成这么多？

两者必须分离。

---

# 17. Inventory Reservation

订单占用库存必须产生：

```text
InventoryReservation
```

这样才能明确：

```text
Reserved = 12
```

具体是被哪些订单占用。

---

# 18. 库存并发控制

所有涉及库存修改的业务必须：

```text
BEGIN

SELECT InventoryBalance
FOR UPDATE

业务校验

修改库存

写流水

修改相关业务单据

COMMIT
```

禁止只依赖前端校验。

---

# 19. 库存分配器

系统建立统一：

**Inventory Allocator**

作用：

> 将 ERP 实际可售库存计算成各店铺目标推送库存。

核心思想：

**账本层负责“有多少”，分配层负责“准备在哪卖多少”。**

分配器采用：

**持久化规则 + 实时纯函数计算**

而不是每轮都保存一个新的规则结果。fileciteturn1file1L12-L16

---

# 20. 分配规则

建议第一阶段支持：

## SHARED

共享全部可售：

```text
push = available
```

## FIXED

固定最大数量：

```text
push = min(fixedQty, available)
```

## RATIO

按比例：

```text
target = available × ratio
push = min(target, available)
```

## MAX_LIMIT

限制最大平台展示库存：

```text
push = min(available, maxQty)
```

---

# 21. 分配规则优先级

建议支持：

```text
SKU + Store级规则
        ↓
Store默认规则
        ↓
系统默认 SHARED
```

即：

具体SKU规则优先于店铺默认规则。

这一 Default + Override 结构适合大量 SKU 管理。fileciteturn1file1L20-L33

---

# 22. 禁止主动超卖

第一阶段：

```text
oversell = false
```

平台推送数量原则上不得高于系统允许的可售数量。

但是：

如果因为：

- API同步延迟
- 多平台同时下单
- 外部平台状态延迟

产生缺货订单：

系统不得删除订单或让整个同步任务失败。

---

# 23. Backorder / 缺货订单

Order Item 增加：

```text
PENDING

RESERVED

BACKORDERED

PICKED

SHIPPED

RELEASED
```

订单锁库存失败：

```text
BACKORDERED
```

并进入：

```text
Exception Center
```

但是：

其他订单继续处理。

缺货订单以后库存恢复时：

可以重新尝试锁库存。

这种行级失败隔离机制用于避免单个订单阻塞整个同步任务。fileciteturn1file1L76-L90

---

# 24. Store

店铺必须作为独立业务实体。

结构：

```text
Platform
    ↓
Store
```

Store 包含：

- 平台
- 店铺名称
- Seller ID
- 币种
- 状态
- 默认设置

---

# 25. Credential

平台凭证与店铺业务实体分离。

结构：

```text
Store
   ↓
PlatformCredential
```

一个店铺未来可以拥有：

- API Credential
- Ads Credential
- Finance Credential
- Webhook Secret
- Rotation Credential

平台密钥不得暴露给前端。

敏感凭证：

加密存储。

---

# 26. Store Warehouse Binding

系统建立：

```text
StoreWarehouseBinding
```

负责定义：

> 某个店铺在某种履约模式下，对应哪个 ERP 仓库和哪个平台仓库。

建议字段：

```text
store_id

warehouse_id

fulfillment_mode

platform_warehouse_id

is_inventory_source

is_inventory_push_enabled

priority

settings JSONB
```

---

# 27. 一个仓库可以被多个店铺共享

例如：

```text
深圳仓
```

可以同时绑定：

```text
OZON店铺A RFBS

OZON店铺B RFBS

WB FBS

Yandex FBS
```

它们共享同一个实体库存账本。

不同店铺通过：

**Inventory Allocator**

得到不同渠道库存。

---

# 28. 平台仓

例如：

```text
OZON FBO
OZON FBP
WB FBW
Yandex FBY
```

平台仓仍然作为：

```text
Warehouse
```

进入 ERP。

区别是：

- 数据来源可能主要是平台 API；
- ERP需要保存调拨账；
- ERP需要对平台库存进行对账。

---

# 29. 仓库类型

建议：

```text
SELF

PLATFORM

THIRD_PARTY

RETURN_TEMP
```

此外：

```text
TRANSIT
```

建议视为库存状态/业务过程处理。

若未来需要聚合视图，再增加：

```text
WarehouseGroup
```

而不是伪造一个真实库存仓。

---

# 30. Warehouse Group

未来可以支持：

```text
中国全部库存

俄罗斯全部库存

全部平台仓

OZON全部库存
```

这些属于：

**查询聚合视图**

不拥有独立库存。

不会参与：

- 调拨
- 出库
- 库存流水
- 平台同步

这一类聚合视图应由成员仓实时推导。fileciteturn1file2L47-L53

---

# 31. 平台 Adapter

所有平台必须实现统一：

```text
PlatformAdapter
```

建议接口：

```text
authenticate()

fetchProducts()

fetchListings()

fetchOrders()

fetchOrderDetail()

fetchInventory()

pushInventory()

fetchShippingLabel()

fetchTracking()

fetchFinance()

handleWebhook()
```

核心业务模块不得直接调用：

```text
Ozon API
WB API
Yandex API
```

---

# 32. Platform Adapter Registry

建立统一：

```text
PlatformAdapterRegistry
```

根据：

```text
platform_code
```

获取：

```text
OzonAdapter

WildberriesAdapter

YandexAdapter
```

新平台接入原则：

```text
新增 Adapter
+
注册
+
配置 Store
```

不修改库存、订单等核心模块。

这一接口隔离方式用于保证新增平台不会侵入库存核心。fileciteturn1file0L242-L272

---

# 33. 平台特有字段

平台专属字段：

例如：

```text
OZON offer_id

WB nmID

Yandex campaign data
```

原则：

高频核心身份字段结构化保存。

大量平台特有非核心属性：

保存为：

```text
raw_data JSONB

extra_data JSONB
```

避免为每个平台建立大量专用业务字段。

---

# 34. 同步引擎

系统建立统一：

```text
Sync Engine
```

负责：

- 订单同步
- 商品同步
- 库存拉取
- 库存推送
- 物流同步
- 财务同步

---

# 35. SyncJob

每次同步必须产生：

```text
SyncJob
```

维度：

```text
store_id
+
sync_type
```

例如：

```text
OZON-A / ORDER

OZON-A / INVENTORY

OZON-B / ORDER

WB-A / ORDER
```

同步任务必须按店铺隔离。fileciteturn1file2L18-L23

---

# 36. 同步隔离

如果：

```text
OZON店铺A
```

API异常。

不得影响：

```text
OZON店铺B
WB
Yandex
```

因此：

- Credential
- Cursor
- Lock
- Retry
- SyncJob
- Error

均按：

```text
Store
```

隔离。

---

# 37. 同步游标

每个：

```text
Store + Sync Type
```

单独记录：

```text
Cursor
```

例如：

订单同步：

```text
OZON-A
cursor = xxx
```

不能使用平台级共享游标。

---

# 38. 同步单飞锁

同一：

```text
Store + Sync Type
```

只能同时运行一个任务。

例如：

```text
OZON-A ORDER_SYNC
```

正在运行时：

第二个相同任务：

跳过或排队。

防止：

- 重复拉取
- 重复扣库存
- 数据竞争

---

# 39. 同步重试

API错误：

```text
429
500
timeout
network
```

进入：

BullMQ Retry。

采用：

```text
指数退避
+
平台 Retry-After
```

超过最大次数：

```text
SyncJob = FAILED
```

并进入异常中心。

---

# 40. Webhook + 定时补拉

订单同步采用：

```text
Webhook
+
Scheduled Pull
```

Webhook负责：

快速响应。

定时补拉负责：

可靠性。

不得依赖单一机制。

---

# 41. 异步任务架构

以下任务进入 BullMQ：

```text
order-sync

inventory-push

inventory-fetch

tracking-sync

finance-sync

label-fetch

notification

excel-import

webhook-processing
```

HTTP 请求只负责：

```text
提交任务
```

长时间平台同步不得阻塞 Web 请求。

---

# 42. 幂等设计

所有外部事件必须考虑重复执行。

订单唯一键：

```text
store_id
+
platform_order_id
```

而不是：

```text
platform_order_id
```

全局唯一。

---

# 43. Inventory Idempotency Key

所有库存关键业务需要：

```text
idempotency_key
```

例如：

```text
OZON_CANCEL_STORE_A_123456_ITEM1
```

重复收到事件：

系统判断已经处理：

直接返回成功。

不得重复释放库存。

---

# 44. Tracking Event 幂等

物流节点通过：

```text
shipment
+
event_hash
```

去重。

同一轨迹重复获取：

不重复插入。

---

# 45. “没有库存记录”和“库存为零”必须区分

这是库存同步的最高级安全规则之一。

```text
NO_INVENTORY_RECORD
```

不能解释为：

```text
ZERO_INVENTORY
```

如果某个：

```text
SKU + Warehouse
```

在 ERP 完全没有库存账本：

库存同步应该：

```text
SKIP
```

而不是：

```text
push 0
```

这样避免系统初始化、数据迁移或映射缺失时错误清空平台真实库存。fileciteturn1file2L47-L54

---

# 46. 平台库存同步流程

自管仓：

```text
InventoryBalance
     ↓
计算 Available
     ↓
应用 Safety Stock
     ↓
Inventory Allocator
     ↓
计算 Store Target Stock
     ↓
Platform Adapter
     ↓
pushInventory
```

---

# 47. 平台仓同步流程

平台仓：

```text
Platform API
     ↓
fetchInventory
     ↓
保存 Platform Inventory Snapshot
     ↓
与 ERP 调拨账 / 平台仓账比较
     ↓
差异
     ↓
Exception Center
```

---

# 48. 平台库存快照

建议建立：

```text
PlatformInventorySnapshot
```

记录：

```text
store

listing

warehouse

sellable

reserved

returned

raw_data

synced_at
```

它不是实体库存事实源。

作用：

- 平台对账
- 同步日志
- 差异排查

---

# 49. 订单数据流

订单流程：

```text
Platform
   ↓
Webhook / Sync
   ↓
Adapter
   ↓
Order Ingestion
   ↓
幂等判断
   ↓
SKU Mapping
   ↓
Inventory Reservation
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

---

# 50. 订单锁库存

平台生成新订单：

```text
InventoryService.reserveStock()
```

Reserved 增加。

On Hand：

不变。

---

# 51. 拣货

进入仓库执行后：

```text
Reserved
↓
Picked
```

并必须：

- 扫 SKU
- 校验数量
- SN商品扫描SN

扫码错误：

禁止继续。

---

# 52. 正式出库

正式交运：

```text
Picked ↓

On Hand ↓
```

产生：

```text
ORDER_SHIP
```

库存流水。

---

# 53. 取消订单

未拣货：

```text
Reserved
↓
Released
```

已经 Picked：

禁止直接恢复库存。

系统创建：

```text
Interception Task
```

并发送：

```text
Feishu Notification
```

---

# 54. 拦截回库

找到商品以后：

```text
扫描订单
↓
扫描SKU
↓
扫描SN
↓
扫描库位
↓
Return To Stock
```

只有实体商品重新回到货架：

系统库存才恢复可售。

---

# 55. Notification Service

业务模块不得直接写：

```text
FeishuWebhook.send()
```

业务模块只发布事件：

例如：

```text
ORDER_INTERCEPTION_REQUIRED

INVENTORY_SYNC_FAILED

TRANSFER_DIFFERENCE

TRACKING_STALLED
```

Notification Service决定：

```text
SYSTEM
FEISHU
```

未来可扩展：

```text
EMAIL
WECHAT_WORK
TELEGRAM
```

---

# 56. Exception Center

统一管理：

```text
ORDER_OUT_OF_STOCK

ORDER_SKU_MAPPING_FAILED

NEGATIVE_INVENTORY

INVENTORY_SYNC_FAILED

ORDER_CANCEL_AFTER_PICK

TRANSFER_DIFFERENCE

SERIAL_NUMBER_ERROR

TRACKING_STALLED

TRACKING_LOST

RETURN_ORDER_NOT_FOUND

API_CONNECTION_ERROR
```

---

# 57. 异常不能阻塞整体同步

原则：

**尽可能做到行级失败，而不是任务级失败。**

例如100个订单：

```text
99成功
1缺货
```

结果：

```text
99正常处理

1订单 BACKORDERED
```

不能让：

整个 Order Sync Failed。

---

# 58. API设计

系统使用：

```text
REST API
+
OpenAPI
```

统一前缀：

```text
/api/v1
```

例如：

```text
GET    /api/v1/products

GET    /api/v1/skus

GET    /api/v1/inventory

POST   /api/v1/inventory/reservations

POST   /api/v1/inventory/reservations/:id/release

POST   /api/v1/picking-tasks

GET    /api/v1/orders

POST   /api/v1/transfers
```

---

# 59. DTO边界

数据库 Entity：

不能直接暴露给前端。

正确结构：

```text
TypeORM Entity
     ↓
Domain Service
     ↓
DTO
     ↓
Controller
     ↓
OpenAPI
     ↓
Frontend Client
```

---

# 60. 输入校验

所有外部输入必须校验。

包括：

```text
HTTP Body

Query

Path Params

Webhook Payload

Excel Import

Platform API Response
```

NestJS 层统一使用：

```text
DTO
+
class-validator / validation pipe
```

关键平台数据可再增加独立 Schema 校验。

---

# 61. 原始平台数据

重要平台数据尽可能保存：

```text
raw_data JSONB
```

包括：

```text
Order Raw Data

Listing Raw Data

Tracking Raw Data

Finance Raw Data
```

平台API升级或映射错误时：

可以追查。

---

# 62. 外部事件日志

Webhook 建议首先写入：

```text
external_raw_events
```

然后异步处理。

流程：

```text
Webhook
↓
保存原始Payload
↓
返回200
↓
BullMQ
↓
业务处理
```

这样避免平台重试和长事务耦合。

---

# 63. Monorepo

建议：

```text
wcies/

├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── shared/
│   ├── api-client/
│   ├── config/
│   └── platform-types/
│
├── docs/
├── docker/
├── scripts/
├── AGENTS.md
└── pnpm-workspace.yaml
```

---

# 64. Shared Package

`packages/shared`

只保存真正可以共享的：

- 通用枚举
- 基础工具
- 无业务依赖类型

不得让前端：

直接 import TypeORM Entity。

---

# 65. API Client

建议根据：

```text
OpenAPI
```

自动生成：

```text
packages/api-client
```

前端调用：

```text
generated API client
```

避免手写大量接口类型。

---

# 66. 平台 Integration 目录

后端建议：

```text
modules/integration/

├── platform-adapter.interface.ts
├── adapter-registry.ts

├── ozon/
│   ├── ozon.adapter.ts
│   ├── ozon.client.ts
│   ├── ozon.mapper.ts
│   └── ozon.types.ts
│
├── wildberries/
│
└── yandex/
```

---

# 67. Adapter 与 Mapper 分离

Adapter：

负责业务接口。

Client：

负责：

```text
HTTP
Authentication
Retry
Rate Limit
```

Mapper：

负责：

```text
平台DTO
→
WCIES统一模型
```

避免一个：

```text
ozon.adapter.ts
```

写成几千行。

---

# 68. API Rate Limit

每个平台 Adapter 必须支持：

- 限流
- Retry-After
- Timeout
- Retry
- Request Logging

不得将限流逻辑分散在业务模块。

---

# 69. 工程纪律

WCIES 使用 Vibe Coding，因此必须建立：

**AI可执行的工程约束。**

---

# 70. AGENTS.md

仓库根目录建立：

```text
AGENTS.md
```

规定：

### 架构

- 业务规则必须位于业务模块
- Controller保持薄
- 禁止跨模块直接访问Repository
- 库存只能由InventoryService修改
- 平台调用必须经过Adapter

### 数据

- 任何库存变化必须写流水
- Platform Inventory不得修改实体库存
- 外部事件必须考虑幂等
- Store级数据必须携带store_id

### 代码

- 单文件过长必须拆分
- 禁止超大型 Service
- 新代码必须有对应测试
- 不允许 AI 自行创造业务规则

此前工程纪律设计已经明确要求通过领域边界、受限导入及自动检查防止业务代码互相越界。fileciteturn1file0L306-L325

---

# 71. Architecture Checks

建议增加：

```text
scripts/check-architecture.ts
```

自动检查：

- Controller是否直接访问Repository
- Integration是否直接修改Inventory
- 禁止前端引用后端Entity
- 单文件过长
- 禁止跨领域违规import

---

# 72. ESLint

强制：

- import boundaries
- no circular dependency
- max file size
- no floating promise
- no any（核心模块）
- unused import

---

# 73. Git Hooks

使用：

```text
Husky
+
lint-staged
```

Commit前：

```text
lint
typecheck
architecture check
unit tests
```

---

# 74. 测试分层

## Unit Test

重点测试：

```text
库存计算
Allocator
状态机
成本计算
物流状态转换
```

## Integration Test

测试：

```text
PostgreSQL真实事务
FOR UPDATE
库存Reservation
订单同步
幂等
```

## Adapter Test

每个平台：

```text
Mock API
+
Contract Test
```

## E2E

验证：

```text
订单
→
锁库存
→
拣货
→
出库
```

---

# 75. 第一优先测试

必须优先保证：

### Case 1

库存：

1

同时两个订单。

结果：

```text
1成功
1缺货
```

---

### Case 2

Webhook重复。

结果：

```text
1订单
1Reservation
1流水
```

---

### Case 3

已Picked订单取消。

结果：

```text
不能自动恢复库存
必须创建拦截任务
```

---

### Case 4

不存在 Inventory Balance。

结果：

```text
库存同步跳过
不能推0
```

---

# 76. Docker架构

开发环境：

```text
Docker Compose

postgres
redis
object-storage
api
web
worker
```

---

# 77. Worker

初期：

Worker仍可运行在 NestJS 工程中。

逻辑模块保持：

```text
apps/api
```

将来任务量增加：

可以独立：

```text
apps/worker
```

但第一阶段不做微服务。

---

# 78. 部署模式

第一阶段：

```text
单服务器
+
Docker Compose
```

足够。

无需：

```text
Kubernetes
Service Mesh
Microservices
```

---

# 79. 安全

必须至少覆盖：

- API凭证加密
- JWT/Session鉴权
- RBAC预留
- HTTPS
- 数据库不暴露公网
- Redis不暴露公网
- Object Storage私有Bucket
- Signed URL
- 操作日志
- 财务权限隔离预留

---

# 80. 凭证加密

平台凭证：

数据库只保存密文。

推荐：

```text
AES-256-GCM
```

主密钥：

来自环境变量或Secret Manager。

前端永远无法获得解密后的平台 Key。

---

# 81. 对象存储

对象存储用于：

- 商品图片
- SKU图片
- 物流面单
- 导入文件
- 导出文件
- 后续退货图片

数据库只保存：

```text
object_key
URL
metadata
```

---

# 82. 日志

日志至少分：

```text
Application Log

API Log

Platform Sync Log

Inventory Transaction

Operation Log

External Event Log
```

库存流水不能使用普通日志替代。

---

# 83. 观测

每次平台同步至少记录：

```text
store
type
start
finish
cursor
success_count
failed_count
retry_count
error
```

Dashboard展示：

```text
每店最后同步时间
同步状态
连续失败次数
```

---

# 84. 财务技术架构

财务模块虽然晚于库存上线，但底层遵守：

```text
External Raw Finance Data
      ↓
Normalized Finance Entry
      ↓
Accounting / Profit Calculation
```

平台原始账单不能直接被最终财务结果覆盖。

---

# 85. 汇率

财务使用：

```text
Settlement Exchange Rate Snapshot
```

一旦结算：

保存当时汇率。

后续汇率变化：

不得自动修改历史财务结果。

---

# 86. 采购成本

采用：

```text
移动加权平均
```

入库时更新成本。

采购未收货：

不得提前改变库存成本。

---

# 87. 系统未来扩展原则

未来增加：

- AI
- 自动调价
- 广告
- BI
- 客服
- 知识库

不得直接侵入：

```text
Inventory Core
```

AI只能通过公开：

```text
Service / API
```

访问业务系统。

---

# 88. AI自动操作原则

未来AI如果执行：

```text
调价
库存分配
补货
```

必须：

产生：

```text
Business Command
```

由业务 Service执行。

AI不能直接操作数据库。

---

# 89. 当前架构核心闭环

第一阶段真正需要跑通：

```text
创建Product/SKU
↓
建立平台映射
↓
采购入库
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

异常：

```text
订单取消
↓
未拣货：释放Reservation

已拣货：
Interception Task
↓
飞书通知
↓
扫码回库
```

---

# 90. 核心不可违反规则

以下规则作为 WCIES 架构级规则冻结：

1. Internal SKU 是库存统一身份。
2. 平台 SKU 只是外部映射。
3. Listing支持一SKU多链接。
4. Store和Credential分离。
5. Store和Warehouse多对多绑定。
6. Physical Inventory和Channel Inventory分离。
7. Available库存不直接永久冗余保存。
8. 库存余额与库存流水分离。
9. 所有库存变化必须经过InventoryService。
10. 所有库存变化必须写InventoryTransaction。
11. Reservation必须知道对应订单。
12. Reserved和Picked必须区分。
13. 平台订单状态与ERP订单状态分离。
14. Order与Shipment分离。
15. Shipment与Package分离。
16. 平台同步必须按Store隔离。
17. 每个Store+SyncType拥有独立Cursor。
18. 外部事件必须幂等。
19. 单条异常不能无必要阻塞整批同步。
20. 没有库存记录不能等同于库存0。
21. 自管仓库存由ERP事实账本决定。
22. 平台仓库存由API拉取并与ERP账对比。
23. 渠道库存必须经过Allocator。
24. 第一阶段禁止主动超卖。
25. Vibe Coding必须遵守AGENTS.md和架构检查。
26. AI不得直接决定或修改业务核心规则。
27. AI不得直接修改库存数据库。
28. 新平台只能通过Adapter接入。
29. 平台特有数据不得污染通用领域模型。
30. 核心库存正确性优先于理论上的极限性能。

---

# 91. 当前最终技术形态

```text
                        ┌──────────────┐
                        │ React Web/PWA│
                        │ Ant Design   │
                        └───────┬──────┘
                                │
                         REST / OpenAPI
                                │
                                ▼
                    ┌──────────────────────┐
                    │      NestJS API      │
                    │                      │
                    │ Product              │
                    │ Inventory            │
                    │ Warehouse            │
                    │ Order                │
                    │ Purchase             │
                    │ Shipment             │
                    │ Transfer             │
                    │ Return               │
                    │ Finance              │
                    │ Sync                 │
                    │ Notification         │
                    └─────────┬────────────┘
                              │
              ┌───────────────┼────────────────┐
              │               │                │
              ▼               ▼                ▼
        PostgreSQL          Redis        Object Storage
                              │
                              ▼
                            BullMQ
                              │
                              ▼
                      Platform Adapters
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
               OZON           WB         Yandex
```

---

# 92. 下一阶段

总体架构确定后，开发前还需要继续冻结：

1. Monorepo最终目录结构
2. NestJS模块依赖关系
3. InventoryService接口契约
4. PlatformAdapter TypeScript接口
5. Sync Engine任务模型
6. BullMQ Queue设计
7. API统一响应格式
8. 错误码规范
9. DTO规范
10. 配置与Secret规范
11. Database Migration规范
12. AGENTS.md正式版
13. Sprint 0工程初始化方案

完成以上内容后即可创建代码仓库并开始 Sprint 0。