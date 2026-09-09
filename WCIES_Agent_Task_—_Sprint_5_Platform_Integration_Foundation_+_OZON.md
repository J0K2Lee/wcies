# WCIES Agent Task
## Sprint 5 — Platform Integration Foundation + OZON Order/Listing Sync

## 1. Sprint目标

在现有完整内部业务闭环之上，实现：

```text
OZON
 ↓
OzonClient
 ↓
OzonAdapter
 ↓
Platform Contract
 ↓
Sync Engine
 ├─ Listing Sync
 ├─ Order Polling
 └─ Webhook Processing
 ↓
现有 Listing / OrderIngestionService
 ↓
Inventory / Picking / Shipment
```

本 Sprint 的核心目标：

> OZON 只负责提供外部数据，WCIES 内部业务规则仍完全由现有领域模块决定。

完成后应能够：

- 配置并验证 OZON 店铺凭证；
- 每个 Store 独立同步；
- 拉取并保存 OZON Listing；
- 将平台 Listing 映射到 Internal SKU；
- 拉取 OZON 订单；
- 转换为 `NormalizedOrderInput`；
- 调用现有 `OrderIngestionService`；
- 支持 Webhook（若 OZON 官方当前能力支持）；
- 支持 Polling Catch-up；
- 查看同步历史、错误、游标和未映射数据。

---

# 2. 开始前

执行：

```bash
git status
```

必须阅读：

```text
AGENTS.md

docs/architecture/*
docs/business-rules/orders.md
docs/business-rules/inventory.md
docs/integrations/ozon.md
```

重点阅读：

```text
PlatformAdapter
PlatformCredential
Store
ListingResolverService
OrderIngestionService
Shipment
Sync/BullMQ基础设施
```

---

# 3. P0：先修复 Shipment 审计问题

Sprint 4报告指出：

> Interception 回库时会物理删除 shipment_items snapshot。

本 Sprint 开始时先改掉。

要求：

- 已经产生业务历史的 `shipment_items` 不物理删除；
- 改为 `VOIDED/CANCELLED` 或等价状态；
- 保留原数量、OrderItem、Shipment引用；
- 记录 void reason / voided_at；
- Package/Shipment有效数量计算排除 VOIDED 行；
- Operation/History仍可追踪。

不得通过删除历史记录保持“数据干净”。

完成后补 Integration Test。

---

# 4. 本 Sprint 禁止的真实平台操作

**禁止调用任何会修改 OZON 真实业务状态的 API。**

本 Sprint 禁止：

```text
pushInventory
updatePrice
updateProduct
createProduct
cancelOrder
confirmShipment
changeShipmentStatus
平台发货
平台退货操作
```

即：

> Sprint 5 = Read-first Integration。

只有用户明确批准的：

```text
Credential Validation
Read API
```

可以做真实 OZON Smoke Test。

---

# 5. 不猜 OZON API

实现前必须以：

```text
当前 OZON 官方 Seller API 文档
+
用户真实 API 响应
```

为依据。

禁止凭记忆猜：

- Endpoint；
- Header；
- Request字段；
- Response字段；
- Pagination；
- Status；
- Rate Limit；
- Webhook格式。

把验证后的知识写入：

```text
docs/integrations/ozon.md
```

记录：

```text
官方来源
验证日期
实际请求
实际响应摘要
Rate Limit
Pagination/Cursor
已知问题
```

---

# 6. Platform Contract扩展

当前最小 `PlatformAdapter` 扩展为 Sprint 5 所需能力：

```typescript
interface PlatformAdapter {
  readonly platformCode: string;

  validateCredential(
    context: PlatformCredentialContext,
  ): Promise<void>;

  fetchListings(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformListingRaw>>;

  fetchOrders(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformOrderRaw>>;

  processWebhook?(
    context: StoreContext,
    payload: unknown,
  ): Promise<PlatformWebhookEvent[]>;
}
```

暂时不要为了未来一次性加入大量空方法。

---

# 7. Integration目录

建立：

```text
modules/integration/
├── platform-adapter.interface.ts
├── platform-adapter.registry.ts
│
└── ozon/
    ├── ozon.module.ts
    ├── ozon.adapter.ts
    ├── ozon.client.ts
    ├── ozon.mapper.ts
    ├── ozon.errors.ts
    └── types/
```

职责必须分离：

### Client

负责：

```text
HTTP
Authentication
Timeout
Retry
Rate Limit
Request/Response Logging
```

### Mapper

负责：

```text
OZON DTO
→
WCIES统一模型
```

### Adapter

负责：

组合Client + Mapper实现统一Contract。

---

# 8. 核心模块禁止认识 OZON

以下模块中不得出现 OZON API 判断：

```text
Inventory
Order
Picking
Shipment
ListingResolver
Warehouse
```

正常流程必须保持：

```text
OZON
↓
Adapter / Mapper
↓
Normalized WCIES Model
↓
Domain Service
```

---

# 9. PlatformAdapterRegistry

实现：

```text
PlatformAdapterRegistry
```

支持：

```typescript
getAdapter(platformCode)
```

例如：

```text
OZON → OzonAdapter
```

后续 WB / Yandex 只能通过注册新 Adapter 扩展。

不得：

```typescript
if (platform === 'OZON') ...
else if (platform === 'WB') ...
```

散落在 Sync Service 中。

---

# 10. Sync Core

建立正式：

```text
SyncModule
```

至少支持：

```text
LISTING_SYNC
ORDER_SYNC
```

后续再扩：

```text
INVENTORY_SYNC
TRACKING_SYNC
FINANCE_SYNC
```

---

# 11. sync_jobs

建立：

```text
sync_jobs
```

字段至少：

```text
id
store_id
sync_type

status

started_at
finished_at

cursor_before JSONB
cursor_after JSONB

success_count
failed_count
skipped_count

retry_count
error_code
error_message

trigger_type

created_at
```

---

# 12. Sync Job Status

至少：

```text
PENDING
RUNNING
SUCCESS
PARTIAL
FAILED
```

Trigger：

```text
MANUAL
SCHEDULED
WEBHOOK
RETRY
```

---

# 13. Sync Cursor

建立：

```text
sync_cursors
```

唯一维度：

```text
store_id + sync_type
```

字段：

```text
store_id
sync_type
cursor_data JSONB
last_success_at
updated_at
```

不得平台级共享Cursor。

---

# 14. Store隔离

每一个：

```text
Store + SyncType
```

必须独立拥有：

```text
Credential
Cursor
Lock
SyncJob
Retry
Error
```

一个 OZON Store失败：

不得：

阻塞其他 OZON Store。

---

# 15. Single Flight

同一个：

```text
Store + SyncType
```

同时只能有：

```text
1 RUNNING
```

任务。

至少使用：

```text
BullMQ Job Guard
+
数据库 SyncJob Guard
```

避免：

Manual Sync

和：

Scheduled Sync

同时运行。

---

# 16. BullMQ

正式建立：

```text
wcies.order-sync
wcies.listing-sync
wcies.webhook
```

Processor只负责：

```text
Job
↓
SyncService.execute()
```

禁止Processor写平台/订单业务逻辑。

---

# 17. Listing Sync

流程：

```text
OZON fetchListings
↓
Raw Data保存
↓
Mapper
↓
Platform Listing
↓
Platform Listing SKU
↓
Mapping State
```

不得在 Adapter里直接修改 Listing Repository。

---

# 18. 未映射 Platform SKU

Sprint 1 的 Listing Mapping模型需要支持：

```text
平台SKU已存在
但尚未映射Internal SKU
```

如果当前：

```text
platform_listing_skus.sku_id NOT NULL
```

则本 Sprint应正式调整模型：

```text
sku_id nullable
mapping_status = UNMAPPED | MAPPED
```

Resolver只解析：

```text
sku_id IS NOT NULL
```

不得为了同步Listing：

随便猜一个Internal SKU。

---

# 19. Listing Sync安全规则

平台同步可以：

- 新建平台Listing事实；
- 更新平台标题；
- 更新Raw Data；
- 更新平台状态；
- 更新last_seen_at。

不得：

自动覆盖人工 Internal SKU Mapping。

如果已有：

```text
platform_listing_sku → Internal SKU
```

再次同步：

必须保留映射。

---

# 20. 平台未返回Listing

第一次Full Sync未看到某Listing：

不要立即物理删除。

使用：

```text
last_seen_at
platform_status
```

记录。

任何自动Deactivate策略必须建立在：

官方API确认是完整权威集合

的前提下。

---

# 21. Order Sync标准链路

必须严格：

```text
OzonAdapter.fetchOrders()
↓
OzonMapper
↓
NormalizedOrderInput
↓
OrderIngestionService
```

禁止：

```text
OzonAdapter
↓
OrderRepository
```

---

# 22. Order Sync必须复用现有逻辑

不得重新实现：

```text
SKU Mapping
Reservation
Backorder
Exception
Order Status
```

这些已经属于：

```text
OrderIngestionService
```

平台同步只负责：

把正确输入送进去。

---

# 23. 原始订单数据

必须保存完整：

```text
raw_data
```

用于排查：

> OZON实际给了什么？

不能只有经过Mapper裁剪后的统一字段。

---

# 24. Order Sync幂等

必须继续依赖：

```text
UNIQUE(store_id, platform_order_id)
```

以下情况最终只能一张Order：

```text
Poll获取一次
Poll再次获取
Webhook再次收到
Manual Catch-up再次获取
```

并且：

Reservation / InventoryEvent

只能产生一次。

---

# 25. Cursor推进规则

Cursor只在：

当前Page/Batch已经被安全处理后推进。

允许：

某订单进入业务异常：

```text
BACKORDERED
ORDER_SKU_MAPPING_FAILED
```

仍视为：

**已成功摄入事实。**

不能因此永远卡住同步Cursor。

但：

以下失败不得推进：

```text
HTTP传输失败
响应无法解析
数据库事务失败
系统级未知异常
```

---

# 26. 外部原始事件

建立：

```text
external_raw_events
```

至少：

```text
id

platform
store_id

event_type
external_event_id NULL

payload JSONB

payload_hash

status

received_at
processed_at

error_code
error_message
```

---

# 27. Raw Event 幂等

如果平台提供：

```text
externalEventId
```

使用：

```text
store + eventId
```

去重。

如果没有：

使用稳定：

```text
payload hash
+
必要业务键
```

但不得使用随机UUID作为外部事件幂等依据。

---

# 28. Webhook

只有在：

**当前 OZON 官方能力确认支持所需订单Webhook**

后才实现真实处理。

正确流程：

```text
HTTP Request
↓
验证官方要求的签名/身份
↓
保存 external_raw_event
↓
BullMQ
↓
快速HTTP成功响应
```

禁止在Webhook HTTP中：

```text
创建Order
锁库存
长时间请求平台API
```

---

# 29. 如果当前官方Webhook不满足需求

不得伪造。

明确记录：

```text
Webhook capability unavailable / insufficient
```

并使用：

```text
Scheduled Polling
+
Catch-up
```

保证订单同步。

---

# 30. Scheduled Polling

实现：

```text
Scheduler
↓
dispatch Store + ORDER_SYNC
```

频率：

必须：

- 可配置；
- 不写死在Domain Service；
- 根据官方Rate Limit安全设置。

Webhook存在时：

Polling承担：

```text
Catch-up / Lost Event Recovery
```

---

# 31. 手工同步

UI支持：

```text
同步订单
同步Listing
```

点击后：

只创建Sync Job。

不要HTTP一直等待平台同步完成。

---

# 32. Credential Validation

店铺页面增加：

```text
验证连接
```

流程：

```text
Store
↓
读取并解密Credential
↓
OzonAdapter.validateCredential
↓
只执行安全Read/Validation请求
↓
更新验证状态
```

Credential不得返回前端。

日志不得输出：

```text
Client Secret
API Key
Authorization
```

---

# 33. Credential元数据

建议增加：

```text
last_validated_at
last_validation_status
last_validation_error
```

便于运营看到：

```text
已连接
认证失败
未验证
```

---

# 34. Sync Dashboard

新增：

```text
/operations/sync
```

或：

```text
/sync
```

至少显示：

```text
Platform
Store
Sync Type
Status
Started
Finished
Success
Failed
Skipped
Duration
Last Cursor
Error
```

---

# 35. Store详情同步Tab

Store详情增加：

```text
同步
```

显示：

```text
Credential状态
最后订单同步
最后Listing同步
连续失败次数
Manual Sync按钮
```

---

# 36. Listing Mapping UI增强

增加：

```text
UNMAPPED
```

筛选。

同步到平台SKU但没有Internal SKU：

应该能被运营快速看到。

允许人工：

```text
平台SKU
→ Internal SKU
```

映射。

---

# 37. 不能自动猜SKU

以下情况：

```text
seller_sku名字很像Internal SKU
标题很像
条码看起来一致
```

不能默认自动映射。

如果未来设计自动映射规则：

必须单独明确。

Sprint 5 默认：

```text
确定映射 → 保留
不确定 → UNMAPPED
```

---

# 38. Order Mapping失败行为

Listing未映射：

订单仍进入：

```text
Order
+
OrderItem mapping FAILED
+
ORDER_SKU_MAPPING_FAILED
```

现有规则保持不变。

不得因为 Listing Sync 尚未映射：

丢掉订单。

---

# 39. OzonClient错误归一化

平台HTTP错误必须转换为统一错误类别，例如：

```text
PLATFORM_AUTH_ERROR
PLATFORM_RATE_LIMITED
PLATFORM_TIMEOUT
PLATFORM_BAD_RESPONSE
PLATFORM_API_ERROR
```

必须保存：

安全的：

```text
HTTP Status
Request ID（如果平台返回）
Endpoint Name
Store
```

不得记录Secret。

---

# 40. Retry

只对可安全重试的错误执行：

```text
Timeout
5xx
Rate Limit
临时网络错误
```

不要对：

```text
401/403 Credential Error
请求字段错误
确定性业务错误
```

无限重试。

如官方返回：

```text
Retry-After
```

则按官方语义处理。

---

# 41. Rate Limit

Rate Limit必须位于：

```text
OzonClient / Integration Layer
```

而不是：

Order Service。

Store之间应尽量隔离。

一个Store触发限流：

不得拖死其他Store。

---

# 42. Contract Tests

建立：

```text
Platform Adapter Contract Test
```

至少验证：

```text
validateCredential
fetchListings
fetchOrders
pagination/cursor
error normalization
raw data preservation
```

OzonAdapter必须通过统一契约。

以后 WB / Yandex：

复用同一套Contract Test。

---

# 43. Mock HTTP / Fixtures

自动化测试：

不得依赖真实 OZON。

保存经过脱敏的：

```text
OZON response fixtures
```

用于：

```text
Mapper
Client
Adapter
Order Sync
```

测试。

Fixture必须：

删除真实Credential和买家敏感信息。

---

# 44. 必测：Multi Store隔离

例如：

```text
OZON Store A
OZON Store B
```

同时同步。

A失败：

```text
SyncJob A = FAILED
```

B：

```text
SUCCESS
```

Cursor B正常推进。

---

# 45. 必测：重复订单

同一Order由：

```text
Polling
Polling Again
Webhook
Manual Catch-up
```

分别出现。

最终：

```text
1 Order
正确OrderItems
1 Reservation
1组库存流水
```

---

# 46. 必测：跨Store同Platform Order ID

```text
Store A order = 123
Store B order = 123
```

必须：

两张独立Order。

---

# 47. 必测：Mapping失败

OZON订单到达，

Listing SKU尚未映射。

必须：

```text
Order保存
OrderItem FAILED
Exception创建
Cursor正常推进
```

---

# 48. 必测：Backorder

订单SKU已映射但库存不足：

```text
BACKORDERED
```

SyncJob仍可以：

```text
SUCCESS
```

因为：

平台事实已成功摄入。

---

# 49. 必测：HTTP失败

当前Batch：

平台请求Timeout。

必须：

```text
SyncJob FAILED / RETRY
Cursor不推进
Order不出现半批未知状态
```

---

# 50. 必测：Malformed Response

平台响应不符合已验证Schema。

必须：

```text
PLATFORM_BAD_RESPONSE
```

保存足够排错信息。

不得：

`as any`

强行通过。

---

# 51. 必测：Cursor

至少测试：

```text
Page 1成功
Page 2失败
```

恢复后：

不能从错误的新Cursor继续导致漏单。

---

# 52. 必测：Webhook + Poll竞态

Webhook和Polling同时处理同订单。

最终仍：

```text
1 Order
```

不得产生重复库存占用。

---

# 53. 必测：同步Single Flight

同一：

```text
Store + ORDER_SYNC
```

同时触发10次。

实际只能：

一个Active Sync。

---

# 54. 必测：凭证安全

验证：

```text
API Response
Log
SyncJob
Error
Raw Event
```

均不得包含：

真实API Secret。

---

# 55. Real OZON Smoke Test

自动测试全部通过以后，

才允许进行真实平台Smoke Test。

必须由用户知情批准。

并且只测试：

```text
Credential Validation
Fetch Listings
Fetch Orders
```

禁止任何真实写操作。

---

# 56. Smoke Test 范围控制

首次建议：

只选择：

```text
1个 OZON Store
```

验证。

确认：

```text
Credential
Pagination
Listing Mapping
Order Mapping
Raw Data
Cursor
Rate Limit
```

全部符合预期后：

再扩展到其他Store。

不要第一天同时启用全部店铺自动同步。

---

# 57. Scheduler上线策略

真实自动调度应分阶段：

```text
Manual
↓
单店Scheduled
↓
观察
↓
多店Scheduled
```

不要开发完成后立即打开所有Store自动同步。

---

# 58. 前端

本 Sprint至少：

### Sync Center

```text
/sync
```

### Store Detail

增加：

```text
Connection / Sync Status
```

### Listing Mapping

增加：

```text
UNMAPPED
```

视图。

### Orders

订单详情增加：

```text
Sync Source
Raw Platform Data
```

管理员查看能力。

---

# 59. Operation / Audit

人工操作：

```text
Validate Credential
Manual Sync
Manual Retry Sync
Manual Listing Mapping
```

应留下Operation Log。

系统自动同步主要通过：

```text
SyncJob
Raw Event
Application Log
```

追踪。

---

# 60. Migration建议

至少：

```text
extend_platform_listing_skus_mapping_state
add_listing_last_seen

create_sync_jobs
create_sync_cursors

create_external_raw_events

extend_platform_credentials_validation_metadata

add_sync_indexes

void_shipment_items_instead_of_delete
```

根据实际依赖合理拆分。

---

# 61. Architecture Check升级

至少确保：

```text
integration/ozon
```

不能：

```text
import Inventory Repository
import Order Repository
```

Sync模块不能：

直接修改库存表。

平台调用只能存在于：

```text
Integration / Adapter / Client
```

---

# 62. docs/integrations/ozon.md

Sprint结束时必须不再只是占位。

至少包含：

```text
Credential结构
验证方式
订单API能力
Listing API能力
Pagination
Rate Limit
Webhook能力
状态字段
关键平台ID语义
实际脱敏响应示例
验证日期
已知限制
```

所有内容必须来源于：

官方文档或真实验证。

---

# 63. 最终验证

必须：

```bash
pnpm lint
pnpm typecheck
pnpm check:arch
pnpm test
pnpm test:integration
pnpm build
```

全部通过。

并验证：

```text
全新空库
→ migrations
→ seed
→ integration
```

---

# 64. GUI验收

至少验证：

1. Store Credential状态可见；
2. Credential Validate操作；
3. Manual Listing Sync；
4. Sync Job实时状态；
5. Listing同步结果；
6. UNMAPPED SKU显示；
7. 人工完成Mapping；
8. Manual Order Sync；
9. 正常订单进入现有Order系统；
10. Mapping Failed订单进入异常；
11. Backorder订单正常；
12. 重复同步不重复建单；
13. 一个Store失败不影响另一个；
14. Sync错误可查看。

真实OZON测试仅在用户批准后追加。

---

# 65. 最终报告

请按以下结构：

## 1. P0 Audit Fix

说明 shipment_items 如何从物理删除改为可审计状态。

## 2. Platform Contract

## 3. OzonClient

说明 Auth / Retry / Rate Limit / Error Normalize。

## 4. OzonAdapter

## 5. Mapper

列出 OZON → WCIES 主要字段映射。

## 6. Sync Engine

说明 Store+SyncType隔离、Single Flight、Cursor。

## 7. Listing Sync

## 8. Order Sync

## 9. Webhook

明确说明官方能力与最终实现。

## 10. Idempotency

特别说明 Poll/Webhook竞态。

## 11. Credential Security

## 12. API

## 13. Frontend

## 14. Tests

## 15. GUI Acceptance

## 16. Real OZON Smoke Test

如未获用户批准：

明确写：

```text
NOT RUN
```

不得自行执行。

## 17. Migration

## 18. Architecture Check

## 19. docs/integrations/ozon.md 更新内容

## 20. 新增决策

## 21. 未完成项

## 22. 风险

## 23. Git Commits

## 24. 下一步

Sprint结束后：

**停止。**

不得自行实现：

```text
OZON库存推送
价格写入
平台发货写操作
WB Adapter
Yandex Adapter
```

---

# 66. Sprint 5完成定义

只有以下全部满足：

```text
Shipment审计历史不再物理删除

PlatformAdapter正式扩展
AdapterRegistry工作
OzonClient工作
OzonMapper工作
OzonAdapter工作

Credential Validation工作

SyncJob工作
SyncCursor工作
Store+SyncType隔离工作
Single Flight工作

Listing Sync工作
UNMAPPED Listing可见
人工Mapping不被同步覆盖

Order Poll Sync工作
OrderIngestionService正确复用
Mapping Failure正确
Backorder正确

Poll重复不重复订单
Webhook/Poll重复不重复订单
Cursor安全推进
一个Store失败不影响其他Store

Raw Event可审计
Secret无泄露

Sync UI可使用
OpenAPI更新

OZON知识文档已由真实来源完善

lint通过
typecheck通过
architecture check通过
unit通过
integration通过
build通过
空库Migration通过
```

才可以将：

**WCIES Sprint 5 — Platform Integration Foundation + OZON**

标记完成。