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
| 内部条码 | `barcode`(INTERNAL) | PG sequence，6 位纯数字 `%06d`（决策 0019；旧 `WCSKU%08d`/`W%08d` 已由迁移 20261009_001 统一转换） | 现有 sequence | — |
| Bin 条码 | `barcode` | `BIN-{warehouseCode}-{binCode}` | — | 可 |
| Supplier（Sprint 7） | `code` | `SUP%04d`，如 `SUP0001` | `supplier` | 创建时可留空自动生成；创建后不可改 |
| 采购单（Sprint 7） | `po_no` | `PO%06d`，如 `PO000001` | `purchase_order` | 服务端生成，不可改 |
| 收货单（Sprint 7） | `receipt_no` | `PR%06d`，如 `PR000001` | `purchase_receipt` | 服务端生成，不可改 |

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
4. **内部条码格式**（决策 0019，2026-10-09）：**6 位纯数字** `%06d`，如 `000014`，由 PG sequence `seq_internal_barcode` 取号；宽度是最小宽度，序号溢出（>999999）自然进位。真实 EAN/GTIN 为 8–13 位，6 位内部条码不会在扫码层与之混淆。
   - 历史格式 `WCSKU%08d` / `W%08d` 已由**迁移 `20261009_001` 统一转换**为 6 位（数字部分原样保留，单射转换；冲突即报错中止）。此决策取代 0017 的"不迁移"立场——用户明确要求更正存量数据，旧标签实物重印处理。人工录入的非系统格式 INTERNAL 条码不受影响。
   - 打印载体仍是 Code128（决策 0007）；纯数字可走 Code128 子集 C（每 2 位数字 11 模块），符号宽度比 `W%08d` 再缩短约一半。
   - **SKU 标签不打印 SKU 编码**（2026-10-09）：标签内容 = SKU 名称（可选）+ 条码符号 + 条码值；打印契约 `SkuLabelTask.payload` 已无 `skuCode` 字段。
   - 生成入口只有两处（常规 `POST /skus/:id/barcodes/generate-internal` 与建档事务内的 `generateInternalInTx`），两者必须共用同一格式化函数（`formatInternalBarcode`），禁止各自拼串。

## 4. SKU 物理属性

1. `volume_cm3` 只能由后端计算（长×宽×高），前端/API 均不可写入。
2. 长宽高必须"全有或全无"，保证体积可推导。
3. `latest_purchase_price` 允许人工维护（本 Sprint 不自动更新）。
4. `moving_average_cost`（移动加权平均成本）自 Sprint 7 起由**收货确认**维护
   （决策 0013 §6，原「预留字段，恒为 NULL」作废）：
   - 确认收货时 `新平均成本 = (原平均成本 × 原在库数量 + 本次单位成本 × 本次数量) / (原在库数量 + 本次数量)`；
   - 原值为 NULL 时以本次单位成本为新平均成本；明细 `unit_cost` 为空不更新；
   - 数量取该 SKU 全仓 on_hand 合计；NUMERIC 运算保留 4 位小数；
   - 除收货确认外任何路径不得写该字段（人工也不得改，保证与收货事实一致）。
4. `serial_tracking` 仅是配置；`inventory_serials` 属于库存 Sprint。

## 5. 平台 / 店铺 / 凭证

1. Platform 为系统级主数据（Migration 种子：OZON/WB/YANDEX），普通用户只读。
2. Store 唯一键：`platform_id + store_code`；不同平台允许相同 store_code。
3. Credential 与 Store 严格分离；一个 Store 每个 `credential_type` 至多一条。
4. 凭证安全：AES-256-GCM（Sprint 0 `CredentialEncryptionService`）；API 永不返回密文/明文；Operation Log 只记录元数据；写操作仅管理员。
5. Credential 生命周期（2026-09-11 起）：可创建、**可替换密钥**（`PATCH .../credentials/:id` 重新加密）、可停用/启用（保留已存密钥，无需重录）、**可删除**。删除不适用"零引用"限制——订单与库存引用的是**店铺**而非凭证，凭证本身没有业务引用方，故录错的密钥允许删除后重录。

## 6. 仓库 / 库位

1. Warehouse Type：`SELF / SEMI_MANAGED / PLATFORM / THIRD_PARTY / RETURN_TEMP`（无 VIRTUAL，无 Warehouse Group）。SEMI_MANAGED（半托管，编码前缀 BT）2026-09-17 加入，对应 OZON FBP 模式。
2. 库位唯一键：`warehouse_id + bin_code`；不同仓库允许相同 bin_code。
3. Bin 表禁止 `sku_id` 列：SKU↔Bin 是 N:M，经库存记录关联（inventory.md §54）。
4. 库位编码格式（2026-09-11 起，决策 0010）：`{仓库编码}-{货架}-{层}[-{位}]`，如 `ZG-01-A05-1`。货架号**至少补零两位**（保证字典序 = 实地行走顺序）；层号不补零；仓库编码前缀一并写入，使标签离仓后仍可辨认归属。编码写入后不可修改（`UpdateBinRequestDto` 不含 `binCode`）。
5. **条码 = 编码**：`barcode` 与 `bin_code` 存同一字符串。拣货、拦截、导入解析库位时一律按 `bin_code` 匹配（`findByWarehouseAndCode`），因此标签必须印编码本身——印成别的字符串扫码将无法识别。标签条码规格需用 Code128 或二维码（含字母与连字符，非纯数字，不能用 EAN-13）。
6. **货架 = 库区 + 货架号**（决策 0011）：货架编码由库区前缀与补零货架号组合而成（区 `A` + 号 `3` → `A03`）。**单建与批量两条路径共用服务端同一组合规则**（`formatRack`），因此同一份「库区 A」在任一入口都得到 `A01`，不会出现「库区 A + 货架 C01」这类自相矛盾的输入。`zone` 只是库位上的标签，不建独立实体。
7. 新建库位（单建）输入为：库区、货架号（数字）、层、位（选填）；编码由服务端生成。层与位的**纯数字段自动去掉前导零**，使 `01` 与 `1` 指向同一个库位而非产生两个编码；重复编码返回 409 `WAREHOUSE_BIN_ALREADY_EXISTS`。
8. 批量建位（2026-09-11 起）：调用方给出**布局意图**——库区、起始货架号、货架数量、每架层数，由服务端生成编码。例：库区 A、起始 1、数量 5、层数 4 → 20 个库位 `ZG-01-A01-1 … ZG-01-A05-4`。起始货架号使「续建 A06–A10」可无歧义表达。
9. 批量建位在插入前一次性校验**库内**重复编码并整体拒绝（409 + 冲突清单），不产生部分插入。库区筛选经 `GET /warehouses/:id/bins?zone=` 与 `GET /warehouses/:id/bins/zones`。
10. Excel 导入（`master-data-import.handlers.ts`）是例外路径：它提供**完整 bin_code**，服务端按原样存入，不对描述列做规范化，避免与文件给定的编码不一致。
11. **批量删除（2026-09-28 起，用户指示）**：`POST /warehouses/:id/bins/batch-delete`
    （body `binIds[]`，1~2000 个，自动去重）。逐个执行与单删完全相同的零引用
    规则（decision 0003）：被引用（`BIN_IN_USE`）/不存在/不属于该仓库的库位
    **跳过并逐条返回原因，部分成功**，绝不整批回滚——清理布局时一条被引用
    的库位不阻塞其余。每个成功删除照常写独立 DELETE 操作日志，另记一条
    BATCH_DELETE 汇总（deleted/failed 计数）。

## 7. 仓库绑定平台仓库（2026-09-17 重构，取代店仓绑定）

> 本节由原「店仓绑定」重构而来（用户指示 2026-09-17）：绑定主体不再是
> 店铺↔仓库，而是**物理仓库 ↔ 平台仓库**（如 OZON `warehouse_id
> 1020005000770362`）。平台仓库永远归属某个店铺，因此同一物理仓库可通过
> 多条绑定服务多个店铺的多平台仓库。

1. 数据模型：`warehouse_platform_bindings`（`warehouse_id + store_id +
   platform_warehouse_id + platform_warehouse_name + fulfillment_mode +
   remark_name + priority + status`）。唯一键 `store_id +
   platform_warehouse_id`——一个平台仓库至多映射到一个内部仓库。
   旧表 `store_warehouse_bindings` 已移除（Migration
   20260917_005/006：含平台仓库 ID 的旧绑定行已搬运，其余不迁移）。
2. 履约模式规范值：`OZON_RFBS/OZON_FBS/OZON_FBO/OZON_FBP/WB_FBS/WB_FBW/
   YANDEX_FBS/YANDEX_FBY`（typed constant，数据库 VARCHAR）。
   业务类别仅用于展示（决策 0009，不落库）：`自管仓 SELF_MANAGED =
   RFBS/FBS`、`半托管 SEMI_MANAGED = FBP`、`托管仓 MANAGED = FBO/FBW/FBY`。
3. **仓库类型 ↔ 履约模式兼容**（Service 层校验，`WAREHOUSE_PLATFORM_BINDING_INVALID`）：
   - 自管模式（rFBS/FBS）→ `SELF / THIRD_PARTY` 仓库；
   - FBP → `SEMI_MANAGED`（半托管）仓库；
   - FBO/FBW/FBY → `PLATFORM`（托管仓）仓库；
   - 履约模式平台必须与店铺平台一致（WB 店铺 + OZON_FBO 拒绝）。
4. **托管仓（PLATFORM）只能绑定一个平台仓库**（用户指示 2026-09-17）。
5. 平台仓库目录实时查询平台 API（不落地缓存，绑定快照存表）：
   - OZON：`/v2/warehouse/list`（is_rfbs 区分 rFBS/FBS）、
     `/v1/fbp/warehouse/list`（FBP）、`/v1/warehouse/ozon/list`
     （FBO，FULL_FILLMENT 过滤）；见 `docs/integrations/ozon.md`。
   - 其它平台返回 `PLATFORM_WAREHOUSE_QUERY_UNSUPPORTED`。
6. 订单摄入解析仓库：店铺 → ACTIVE 绑定（priority ASC，非 FBO 优先，
   orders.md §4.6）→ 内部仓库。不再有 is_inventory_source 开关——
   ACTIVE 绑定即库存来源候选。
7. 平台履约语义只存在于 Binding/Adapter/常量，不得进入 Inventory Core
   （AGENTS.md §31）。

## 8. Listing 与映射（AGENTS.md 冻结规则 §101）

1. Listing 唯一键：`store_id + platform_product_id`。
2. 必须允许：一个 Internal SKU → 多平台 → 多店铺 → 多 Listing；同一 Store 同一 SKU → 多个商品链接。禁止 `UNIQUE(sku_id, store_id)`。
3. 一个 Listing 可含多个变体（PlatformListingSku）映射不同 Internal SKU。

Sprint 5 起，平台同步会产生**未映射**的平台 SKU 事实：

4. `platform_listing_skus.sku_id` 可空；`mapping_status ∈ {UNMAPPED, MAPPED}`。
5. 平台同步 upsert 规则：按 `(listing_id, platform_sku_id)` 查找——存在则仅刷新平台事实（offer_id / seller_sku / raw_data），**绝不触碰 sku_id 与 mapping_status**（人工映射永不被同步覆盖）；不存在则插入 `sku_id = NULL, mapping_status = 'UNMAPPED'` 的行。
6. Resolver 只解析 `sku_id IS NOT NULL AND mapping_status = 'MAPPED'` 的 ACTIVE 行；UNMAPPED 行参与订单解析时按既有规则产生 `ORDER_SKU_MAPPING_FAILED`。
7. 人工映射入口：`POST /listings/:listingId/skus/:mappingId/map {skuId}`（UNMAPPED → MAPPED，记 Operation Log）。
8. **映射必须携带平台标识**（决策 0012，2026-09-11；决策 0016 收紧，2026-09-14）：创建变体映射时 `platform_sku_id / seller_sku` **至少填一个**，纯 Offer ID 或三个全空返回 422 `LISTING_SKU_MAPPING_IDENTIFIER_REQUIRED`，文案「至少填写 Platform SKU ID 或 Seller SKU；Offer ID 可被运营修改，不作为订单解析依据」。原因：订单解析只认 `platform_sku_id / seller_sku`（见 §9），`offer_id` 可被运营在平台侧随时修改，按它解析会在改名后静默失配。判定顺序上「同一 SKU 已映射到该 Listing」（409）优先于本规则。`offer_id` 仍照常入库、展示、导出，仅**不参与解析与绑定**（决策 0016）。
   - 平台已同步的商品**不要用「新建映射」**：该 Listing 已存在，新建会因唯一键冲突失败；正确做法是在该 Listing 详情里对已同步的未映射变体做「人工映射」，这样映射自带平台标识。
9. 严禁自动猜测映射（名字相似/条码一致都不是依据）。
10. `platform_listings.last_seen_at` 记录最近一次被 Listing Sync 观察到的时间；同步未见到某 listing **不做**任何自动下架/删除。
11. **Listing 级映射状态的唯一定义**（2026-09-11）：当且仅当该 Listing 存在至少一个 `status = ACTIVE` 且 `mapping_status = 'MAPPED'` 且 `sku_id IS NOT NULL` 的变体时，该 Listing 为 **MAPPED（已映射）**，否则为 **UNMAPPED（未映射）**。
    - 该判定在列表行（`mappingStatus` 字段）、列表筛选（`mappingState`）、详情响应三处**共用同一条件**，不得各写一份——否则会出现「同一页面行显示未映射、而它上方的未映射计数为 0」这类自相矛盾（2026-09-11 实测到的缺陷）。
    - `mappingCount` 语义：该 Listing 的**变体映射总数（含未映射行）**，与「已映射数量」不是同一个数，界面文案需区分。
    - 确定性说明：因为没有 `mappingId` 直接绑定 SKU 时会先落 UNMAPPED 行再人工映射，`sku_id IS NOT NULL` 与 `mapping_status = 'MAPPED'` 在现有写路径下同真同假；两者都写进条件是防御性的，使未来新增写路径不会静默改变判定。

Sprint 8 起（2026-09-12，规划 §T1/T2/T3）：

12. **快捷建档**：`POST /listings/:listingId/skus/:mappingId/onboard`。一个数据库事务内创建 Product + SKU +（可选）内部条码，并把该变体绑定为 MAPPED；任一步失败**整体回滚**，不存在「建了 SKU 但没映射」的半成品。编码沿用集中序号（`PN%06d` / `SKU{9}` / `W%08d`（决策 0017；历史行可能仍是 `WCSKU%08d`），不新增规则）；商品名/SKU 名默认取 `listing.title`，两者最终都为空 → 422 `LISTING_ONBOARD_NAME_REQUIRED`。只允许从 **UNMAPPED** 变体发起（已映射变体返回 409 `LISTING_SKU_MAPPING_INVALID_STATE`）。条码为该 SKU 首条码时自动为主条码。审计在各实体写入成功（提交后）记录，Action 含 `CREATE`（product/sku/barcode）与 `MAP`。

Sprint 8.5 起（2026-09-14，决策 0014/0015）——快捷建档增强：

13. **并发语义（决策 0014）**：onboard 事务**开头**对 mapping 行 `SELECT … FOR UPDATE`，「检查 → 建档 → 映射」全程串行化；并发双请求仅一成功，另一在锁释放后 re-check 失败得到同一个 409，**不产生任何主数据孤儿**。重复提交语义保持 409，不做幂等成功。
14. **多变体挂靠（决策 0014）**：同一 Listing 的后续变体**默认挂靠**该 Listing 首个已建档变体的 Product（`nextSkuCode` 顺延 SKU002/003…，无新编码规则）；弹窗可显式切换「另建新商品」（DTO `createNewProduct: true`）或指定挂靠目标（`existingProductId`，不存在 → 404 `PRODUCT_NOT_FOUND`）。挂靠时不改动已有 Product 的品牌/分类档案。
15. **新增建档字段**：
    - 品牌 `brandId?`（人工 Select + 现场快建，复用常规品牌存在性校验；**不做**自动提取）；
    - 分类 `categoryId?`（必须三级，复用 `CATEGORY_LEVEL_INVALID` 校验）；
    - 尺寸/重量 `lengthMm/widthMm/heightMm/weightG?`（可编辑预填；沿用全有或全无 + 体积后端计算规则）。
16. **DRAFT 标记语义**：快捷建档的 Product 停留 **DRAFT** 仅作「档案未补全」标记，**不阻断任何业务**（不阻断映射、订单解析、收发货）；可见性优化放 backlog。
17. **平台类目映射（决策 0015）**：`platform_category_mappings` 以 `(platform_id, external_category_id, external_type_id)` **复合键**精确映射内部三级分类；type 节点不携带自身 category id（T0 冒烟事实），复合键的 category 部分取其**父类目**。弹窗「记住此映射」（默认勾选）在 onboard **同一事务**内写映射行（source=ONBOARD），`ON CONFLICT DO NOTHING`——已有映射（树导入或更早的记住）永不被覆盖。**任何未命中都回退人工三级 Cascader 选择，绝不按名称相似度自动匹配**。
18. **OZON 类目树导入（决策 0015）**：手动同步 `/v1/description-category/tree`（ZH_HANS + RU 双语合并）到缓存表 `platform_category_nodes`（按 SyncJob 记录）；一键导入按「一级类目→内部一级、二级类目→内部二级、type→内部三级」1:1 直映（真实树恰好三层，T0 冒烟验证；更深层级跳过并列入预演报告），仅导入 `disabled=false`，dry-run 预演报告冲突清单（与现有分类按 `name_ru` 精确查重），存在**真冲突**时执行 **409 拒绝**（§89：先查重、歧义报错、禁止静默丢弃）；确认后**单事务**批量建类目（经 catalog 公开 Service，`CN%05d` 批量取号）+ 写映射行（source=TREE_IMPORT）。
    **同父同名候选的去重命名（2026-09-14 真实数据发现）**：真实树存在同父级下同名 type（全树 57 组），内部 `(parent_id, lower(name_zh))` 唯一索引不允许——导入时对第二及以后的同名候选**确定性追加外部 id 后缀**（如 `其他 (91543)`），首 个保留原名；每一处在预演报告 `disambiguatedNames` 中列出。不丢弃、不合并、复合键映射不受影响。
19. **SKU 图片（决策 0014）**：建档弹窗预览用 `raw_data.primary_image` CDN 直链；onboard 事务提交成功后入 BullMQ 异步转存 `color_image ?? primary_image` → 自有私有桶（`SkuImageService.upload` 通道）→ 首图 `isPrimary=true` → 首次回填 `products.main_image_id`（仅当为空）。图片失败自动重试，**不进建档事务**、不影响建档事实。
20. **LISTING_MAPPING 导入绑定同步行**：导入行落到**已存在**的 Listing 且平台标识（优先 `platform_sku_id`，其次 `seller_sku`）命中该 Listing 一条 ACTIVE 的 UNMAPPED 同步变体时，**绑定该行**（等价人工映射，sku_id 写入、置 MAPPED），**不插入重复变体行**。「相同映射（同 Listing 同 SKU）拒绝」与决策 0012/0016（至少一个**解析**标识：Platform SKU ID 或 Seller SKU）规则不变；`offer_id` 不是绑定标识（决策 0016），仅 offer 命中的行不绑定，走新建路径并按 0016 拒绝；未命中任何同步变体时维持原有新建行为。
21. **未映射工作台**（派生展示，不新增业务状态）：
    - `GET /listings/mapping-stats` 返回全局 MAPPED/UNMAPPED 计数，判定与第 11 条同一条件；
    - 列表行携带 `hasOrderException`（是否存在 OPEN 的 `ORDER_SKU_MAPPING_FAILED` 异常经订单行 `store + platform_product_id` 撞上该 Listing；2026-09-14 真实数据修正：OZON 订单行的 `platform_product_id` 实为 **sku id**，故命中条件同时比对 Listing 的 `platform_product_id` **与其变体的 `platform_sku_id`**）；
    - `mappingState=UNMAPPED` 筛选下，`hasOrderException` 的行**排序置顶**，其余按 `created_at DESC`。该标志不参与任何写路径判定。

Sprint 8.5R1 起（2026-09-14，人工验收修复；映射规则变更见决策 0016）：

22. **建档弹窗补最新采购价**：`latestPurchasePrice?`（NUMERIC，≥0）随 onboard 请求在同一事务写入 `skus.latest_purchase_price`。这是人工维护通道（§4.3）；移动加权平均成本仍**只由收货确认**维护（§4.4），两者互不覆盖。名称预填（商品名/SKU 名优先取当前变体的 Offer ID，无 Offer ID 回退 Listing 标题）属**前端预填行为**，后端缺省规则不变（仍取 `listing.title`）。
23. **类目树精简端点**：`GET /categories/tree-lite` 返回 `id/parentId/code/nameZh/nameRu/level/sortOrder/status/children`（SQL 列裁剪，去掉 `createdAt/updatedAt` 等），供商品 / SKU / Listing 三个页面的类目选择器与「分类管理」树消费；层级语义、排序（`sort_order, code`）与 `GET /categories` 完全一致。`GET /categories` 行为不变（向后兼容），两者共用同一建树实现以免形状漂移。
24. **映射解析不使用 Offer ID**（决策 0016）：见 §9 第 6 条。人工映射要求至少一个**解析标识**（Platform SKU ID 或 Seller SKU）；纯 Offer ID 被拒（422 文案见 §12）。`offer_id` 仍同步入库、列表展示、Excel 导出列保留、关键字搜索可命中，仅从解析/绑定链路移除。

## 9. Listing Resolver（订单安全边界）

`ListingResolverService.resolveInternalSku({ storeId, platformSkuId?, sellerSku? })`：

1. 解析查询必须携带 `storeId`（Repository 层结构性保证，全局查找不可能发生）。
2. 提供 0 个**解析标识** → `LISTING_SKU_RESOLVE_FAILED`。
3. 0 候选 → `LISTING_SKU_RESOLVE_FAILED`（订单阶段转 `ORDER_SKU_MAPPING_FAILED`）。
4. 同 Store 内 >1 候选 → `LISTING_SKU_RESOLVE_AMBIGUOUS`；禁止"取第一条"。
5. 匹配语义：任一提供的标识命中即视为候选（OR），歧义判定覆盖全部候选。
6. **解析标识只有 `platform_sku_id` 与 `seller_sku`**（决策 0016，2026-09-14）：`offer_id` 可被运营在平台侧修改，**不作为解析依据**（请求 DTO 已无该字段，历史请求带 `offerId` 时等同于未提供标识）。响应字段 `matchedOfferId` 保留但**恒为 null**（前端契约兼容）。Platform Product ID 维度由「Listing(store + platform_product_id) → 变体(platform_sku_id) → 内部 SKU」结构承载，不另开解析分支。

## 10. Excel 导入

1. 固定模板（无字段拖拽映射）：SKU / BARCODE / WAREHOUSE / BIN / LISTING_MAPPING。
2. 流程：上传（存 MinIO）→ 同步解析+校验（错误精确到 row/field/code）→ 显式确认 → BullMQ worker（`wcies.import`）执行导入；单行失败不阻塞整批。
3. 唯一业务键（sku_code/barcode/warehouse_code 等）重复时 **Reject 并报告**，绝不静默覆盖（task §61）。
4. SKU 模板中 `product_code` 引用已有商品；不存在时若提供 `product_name_zh` 则一并创建。

Sprint 8 起（2026-09-12，Excel 闭环补齐）：

5. **未映射清单导出**：`POST /listings/exports/unmapped`（可选 platformId/storeId 过滤）。导出**未映射的 ACTIVE 变体行**（非 Listing 行），列与 LISTING_MAPPING 模板**逐列一致**，`internal_sku_code` 留空待补填；已映射行默认不导出。文件走对象存储 + 短时效签名 URL 下载；现实规模约 1.3k 行，同步生成即可（BullMQ 只用于长任务）。
6. **模板下载**：`GET /imports/templates/:type`（SKU / LISTING_MAPPING），表头 + 一行示例；示例行上传校验会按行报错，防止被误导入。

## 11. 审计

以下写操作记录 `operation_logs`：Product、SKU、Barcode、Store、Credential（不含 Secret）、Warehouse、Bin、StoreWarehouseBinding、Listing、ListingSkuMapping、ImportJob、Supplier、PurchaseOrder、PurchaseReceipt（Sprint 7 起）。

## 12. 错误码（Sprint 1 集）

`PRODUCT_NOT_FOUND`、`PRODUCT_CODE_ALREADY_EXISTS`、`SKU_NOT_FOUND`、`SKU_CODE_ALREADY_EXISTS`、`SKU_BARCODE_ALREADY_EXISTS`、`BRAND_NOT_FOUND`、`CATEGORY_NOT_FOUND`、`PLATFORM_NOT_FOUND`、`STORE_NOT_FOUND`、`STORE_CODE_ALREADY_EXISTS`、`WAREHOUSE_NOT_FOUND`、`WAREHOUSE_CODE_ALREADY_EXISTS`、`WAREHOUSE_BIN_ALREADY_EXISTS`、`STORE_WAREHOUSE_BINDING_INVALID`、`LISTING_NOT_FOUND`、`LISTING_ALREADY_EXISTS`、`LISTING_SKU_MAPPING_NOT_FOUND`、`LISTING_SKU_RESOLVE_FAILED`、`LISTING_SKU_RESOLVE_AMBIGUOUS`、`FILE_INVALID_TYPE`、`IMPORT_VALIDATION_FAILED` 及过程码（`SKU_DIMENSIONS_INVALID`、`CREDENTIAL_ALREADY_EXISTS` 等）。

Sprint 6 新增（T2/T3/T4，2026-09-11）：

- 删除保护（决策 0003）：`WAREHOUSE_IN_USE`、`BIN_IN_USE`、`STORE_IN_USE`、`BINDING_IN_USE`、`BRAND_IN_USE`、`CATEGORY_IN_USE`、`PRODUCT_IN_USE`、`SKU_IN_USE`、`LISTING_IN_USE`、`LISTING_SKU_MAPPING_IN_USE`。
- 分类层级（决策 0005）：`CATEGORY_DEPTH_EXCEEDED`、`CATEGORY_LEVEL_INVALID`、`CATEGORY_NAME_DUPLICATED`、`CATEGORY_HAS_CHILDREN`。

Sprint 8 新增（2026-09-12）：

- 快捷建档：`LISTING_ONBOARD_NAME_REQUIRED`（422，无标题且未填名称）。
- 模板下载：`IMPORT_TEMPLATE_INVALID`（422，未知模板类型）。

Sprint 8.5 新增（2026-09-14）：

- 类目树未同步：`CATEGORY_TREE_NOT_SYNCED`（409，先在同步中心触发类目树同步）。
- 类目导入冲突：`CATEGORY_IMPORT_CONFLICTS`（409，details 携带冲突清单，禁止静默跳过）。
- 挂靠目标不存在：复用 `PRODUCT_NOT_FOUND`（404）。

Sprint 8.5R1 修订（2026-09-14）：

- `LISTING_SKU_MAPPING_IDENTIFIER_REQUIRED`（422）**文案收紧**：「至少填写 Platform SKU ID 或 Seller SKU；Offer ID 可被运营修改，不作为订单解析依据」——纯 Offer ID 与全空同样被拒（决策 0016）。错误码本身不变，既有调用方无需改判定。
- 新增只读端点 `GET /categories/tree-lite`（列裁剪类目树）；`GET /categories` 行为不变。

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
