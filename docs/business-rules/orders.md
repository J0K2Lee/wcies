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
   > **2026-09-18 补充（`orders.platform_tracking_no`，不是被禁的 `orders.tracking_number`）**：
   > 发货流程需要展示平台自己分配的运单号（OZON `tracking_number`）。它是**平台事实**，
   > 与 `platform_status` / `platform_stage` 同类：只读展示、出库时自动填入
   > `shipments.tracking_number`（实现 orders.md §15A「未来由平台 Adapter 自动填入」的承诺）。
   > 内部物流载体**仍然只有** Shipment / Package——本列不承担数量、包裹、行归属任何语义。
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
6. 仓库选择：Sprint 3 使用该店铺 `warehouse_platform_bindings`（仓库绑定平台仓库，2026-09-17 取代店仓绑定，master-data.md §7）中 ACTIVE 绑定里 `priority` 最小的仓库；同优先级时非 FBO 模式优先（FBO 平台仓库存由平台管理）；多仓决策属于未来 Shipment/Allocator 阶段。
7. **外部履约不占库存**（用户指示 2026-09-17）：订单履约模式为 FBO/FBP（含短码及 WB_FBW/YANDEX_FBY，判定 `isExternalFulfillmentMode`）时，订单行映射成功后直接置 `EXTERNAL_FULFILLED`——不解析内部仓库、不创建 Reservation、不进入拣货流程；发货时限异常不评估。业务状态随平台事件自动流转（见 §7a.3）。

---

# 5. 缺货行为与 Backorder

库存不足（Inventory Core 返回 `INVENTORY_INSUFFICIENT_STOCK`）时：

1. 订单与订单行必须保存，不得回滚消失。
2. 该订单行 `fulfillment_status = BACKORDERED`。
3. 创建 `ORDER_OUT_OF_STOCK` 异常。
4. 禁止创建负库存；禁止自动取消平台订单。
5. 其他库存充足的行正常 RESERVED，其 Reservation 保留。

## 缺货口径（2026-09-17 修复）

「缺货」的行级事实口径 = `mapping_status = 'MAPPED'` 且
`fulfillment_status IN ('BACKORDERED','PENDING')`——与订单 rollup
「PENDING 视为缺货」一致。缺货筛选（goodsState=BACKORDERED）、自动重新
分配、待采购管线均按此口径。摄入时「无法分配仓库」的已映射行直接置
BACKORDERED（不再停留 PENDING）；历史卡行由 Migration 20260917_007 归位。

## 平台已事实发货时缺货不成立（用户指示 2026-10-14）

平台阶段 `IN_TRANSIT / DELIVERED`（OZON `delivering` / `delivered`）
即货物已发走：此时缺货与现实矛盾，**缺货不得阻塞订单**——缺货行转
`EXTERNAL_FULFILLED`、OPEN `ORDER_OUT_OF_STOCK` 关闭；除未映射异常
（`ORDER_SKU_MAPPING_FAILED`）外不阻塞，无未映射行且内部履约不在进行
中时订单转 `SHIPPED`。完整规则见 §7a.0（`OrderPlatformShippedService`，
同步/摄入/映射修复三路径共用）。连带约束：

- 库存到货触发自动重分配时**跳过**平台已事实发货的订单（占库存会被
  现实否证——RESERVED 会随已发货订单把库存锁死）；
- 人工「重新分配」对平台已事实发货的订单直接 409 说明，不再占库存。

## 自动重新分配（用户指示 2026-09-17；排序 2026-10-16 修订）

任何入库类库存流水（`INITIAL_STOCK / RECEIVE / TRANSFER_IN`，2026-10-15 起含
`MOVE_BIN`——移位上架是「货已就位」心智时点）产生后，
`OrderAutoReallocationService`（经 `InventoryStockListenerRegistry` 进程内
注册，无模块环）自动对该 SKU「已映射但未持有库存」的行重试预留：

1. 复用 `allocateMappedItem`（幂等键 `ORDER_RESERVE:<orderItemId>`，并发安全）。
2. 成功：行转 RESERVED、关闭该行 OPEN `ORDER_OUT_OF_STOCK` 异常、重算 rollup。
3. 失败（仍不足）：保持缺货，不重复刷异常。
4. 失败自吞：重分配失败不得影响库存主流程（AGENTS.md §10）。
5. 人工重试（单行）继续走 `POST /orders/items/:itemId/retry-allocation`。
   列表级的「已到货 → 重新分配」批量入口随「已到货」状态一起移除（决策 0023）。
6. **事件必须在库存事务提交之后广播**（2026-10-17 修复）：监听器用独立连接读
   余额，事务内广播时**本次新建**的余额行对它不可见，会被误判为库存不足——
   表现为「收货后没有自动分配、手动重试才成功」（真实样本 ORD00000219 /
   SKU000012012：首次入库到某库位时余额行由该事务 INSERT）。因此 `addStock`
   在 commit 后广播；`receiveStockInTx` / `transferInInTx` 由调用方（收货确认 /
   退货入库 / 调拨确认）在各自事务提交后逐条广播。

**候选范围与排序（2026-10-16 决策 0022）**：候选来自
`findUnallocatedItemIdsBySku(skuId, warehouseId)`，只含**事件仓库被该订单店铺
ACTIVE 绑定**的行（半连接，一个仓的到货只满足它服务的店铺的订单）；按
**加急 > 平台优先级 > 发货时限 > 行入库时间**排序：

```sql
ORDER BY o.is_urgent DESC, p.priority ASC,
         o.shipment_deadline ASC NULLS LAST, i.created_at ASC
```

要点：`order_items.warehouse_id` 在缺货行上恒为 NULL（建单不写、只有占用成功
才写），故仓库过滤必须用「店铺绑定」半连接，不能用行上的仓库列。分配目标仓仍
是店铺默认仓（`resolveDefaultWarehouseId`），过滤只收窄候选、不改变目标仓。

## 加急订单（用户指示 2026-10-16，决策 0022）

加急是订单的**业务标注**（`orders.is_urgent` + `urgent_marked_at`），**不是 ERP
状态**（AGENTS.md §38）——不进 `erp_status`、不写状态历史、不产生库存流水。

- **优先展示**：订单列表**恒定置顶**（`orderSortOf()` 首级键恒为 `is_urgent
  DESC`，无论用户选哪种排序），加急组内再按用户所选键排。
- **优先分配**：缺货到货后的自动重分配把加急行排到候选最前（见上节排序），
  但**不抢占**已 RESERVED 给其他订单的库存（只影响新分配排序）。
- **入口**：订单列表「订单号」列的旗标，单击切换——**红=加急、黑白=普通**。
- **终态限制**：`SHIPPED` / `CANCELLED` 订单不可加急（`ORDER_INVALID_STATE`）；
  幂等：已在目标状态时 no-op。
- API：`POST /api/v1/orders/:id/urgent`，body `{ "urgent": true|false }`。

平台分配优先级（用户可设，数值小=优先）存于 `platforms.priority`，管理端在
系统管理页编辑，API：`PATCH /api/v1/platforms/:id/priority`（管理员）。


## Backorder 重试

`retryBackorder(orderItemId)`（API：`POST /orders/items/:itemId/retry-allocation`）：

三种情况，按行当前的 `mappingStatus` / 分配状态分流。

### A. 已映射行（`MAPPED` + `BACKORDERED / PENDING`）

```text
BACKORDERED / PENDING
↓
重新尝试 reserveStock（同一幂等键 ORDER_RESERVE:<orderItemId>）
↓
成功 → RESERVED，解决（RESOLVED）对应 OPEN 异常，订单状态重算
失败 → 行转 BACKORDERED（原 BACKORDERED 保持），创建或保留
       ORDER_OUT_OF_STOCK（createInTx 幂等，不产生重复异常），
       订单汇总状态重算
```

要点：**PENDING 行（映射修复后从未分配成功）分配失败同样必须落到
BACKORDERED**——静默停在 PENDING 会让操作员看不到任何待办（与 §5.B.2
同一原则）。**平台已事实发货（stage IN_TRANSIT / DELIVERED）的订单除外**
（用户指示 2026-10-14）：直接 409 说明「平台已事实发货，缺货状态将按平台
事实自动收敛，无需重新分配」——占库存会被现实否证，收敛见 §7a.0。

### A2. 已映射行 + 其他状态（`RELEASED` / `SHIPPED` / `RESERVED` 等）

直接 409 `ORDER_INVALID_STATE`：该行既不缺库存、也没有映射问题可修
（`RESERVED` 已占用、`SHIPPED` 已出库、`RELEASED` 不持有内部库存）。

### B. 映射失败行（`FAILED`）— 决策 0012；2026-10-14 调整：**先修映射，再决定是否分配**

```text
FAILED
↓
按摄入时相同的 store-scoped 规则【重新解析】该行
   （不信任行上存储的 mappingStatus / skuId：人工可能已修好映射）
↓
解析失败 → 保持 FAILED，接口回报解析错误码，异常保持 OPEN（外层 409）
解析成功 → 行提升为 MAPPED + 写入 skuId
         → 关闭 ORDER_SKU_MAPPING_FAILED 异常
         → 平台已事实发货（stage IN_TRANSIT / DELIVERED）？**不占库存**
             （货物已发走，分配会被现实否证）：走 §7a.0 收敛——行转
             EXTERNAL_FULFILLED、关缺货异常，无其他未映射行时订单转
             SHIPPED，否则保持由未映射异常阻塞
         → 分配状态可分配（BACKORDERED / PENDING）？走 A 的库存分配
             成功 → RESERVED
             失败 → BACKORDERED + ORDER_OUT_OF_STOCK 异常
           不可分配（RELEASED 等）→ **只修映射、不占库存**：行保持原状态，
             仅重算订单汇总状态；响应 mappingRepaired=true 供前端提示
```

**为何修映射不设状态门槛（2026-10-14 修正）**：此前「先判 `BACKORDERED`/
`PENDING`、再修映射」的顺序，让 `RELEASED` 类行（典型来源：运营对含映射失败
行的订单执行「标记外部履约」，行转 RELEASED 而映射保持 FAILED）永远修不上映射
——订单页「快速建档后自动重试映射」对该类行表现为失效：映射补不上、映射异常常
开、订单卡在 EXCEPTION。修复方式是把映射修复提到状态守卫之前，并让「是否占库存」
单独判定；**未补齐映射时仍然 409**，行为不放松。

要点：

1. `FAILED` **不是终点**。人工在 SKU 映射中补齐平台变体映射后，必须能通过重试让订单继续。
2. 修复后仍缺货时**必须落到 BACKORDERED**。`allocateMappedItem` 在库存不足时只返回 `reserved:false` 而不改行状态——对已是 BACKORDERED 的行没问题，但刚修复的 FAILED 行是 PENDING，若不一并写 BACKORDERED 就会静默停在 PENDING 且无库存异常，操作员看不到任何待办。
3. 重试成功（`reserved:true` 或转 BACKORDERED）后订单汇总状态重算，以便离开 EXCEPTION。
4. 映射修复成功但**分配阶段抛错**（如店铺暂无可用库存绑定仓库）时：行保持
   MAPPED，映射异常已关闭，订单汇总状态**同样重算**（分配错误照常返回调用方）
   ——修复映射的事实必须反映到订单状态，操作员可随时再次「重新尝试分配」。

### B2. 映射修复后的批量收敛（2026-10-20）

映射已经建好、订单行却仍停在 FAILED + `ORDER_SKU_MAPPING_FAILED`，需要人工
逐单「重试映射」——根因是收敛只挂在部分映射写入路径上。契约是：**任何让
「store + 平台变体」从不可解析变为可解析的写操作，都必须收敛该变体下已摄入
的 FAILED 行**（`ListingService.retryOrderLinesAfterMappingRepair` →
`OrderIngestionService.retryFailedMappingForVariant`，幂等，跳过 CANCELLED 订单，
只对 BACKORDERED / PENDING 行分配库存）：

1. 绑定已同步的 UNMAPPED 变体（`mapUnmappedSku`）——原有路径。
2. 变体映射写入（含 Excel 导入的新建与绑定分支、手工
   `POST /listings/:id/skus`）——2026-10-20 补齐。此前只有路径 1 收敛，
   走接口/导入建好的映射不触发批量修复。
3. 链接从 INACTIVE 重新启用为 ACTIVE——解析要求 `listing.status='ACTIVE'`
   且 `pls.status='ACTIVE'`，重新启用同样让历史行可解析，必须收敛。
4. 兜底：每次店铺订单同步额外跑一次有界扫描（每店每轮 40 条最老 FAILED 行，
   截止已 `SHIPPED` 的行，跳过 CANCELLED 订单），覆盖历史遗留与上述路径之外的
   写入方式。同一轮还会：
   - 关闭已释放行（`RELEASED` / `EXTERNAL_FULFILLED`）上仍 OPEN 的行级
     `ORDER_OUT_OF_STOCK` / `ORDER_SKU_MAPPING_FAILED` 异常——释放后没有可执行
     的待办；
   - 对被旧规则误判为 `EXCEPTION` 的订单重算 rollup，恢复到真实状态
     （见汇总规则第 2 条），不必等 24h 平台事实刷新窗口。
   失败只记 warn，绝不影响同步任务结果（§36）。

订单进入终态（取消 / 标记外部履约）时，行级 `ORDER_OUT_OF_STOCK` 与
`ORDER_SKU_MAPPING_FAILED` 异常一并关闭——已释放的订单行不再有可执行的待办。

### B3. 本地链接镜像缺失时的按需补链接（2026-10-20）

映射弹窗（快速建档 / SKU映射）只查**本地**未映射变体。平台侧新上架、而
listing sync 尚未 walk 到的商品会让两个按钮都无路可走（真实样本
ORD00000410：ON-002 的 listing sync 自 2026-10-05 起未再运行）。

`POST /listings/ensure-variant`（`ListingVariantBackfillService`）按用户决策
分两级：

1. **`source=PLATFORM`（主路径，C）**：用订单行自带的 `platformSkuId`
   （没有时退 `offerId`）对平台做**一次**定向读取，把平台事实落成 UNMAPPED
   变体并返回 listingId。本地已有变体时零平台调用；查不到的标识做 10 分钟
   负缓存；平台接口失败**不**缓存（下次点击会重试）。已实现平台：OZON
   `/v3/product/info/list`（sku / offer_id 入参均已验证）；适配器未实现
   `fetchListingVariant` 的平台返回 `UNSUPPORTED`。
2. **`source=ORDER_FACTS`（兜底，B）**：平台不支持 / 读取失败 / 查不到时，
   运营确认后用订单事实（`platformProductId` + `platformSkuId`/`sellerSku`）
   在本地补建链接与 UNMAPPED 变体，零平台调用；`raw_data.source =
   'ORDER_FACTS'` 便于追溯，后续 listing sync 按平台事实校正。

两条路径都**只补链接/变体，绝不替人决定内部 SKU**（决策 0016 / §54）。
兜底的已知边界：OZON 订单行只带 sku（catalog product_id 未知），补建的链接
以订单的 `platformProductId` 为键，与后续全量 listing sync 建立的正式链接
可能是两条记录——优先用平台定向读取，兜底只用于解除卡死。

批量补镜像仍可通过店铺设置 `listingSyncEnabled` +
`LISTING_SYNC_INTERVAL_SECONDS` 开启（默认关闭，Sprint 9 决策 2），三者不冲突。

---

# 6. OrderItem 库存履约状态

```text
PENDING             已保存，尚未尝试分配
RESERVED            已创建 InventoryReservation
BACKORDERED         映射成功但库存不足
PICKED              已完成拣货（pickedQty == requiredQty）
SHIPPED             已随 Shipment 正式出库（Sprint 4；该行全部数量已离开库存）
RELEASED            订单取消后的取消终态
EXTERNAL_FULFILLED  外部履约（2026-09-17）：FBO/FBP 等平台仓库持货发货的行，
                    不占内部库存、不拣货；业务状态随平台事件流转（§7a.3）
```

严格区分 Order ERP 状态与 OrderItem 履约状态；行状态是库存事实，订单状态是业务汇总。

## Mapping Status（与履约状态正交）

```text
PENDING   未解析
MAPPED    已解析到 Internal SKU
FAILED    无法解析（skuId = NULL，禁止猜测 SKU）
```

映射失败行创建 `ORDER_SKU_MAPPING_FAILED` 异常，不阻塞其他行继续 Reservation。

未映射行可展示同步时保存的公开平台直链图（`platform_image_url`）；映射后以内部 SKU 主图为准，即使内部无图也不回退平台图。响应 `imageSource` 为 `INTERNAL` / `PLATFORM` / null（无图）。图片富化失败或平台无图只记 warn，不改变摄入结果、库存、映射或订单状态（T5，2026-09-17）。

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

EXTERNAL_FULFILLED 行不属于内部可履约行（与 RELEASED 同样被 rollup 排除）：
全部行 EXTERNAL_FULFILLED 的订单保持当前状态，等平台事件推进（下条）。

任一订单行履约状态变化后，按以下优先级重算订单状态：

1. `CANCELLED` 为终态，取消后不再重算。
2. 无任何可履约行时：
   - 存在**仍待内部履约**的 mapping FAILED 行（`fulfillment_status` 不是
     `RELEASED` / `EXTERNAL_FULFILLED`）→ `EXCEPTION`。
   - 无此类 FAILED 行时：当前态为 `EXCEPTION` 的**恢复到历史中最近一次非
     `EXCEPTION` 的状态**（其成立前提「存在待履约的 FAILED 行」已消失，不得
     保留陈旧异常），其余当前态保持不变（已 SHIPPED 保持 SHIPPED、外部履约单
     停在 NEW 等平台事件——列表侧这类单归入「外部履约」阶段，不再混入「待处理」）。
     典型：从未发过货的 FBP 单修好映射 → 历史上一态是 `NEW`，回 `NEW`；被平台
     事实置 `SHIPPED` 后又误判回异常的单 → 回 `SHIPPED`，不会掉进「待处理」
     （2026-10-20 补充；此前一律回落 `NEW`）。
   - 2026-10-16 修复：陈旧的 EXCEPTION 此前被无条件 `return current` 保留，导致
     FBP 订单补齐映射后永久卡异常（真实样本 ORD00000207）。
   - 2026-10-20 修复：**已被释放的 FAILED 行不再阻塞**。此前只要存在 FAILED 行
     就判 `EXCEPTION`，而「标记外部履约」会把行置 `RELEASED` 却保留 FAILED 映射；
     于是已按平台事实 `SHIPPED` 的订单在下一次 rollup 被翻回 `EXCEPTION`（状态
     倒退），必须人工修完映射才回到 `SHIPPED`（真实样本 ORD00000065：待处理 →
     异常 → 已发货 → 异常 → 已发货）。行已释放即该行不再需要内部履约，未映射
     不再可执行，不得用它判异常。**未释放的 FAILED 行仍然阻塞**，映射异常不会
     被静默忽略。
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

摄入成功后订单直接进入按行结果汇总出的状态（NEW 仅作为创建历史记录的起点，历史链：）。

**平台已事实发货时按平台事实收敛**（用户指示 2026-10-14）：摄入时
`platform_stage` 已是 `IN_TRANSIT` / `DELIVERED`（OZON `delivering` /
`delivered`）的订单，行不预留、不拣货、不产生缺货异常（直接
`EXTERNAL_FULFILLED`），摄入完成即按 §7a.0 收敛——无未映射行时转
`SHIPPED`，有未映射行时保持由未映射异常阻塞；不评估发货时限。

## 平台同步摄入（Sprint 5）

订单除人工/测试 API 摄入外，新增两条同步链路，均**复用** `OrderIngestionService`（不重写 SKU 映射/预约/Backorder/异常逻辑）：

1. **Polling**：SyncModule 按店铺游标窗口拉取平台订单（OZON `/v3/posting/fbs/list`），`orders.sync_source = 'POLLING'`。
2. **Webhook**：平台推送提示事件（OZON `TYPE_NEW_POSTING` /
   `TYPE_STATE_CHANGED` / `TYPE_POSTING_CANCELLED`，双轴 T2 起）→ Worker 用
   已认证 API 按单号回读原文后摄入/更新事实，`orders.sync_source = 'WEBHOOK'`。
   Webhook 与 Polling 可并发竞争同一订单；`UNIQUE(store_id, platform_order_id)`
   + 摄入幂等保证最终仅一张订单、一组 Reservation。状态/取消事件回读遇到
   未知单同样完整建单（webhook 是补漏通道，与 NEW_POSTING 同语义）；
   payload 中的 push 状态词表（`new_state`）不写入 `platform_status`，
   只以回读的 Seller API 原文为准（ozon.md §6.2）。

规则：

- 平台订单业务键仍是 `store_id + platform_order_id`（OZON 取 `posting_number`，履约单位而非 order_id）。
- 行级业务失败（映射失败/缺货）不影响同步任务判定：平台**事实**已成功摄入，同步任务记 SUCCESS，游标推进。
- 传输/解析/系统级失败：同步任务 FAILED，游标不动，重试安全（见 docs/integrations/ozon.md）。
- 平台状态（platform_status）仅作事实存储，不驱动 ERP 状态机（§1 规则不变）。

## 已摄入订单的平台状态更新（Sprint 9 T1）

ORDER_SYNC 再遇到已存在的订单（窗口重叠再投递，或定向回读刷新）时，
从「跳过」改为「对比更新」：

0. **平台已事实发货的收敛**（用户指示 2026-10-14）：归一化平台阶段为
   `IN_TRANSIT / DELIVERED`（OZON `delivering` / `delivered`）即货物在
   平台侧已经发走——与履约模式无关（外部履约同样适用，2026-09-17 起）。
   此时内部「预发货」状态与现实矛盾，统一由 `OrderPlatformShippedService`
   收敛（同步遭遇、摄入、映射修复三条路径共用，幂等）：
   - 缺货行（`MAPPED` 且 `BACKORDERED` / `PENDING`）转
     `EXTERNAL_FULFILLED`：平台侧已履约完成，不占内部库存、不进拣货 /
     待采购 / 自动重分配（这些口径只认 `BACKORDERED`/`PENDING` 行）；
   - 关闭行上 OPEN `ORDER_OUT_OF_STOCK` 与订单级
     `ORDER_SHIPMENT_DEADLINE_NEAR`，不再评估发货时限；
   - **除未映射异常外不阻塞**：无 `FAILED` 行、且无 `RESERVED` / `PICKED`
     行（内部履约不在进行中）时，订单经 `OrderStatusService.transition`
     转 `SHIPPED`；仍有 `FAILED` 行时由未映射异常阻塞（重算 rollup 落
     `EXCEPTION`）；内部履约进行中时不自动关账，按 §7a.8 差异协议留待
     运营处理（货可能还在我们仓内，平台状态与现实谁对谁错需要人判）。
   - 不产生任何库存流水（§14）：这些行从未持有内部库存。轮转候选因此
     纳入「`platform_stage='DELIVERED'` 且 ERP 未 SHIPPED/CANCELLED」的
     差异单（§7a.2），首次即按 delivered 摄入的订单也能被兜底回读自愈。
1. **外部履约自动流转**（用户指示 2026-09-17，已被 0 泛化）：订单履约模式为 FBO/FBP
   （`isExternalFulfillmentMode`，兼容长短两种存储形态）且平台阶段进入
   `IN_TRANSIT / DELIVERED`、ERP 尚未 SHIPPED/CANCELLED 时，订单经
   `OrderStatusService.transition` 自动转 `SHIPPED`（历史原因
   「平台履约流转：平台仓库已发货」）；不评估发货时限异常。此类订单的履约
   流程在平台侧完成，不阻塞、不依赖内部发货单。
   **映射修复同样遵守外部履约语义（2026-09-28，ERP 建议#6 修复）**：此前
   恢复路径 `retryFailedMappingItem` / `retryAllocation` 对映射失败或缺货的
   外部履约行误走内部库存分配，导致 FBP 订单被 `ORDER_SKU_MAPPING_FAILED` /
   `ORDER_OUT_OF_STOCK` 异常永久卡在 待处理/异常。修复后：外部履约行修复时
   不占库存，行直接 `EXTERNAL_FULFILLED` 并关闭行上的
   `ORDER_OUT_OF_STOCK`；平台阶段已是 `IN_TRANSIT / DELIVERED` 的订单立即
   转 `SHIPPED`（历史原因「平台履约流转：映射修复/重新分配时平台已发货」），
   否则保持当前状态等平台事件推进。
1. **只更新平台事实字段**：`platform_status` / `shipment_deadline` / `raw_data`。
   绝不直接改 `erp_status`（§1）。平台未提供的字段（NULL 输入）保持库内原值，
   历史上 `platform_status IS NULL` 的行不得被「看起来空」而清理或改写。
2. **窗口游标从不回看 + 按需回读轮转（双轴 T2，2026-09-15）**：OZON 窗口按
   `in_process_at`（订单创建时间）过滤，已摄入订单不会再出现在后续窗口中。
   兜底感知改为**公平轮转制**，不再「每轮刷新全部非 ERP 终态订单」：
   - 候选 = `platform_stage IS NULL`、`∈ {AWAITING_SHIPMENT, IN_TRANSIT}`，
     或 `= 'DELIVERED' 且 erp_status NOT IN ('SHIPPED','CANCELLED')`
     （**按平台阶段**判定，不看 `erp_status`——`erp_status='SHIPPED'` 的单
     继续回读直到平台妥投/取消，否则妥投事实永远学不到；最后一档是
     「已妥投但 ERP 未发货」的差异单，用户指示 2026-10-14：交给 §7a.0
     收敛，收敛为 SHIPPED 后自动退出候选，不会常驻）；
   - 且 `platform_facts_checked_at`（上次回读确认时间）为空或超过
     `ORDER_STATE_FALLBACK_HOURS`（默认 24h，ENV 可配）；
   - 排序「最久未查优先」，每单回读确认后无论事实是否变化都刷新
     `platform_facts_checked_at`，批容量 100/轮；
   - 该轮转制同时保证：事实不变的单不会霸占回读预算（饥饿）、停滞单持续
     被观察直至平台终态（webhook 停用时异常仍可自动解决）。
   - **面单归档后的主动回读（2026-10-21）**：预取任务归档面单成功后，对
     `platform_tracking_no` 仍为空的订单立即定向回读一次。面单可取 = 平台
     已完成注册，这是不依赖 webhook 的可靠信号；OZON 的 `TYPE_STATE_CHANGED`
     不推送 `awaiting_deliver` 这一跳（实测 521 条事件、8 种状态，从未出现
     `posting_registered`），24h 轮转又太慢。已有运单号的订单跳过，不产生
     额外平台调用。
   单单失败只计入 failedCount，不拖垮整批。
3. **幂等**：状态无变化（含 `raw_data` 键序无关比较——PG jsonb 不保留键序）
   时零写入，不产生任何行更新或历史记录。
4. **平台取消 = 自动执行**（决策 1-D1b=A）：平台状态变为 `cancelled`
   （由平台 Mapper 判定并以 `platformCancelled` 布尔传递，平台词表不进入
   订单核心）时，直接调用既有 `OrderService.cancel()`：Reserved 行释放
   Reservation、Picked 行建 Interception。重复的 cancelled 同步命中
   cancel 的幂等早退与 `ORDER_RELEASE:<orderItemId>` 幂等键，只释放一次。
   **新单即取消**（窗口内首次摄入即 `cancelled`）同样在摄入后立即走 cancel。
   **取消词表的完整归类（2026-10-15 修复）**：OZON 的
   `cancelled_from_split_pending`（拆单取消）与 `cancelled` 是同一取消事实，
   由 Mapper 共享谓词 `isOzonPostingCancelled` 一并判为 `platformCancelled`
   且阶段归 `CANCELLED`（与发货链路 `ozon-shipment.service` 早有口径对齐）。
   此前该状态未归类，导致已取消的发货单被 `POSTING_CANCELLED` webhook 回读后
   当活跃单摄入、常驻缺货（真实样本 ORD00000041）。数据修复见 Migration
   `20261015_002_fix_platform_cancelled_dead_orders`。
5. **取消关闭缺货异常**：订单取消（任何触发方）时，自动 RESOLVE 其订单行的
   OPEN `ORDER_OUT_OF_STOCK` 与 `ORDER_SHIPMENT_DEADLINE_NEAR`——
   永不发货的订单不得继续要货。
6. **时限重算**：每次再遇（无论字段是否变化）按 §16 重评估时限异常。
7. **平台状态历史**：`platform_status` 迁移写入独立表
   `platform_status_history`（决策 5，方案 B），与 ERP 状态机表物理隔离；
   订单详情将两条时间线按 `created_at` 合并返回。
8. **发货/送达差异可见**：平台 `delivering/delivered` 而 ERP 未发货的订单，
   订单列表与详情展示醒目标记（纯展示，不产生 ERP 动作）。正式收口走
   §8A「标记外部履约」。

---

# 7b. 平台物流阶段（双轴任务 T1，2026-09-15）

订单头新增三个**平台事实列**（绝不写 `erp_status`，§1/§38 不变）：

```text
orders.platform_stage             归一化平台物流阶段（AWAITING_SHIPMENT /
                                  IN_TRANSIT / DELIVERED / CANCELLED，可空）
orders.platform_stage_changed_at  进入该阶段的平台自身时间戳（停滞时钟锚点）
orders.platform_facts_checked_at  最近一次兜底回读确认时间（调度游标，非事实）
```

规则：

1. **归一化在 Mapper 完成**（AGENTS.md §31/§33）：OZON 词表 → 阶段的映射
   表冻结于 `docs/integrations/ozon.md` §平台阶段映射；未归类状态
   （`arbitration` 等）→ NULL，禁止猜测（AGENTS.md §88）。
2. **锚点取平台自身时间**（§2.4 口径）：`IN_TRANSIT` → `delivering_date`、
   `DELIVERED` → `fact_delivery_date`（OZON GET 响应**没有**
   `changed_state_date`，该字段仅 webhook 载荷有）；阶段迁移时若平台
   时间缺失/非法，回退**本次观察时间**，不得用「我们的接收时间」当
   平台事实。
3. **NULL 输入保留库内值**：与 §7a.1 同语义——未归类/未同步不得清空
   已有阶段。
4. **`platform_facts_checked_at` 只是轮转游标**：每次兜底回读确认后刷新
   （无论事实是否变化），服务于 T2 的公平轮转（见 §7a.2），不参与业务
   判定。
5. 停滞判定（`platform_stage='IN_TRANSIT'` 且超 3 天未变）见 §16A；
   列表「待收货 / 已完成」标签以 `platform_stage` 为准（§17a）。

---

# 8. 取消订单

内部 `cancelOrder()`：人工 / API 触发，或**平台取消自动传导**（Sprint 9 T1，
平台状态 `cancelled` → 同一 `OrderService.cancel()` 链路，决策 1-D1b=A）。

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

**取消的异常收口（Sprint 9 T1）**：订单取消（任何触发方）时，该订单全部
订单行的 OPEN `ORDER_OUT_OF_STOCK` 与订单级 `ORDER_SHIPMENT_DEADLINE_NEAR`
自动 RESOLVED——永不发货的订单不得继续占用待采购/催货注意力。

## 标记外部履约（Sprint 9 T6，决策 6 = A）

订单在 WCIES 之外完成（如线下采购直发买家，货物从未进入系统仓库）的
正式收口动作：`POST /orders/:id/mark-external-fulfillment`（原因必填）。

```text
订单行（非 SHIPPED/RELEASED）
↓
已占用（RESERVED）的行：先释放预约（releaseReservation，订单域入口）
↓
fulfillment_status = RELEASED（关账）
↓
erp_status → SHIPPED（显式迁移，历史记录「标记外部履约：<原因>」）
↓
orders.external_fulfilled_at = now()、external_fulfillment_reason = <原因>
↓
RESOLVE 该订单的 ORDER_OUT_OF_STOCK / ORDER_SHIPMENT_DEADLINE_NEAR
↓
OperationLog：MARK_EXTERNAL_FULFILLMENT（操作人 + 原因）
```

规则：

1. **释放占用是标记流程的一部分**（2026-10-23 用户口径）：有 RESERVED 行不再
   拒绝，而是先释放预约再关账——运营决定改由平台履约时，占用本来就没有意义了。
   释放走订单域入口（`orderDomain`），行状态与 rollup 同步，不产生悬空占用。
2. **已拣货（PICKED）的行仍然拒绝**：货已离开货架，释放库存会让账面与实物不符
   （§16 Picked ≠ Reserved）。这类单必须先走拦截/退回，再标记外部履约。
3. **不产生任何库存流水**（货从未入系统，§14 账本不受影响）。
4. 不新增 ERP 状态（§98）：复用 SHIPPED 作为「履约完成」的关账状态；
   真实履约路径与外部履约通过 `external_fulfilled_at` 与历史原因区分。
5. 已 CANCELLED / SHIPPED 的订单不可标记。

## 取消外部履约标记（2026-10-23）

`POST /orders/:id/cancel-external-fulfillment`。标记只是**账面**关账，平台侧可能
还没发货；此时允许撤销：

```text
RELEASED 行 → PENDING（可重新分配）
↓
orders.external_fulfilled_at = NULL、reason = NULL
↓
recomputeOrderStatus（PENDING → BACKORDERED/待分配）
↓
OperationLog：CANCEL_EXTERNAL_FULFILLMENT
```

- 只有 `external_fulfilled_at IS NOT NULL` 的单才能取消（未标记过 → 409）。
- **平台已开始运输（platform_stage = IN_TRANSIT / DELIVERED）时拒绝**：货已经
  离开，回退没有意义；前端在这种状态下直接隐藏按钮。
- 取消后不自动重试分配：操作员按需点「重新尝试分配」（或等库存事件）。
- `SHIPPED` 行不动（既成事实）。

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
4. 回库（原子事务）：解包（PackageItem / PackageItemSerial **作废为 VOIDED，不得物理删除**；SEALED 包裹 → `REPACK_REQUIRED`，清空包裹 → `CANCELLED`；ShipmentItem 快照行**同样作废为 VOIDED，不得物理删除**；Shipment 阶梯重算）→ 库存 `RETURN_PICKED`（Picked - N，On Hand 不变，SN → IN_STOCK 回目标 Bin，Reservation → RELEASED）→ OrderItem → RELEASED。状态历史（`order_interception_histories`）逐跳记录，内部合并步骤也留痕。作废语义与审计字段见 §15A「Shipment / Package 行的作废（VOIDED）生命周期」。
5. **暂存位兜底（Sprint 9 T3，决策 4 = A）**：回库时未扫码且未显式传入
   目标库位（`targetBinId IS NULL`）的，**自动创建**该仓库的 `STAGING`
   库位（幂等：已存在则复用；创建记 OperationLog）并回库——仓库没有
   暂存位不得阻塞实体找回。已扫码 / 已传入库位的仍严格校验归属。
6. 失败：`FAILED` 不动库存（Picked 保持），创建 `ORDER_INTERCEPTION_FAILED` 异常并发送通知。
7. 关闭：`RETURNED_TO_STOCK` / `FAILED` → `CLOSED`。
8. **文案口径（2026-10-25 用户反馈）**：被取消的是**订单**，商品仍是「已拣货」。
   拦截通知与任务原因必须陈述这一事实（「订单已取消；该行已拣货完成（未出库），
   需要拦截找回」），不得写成「拣货商品已取消」——那会让通知与行状态自相矛盾。
   任务原因说明「为什么要拦截」，不复述订单取消原因（后者在订单状态历史里）。
9. **通知中心列（2026-10-26 用户要求）**：不单列「通知状态」——能看到就表示已送达，
   投递异常时才在通知格内提示。「货物状态」列直接回答运营/仓库最关心的问题
   （实物现在在哪）：拦截进度 + 原拣货库位 / 回库目标库位 / 已装包裹；「订单状态」
   列显示关联订单**当前**的 ERP 状态。两列都是派生字段（不落库）。

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

- 类型：`ORDER_SKU_MAPPING_FAILED` / `ORDER_OUT_OF_STOCK` / `ORDER_INVALID_STATE` / `ORDER_INTERCEPTION_FAILED`（Sprint 4）/ `ORDER_SHIPMENT_DEADLINE_NEAR`（Sprint 7，见 §16）/ `SYNC_FAILED`（Sprint 9 T2，见 §15B）/ `ORDER_TRACKING_STALLED`（双轴 T4，见 §16A）/ `ORDER_CANCELLED_AFTER_SHIP`（双轴 T4，订单在 WCIES 已发货后被平台取消：订单仍走既有 `cancel()` 链路，SHIPPED 行保持、库存不动，找回走退货/退款流程；severity=HIGH，reference=ORDER/orderId，不自动解决，由人工在退货流程完成后收口）。
- 状态：`OPEN / RESOLVED / IGNORED`；禁止物理删除历史异常。
- severity 取值：`LOW / MEDIUM / HIGH`（技术必需的分级字段）。

---

# 16. 平台发货时限（Sprint 7）

`orders.shipment_deadline`（TIMESTAMPTZ，可空）：平台要求完成拣货发货的截止时间
（OZON `shipment_date`，超时后平台按更高费率计费）。

规则：

1. **平台事实，不是 ERP 状态**（AGENTS.md §38）：由平台映射器提取，`raw_data`
   原文保留（§34）；禁止用它驱动 `erp_status`。
2. 映射提取**容错**：缺失或非法格式时置 NULL，不抛错——一个字段的缺失不得
   让整单同步失败（§49）。
3. 展示分档（前端展示规则）：

| 分档 | 判定 | 呈现 |
|---|---|---|
| 已超时 | `deadline < now()` | 红 + 「已超时」 |
| 紧急 | 剩余 `< 24h` | 红 |
| 临近 | 剩余 `< 3 天` | 橙 |
| 正常 | 其余 | 中性 |

4. 异常 `ORDER_SHIPMENT_DEADLINE_NEAR`：订单摄入时若 `shipment_deadline`
   非空且（已超时或剩余 < 24h），创建该异常（reference = ORDER/orderId）。
   已超时 severity=HIGH，临近 severity=MEDIUM。同一 (type, reference) 仅一条
   OPEN（既有部分唯一索引兜底）。
5. 异常解决：订单全部发货（erpStatus = SHIPPED）或取消时自动 RESOLVED；
   也可人工 IGNORED/RESOLVED。
6. **重评估（Sprint 9 T1）**：时限是时间敏感事实——摄入时还很远的时限会
   随时间流逝变得紧急。因此每次 ORDER_SYNC 再遇该订单（无论字段是否
   变化）都重评估：剩余 < 24h / 已超时 → 创建（去重）；平台把时限推迟到
   ≥ 24h 后 → RESOLVE 既有 OPEN。重评估本身零写入（异常中心幂等保证）。

---

# 16A. 物流停滞（双轴任务 T4，2026-09-15 冻结）

用户规则：**平台状态超 3 天未变即报**。适用范围 = `platform_stage='IN_TRANSIT'`
（已交物流后的在途阶段）；未发货阶段的超时由「发货超时」（§17a
`SHIPMENT_OVERDUE`）覆盖，不重复报。

- **判定**：`platform_stage='IN_TRANSIT'` 且 `now() - platform_stage_changed_at >
  3 天` → 创建 `ORDER_TRACKING_STALLED`（severity=MEDIUM，reference=ORDER/orderId）。
- **时钟锚点**：平台自身时间戳（§2.4 / §7b）——回读取 `delivering_date`、
  webhook 取 `changed_state_date`，缺失回退观察时间；禁止用「我们的接收时间」
  当平台事实（投递延迟会造成误判）。
- **评估时机**：ORDER_SYNC 兜底回读**每次相遇都评估**（无论事实是否变化——
  停滞的定义恰恰是什么都没变，只评估变化会永远漏掉停滞单，与 §16 时限重评估
  同理）。候选轮转（§7a.2）保证每个非终态单至少每个 fallback 窗口被观察一次。
- **自动解决**：阶段进入 `DELIVERED` / `CANCELLED` 时自动 RESOLVED——**经纯
  回读路径也能解决，不依赖 webhook 存活**（webhook 被平台自动暂停是真实风险，
  ozon.md §6.5）。
- 平台的送达日期事实（`client_delivery_date_end` / `delivery_date_begin/end`）
  本期只随 raw_data 展示，不参与判定。

---

# 17. 订单行采购覆盖（2026-10-21 决策 0023，派生）

订单行响应携带派生字段（均**不落库**，AGENTS.md §13）：

| 字段 | 含义 |
|---|---|
| `procurementCoverage` | `COVERED` / `SHORT` / `null`（未映射行或店铺无绑定仓） |
| `procurementGapQty` | 该 SKU 在该仓的剩余缺口数量（仅 `SHORT` 有值） |
| `procurementInTransitQty` | 该 SKU 在该仓的在途未收采购总量 |
| `procurementWarehouseId` | 缺口计算所用的仓（订单店铺绑定仓） |
| `storeWarehouseUnbound` | 店铺没有任何 `ACTIVE` 仓库绑定（2026-10-24） |

采购不再挂订单行：需求、在途、缺口与逐行覆盖全部按 `SKU × 目标仓` 现算，
完整定义见 `docs/business-rules/purchase.md` §3.5（单一事实源，本文档不重复定义）。
**「已到货」（`ARRIVED`）状态已整体移除。**

## 店铺未绑定仓库 ≠ 缺货（用户指示 2026-10-24）

店铺没有任何 `ACTIVE` 的 `warehouse_platform_bindings` 时，订单行在分配阶段拿不到
目标仓：既不能占用库存，也不能按仓计算采购缺口。这类行**不是缺货**，补货解决
不了它：

- 行状态徽标显示「店铺未绑定仓库」（不是「缺货」），提示去店铺配置绑定仓库；
- 列表计数：`backorderedUnboundCount` 单列，`backorderedShortCount` 与界面上的
  「缺货 N」都**不包含**这类行；订单头若全部未分配行都是这个原因，ERP 徽标显示
  「仓库未绑定」而不是「缺货」；
- 「待采购」筛选不含这类行（它们没有目标仓，无法按 `SKU × 仓` 补货）；
- 库存事实不变：行仍是 `BACKORDERED`（确实没有分配到库存），异常类型是
  `ORDER_INVALID_STATE`（配置问题），绑定仓库后重试分配即可推进。

---

# 17a. 订单列表双轴标签口径（双轴任务 T3，2026-09-15 冻结）

订单列表是**两级标签体系**：一级是订单的物流阶段（横向），二级是行级货物
状态（纵向）；一张订单可同时属于一级标签与多个二级 chip。

## 一级 · 物流阶段（Tabs，默认「待处理」）

| 标签 | 查询 `stage` | 判定 |
|---|---|---|
| 全部 | —（无筛选） | 含已取消 |
| 待处理 | `PENDING` | `erp_status NOT IN ('SHIPPED','CANCELLED')` **且非外部履约单**；含「平台已妥投但系统未发货」的分歧单（保留 ⚠ 提示人工收口）；缺货单天然落在其中 |
| 外部履约 | `EXTERNAL` | 外部履约单（`fulfillment_mode` 为 FBO/FBP/FBW/FBY）**且 ERP 无可履约行**（全部行 `EXTERNAL_FULFILLED`/`RELEASED`）、**无**映射失败行、尚未发货/取消（用户指示 2026-10-16） |
| 已发货 | `IN_TRANSIT` | `erp_status='SHIPPED'` 且 `platform_stage ≠ 'DELIVERED'`（含 `platform_stage IS NULL` 的未同步单）；2026-10-19 由「待收货」更名 |
| 已完成 | `COMPLETED` | `erp_status='SHIPPED'` 且 `platform_stage='DELIVERED'`（已签收） |
| 已取消 | `CANCELLED` | `erp_status='CANCELLED'`（2026-10-19 从「全部」独立成 Tab） |

- 「全部」仍包含已取消；已取消不再只在该处可见（2026-10-19 起有独立 Tab）。
- 标签计数必须与同筛选条件（含当前店铺/关键词）的列表 `total` 一致。
- **外部履约单独立成 Tab（用户指示 2026-10-16）**：FBO/FBP/FBW/FBY 由平台仓库
  持货发货，ERP 侧没有拣货/发货动作，此前停在 `NEW`（§7）混在「待处理」里像待办。
  现单列「外部履约」阶段收纳；平台发货后随 `erp_status` 转 `SHIPPED` 归入「待收货」，
  妥投后归入「已完成」。**存在映射失败行的外部履约单不归此处**（仍需人工补映射，
  留在「待处理/异常」）。
- 外部履约单不评估发货时限异常（§7 规则 7），列表「时限」列对它们也不显示倒计时
  （显示 `—`），避免"看着紧急实则无动作"。

## 订单级「物流」列（用户指示 2026-10-19）

ERP 状态与平台物流阶段是两条轴（§1/§38）：ERP 状态保持「已发货」，物流阶段
单独成列，取自 `orders.platform_stage`：

| 显示 | 判定 | 含义 |
|---|---|---|
| 待揽收 | `AWAITING_SHIPMENT` | 平台尚未交给承运商（**未产生物流记录**） |
| 运输中 | `IN_TRANSIT` | 已交承运商、未签收 |
| 已签收 | `DELIVERED` | 平台已妥投 |
| — | `NULL` | 阶段未同步/未归类，不猜 |

**注意**：不能用运单号判断是否"已产生物流记录"——OZON 组包即分配运单号，
首批实测中"待揽收"订单全部已有运单号。

### 展示条件（2026-10-19 定稿）

| 订单 | 物流阶段 | 打单状态 |
|---|---|---|
| 已取消 | `—` | `—` |
| 外部履约单（FBO/FBP/FBW/FBY） | **始终按阶段显示**（平台履约，阶段即物流事实） | `—`（无需内部打单） |
| 自管 / 半自管，已发货或部分发货 | 显示（= 已发货后的物流进度） | 已打印则显示绿色「已打印」 |
| 自管 / 半自管，未发货 | `—`（`AWAITING_SHIPMENT` 只表示"平台在等我们发货"，不是物流事实） | 已打印则显示绿色「已打印」 |

### 面单已打印标记

`orders.label_printed_at`（人工确认，浏览器无法感知打印结果）：
- 单笔「打单」或批量打印后，用户回到系统时弹窗确认；确认后置位；
- 列表在物流列显示绿色胶囊「已打印」（运单号列展示时也会出现在单号前）；
- 二级 chip「已打单」= `label_printed_at IS NOT NULL AND erp_status NOT IN ('SHIPPED','CANCELLED')`；
- 幂等：只置位尚未打印的订单，重复确认不刷新时间、不重复审计。

## 二级 · 行级货物状态（chips，单选，与行内徽标同源）

| chip | 查询 `goodsState` | 判定 |
|---|---|---|
| 已采购 | `PURCHASED` | 存在**缺货行**且该行 `procurementCoverage = COVERED`（缺口已被该 SKU 在该仓的在途采购覆盖，决策 0023）。由采购模块端口提供行 id，订单仓储只做行事实过滤 |
| 待拣货 | `TO_PICK` | 存在行 `fulfillment_status='RESERVED'` |
| 已打单 | `LABEL_PRINTED` | `label_printed_at IS NOT NULL` 且 `erp_status NOT IN ('SHIPPED','CANCELLED')`（已打印未发货） |
| 拣货中 | `PICKING` | `erp_status='PICKING'`（该状态由「存在未完成拣货任务」汇总产生，§7） |
| 待发货 | `TO_SHIP` | 存在行 `fulfillment_status='PICKED'` |
| 缺货 | `BACKORDERED` | 存在行 `fulfillment_status='BACKORDERED'` |
| 映射失败 | `MAPPING_FAILED` | 存在行 `mapping_status='FAILED'` |
| 发货超时 | `SHIPMENT_OVERDUE` | `shipment_deadline < now()` 且 `erp_status NOT IN ('SHIPPED','CANCELLED')`，且平台阶段不是 `IN_TRANSIT`/`DELIVERED`（用户指示 2026-10-14：**已事实发货的订单不属于发货超时**，含被未映射异常卡在 EXCEPTION 的——映射要补，但「超时」与货物已发走的事实矛盾；`PARTIALLY_SHIPPED` 剩余行未出且已过时限仍算；阶段 NULL 的单保持原口径） |
| 异常（聚合） | `ABNORMAL` | 缺货 ∪ 映射失败 ∪ 发货超时 ∪ 存在 OPEN `ORDER_TRACKING_STALLED`（§16A；退货模块落地后并入「已发货退款」） |

- 行级口径**不能用订单 ERP 状态表达**：映射失败行不占状态位（§7），
  「部分已发货 + 一行映射失败」的订单状态是 `PARTIALLY_SHIPPED` 但仍需人工。
- `拣货中` 与 `待拣货` 允许同时命中（拣货中的订单仍有未拣的 RESERVED 行）。
- 全部二级判定由后端 EXISTS 子查询执行（前端只展示）。

## 行内标记（非筛选）

`缺货 N`、`已采购 N`、`映射失败 N`。已采购取缺货行中 `procurementCoverage =
COVERED` 的行数（purchase.md §3.5），与行内徽标同源。列表响应字段
`backorderedCoveredCount` / `backorderedShortCount`。

**「已到货」已移除（2026-10-21 决策 0023）**：货到仓后库存增加事件直接触发自动
分配，缺货行当场变成已占用，不会停在"已到货但仍缺货"的中间态；因此列表里不再有
「已到货 N」与「重新分配 N」按钮。

**采购状态的展示口径（2026-10-19，口径不变）**：只在行**仍缺货**
（`BACKORDERED`/`PENDING`）时显示采购覆盖；行一旦分配成功（已占用/已拣/已出库/
外部履约/已释放）就不再显示，右栏的「创建采购单」入口也一并隐藏。
派生值本身不删除——行回到缺货时会自然重新出现。

**口径统一（2026-10-15 修复）**：`缺货 N` 计数、已采购/已到货的取行、待采购
筛选的行集，全部与 §5「缺货口径」及订单 rollup 同源——`mapping_status='MAPPED'`
且 `fulfillment_status IN ('BACKORDERED','PENDING')`。此前 `backorderedCount` 与
取行只数 `BACKORDERED`，导致 `MAPPED+PENDING` 的卡行（典型来源：映射修复时店铺
尚未绑定仓库，分配阶段抛错而抛错路径不写 BACKORDERED）在订单头已显示缺货，
商品列却无缺货徽标、右栏「风险」不渲染、行内也无「重新尝试分配」——整条行级
链路隐身。三处口径现已与筛选/rollup 对齐。

**行内徽标与工具提示（2026-10-23 定稿）**：行内履约徽标按同一缺货口径渲染——
`fulfillment_status IN ('BACKORDERED','PENDING')` 一律显示橙色「缺货」（**未分配就是
缺货**，不再区分是否已映射），订单列表展开行、详情抽屉、右栏头徽标三处一致。

鼠标悬停文案固定为 **「缺货 N 件」**，其中 N 是**该仓该 SKU 的缺口**，口径与
ADR 0023 一致：

```text
N = max(0, 该 SKU 在该仓的总需求 − 在途未收)
```

取值直接用后端派生字段 `procurementGapQty`（不是本行数量，也不是本行未占用量）；
没有仓信息（未映射 / 店铺无绑定仓）时才退化为本行数量。`PENDING` 行同样提供「重新尝试分配」（后端 `retryAllocation`
本来就接受 PENDING，只是按钮此前只对 BACKORDERED 渲染）。

**映射修复路径的配置性失败（2026-10-23 修复）**：店铺没有绑定仓库时，映射修复后
的重试分配此前**直接抛错**，行会永远停在 `PENDING`（映射异常已关闭，页面既无缺货
徽标也无异常可看，实证 ORD00000544）。现与摄入路径对齐：行置 `BACKORDERED` +
行级 `ORDER_INVALID_STATE`（说明「店铺没有已绑定平台仓库的可用仓库」）并重算订单状态。

## 订单列表搜索口径（2026-10-23）

订单页搜索框是「单框混搜」，命中任一即入选：订单号、平台订单号、内部 SKU
**编码或名称（中/俄）**、offer_id、seller_sku、platform_sku_id。SKU 名称是
2026-10-23 补上的——运营常常只记得商品名（如「瓦尔基里-VK M5 Max -索尔suoer」），
记不住 `SKU000012024`，两种输入必须等效。

商品链接页（Listing）的关键词搜索同理：平台商品 ID、链接标题、变体标识
（platform_sku_id / offer_id / seller_sku）以及**已映射内部 SKU 的编码或名称**。

## 订单行采购入口（订单页右栏操作区，2026-10-21 决策 0023）

按行的派生覆盖给出口径：

- `SHORT` → **创建采购单**：弹窗预填当前缺口数量，目标仓取该行的
  `procurementWarehouseId`，请求带 `purpose=REPLENISH`，由后端做缺口守卫
  （purchase.md §3.4）；数量超过缺口或缺口已被覆盖都会被拒绝；
- `COVERED` → 按钮禁用，提示"该 SKU 在该仓的缺口已被在途采购覆盖，无需重复采购"；
- 行已分配（非缺货）→ 无采购入口。

**「去收货」入口下线**：收货不再由订单行发起。收货单只能从采购单生成
（`POST /purchase-receipts/from-po/:poId` / 批量），且收货仓恒为采购单目标仓
（purchase.md §4.1.0）。

---

# 15B. SYNC_FAILED 异常（Sprint 9 T2，决策 3）

店铺定时同步持续失败进入异常中心：

- **触发**：该店铺任一 syncType（ORDER_SYNC / LISTING_SYNC，按
  `sync_cursors.consecutive_failures` 计）**连续失败 ≥ 3 次**。
- **引用**：`referenceType = STORE`、`referenceId = storeId`——每店铺**至多
  一条 OPEN**（复用既有 (type, reference) OPEN 部分唯一索引），details 记录
  各失败 syncType 的连续失败次数；失败画像变化时**更新**该 OPEN 行
  （message/details 刷新，不堆积新行）。
- **severity**：HIGH。
- **自动解决**：该店铺全部 syncType 恢复健康（连续失败清零）时自动 RESOLVED。
- 手动触发的同步失败同样计数（与调度无关）；类目树 / 属性增强同步
  （手动、无游标）不参与该异常。

---

# 15A. Shipment 与 Packing（Sprint 4）

## 进入条件

只有 `OrderItem.fulfillmentStatus = PICKED` 的行可进入 Shipment（按仓拆分，
`shipment_items` 为数量快照）。`BACKORDERED / RESERVED / MAPPING_FAILED` 行禁止进入。
一个订单行最多归属一张**有效（ACTIVE）**的 Shipment 行：约束为部分唯一索引
`uq_shipment_items_order_item_active (order_item_id) WHERE status = 'ACTIVE'`，
VOIDED 历史行不参与（同一订单行允许历史上多次作废后重新发货）。

## 打包（Packing）

```text
Picked Order Items → Create Package → 扫码 SKU → 数量校验 → Seal
```

1. 扫码装箱每次 1 件，条码由后端解析为 Internal SKU；打包**不改变库存**。
2. 错误 SKU：`PACKING_SKU_MISMATCH`；超量：`PACKING_QUANTITY_EXCEEDED`。
3. 数量完整性：Shipment 内全部包裹的 PackageItem 合计必须等于快照数量
   （`SHIPMENT_NOT_FULLY_PACKED`），且全部包裹 SEALED 后才允许出库。
4. SN 商品打包必须记录具体 SN（`package_item_serials`，ACTIVE 行按
   `serial_number` 部分唯一，即同一 SN 同时只能存在于一个有效装箱记录中）；
   打包 SN 必须已属于当前订单行的 Reservation（禁止装入其他订单的 SN），
   SN 状态保持 PICKED。作废后的 SN 可被再次装箱（见下方作废生命周期）。
5. 并发：每张 Shipment 的打包操作按 Shipment 行锁 + Package 行锁串行化。

## 正式出库（Ship）

```text
READY_TO_SHIP → shipShipment() → SHIPPED
```

单一数据库事务内完成：逐行 `shipStockPartialInTx`（Picked - N / On Hand - N /
SN → SHIPPED）→ Packages → SHIPPED → Shipment → SHIPPED → OrderItems → SHIPPED。
任一步失败整体回滚（不存在"Shipment=SHIPPED 但库存未扣"或反向状态）。
人工可录入 `trackingNumber / carrierCode`；平台运单号自 2026-09-18 起由平台 Adapter
自动填入（`orders.platform_tracking_no` → `shipments.tracking_number`，见 §15C）。

## 面单（Shipping Label）

`shipping_labels` 为平台无关元数据：Sprint 4 支持 `MANUAL_UPLOAD`
（经 ObjectStorageService 私有桶 + 短期签名 URL 查看/打印，支持 PDF/PNG/JPEG）。

2026-09-18 起 `PLATFORM_API` 正式启用：平台面单（OZON 官方 PDF）在**组包后、拣货前**
即可获取，因此归属订单（`order_id`）而非发货单；`shipment_id` 因此可为空，
DB CHECK 保证两者至少有一个非空。存储与查看规则与手工上传完全一致。

## Shipment / Package 行的作废（VOIDED）生命周期

`shipment_items` / `package_items` / `package_item_serials` **一律以 VOIDED 替代
物理删除**。行永久保留作审计历史，用于回答"这张发货单原本要发什么、那一行为什么
消失了、是谁在什么时候因为什么作废的"。

状态语义（**关键，不得误解**）：

```text
ACTIVE  = 仍是该 Shipment / Package 的有效组成部分、未被作废
VOIDED  = 已作废的审计历史
```

`status = ACTIVE` **不表示"尚未发货"**。Shipment 已 `SHIPPED` 之后，其有效
`shipment_items` 保持 `ACTIVE` 是**正确状态**；`package_items` 同理。
ACTIVE/VOIDED 只描述"是否被作废"，不描述发货进度（发货进度看 `packedQty` 与
Shipment / Package 状态）。

审计字段：`status`、`voided_at`、`voided_by`（uuid，FK → `users.id`，稳定身份）、
`voided_by_name`（作废时操作人显示名快照，仅用于展示）、`void_reason`、
`void_source_type`、`void_source_id`。
`package_item_serials` 只记录 `status / voided_at / voided_by`。

`void_source_id` 为**多态引用，不建 FK**；`void_source_type ∈ {ORDER_INTERCEPTION, MANUAL}`
与来源存在性由 **Service 层校验**（非法来源 → `SHIPMENT_VOID_SOURCE_INVALID`）。

部分唯一约束（VOIDED 历史行永不阻塞后续重建）：

| 表 | 部分唯一索引 |
| --- | --- |
| `shipment_items` | `uq_shipment_items_order_item_active (order_item_id) WHERE status='ACTIVE'` |
| `package_items` | `uq_package_items_package_order_item_active (package_id, order_item_id) WHERE status='ACTIVE'` |
| `package_item_serials` | `uq_package_item_serials_serial_active (serial_number) WHERE status='ACTIVE'` |

规则：

1. **所有业务计算只统计 ACTIVE**：打包完整性、出库库存扣减、列表聚合、
   `findLiveShipmentOfOrderItem` 等一律过滤 ACTIVE；VOIDED 行不参与任何计算。
2. 作废操作 `UPDATE … WHERE status = 'ACTIVE'`，天然幂等（第二次 affected = 0），
   不会产生第二条 VOIDED 行。
3. 作废与回库、Package 重算、Inventory `returnPickedStockInTx`、Reservation →
   RELEASED、OrderItem → RELEASED、Interception 状态迁移必须在**同一事务**内完成。
4. 迁移必须显式回填 `UPDATE … SET status='ACTIVE'` 后才建 CHECK / 部分唯一约束，
   不能只依赖列 DEFAULT。
5. 前端 `/shipments/:id` 主表只显示 ACTIVE 行；VOIDED 行在默认折叠的
   「已作废 / 历史记录」区展示，并可跳转到来源拦截任务。

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

# 15C. 订单发货流程（2026-09-18，用户真实作业顺序）

用户确认的真实日常流程（有可用库存、自动分配成功的订单）：

```text
① 获取运单号 → ② 拣货 → ③ 打单 → ④ 发货（通知平台）
```

对应实现（全部入口在订单页右栏操作区）：

| 步骤 | 动作 | API | 是否写平台 |
|---|---|---|---|
| ① | 获取运单号 | `POST /orders/:id/prepare-shipment` | **是**（真实平台写） |
| ② | 拣货 | 既有 `picking-tasks` 流程，**未改动** | 否 |
| ③ | 打单 | `POST /orders/:id/shipping-label` | 否（只下载平台生成的文件） |
| ④ | 发货 | `POST /orders/:id/ship` | 否（平台已在①被通知） |

## ① 获取运单号 = 平台组包

平台侧语义：OZON `POST /v4/posting/fbs/ship`（组包），把发货单从
`awaiting_packaging` 推进到 `awaiting_deliver`，平台随即分配运单号。

- **这是本次改造中唯一的订单生命周期平台写操作**。规范里其后再无面向卖家的
  「标记已发货」写接口，因此 ④ 不重复写平台（用户 2026-09-18 确认「一次组包就够」）。
- 实测依据（2026-09-18，真实库 197 单）：`awaiting_deliver`/`delivering` 的
  **155 单全部有 `tracking_number`**，16 单 `awaiting_packaging` **全部没有**——
  证实平台只在组包时分配运单号，这也解释了为什么「获取运单号」必须调组包接口。
- **幂等**：先回读发货单，已组包（或平台返回已组包）时**完全不写平台**，只刷新本地事实。
- **回读确认 + 异步受理（2026-10-09 T0 修订）**：规范明确 200 不代表组包成功，需回读
  并检查 `substatus`。组包确认是**异步**的——回读落在 `awaiting_packaging` +
  `substatus=ship_pending` 属正常「已受理、处理中」，作为成功返回
  （`assemblyPending=true`，运单号暂为 null，不建异常）；用户再次点击或常规订单
  同步自然收敛。仅 `substatus=ship_failed` 或写后 `cancelled` 才抛
  `PLATFORM_SHIP_NOT_CONFIRMED`（真失败，进异常中心）。
- 组包后把平台事实（状态 / 阶段 / 时限 / 运单号 / raw_data）经平台 mapper
  归一化后落库；**ERP 状态一律由 `OrderStatusService` 决定**（§38 不变）。
- 平台未实现该能力时不猜测、不跳过：抛 `PLATFORM_CAPABILITY_UNSUPPORTED`，
  前端据后端能力位隐藏按钮。

## ③ 打单

`shipping_labels` 仍是唯一的平台/发货单**面单统一入口**：

- 平台面单在组包后即可取，此时**还没有内部 Shipment**（发货单只能由 PICKED 行创建），
  因此 `shipping_labels.order_id` 记录订单归属，`shipment_id` 可为空
  （DB CHECK：两者至少有一个非空）；既有手工上传行不受影响。
- 来源 `source = PLATFORM_API`（Sprint 4 预留值的正式启用），文件仍走
  `ObjectStorageService` 私有桶 + 短期签名 URL 查看/打印（§68 不变）。
- 默认复用已存档面单，`refresh=true` 才重新向平台取（平台面单接口限流且全或无）。

## ④ 发货 = 一键出库

```text
createShipmentsFromOrder（仅 PICKED 行，1 发货单 = 1 仓）
→ ensureOpenPackage + packAllItems + sealPackage（单包裹快捷路径）
→ ShipmentShipService.shipShipment（唯一扣库存的一步）
→ OrderItem → SHIPPED → 订单 rollup
```

- **不是新阶梯，是既有阶梯的编排**：① ② ③ ④ 都不改变 §15A 的打包/出库规则，
  库存仍只由 `shipStockPartialInTx` 扣减，`InventoryTransaction` 仍然一条不少。
- **单选包裹**：一键路径把该发货单的全部待装数量装入一个包裹并封箱；
  手工多包裹精细装箱能力保留不变，两者互不排斥
  （已 READY_TO_SHIP 的发货单，一键发货直接出库，不再装箱）。
- **并发（用户 2026-09-18 实测发现）**：全流程跨多个事务，单行锁无法覆盖，
  因此按订单加 **PostgreSQL advisory lock**（§18 允许的「明确验证的等效并发控制」，
  由集成测试证明：并发两次发货只扣一件库存）。包裹的「判断该不该开箱 + 开箱」
  在发货单行锁内完成，避免开出空箱——空箱永远无法封箱，会让发货单卡在 PACKING。
- **幂等**：复用已存在的有效发货单；`shipShipment` 重复调用不二次扣减；
  重新发货的报告 `alreadyShipped`。
- 订单上的平台运单号自动填入发货单 `trackingNumber`（已有值不覆盖）。
- **运单号回填（2026-10-21）**：发货单的运单号是创建时的快照。同步层每次
  观察到订单的运单号（组包回写、面单后主动回读、24h 轮转、Webhook 回读）时，
  调用 `ShipmentService.backfillTrackingForOrder` 把该订单下
  `tracking_number IS NULL` 的发货单补齐；只填空值，绝不覆盖人工录入。
  典型场景：组包后平台尚未分配运单号就发货，事后平台回填运单号时发货单
  自动补齐（迁移 `20261021_003` 已修复存量）。

## 多选批量入口（2026-10-13，订单页多选）

订单页支持勾选多个订单（跨分页保留）后在主页面批量条上批量执行 ①②④
（2026-10-14 增补批量外部履约）：

| 动作 | API | 语义 |
|---|---|---|
| 批量生成拣货单 | `POST /picking-tasks/auto-create`（请求体带 `orderIds`） | 勾选订单的 RESERVED 行**按仓合并**生成拣货任务（2026-10-15 语义修正）：同一仓库合并为一个任务（合并拣货，`picking_task_items` 行保留各自订单引用，任务内订单取消只摘除该订单行）；省略 `orderIds` 仍是旧的按店铺自动选取（同样合并）；跳过/幂等规则不变 |
| 批量获取运单号 | `POST /orders/batch-prepare-shipment` | 逐单执行 ① 的全部平台/幂等/事实回写逻辑；仍是真实平台写操作 |
| 批量发货 | `POST /orders/batch-ship` | 逐单执行 ④（含按订单 advisory lock）；库存仍只走 `shipShipment` |
| 批量打印面单 | `POST /orders/batch-shipping-label` | 逐单执行 ③（默认复用本地已存档面单，`refresh=true` 才重新打平台）；缺面单的订单**按店铺分组、每 ≤20 单一次平台调用**，返回形状不可用时逐单降级；终态订单跳过并计入 `notPrintable`；成功面单在**服务端合并成一个 PDF** 返回（`mergedPdfBase64`），每页保留平台原纸张尺寸；**页序 = 订单列表当前排序**（含加急置顶；请求带 `sortBy`/`sortOrder`） |
| 批量外部履约 | `POST /orders/batch-mark-external-fulfillment` | 逐单执行 Sprint 9 T6 的标记外部履约（同一 reason 记入每单的状态历史与操作日志）；不产生任何库存流水 |

规则不变，只是编排：**逐单执行、单笔失败只记录结果不拖垮整批**（§36/§43），
不新增状态、不改变任何单笔路径的业务规则；批量获取运单号仍要求操作员显式确认
（§92）。前端原右栏「自动创建拣货任务」按钮按店铺全量扫单的入口已下线，
改为按勾选执行。批量外部履约的校验与单笔一致：已取消/已发货、存在
RESERVED / PICKED 行的订单逐单拒绝并说明原因。

**批量打印面单的纸张尺寸（2026-10-17 修正）**：平台面单 PDF 自带纸张尺寸
（OZON 实测 `57.9mm × 40mm`，MediaBox 164.25×113.25pt）。**必须**用浏览器
原生 PDF 查看器打印——把 PDF 嵌进 HTML 打印页会被缩放成 A4，尺寸错误
（2026-10-17 用户实测报错）。因此后端把成功面单合并成一个 PDF（`pdf-lib`，
`copyPages` 保留每页 MediaBox），前端以 Blob URL 在该窗口打开；合并失败时
逐单结果仍返回签名 URL，可单张补打。

## 面单归档、预取与清理（2026-10-21）

### 预取（组包后后台归档）

- **触发点**：`POST /orders/:id/prepare-shipment`（以及批量版）成功之后。
  组包是面单可用的**唯一**前置条件（平台只在 `awaiting_deliver` 提供面单）。
- **延迟**：默认 60 秒（OZON 文档建议组包后 45–60 秒再取），异步组包
  （`assemblyPending`）由任务按指数退避重试（默认 6 次）。
- **批量组包只入队「批次任务」**（每 ≤20 单一块），不逐单入队——否则 50 单
  组包会变成 50 次平台调用。
- **补触发**：同步 / Webhook 首次观察到平台运单号时补一次（可配置关闭）。
- 没有运单号且非异步组包的订单**不预取**（避免无意义的平台访问）。
- 预取是**尽力而为**：入队失败只记日志，绝不影响组包响应；失败不写异常中心，
  用户点「打单」仍走按需路径并看到真实错误。
- 打印命中存档时返回 `fromArchive=true`，不访问平台。

### 批量取单

- 未存档的订单按店铺分组，每 `LABEL_BATCH_FETCH_CHUNK`（默认 20，OZON 文档
  上限）单一次平台调用。
- 平台返回的批量面单只有**页数恰好等于单数**时才能一页对一单；页数不符或
  无法解析时必须降级为逐单请求（不猜测平台分页规则）。
- 平台以 4xx 拒绝（批量接口「一单不可取则整批不成」）时同样逐单降级，把坏单
  隔离出来；5xx / 鉴权 / 网络错误不降级（逐单重试只会放大同一个失败）。

### 终态禁打

订单进入以下终态后**不再支持打印面单**（服务端 409
`ORDER_LABEL_NOT_PRINTABLE`，前端隐藏入口）：

- `CANCELLED`；
- 「已完成」= `erp_status = 'SHIPPED'` **且** `platform_stage = 'DELIVERED'`
  （列表的 COMPLETED 口径，§17a）。

**注意**：平台已妥投但 ERP 尚未 `SHIPPED` 的背离单**不**禁打——它们仍可能需要
面单。批量打印对终态订单逐单返回该错误码并计入 `notPrintable`，其余照常打印
（§36：不因个别订单让整批失败）。

### 清理

- 终态订单的面单**图像字节**被清理；`shipping_labels` 行永久保留为审计事实
  （谁、何时、为哪单存过面单、对象键是什么），并以 `purged_at` 标记。
- 其余运单号 / 订单事实（`orders`、`shipments`、`packages`）**不受影响**——
  清理的是图像，不是运单号。
- 执行方式：后台扫描（默认 6 小时一次，`LABEL_PURGE_SWEEP_INTERVAL_SECONDS`），
  按 `(created_at, id)` keyset 游标每轮循环若干批（默认 10×200 行、60 秒预算）
  直到排空或达到上限。为什么不挂在状态迁移上：终态判定在 order 模块（面单属于
  shipment，反向依赖会破坏模块方向）；COMPLETED 是派生口径、没有单一变更事件；
  S3 删除不是事务性的。扫描天然覆盖手工取消、平台取消与历史积压。
- 清理对用户不可见（禁打由状态判断，**立即生效**，不依赖清理是否跑过），因此
  时效要求极低；宽限期 `LABEL_PURGE_GRACE_MINUTES` 默认 0。
- 扫描顺序为「先删对象、后置标记」：对象删除失败不置标记，下一轮重试；对象已
  不存在视为已删。

## 异常

- `ORDER_PLATFORM_SHIP_FAILED`（新增，HIGH，reference ORDER/orderId）：
  ① 的平台写**真实失败**（5xx 类平台/基础设施故障，或平台受理但未确认组包）时创建；
  下一次成功组包自动解除。
- 4xx 类前置条件（平台状态不允许组包、组包进行中、平台未接入该能力）**不建异常**——
  操作人当场看到原因即可，否则异常中心会被重复点击淹没。

## 明确不做

- 批量打单已提供 `POST /orders/batch-shipping-label` + 单窗口多面单打印
  （2026-10-17）；仍未做的是**打印子系统**（本地打印代理 / 免驱标签纸）。
- FBO / FBP 等外部履约订单的平台写（这些订单在摄入时即 `EXTERNAL_FULFILLED`，不进拣货）。
- WB / Yandex 的对应平台写：仓库内尚无经核实的接口事实（§88），
  待用户提供官方文档后按同一适配器契约补齐。

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

---

# 18. 错误摄入订单的彻底移除（2026-10-24 用户指示）

「取消」与「移除」是两件事，不能互相替代：

| 动作 | 语义 | 结果 |
|---|---|---|
| 取消（§8） | 这张单确实发生过，后来不做了 | 留在已取消列表、统计与后续查重里；释放占用/已拣走拦截 |
| 移除 | 这张单**本就不该存在**（平台重复推送、映射错单） | 订单、明细、状态历史、异常一并删除，不进任何统计 |

## 18.1 允许移除的前提

订单**没有任何真实业务事实**。只要有下列任一条引用，一律拒绝并列出阻断项：

库存流水（`inventory_transactions`，含 ORDER/ORDER_ITEM 引用）、库存占用
（`inventory_reservations`）、拣货任务、发货单、订单结算/结算明细、财务流水、
拦截任务、平台面单、被采购明细引用。

理由：这些记录一旦指向已删除的订单，库存与财务的追溯链就断了（AGENTS §14/
§101.10）。这类单只能走取消 + 拦截/退回/合并等正式流程。

## 18.2 执行约束

- 已发货/部分发货状态直接拒绝；
- 单事务删除：异常（ORDER 级 + ORDER_ITEM 级）→ 平台状态历史 → 订单状态历史
  → 明细 → 订单头；
- 操作员必须**再次输入订单号**确认（与 SKU 合并同一约定），并填移除原因；
- 写 `operation_logs`（`PURGE_ORDER`，含平台单号、删除行数、原因）——删除动作
  本身必须可追溯；
- 不可撤销。

## 18.3 入口

- API：`GET /orders/:id/purge-preview`（只读影响面与阻断项）、
  `POST /orders/:id/purge { reason, confirmOrderNo }`；
- 订单页右栏：**仅已取消订单**显示「彻底移除（错误摄入）」，弹窗先展示影响面，
  有阻断项时只解释不给删。

历史重复单（WB 统计流水重复建单，2026-10-20/21 那批）按本节一次性清除，
快照见 `.workbuddy/backup/purged-duplicate-orders-*.json`。

## 18a. 同步任务的「墓碑」自愈（2026-10-24）

`sync_jobs` 的 PENDING/RUNNING 行是**单飞守门员**（同一 store + syncType 同时只允许
一条）。此前只回收 RUNNING：进程若在「写 DB」与「入队」之间退出、或 Redis 丢掉队列
任务，PENDING 行会永远留着，之后每次派发都撞唯一约束而被当作「已在运行」——该店铺
从此不再同步（实证：11 个店铺卡住 5 小时，界面一直显示「等待中」）。

规则：

1. 调度 tick 每轮回收 **PENDING 超过 10 分钟**的行（`SYNC_DISPATCH_STALE`）与
   RUNNING 超过 10 分钟的行（`SYNC_JOB_STALE`），前者由下一轮重新派发；
   若原队列任务其实还活着，它的 `claimRunning` 会因状态不是 PENDING 安全跳过。
2. 入队失败必须立刻把行置 FAILED（`SYNC_DISPATCH_FAILED`），不允许留 PENDING。
3. 同步任务与订单状态无关：回收只影响「这轮没跑」，不影响订单事实。

## 18b. 订单金额与「最近采购价」的币种口径（2026-10-24 用户指示）

- **存档原数据**：`order_items.unit_price` 存平台**原币**金额（WB 用 `price/100` 的 RUB，
  Yandex 用 `payment+cashback` 的 RUB，OZON 用其 posting 币种 CNY），
  `orders.currency` 存归一化后的币种（ISO 字母码，不接受 `643` 这类数字码）。
- **显示按原币**：单价/小计按 `orders.currency` 显示；订单没有平台币种时回退到
  店铺计价币种 `stores.default_currency`（DTO 字段 `storeCurrency`）。
- **最近采购价恒为 CNY**：`skus.latest_purchase_price` 记录的是我们自己的进货成本
  （`cost_currency` 固定 CNY），**不得**跟随订单币种格式化——曾因跟订单币种显示成
  `323.00 643`（WB 的 ISO 数字码），被误认为数据被 WB 覆盖。
- 订单同步不写 `latest_purchase_price`；该字段只由 SKU 建档/编辑、Excel 导入、
  SKU 合并与采购收货维护。
