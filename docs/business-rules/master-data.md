# WCIES Master Data Business Rules（Sprint 1）

> 本文档记录 Sprint 1 主数据层的业务规则。修改相关代码前先阅读并同步更新本文档（AGENTS.md §84/§86）。
>
> 本文只覆盖主数据；库存规则见 `inventory.md`，订单规则见 `orders.md`。

---

## 1. 编码规则

> 2026-09-11 起按决策 `docs/decisions/0001`、`0002` 执行：集中式序号表 + 作用域递增。

| 对象 | 编码 | 生成规则 | 序号作用域 | 可否人工修改 |
|---|---|---|---|---|
| Warehouse | `warehouse_code` | `{前缀}-%02d`：SELF→`ZG`、PLATFORM→`PT`、THIRD_PARTY→`SF`、RETURN_TEMP→`TH`，如 `ZG-01` | `warehouse:{TYPE}` | 创建时可留空自动生成；创建后不可改 |
| Store | `store_code` | `{前缀}-%03d`：OZON→`ON`、WB→`WS`、YANDEX→`YX`，如 `ON-001` | `store:{PLATFORM}` | 同上 |
| Brand | `code` | `BN%05d`，如 `BN00001` | `brand` | 同上 |
| Category | `code` | `CN%05d`，一/二/三级共用一条序列 | `category` | 同上 |
| Product | `product_code` | `PN%06d`，如 `PN000001` | `product` | 创建后只读（决策 0002） |
| SKU | `sku_code` | `SKU{商品序号 6 位}{商品内 SKU 序号 3 位}`，如 `SKU000001001` | `sku:{productId}` | 生成后冻结（决策 0002） |
| 内部条码 | `barcode`(INTERNAL) | PG sequence，`WCSKU%08d`（保持独立，不与 SKU 编码合并） | 现有 sequence | — |
| Bin 条码 | `barcode` | `BIN-{warehouseCode}-{binCode}` | — | 可 |

序号由集中式序号表 `business_code_sequences` + `BusinessCodeService` 原子取号（单条 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`，无读-改-写窗口）；并发取同一作用域必然得到互不重复的号。

作用域语义：仓库按**类型**各自递增（第一个自管仓 `ZG-01`，第一个第三方仓 `SF-01`）；店铺按**平台**各自递增（第一个 OZON 店 `ON-001`，第一个 WB 店 `WS-001`）；SKU 按**商品**各自递增（每个商品的第一个 SKU 都是 `001`）。

宽度是**最小宽度**，序号溢出自然进位（`%02d` 对 100 输出 `100`），不报错。仓库**类型**创建后不可改（编码前缀依赖类型）。

## 2. 状态模型

- Product/SKU：`DRAFT → ACTIVE ⇄ INACTIVE`；已被引用的主数据禁止物理删除，只允许停用。
- Store/Warehouse/Binding/Listing：`ACTIVE / INACTIVE(DISABLED)`。
- 删除策略（决策 `docs/decisions/0003`，2026-09-11 起）：**零引用才可物理删除**。服务层逐一引用检查——存在任何引用 → 返回 `*_IN_USE` 错误码 + 提示"该记录已被引用，只能停用不能删除"；零引用 → 真删 + 记 operation log。覆盖 Warehouse / Bin / Store / Binding / Brand / Category / Product / Sku / Listing / ListingSku。Platform 只读，不提供删除。
- **强制删除（决策 `docs/decisions/0008`）**：`DELETE /products/:id?force=true`、`DELETE /skus/:id?force=true` 可级联删除**主数据子对象**——商品的 SKU、SKU 的条码 / 图片 / 平台映射 / 捆绑关系（Listing 记录本身保留，只断开映射）。
  **业务历史永远阻断，勾选强制也不行**：`inventory_balances`、`inventory_safety_stocks`、`inventory_reservations`、`inventory_serials`、`inventory_transactions`、`order_items`、`picking_task_items`、`package_items`、`package_item_serials`、`shipment_items` 任一有引用即返回 `PRODUCT_HAS_BUSINESS_HISTORY` / `SKU_HAS_BUSINESS_HISTORY`，消息中列出具体表名与行数并提示改用停用。
  理由：主数据子对象是可重建的描述，业务历史是发生过的物理事实。删除账本行等同绕过 InventoryService 修改库存（AGENTS.md §10/§14），并使流水与余额失配（§25 可追溯性）。
  级联在同一事务内完成；审计动作记为 `FORCE_DELETE` 并记录被级联的 SKU 数量。

## 3. 条码规则（task §28-§32）

1. `barcode` 全系统唯一：一个条码永远不能绑定两个内部 SKU；冲突错误码 `SKU_BARCODE_ALREADY_EXISTS`。
2. 一个 SKU 可有多个条码，最多一个 `is_primary = true`，由数据库 partial unique index（`WHERE is_primary`）保证；切换主条码在事务中先降级旧主条码。
3. 条码类型：`EAN / GTIN / MANUFACTURER / INTERNAL / OTHER`；69 码归入 EAN/GTIN，不设 CN_69_CODE。

## 4. SKU 物理属性

1. `volume_cm3` 只能由后端计算（长×宽×高），前端/API 均不可写入。
2. 长宽高必须"全有或全无"，保证体积可推导。
3. `latest_purchase_price` Sprint 1 允许人工维护；`moving_average_cost` 为预留字段，恒为 NULL（采购 Sprint 实现）。
4. `serial_tracking` 仅是配置；`inventory_serials` 属于库存 Sprint。

## 5. 平台 / 店铺 / 凭证

1. Platform 为系统级主数据（Migration 种子：OZON/WB/YANDEX），普通用户只读。
2. Store 唯一键：`platform_id + store_code`；不同平台允许相同 store_code。
3. Credential 与 Store 严格分离；一个 Store 每个 `credential_type` 至多一条。
4. 凭证安全：AES-256-GCM（Sprint 0 `CredentialEncryptionService`）；API 永不返回密文/明文；Operation Log 只记录元数据；写操作仅管理员。
5. Credential 生命周期（2026-09-11 起）：可创建、**可替换密钥**（`PATCH .../credentials/:id` 重新加密）、可停用/启用（保留已存密钥，无需重录）、**可删除**。删除不适用"零引用"限制——订单与库存引用的是**店铺**而非凭证，凭证本身没有业务引用方，故录错的密钥允许删除后重录。

## 6. 仓库 / 库位

1. Warehouse Type：`SELF / PLATFORM / THIRD_PARTY / RETURN_TEMP`（无 VIRTUAL，无 Warehouse Group）。
2. 库位唯一键：`warehouse_id + bin_code`；不同仓库允许相同 bin_code。
3. Bin 表禁止 `sku_id` 列：SKU↔Bin 是 N:M，经库存记录关联（inventory.md §54）。
4. 库位编码格式（2026-09-11 起，决策 0010）：`{仓库编码}-{货架}-{层}[-{位}]`，如 `ZG-01-A05-1`。货架号**至少补零两位**（保证字典序 = 实地行走顺序）；层号不补零；仓库编码前缀一并写入，使标签离仓后仍可辨认归属。编码写入后不可修改（`UpdateBinRequestDto` 不含 `binCode`）。
5. **条码 = 编码**：`barcode` 与 `bin_code` 存同一字符串。拣货、拦截、导入解析库位时一律按 `bin_code` 匹配（`findByWarehouseAndCode`），因此标签必须印编码本身——印成别的字符串扫码将无法识别。标签条码规格需用 Code128 或二维码（含字母与连字符，非纯数字，不能用 EAN-13）。
6. **货架 = 库区 + 货架号**（决策 0011）：货架编码由库区前缀与补零货架号组合而成（区 `A` + 号 `3` → `A03`）。**单建与批量两条路径共用服务端同一组合规则**（`formatRack`），因此同一份「库区 A」在任一入口都得到 `A01`，不会出现「库区 A + 货架 C01」这类自相矛盾的输入。`zone` 只是库位上的标签，不建独立实体。
7. 新建库位（单建）输入为：库区、货架号（数字）、层、位（选填）；编码由服务端生成。层与位的**纯数字段自动去掉前导零**，使 `01` 与 `1` 指向同一个库位而非产生两个编码；重复编码返回 409 `WAREHOUSE_BIN_ALREADY_EXISTS`。
8. 批量建位（2026-09-11 起）：调用方给出**布局意图**——库区、起始货架号、货架数量、每架层数，由服务端生成编码。例：库区 A、起始 1、数量 5、层数 4 → 20 个库位 `ZG-01-A01-1 … ZG-01-A05-4`。起始货架号使「续建 A06–A10」可无歧义表达。
9. 批量建位在插入前一次性校验**库内**重复编码并整体拒绝（409 + 冲突清单），不产生部分插入。库区筛选经 `GET /warehouses/:id/bins?zone=` 与 `GET /warehouses/:id/bins/zones`。
10. Excel 导入（`master-data-import.handlers.ts`）是例外路径：它提供**完整 bin_code**，服务端按原样存入，不对描述列做规范化，避免与文件给定的编码不一致。

## 7. 店仓绑定

1. Store N:M Warehouse，通过 `store_warehouse_bindings`；禁止 `warehouse.store_id`。
2. 履约模式规范值：`OZON_RFBS/OZON_FBS/OZON_FBO/OZON_FBP/WB_FBS/WB_FBW/YANDEX_FBS/YANDEX_FBY`（typed constant，数据库 VARCHAR）。
   另有**一层仅用于展示的业务类别**（决策 `docs/decisions/0009`，不落库，由模式派生）：`自管仓 SELF_MANAGED = RFBS/FBS`、`半托管 SEMI_MANAGED = FBP`、`托管仓 MANAGED = FBO/FBW/FBY`。
   存储值必须保持平台专属：`orders.md §4.6` 的"非 FBO 优先"由 `fulfillmentMode.includes('FBO')` 实现，改成通用枚举会使该冻结规则静默失效（AGENTS.md §97）。
   新增平台时：常量表加值 + 类别映射加一行，前端自动生效。
3. Service 层校验（不在数据库硬编码）：
   - 履约模式前缀平台 === 店铺平台（WB 店铺 + OZON_FBO 拒绝，`STORE_WAREHOUSE_BINDING_INVALID`）；**前端下拉框按店铺平台过滤可选模式**；
   - 仓库类型匹配：FBO/FBY/FBW → PLATFORM 仓；FBS/RFBS/FBP → SELF/THIRD_PARTY 仓。
4. 平台履约语义只存在于 Binding/Adapter/常量，不得进入 Inventory Core（AGENTS.md §31）。

## 8. Listing 与映射（AGENTS.md 冻结规则 §101）

1. Listing 唯一键：`store_id + platform_product_id`。
2. 必须允许：一个 Internal SKU → 多平台 → 多店铺 → 多 Listing；同一 Store 同一 SKU → 多个商品链接。禁止 `UNIQUE(sku_id, store_id)`。
3. 一个 Listing 可含多个变体（PlatformListingSku）映射不同 Internal SKU。

Sprint 5 起，平台同步会产生**未映射**的平台 SKU 事实：

4. `platform_listing_skus.sku_id` 可空；`mapping_status ∈ {UNMAPPED, MAPPED}`。
5. 平台同步 upsert 规则：按 `(listing_id, platform_sku_id)` 查找——存在则仅刷新平台事实（offer_id / seller_sku / raw_data），**绝不触碰 sku_id 与 mapping_status**（人工映射永不被同步覆盖）；不存在则插入 `sku_id = NULL, mapping_status = 'UNMAPPED'` 的行。
6. Resolver 只解析 `sku_id IS NOT NULL AND mapping_status = 'MAPPED'` 的 ACTIVE 行；UNMAPPED 行参与订单解析时按既有规则产生 `ORDER_SKU_MAPPING_FAILED`。
7. 人工映射入口：`POST /listings/:listingId/skus/:mappingId/map {skuId}`（UNMAPPED → MAPPED，记 Operation Log）。
8. 严禁自动猜测映射（名字相似/条码一致都不是依据）。
9. `platform_listings.last_seen_at` 记录最近一次被 Listing Sync 观察到的时间；同步未见到某 listing **不做**任何自动下架/删除。

## 9. Listing Resolver（订单安全边界）

`ListingResolverService.resolveInternalSku({ storeId, platformSkuId?, sellerSku?, offerId? })`：

1. 解析查询必须携带 `storeId`（Repository 层结构性保证，全局查找不可能发生）。
2. 提供 0 个标识 → `LISTING_SKU_RESOLVE_FAILED`。
3. 0 候选 → `LISTING_SKU_RESOLVE_FAILED`（订单阶段转 `ORDER_SKU_MAPPING_FAILED`）。
4. 同 Store 内 >1 候选 → `LISTING_SKU_RESOLVE_AMBIGUOUS`；禁止"取第一条"。
5. 匹配语义：任一提供的标识命中即视为候选（OR），歧义判定覆盖全部候选。

## 10. Excel 导入

1. 固定模板（无字段拖拽映射）：SKU / BARCODE / WAREHOUSE / BIN / LISTING_MAPPING。
2. 流程：上传（存 MinIO）→ 同步解析+校验（错误精确到 row/field/code）→ 显式确认 → BullMQ worker（`wcies.import`）执行导入；单行失败不阻塞整批。
3. 唯一业务键（sku_code/barcode/warehouse_code 等）重复时 **Reject 并报告**，绝不静默覆盖（task §61）。
4. SKU 模板中 `product_code` 引用已有商品；不存在时若提供 `product_name_zh` 则一并创建。

## 11. 审计

以下写操作记录 `operation_logs`：Product、SKU、Barcode、Store、Credential（不含 Secret）、Warehouse、Bin、StoreWarehouseBinding、Listing、ListingSkuMapping、ImportJob。

## 12. 错误码（Sprint 1 集）

`PRODUCT_NOT_FOUND`、`PRODUCT_CODE_ALREADY_EXISTS`、`SKU_NOT_FOUND`、`SKU_CODE_ALREADY_EXISTS`、`SKU_BARCODE_ALREADY_EXISTS`、`BRAND_NOT_FOUND`、`CATEGORY_NOT_FOUND`、`PLATFORM_NOT_FOUND`、`STORE_NOT_FOUND`、`STORE_CODE_ALREADY_EXISTS`、`WAREHOUSE_NOT_FOUND`、`WAREHOUSE_CODE_ALREADY_EXISTS`、`WAREHOUSE_BIN_ALREADY_EXISTS`、`STORE_WAREHOUSE_BINDING_INVALID`、`LISTING_NOT_FOUND`、`LISTING_ALREADY_EXISTS`、`LISTING_SKU_MAPPING_NOT_FOUND`、`LISTING_SKU_RESOLVE_FAILED`、`LISTING_SKU_RESOLVE_AMBIGUOUS`、`FILE_INVALID_TYPE`、`IMPORT_VALIDATION_FAILED` 及过程码（`SKU_DIMENSIONS_INVALID`、`CREDENTIAL_ALREADY_EXISTS` 等）。

Sprint 6 新增（T2/T3/T4，2026-09-11）：

- 删除保护（决策 0003）：`WAREHOUSE_IN_USE`、`BIN_IN_USE`、`STORE_IN_USE`、`BINDING_IN_USE`、`BRAND_IN_USE`、`CATEGORY_IN_USE`、`PRODUCT_IN_USE`、`SKU_IN_USE`、`LISTING_IN_USE`、`LISTING_SKU_MAPPING_IN_USE`。
- 分类层级（决策 0005）：`CATEGORY_DEPTH_EXCEEDED`、`CATEGORY_LEVEL_INVALID`、`CATEGORY_NAME_DUPLICATED`、`CATEGORY_HAS_CHILDREN`。

## 13. 修改本文档的条件

变更以下内容必须先改文档：编码规则、状态模型、条码唯一性、体积计算、履约模式集合或匹配规则、Listing 唯一性、Resolver 语义、导入模板或重复处理策略。

## 14. 分类层级（三级）

> 2026-09-11 起按决策 `docs/decisions/0005` 执行。

1. 分类树**最多三级**：`level ∈ {1,2,3}`，数据库 CHECK 兜底（`level BETWEEN 1 AND 3` 且 `(level = 1) = (parent_id IS NULL)`），任何代码路径不可绕过。
2. 商品分类**选填**；填则该分类必须为三级（`CATEGORY_LEVEL_INVALID`）。
3. **同父下名称唯一**（含根级之间）：唯一索引 `(parent_id, lower(name_zh)) NULLS NOT DISTINCT`；服务层预检给友好提示（`CATEGORY_NAME_DUPLICATED`）；跨父允许同名。
4. 创建/改父时计算**整棵子树最终深度**，超过三级拒绝（`CATEGORY_DEPTH_EXCEEDED`）；`level` 随改父在同一事务内整棵子树更新。
5. 已有商品的节点移动后不再是三级 → 拒绝（`CATEGORY_LEVEL_INVALID`）。
6. 停用不级联子节点；停用节点及其子树在商品表单不可选，数据库层级与商品挂载关系不变，重新启用即恢复。
7. 删除：有子节点 → `CATEGORY_HAS_CHILDREN`；有商品 → `CATEGORY_IN_USE`；零引用 → 真删。
8. 分类编码 `CN%05d`，一/二/三级共用一条序列，编码不出现在前端表单。
9. `GET /products?categoryId=` 为**含子树**筛选（递归 CTE），选一/二级分类能查出其下三级分类的商品。
10. 品牌命名（决策 `docs/decisions/0006`）：`name`（一般名称，必填，主显示名）/ `name_zh`（中文名，可空）/ `name_en` / `name_ru`；全站默认显示一般名称。
