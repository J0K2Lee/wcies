# WCIES Agent Task
## Sprint 2 — Inventory Core 库存核心引擎

### 任务目标

在 Sprint 0 和 Sprint 1 已完成的工程与主数据基础上，实现 WCIES 第一版正式库存核心。

本 Sprint 是整个 WCIES 的高风险核心阶段。

目标不是“做一个库存数字字段”，而是建立：

```text
InventoryBalance
InventorySafetyStock
InventoryReservation
InventoryTransaction
InventoryAdjustment
Inventory Query
Available Calculation
Concurrency Control
Idempotency
Initial Stock Import
```

并完成可验证的：

```text
Receive / Initialize
Reserve
Release
Pick
Unpick
Ship
Adjust
Move Bin
```

库存核心能力。

Sprint 2 完成后，系统必须能够可靠回答：

> 某 SKU 在哪个仓、哪个库位有多少实物？

> 其中多少被订单占用？

> 多少已经拣出？

> 还能继续销售多少？

> 每一次库存变化为什么发生？

> 两个订单同时抢最后一件库存时，谁成功、谁失败？

---

# 一、开始前必须阅读

开始编码前：

```text
git status
```

确认工作区。

必须阅读：

```text
AGENTS.md

docs/business-rules/inventory.md

docs/architecture/*
```

并阅读 Sprint 1 已实现：

```text
Product
SKU
Warehouse
Warehouse Bin
Store Warehouse Binding
Operation Log
Import
```

相关代码和 Migration。

不得重构 Sprint 1 已验收功能，除非 Sprint 2 实现确实被阻塞。

---

# 二、Sprint 2 核心原则

必须严格遵守以下规则：

1. Internal SKU 是库存商品身份。
2. Inventory Core 不知道 OZON / WB / Yandex。
3. 所有库存变化必须经过 Inventory Module。
4. 所有库存变化必须产生 InventoryTransaction。
5. InventoryBalance 与 InventoryTransaction 分离。
6. Reservation 必须关联业务来源。
7. Reserved 与 Picked 必须分离。
8. Available 由当前库存状态计算，不作为独立可修改事实。
9. NO_INVENTORY_RECORD ≠ ZERO。
10. 正常业务不得产生负库存。
11. 库存修改必须事务化。
12. 并发库存修改必须使用 PostgreSQL 行级锁或经过验证的等效机制。
13. 外部/重复业务动作必须幂等。
14. 不允许通过手工调整修复 Reservation / Picked 等业务状态。
15. 库存正确性优先于代码简短或性能优化。

---

# 三、本 Sprint 明确不做

禁止提前进入：

```text
真实平台库存推送
Inventory Allocator 渠道分配
OZON/WB/Yandex订单同步
真实平台 Webhook
采购模块完整流程
调拨模块完整流程
退货模块
Shipment
物流
财务
```

本 Sprint 可以为这些后续模块提供库存 API。

但不得提前开发业务流程。

---

# 四、Inventory Module

建立或完善：

```text
apps/api/src/modules/inventory/
```

建议结构：

```text
inventory/
├── inventory.module.ts
│
├── controllers/
│   └── inventory.controller.ts
│
├── services/
│   ├── inventory.service.ts
│   ├── inventory-query.service.ts
│   ├── reservation.service.ts
│   ├── inventory-movement.service.ts
│   └── inventory-adjustment.service.ts
│
├── repositories/
│   ├── inventory-balance.repository.ts
│   ├── inventory-reservation.repository.ts
│   └── inventory-transaction.repository.ts
│
├── entities/
├── dto/
├── enums/
├── errors/
├── mappers/
└── tests/
```

不要将全部逻辑写入一个巨型 `inventory.service.ts`。

---

# 五、InventoryBalance

建立：

```text
inventory_balances
```

推荐字段：

```text
id UUID PK

sku_id UUID NOT NULL
warehouse_id UUID NOT NULL
bin_id UUID NOT NULL

inventory_condition VARCHAR(...) NOT NULL

on_hand_qty NUMERIC(18,3) NOT NULL DEFAULT 0
reserved_qty NUMERIC(18,3) NOT NULL DEFAULT 0
picked_qty NUMERIC(18,3) NOT NULL DEFAULT 0

version BIGINT NOT NULL DEFAULT 0

created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

第一阶段：

```text
inventory_condition = SELLABLE
```

必须支持未来：

```text
QC_PENDING
DEFECTIVE
REPAIR
SCRAPPED
```

但 Sprint 2 不需要完整退货流程。

---

# 六、Bin 规则

Sprint 1 中 Platform Warehouse 可以没有实际 Bin。

为了让 InventoryBalance 唯一维度稳定：

Sprint 2 必须做一个明确决策。

推荐方案：

> 每个需要存放 InventoryBalance 的 Warehouse 必须存在至少一个 Bin。

对于没有实体库位管理的平台仓/第三方仓：

创建系统虚拟 Bin：

```text
DEFAULT
```

例如：

```text
warehouse = OZON-FBO-01
bin = DEFAULT
```

这样避免：

```text
bin_id NULL
```

导致唯一约束和库存定位语义复杂化。

不得把 `NULL bin` 和实体 Bin 混为一套逻辑。

---

# 七、Balance唯一性

必须数据库保证：

```text
UNIQUE(
  sku_id,
  warehouse_id,
  bin_id,
  inventory_condition
)
```

同一个库存维度只能有一条 Balance。

---

# 八、数量类型

库存数量统一：

```text
NUMERIC(18,3)
```

不得使用：

```text
FLOAT
DOUBLE
```

即使当前3C商品主要按整数件管理。

API和业务计算必须避免浮点误差。

---

# 九、数量约束

数据库至少保证：

```text
on_hand_qty >= 0
reserved_qty >= 0
picked_qty >= 0
```

正常业务不得写负数。

同时 Service 必须保证逻辑关系合法。

---

# 十、Available Calculation

第一阶段 SELLABLE 库存：

```text
Physical Available
=
On Hand
- Reserved
- Picked
```

Channel Sellable：

未来再减：

```text
Safety Stock
```

Sprint 2 可以直接提供：

```text
available_qty
```

作为 Response 中的计算字段。

但数据库不得单独维护一个可修改：

```text
available_qty
```

事实字段。

---

# 十一、Safety Stock

建立：

```text
inventory_safety_stocks
```

维度：

```text
sku_id
warehouse_id
```

字段至少：

```text
id
sku_id
warehouse_id
safety_qty
created_at
updated_at
```

唯一：

```text
UNIQUE(sku_id, warehouse_id)
```

---

# 十二、Safety Stock含义

Safety Stock：

不会改变 On Hand。

不会创建 InventoryTransaction。

它属于：

```text
Inventory Policy
```

不是实体库存动作。

对渠道可售/未来订单锁定是否扣 Safety Stock：

本 Sprint按照 `inventory.md` 当前规则实现。

建议提供：

```text
sellable_available
=
max(
  on_hand
  - reserved
  - picked
  - safety,
  0
)
```

但保留：

```text
physical_available
```

供仓库查询。

---

# 十三、InventoryReservation

建立：

```text
inventory_reservations
```

字段至少：

```text
id UUID

reservation_no VARCHAR(...) UNIQUE

sku_id UUID NOT NULL
warehouse_id UUID NOT NULL
bin_id UUID NOT NULL

reference_type VARCHAR(...) NOT NULL
reference_id UUID NOT NULL

quantity NUMERIC(18,3) NOT NULL

status VARCHAR(...) NOT NULL

idempotency_key VARCHAR(...) NOT NULL UNIQUE

created_at
picked_at
released_at
consumed_at
```

---

# 十四、Reservation暂不强耦合Order表

Sprint 2 尚未正式实现订单模块完整业务。

因此不要为了未来Order创建不完整订单结构。

建议 Reservation 使用：

```text
reference_type
reference_id
```

第一阶段可支持：

```text
TEST
MANUAL
ORDER
```

但业务层应使用 Typed Constant。

Sprint 4 Order 接入以后：

真正传：

```text
ORDER_ITEM
```

作为来源。

---

# 十五、Reservation状态

至少：

```text
ACTIVE
PICKED
RELEASED
CONSUMED
CANCELLED
```

状态迁移必须明确。

不得任意更新字符串。

---

# 十六、InventoryTransaction

建立：

```text
inventory_transactions
```

字段至少：

```text
id UUID

transaction_no VARCHAR(...) UNIQUE

sku_id UUID NOT NULL
warehouse_id UUID NOT NULL
bin_id UUID NOT NULL

transaction_type VARCHAR(...) NOT NULL

quantity_before NUMERIC(18,3) NOT NULL
quantity_change NUMERIC(18,3) NOT NULL
quantity_after NUMERIC(18,3) NOT NULL

reserved_before NUMERIC(18,3) NULL
reserved_change NUMERIC(18,3) NULL
reserved_after NUMERIC(18,3) NULL

picked_before NUMERIC(18,3) NULL
picked_change NUMERIC(18,3) NULL
picked_after NUMERIC(18,3) NULL

reference_type VARCHAR(...) NOT NULL
reference_id UUID NOT NULL

idempotency_key VARCHAR(...) NOT NULL

operator_id UUID NULL

remark TEXT NULL

created_at TIMESTAMPTZ NOT NULL
```

---

# 十七、Transaction 幂等

推荐：

```text
UNIQUE(idempotency_key)
```

如果一个业务动作涉及多个 Balance Row：

允许设计：

```text
inventory_event
+
inventory_transaction lines
```

作为更规范方案。

如果 Agent 认为需要引入 parent `inventory_events`：

可以实现，但必须满足：

- 不增加不必要复杂度；
- 一个业务事件拥有一个 idempotency key；
- 多条 Transaction Line属于同一Event；
- 审计能力更强。

如果不采用 parent event：

需要确保每条流水幂等键不会冲突。

在实现前明确采用哪一种。

---

# 十八、推荐 Event + Lines 模型

由于 Sprint 2 已包含：

```text
moveBin
```

未来还有：

```text
transfer
return
```

推荐考虑：

```text
inventory_events
```

字段：

```text
id
event_no
event_type
reference_type
reference_id
idempotency_key UNIQUE
operator_id
remark
created_at
```

和：

```text
inventory_transactions
```

作为明细行。

一个 Move Bin：

```text
Event
├─ Bin A -1
└─ Bin B +1
```

这样比两条互不关联流水更容易审计。

如果实现该模型：

在最终报告中说明。

---

# 十九、禁止直接修改 Balance

除 Inventory Module 内部：

任何模块禁止直接：

```text
save InventoryBalance
update InventoryBalance
```

Sprint 2 完成后：

Architecture Check 建议增加一条规则：

> 非 Inventory Module 不允许 import InventoryBalance Repository。

---

# 二十、receiveStock / initializeStock

Sprint 2需要提供库存增加能力。

考虑尚未开发 Purchase：

建议区分：

## initializeStock()

用于：

系统第一次上线导入现有真实库存。

## receiveStock()

作为未来正式入库底层能力。

两者都必须：

- 创建/锁定Balance；
- On Hand增加；
- 写Transaction/Event；
- 幂等。

---

# 二十一、initializeStock规则

只用于：

```text
库存初始化
```

必须要求：

- SKU
- Warehouse
- Bin
- Quantity
- Reference
- Remark
- idempotencyKey

必须留下：

```text
INITIAL_STOCK
```

流水。

不能：

直接修改数据库。

---

# 二十二、初始化重复

同一个：

```text
idempotencyKey
```

重复执行：

不得重复加库存。

必须返回第一次结果或明确幂等结果。

---

# 二十三、Reserve Stock

实现核心：

```text
reserveStock()
```

输入至少：

```text
skuId
warehouseId
quantity
referenceType
referenceId
idempotencyKey
```

如果存在多个Bin：

系统需要决定从哪些Bin Reservation。

---

# 二十四、Bin Reservation策略

当前同 SKU 通常只有一个 Bin，

但系统必须允许未来多Bin。

Sprint 2 使用简单稳定策略：

```text
按可用库存
+
bin_code稳定顺序
```

或：

```text
创建时间/优先级稳定顺序
```

分配。

重要的是：

顺序必须 deterministic。

防止并发锁顺序不同造成死锁风险。

如果一个Bin不够：

允许跨多个Bin产生多个Reservation。

---

# 二十五、Reservation跨Bin

例如：

```text
A01 available 3
A02 available 5

订单需要 6
```

允许：

```text
Reservation Line 1
A01 = 3

Reservation Line 2
A02 = 3
```

因此如果当前 Reservation 数据模型：

一条只能一个Bin，

允许同一业务 reference 创建多条 Reservation。

建议建立：

```text
reservation_group / reservation_no
```

或者：

一个Reservation Header + Lines。

---

# 二十六、推荐 Reservation Header + Lines

建议认真考虑：

```text
inventory_reservations
```

作为Header：

```text
id
reservation_no
sku_id
warehouse_id
reference_type
reference_id
requested_qty
status
idempotency_key
...
```

以及：

```text
inventory_reservation_lines
```

字段：

```text
reservation_id
bin_id
quantity
status
```

这样未来多Bin会更稳定。

如果采用：

在最终报告说明。

---

# 二十七、Reserve并发事务

核心流程：

```text
BEGIN

1. 查询候选Balance
2. 按固定顺序 SELECT ... FOR UPDATE
3. 重新计算Available
4. 判断总库存是否足够
5. 不足 → rollback / DomainError
6. 足够 → 创建Reservation
7. reserved_qty += N
8. 写Inventory Event/Transaction
9. COMMIT
```

绝不能：

先普通查询Available，

然后再UPDATE。

---

# 二十八、库存不足

不足时：

抛：

```text
INVENTORY_INSUFFICIENT_STOCK
```

不得：

- 产生部分Reservation；
- 留下半完成Balance；
- 自动负库存。

整个Reservation必须原子失败。

---

# 二十九、Release Reservation

实现：

```text
releaseReservation()
```

仅允许合法状态：

```text
ACTIVE
```

变化：

```text
reserved_qty - N
```

On Hand：

不变。

Reservation：

```text
ACTIVE → RELEASED
```

写库存Event/Transaction。

---

# 三十、重复Release

同一业务 Release Event重复：

必须幂等。

不得：

```text
reserved -N
```

两次。

---

# 三十一、Pick Stock

实现：

```text
pickStock()
```

合法来源：

```text
ACTIVE Reservation
```

变化：

```text
Reserved - N
Picked + N
```

On Hand：

不变。

Reservation状态：

```text
ACTIVE → PICKED
```

---

# 三十二、部分Pick

当前订单仓库流程未来可能需要部分拣货。

Sprint 2需要明确支持性。

推荐：

Reservation Line支持：

```text
reserved_qty
picked_qty
```

或者允许Line逐步状态。

至少数据模型不要把：

```text
PICKED
```

设计成只能一次性全量且未来无法扩展。

但当前 API可以先要求：

整笔Reservation全量Pick。

在最终报告说明该边界。

---

# 三十三、Unpick

实现：

```text
unpickStock()
```

仅用于：

拣货撤销 / 拣错后回到原可占用状态。

变化：

```text
Picked - N
Reserved + N
```

Reservation：

```text
PICKED → ACTIVE
```

注意：

它与：

```text
取消订单回库
```

不是同一个业务动作。

后续 Interception 不一定使用 unpick。

---

# 三十四、Ship Stock

实现：

```text
shipStock()
```

合法状态：

```text
PICKED
```

变化：

```text
Picked - N
On Hand - N
```

Reservation：

```text
PICKED → CONSUMED
```

写：

```text
ORDER_SHIP / SHIP
```

库存流水。

---

# 三十五、Ship安全

不得：

```text
ship quantity > picked quantity
```

不得：

没有 Picked 直接 Ship。

Sprint 2 API层应拒绝非法状态。

---

# 三十六、Move Bin

实现：

```text
moveBin()
```

例如：

```text
A01 → A02
```

要求：

- 同一Warehouse；
- 同一SKU；
- Source有足够未占用可移动库存；
- 不得移动 Reserved / Picked库存作为普通移位；
- Source On Hand -N；
- Target On Hand +N；
- Warehouse总库存不变；
- 写同一个业务Event的两条Transaction。

---

# 三十七、Move Bin目标Balance

目标Balance不存在：

允许创建。

目标Bin必须属于：

同一个Warehouse。

否则拒绝。

跨Warehouse：

不是 Move Bin。

未来属于 Transfer。

---

# 三十八、Manual Adjustment

实现：

```text
adjustStock()
```

输入：

```text
sku
warehouse
bin
quantityDelta
reason
remark
idempotencyKey
```

必须：

- 管理员权限；
- 写 Inventory Transaction；
- 写 Operation Log；
- 调整后 On Hand不得为负。

---

# 三十九、Adjustment禁止事项

普通 Adjustment：

不得直接修改：

```text
reserved_qty
picked_qty
```

如果 Reserved / Picked有问题：

必须修复对应业务记录。

禁止：

“为了把库存对上”

直接：

```text
reserved = 0
```

---

# 四十、Safety Stock API

至少：

```text
GET
/api/v1/inventory/safety-stocks

PUT
/api/v1/inventory/safety-stocks/:skuId/:warehouseId
```

或者合理等价REST设计。

允许：

设置/更新：

```text
safety_qty
```

不产生 InventoryTransaction。

应写 Operation Log。

---

# 四十一、Inventory Query API

至少提供：

```text
GET /api/v1/inventory
```

支持筛选：

```text
keyword
skuId
warehouseId
binId
condition
status
page
pageSize
```

返回至少：

```text
SKU
SKU Name
Warehouse
Bin
Condition
On Hand
Reserved
Picked
Physical Available
Safety Stock
Sellable Available
```

---

# 四十二、SKU库存详情

提供：

```text
GET /api/v1/inventory/skus/:skuId
```

或等价API。

展示：

```text
SKU Total
↓
Warehouse
↓
Bin
```

以及：

```text
On Hand
Reserved
Picked
Available
Safety
```

---

# 四十三、InventoryTransaction API

提供：

```text
GET /api/v1/inventory/transactions
```

筛选：

```text
skuId
warehouseId
binId
transactionType
referenceType
referenceId
createdFrom
createdTo
```

列表必须可用于实际审计。

---

# 四十四、Reservation API

至少：

```text
POST /api/v1/inventory/reservations

GET /api/v1/inventory/reservations

GET /api/v1/inventory/reservations/:id

POST /api/v1/inventory/reservations/:id/release

POST /api/v1/inventory/reservations/:id/pick

POST /api/v1/inventory/reservations/:id/unpick

POST /api/v1/inventory/reservations/:id/ship
```

如果 API 结构有更合理设计：

可以调整。

但业务能力必须存在。

---

# 四十五、初始化库存 API

开发/管理员使用：

```text
POST /api/v1/inventory/initialize
```

只允许管理员。

不得在生产日常业务中滥用。

可以在UI明确标记：

```text
库存初始化
```

而不是：

```text
入库
```

---

# 四十六、初始化库存 Import

Sprint 1 已有 Import Center。

Sprint 2必须新增固定模板：

```text
INITIAL_INVENTORY
```

至少字段：

```text
sku_code
warehouse_code
bin_code
quantity
remark
```

要求：

- SKU必须存在；
- Warehouse必须存在；
- Bin必须存在且属于Warehouse；
- quantity > 0；
- 重复唯一导入行必须有可解释策略；
- 通过正式InventoryService执行；
- 禁止Import Handler直接写Balance。

---

# 四十七、Import幂等

建议每个导入Job + Row生成稳定：

```text
idempotencyKey
```

例如：

```text
INITIAL_INVENTORY:<importJobId>:<rowNumber>
```

Worker重复执行：

不得重复增加库存。

---

# 四十八、Operation Log

至少以下动作写Operation Log：

```text
INITIAL_STOCK
MANUAL_ADJUSTMENT
SAFETY_STOCK_UPDATE
```

Reservation等系统业务动作：

主要依靠 InventoryTransaction审计，

不要求重复产生Operation Log，除非是人工操作入口。

---

# 四十九、Architecture Check升级

Sprint 2完成前：

增强：

```text
scripts/check-architecture.ts
```

至少增加：

> 非 Inventory Module 不得 import Inventory Repository / InventoryBalance Entity 用于写业务。

不要只靠 AGENTS.md。

---

# 五十、Frontend

Sprint 2增加：

```text
库存
├─ 库存查询
├─ 库存流水
├─ Reservation
└─ 库存初始化/调整
```

---

# 五十一、库存查询页面

路径建议：

```text
/inventory
```

表格至少：

```text
图片
SKU
名称
Warehouse
Bin
On Hand
Reserved
Picked
Safety
Available
状态
```

支持：

- SKU搜索
- Warehouse筛选
- Bin筛选

---

# 五十二、库存详情

点击SKU：

Drawer或详情页：

```text
汇总
仓库明细
库位明细
Reservation
库存流水
```

---

# 五十三、库存流水页面

```text
/inventory/transactions
```

至少展示：

```text
Time
Type
SKU
Warehouse
Bin
Before
Change
After
Reference
Operator
```

---

# 五十四、Reservation页面

```text
/inventory/reservations
```

用于调试和后续订单追踪。

显示：

```text
Reservation No
Reference
SKU
Warehouse
Quantity
Status
Created
```

---

# 五十五、库存初始化UI

管理员选择：

```text
SKU
Warehouse
Bin
Quantity
Remark
```

提交：

必须经过正式API。

不能前端直接写Balance。

---

# 五十六、Manual Adjustment UI

管理员可以：

```text
+N
-N
```

必须填写：

```text
Reason
Remark
```

危险操作：

要求明确二次确认。

---

# 五十七、Safety Stock UI

库存页面允许：

编辑：

```text
SKU + Warehouse Safety Stock
```

显示调整前后。

---

# 五十八、金额/数量序列化

库存数量使用NUMERIC。

注意：

TypeORM PostgreSQL numeric默认可能返回string。

必须建立统一Decimal/Quantity转换策略。

禁止：

在不同Service各自随意：

```text
Number(value)
```

然后形成浮点行为差异。

请在 Sprint 2 明确一个项目级 Quantity 策略。

如果引入 decimal library：

属于新增依赖，

需先说明必要性。

---

# 五十九、必须测试：并发最后一件

这是 Sprint 2 第一优先Integration Test。

初始：

```text
On Hand = 1
Reserved = 0
Picked = 0
```

同时发起：

```text
Reserve A = 1
Reserve B = 1
```

结果必须：

```text
一个成功
一个 INVENTORY_INSUFFICIENT_STOCK
```

最终：

```text
Reserved = 1
```

绝不能：

```text
Reserved = 2
```

---

# 六十、必须测试：100并发

建议进一步测试：

```text
On Hand = 50
```

同时：

```text
100个 reserve(1)
```

最终：

```text
成功 = 50
失败 = 50
Reserved = 50
```

用于验证锁逻辑。

---

# 六十一、必须测试：幂等 Reserve

同一个：

```text
idempotencyKey
```

同时或重复请求10次：

最终只能：

```text
Reserved + N
```

一次。

---

# 六十二、必须测试：Release

流程：

```text
On Hand 10
Reserve 3
Release
```

最终：

```text
On Hand = 10
Reserved = 0
Picked = 0
```

流水完整。

---

# 六十三、必须测试：Pick

```text
On Hand 10
Reserve 3
Pick
```

最终：

```text
On Hand = 10
Reserved = 0
Picked = 3
```

---

# 六十四、必须测试：Ship

继续：

```text
Ship 3
```

最终：

```text
On Hand = 7
Reserved = 0
Picked = 0
```

---

# 六十五、必须测试：Unpick

```text
Reserve 3
Pick 3
Unpick 3
```

最终：

```text
On Hand = 原值
Reserved = 3
Picked = 0
```

---

# 六十六、必须测试：Move Bin

初始：

```text
A01 = 10
A02 = 0
```

Move：

```text
4
```

最终：

```text
A01 = 6
A02 = 4
Warehouse Total = 10
```

同一InventoryEvent能够追踪两条变化。

---

# 六十七、必须测试：Move Reserved Stock

例如：

```text
A01
On Hand = 10
Reserved = 8
```

普通Move：

```text
5
```

必须判断可移动库存。

如果仅剩：

```text
2
```

未占用：

Move 5应失败。

---

# 六十八、必须测试：Adjustment负数

```text
On Hand = 2
Adjust = -3
```

必须：

失败。

库存仍为：

```text
2
```

不得产生流水。

---

# 六十九、必须测试：事务Rollback

人为模拟：

```text
Balance已经修改
↓
Transaction写入失败
```

整个操作必须Rollback。

Balance保持原值。

---

# 七十、必须测试：NO_INVENTORY_RECORD

查询一个从未初始化的：

```text
SKU + Warehouse
```

必须能够区分：

```text
NO_RECORD
```

与：

```text
Balance存在且OnHand=0
```

不得在数据层静默创建0 Balance作为查询副作用。

---

# 七十一、必须测试：Safety Stock

```text
On Hand 10
Reserved 2
Picked 1
Safety 3
```

应：

```text
Physical Available = 7
Sellable Available = 4
```

---

# 七十二、必须测试：多个Bin Reservation

例如：

```text
A01 available 2
A02 available 4
```

Reserve：

```text
5
```

成功。

Reservation Lines：

```text
A01 = 2
A02 = 3
```

并保证：

锁顺序稳定。

---

# 七十三、必须测试：死锁风险

多Bin锁定时：

所有库存行必须按统一稳定顺序加锁。

例如：

```text
warehouse_id
bin_id
```

或主键。

测试/代码审查确认：

不会一处A→B，一处B→A。

---

# 七十四、性能目标

当前业务量不大。

优先：

正确性。

但测试至少：

```text
5000 InventoryBalance
```

库存列表分页查询：

合理开发机目标：

```text
<500ms
```

常用查询不得明显N+1。

---

# 七十五、索引

至少评估：

```text
(sku_id, warehouse_id, bin_id, inventory_condition)

(warehouse_id, sku_id)

(sku_id)

reservation status
reservation reference

transaction sku_id + created_at
transaction warehouse_id + created_at
transaction reference_type + reference_id
```

以真实查询为准。

不要无脑添加大量索引。

---

# 七十六、Migration

建议拆分：

```text
create_inventory_balances
create_inventory_safety_stocks
create_inventory_reservations
create_inventory_reservation_lines（如采用）
create_inventory_events（如采用）
create_inventory_transactions
add_inventory_indexes
```

不要一个巨大Migration。

---

# 七十七、禁止硬Delete流水

以下原则：

```text
InventoryTransaction
InventoryEvent
```

不提供普通DELETE API。

属于审计数据。

---

# 七十八、Balance为0

当Balance：

```text
OnHand=0
Reserved=0
Picked=0
```

Sprint 2建议：

保留Balance行。

不要为了“清理数据库”立即删除。

这样：

```text
曾经有记录的0库存
```

和：

```text
从未初始化
```

仍然可以区分。

---

# 七十九、测试数据库

库存Integration Test：

必须使用真实PostgreSQL。

禁止：

只Mock Repository。

并发测试必须真正在数据库事务层验证。

---

# 八十、Web测试

至少验证：

- 库存列表；
- 库存初始化；
- Safety编辑；
- Manual Adjustment；
- Reservation状态变化；
- Transaction流水展示。

浏览器自动化可用现有方案。

---

# 八十一、OpenAPI

新增API必须：

```text
Swagger
OpenAPI export
api-client regenerate
```

完成。

前端使用：

```text
@wcies/api-client
```

不得自行维护重复接口类型。

---

# 八十二、禁止引入平台词汇

Sprint 2完成后搜索：

```text
OZON
WB
YANDEX
RFBS
FBO
FBW
FBY
```

Inventory Core Service中不应出现平台业务判断。

如果出现：

必须说明原因。

正常情况下应为0。

---

# 八十三、禁止提前实现Allocator

虽然 Safety Stock 已加入，

Sprint 2暂不实现：

```text
Store Channel Inventory Rule
push inventory
RATIO
FIXED
MAX_LIMIT
```

Allocator属于之后平台库存同步阶段。

---

# 八十四、禁止提前实现Order

Reservation使用通用Reference即可。

不得为了测试Reserve：

提前搭一个半成品Order模块。

---

# 八十五、Sprint 2真实验收数据

使用 Sprint 1 Seed 中：

```text
VK87 等SKU
深圳仓
实际Bin
```

创建开发库存：

例如：

```text
VK87-BLK

深圳仓
A01

On Hand = 10
Safety = 2
```

执行：

```text
Reserve 3
Pick 3
Ship 3
```

最终：

```text
On Hand = 7
Reserved = 0
Picked = 0
Sellable = 5
```

流水必须完整。

---

# 八十六、第二验收场景

同SKU：

```text
A01 = 3
A02 = 5
```

Reserve：

```text
6
```

验证：

多Bin Reservation。

---

# 八十七、第三验收场景

库存：

```text
1
```

并发2请求。

验证：

只成功1个。

---

# 八十八、第四验收场景

重复：

```text
idempotencyKey
```

执行Reserve。

验证：

只有一次库存变化。

---

# 八十九、第五验收场景

首次：

没有Balance。

API必须显示：

无库存记录。

然后initialize：

```text
0
```

如系统允许0初始化，

或经过一次库存归零：

应能够区别：

“已有Balance且0”

和：

“没有Balance”。

---

# 九十、开发提交建议

建议按切片：

```text
feat(inventory): add balance and safety stock model

feat(inventory): add inventory event and transaction ledger

feat(inventory): implement stock initialization and adjustment

feat(inventory): implement reservation engine with row locks

feat(inventory): implement pick/unpick/ship lifecycle

feat(inventory): implement bin movement

feat(import): add initial inventory import

feat(web): add inventory management UI

test(inventory): add concurrency and idempotency coverage
```

不要求固定commit数量。

---

# 九十一、每个切片验证

至少：

```text
pnpm lint
pnpm typecheck
pnpm check:arch
相关unit/integration
```

并发核心：

必须尽早写测试，

不要最后才补。

---

# 九十二、Sprint最终验证

完成后必须：

```text
pnpm lint
pnpm typecheck
pnpm check:arch
pnpm test
pnpm test:integration
pnpm build
```

如果有E2E：

同时执行。

---

# 九十三、空库Migration验证

使用：

全新数据库。

执行：

```text
all migrations
seed
inventory acceptance setup
```

全部成功。

---

# 九十四、AGENTS检查

Sprint 2结束时：

检查：

```text
AGENTS.md
docs/business-rules/inventory.md
```

如果实现引入了经过确认的新业务规则：

同步更新文档。

禁止：

代码和 inventory.md 不一致。

---

# 九十五、最终报告格式

## 1. 完成内容

按实际功能报告。

## 2. Inventory Data Model

明确列出：

- Balance
- Safety
- Reservation
- Reservation Lines（如有）
- Event（如有）
- Transaction

并解释最终模型。

## 3. Inventory Formula

明确：

```text
Physical Available
Sellable Available
```

实际公式。

## 4. Concurrency

明确说明：

- 使用什么锁；
- 如何排序锁；
- 如何避免超卖；
- 并发测试结果。

## 5. Idempotency

说明：

- 幂等键落在哪里；
- 重复调用行为；
- 并发重复行为。

## 6. API

列出新增Endpoint。

## 7. Frontend

列出页面。

## 8. Tests

分别报告：

```text
unit
integration
concurrency
e2e
```

## 9. Acceptance Cases

明确报告：

- last-item concurrency
- 100 concurrency
- duplicate idempotency
- reserve/release
- pick/unpick/ship
- move bin
- adjustment rollback
- no-record vs zero
- multi-bin reservation

## 10. Migration

列出Migration和空库验证。

## 11. Architecture Check

说明增加了哪些库存边界规则。

## 12. 新增决策

只报告真正新增决策。

## 13. 未完成项

明确列出。

## 14. 风险

重点：

- 并发
- NUMERIC
- 多Bin
- 幂等
- 数据迁移

## 15. Git

列主要Commit Hash。

## 16. 下一步

Sprint 2完成后：

**停止。**

不得自行开始下一 Sprint。

---

# 九十六、Sprint 2完成定义

只有同时满足：

```text
InventoryBalance可靠
SafetyStock可靠
Reservation可靠
InventoryTransaction可审计

Initialize工作
Reserve工作
Release工作
Pick工作
Unpick工作
Ship工作
MoveBin工作
Adjustment工作

NO_RECORD与ZERO可区分

多Bin Reservation工作
FOR UPDATE并发安全
幂等工作
负库存被阻止
Rollback正确

Inventory UI可使用
Initial Inventory Import工作

并发测试通过
Integration Test通过
Migration空库通过

lint通过
typecheck通过
check:arch通过
tests通过
build通过
```

才可以将：

**WCIES Sprint 2 — Inventory Core**

标记为完成。