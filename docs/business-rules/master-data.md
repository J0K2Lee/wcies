# WCIES Master Data Business Rules（Sprint 1）

> 本文档记录 Sprint 1 主数据层的业务规则。修改相关代码前先阅读并同步更新本文档（AGENTS.md §84/§86）。
>
> 本文只覆盖主数据；库存规则见 `inventory.md`，订单规则见 `orders.md`。

---

## 1. 编码规则

| 对象 | 编码 | 生成规则 | 可否人工修改 |
|---|---|---|---|
| Product | `product_code` | PostgreSQL sequence，`PRD%06d`（如 PRD000001） | 可（UUID 永不变） |
| SKU | `sku_code` | sequence，`SKU%06d` | 可（UUID 永不变） |
| 内部条码 | `barcode`(INTERNAL) | sequence，`WCSKU%08d` | — |
| Bin 条码 | `barcode` | `BIN-{warehouseCode}-{binCode}` | 可 |

所有业务编码全局唯一，由数据库 UNIQUE 约束兜底；并发分配使用数据库 sequence（原子）。

## 2. 状态模型

- Product/SKU：`DRAFT → ACTIVE ⇄ INACTIVE`；已被引用的主数据禁止物理删除，只允许停用。
- Store/Warehouse/Binding/Listing：`ACTIVE / INACTIVE(DISABLED)`；不提供硬 DELETE。
- 例外（spec §117）：无业务引用的 Barcode、SKU 图片、错误创建的数据允许物理删除。

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

## 6. 仓库 / 库位

1. Warehouse Type：`SELF / PLATFORM / THIRD_PARTY / RETURN_TEMP`（无 VIRTUAL，无 Warehouse Group）。
2. 库位唯一键：`warehouse_id + bin_code`；不同仓库允许相同 bin_code。
3. Bin 表禁止 `sku_id` 列：SKU↔Bin 是 N:M，经库存记录关联（inventory.md §54）。
4. 批量建位（Rack A01~A05 × Level 01~04）在后端校验文件内与库内重复后一次性插入。

## 7. 店仓绑定

1. Store N:M Warehouse，通过 `store_warehouse_bindings`；禁止 `warehouse.store_id`。
2. 履约模式规范值：`OZON_RFBS/OZON_FBS/OZON_FBO/OZON_FBP/WB_FBS/WB_FBW/YANDEX_FBS/YANDEX_FBY`（typed constant，数据库 VARCHAR）。
3. Service 层校验（不在数据库硬编码）：
   - 履约模式前缀平台 === 店铺平台（WB 店铺 + OZON_FBO 拒绝，`STORE_WAREHOUSE_BINDING_INVALID`）；
   - 仓库类型匹配：FBO/FBY/FBW → PLATFORM 仓；FBS/RFBS/FBP → SELF/THIRD_PARTY 仓。
4. 平台履约语义只存在于 Binding/Adapter/常量，不得进入 Inventory Core（AGENTS.md §31）。

## 8. Listing 与映射（AGENTS.md 冻结规则 §101）

1. Listing 唯一键：`store_id + platform_product_id`。
2. 必须允许：一个 Internal SKU → 多平台 → 多店铺 → 多 Listing；同一 Store 同一 SKU → 多个商品链接。禁止 `UNIQUE(sku_id, store_id)`。
3. 一个 Listing 可含多个变体（PlatformListingSku）映射不同 Internal SKU。
4. `platform_sku_id / seller_sku / offer_id` 只建普通索引；唯一约束待接入真实平台 API 后按平台语义收紧。
5. 所有平台 SKU 反查必须 Store Scoped（§26）。

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

## 13. 修改本文档的条件

变更以下内容必须先改文档：编码规则、状态模型、条码唯一性、体积计算、履约模式集合或匹配规则、Listing 唯一性、Resolver 语义、导入模板或重复处理策略。
