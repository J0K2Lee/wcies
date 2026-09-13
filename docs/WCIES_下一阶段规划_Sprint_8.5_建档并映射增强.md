# WCIES 下一阶段规划（Sprint 8.5：建档并映射增强）

> 依据：`AGENTS.md`、`docs/WCIES_下一阶段规划_Sprint_8_批量建档与映射补齐.md`、
> `docs/WCIES_下一阶段规划_Sprint_9_订单状态同步与运营闭环.md`、
> `docs/ozon-seller-openapi.json`（官方规范 v2.1，仓库内）字段级查证、
> 代码现状核查与 grilling 决策会话（2026-09-14，所有决策点已由用户逐项确认，见 §4）。
>
> 本文件是**规划 + 规格**。与 Sprint 8 规划不同，本版不存在待确认决策点——
> 全部决策已在 grilling 会话收敛并经用户确认；§4 是其定稿记录。
>
> 修订历史：
> - v1（本版）：Sprint 8 T1 快速建档的增强范围（grilling 会话共识定稿）

---

# 1. 现状盘点（有证据，非推测）

## 1.1 Sprint 8 已交付（提交 `20b4791`）

| 任务 | 内容 | 关键位置 |
|---|---|---|
| T1 | 快速建档并映射（单事务：Product → SKU → 可选条码 → 映射） | `listing-onboarding.service.ts:87-184`、`POST /listings/:listingId/skus/:id/onboard` |
| T2 | 未映射清单 Excel 导出（签名 URL） | `POST /listings/exports/unmapped` |
| T3 | 未映射工作台（计数 + 订单异常置顶） | `GET /listings/mapping-stats` |
| 测试 | unit 7 例 + 真实 PG integration 4 例（另 T2/T3 共 5 例） | `listing-onboarding.service.spec.ts`、`tests/integration/sprint8-onboarding.integration.spec.ts` |

## 1.2 快速建档的已知缺口（grilling 会话逐项确认）

| # | 缺口 | 证据 | 对应任务 |
|---|---|---|---|
| 1 | **多变体裂变**：每个变体建档都新建独立 Product，一条 5 变体 listing 建完出现 5 个互不相关 Product，违背 SPU 语义（AGENTS §23） | `product.service.ts:327-348` 每次调用必新建 Product | T2 |
| 2 | **并发 TOCTOU 窗口**：UNMAPPED 预检在事务外、事务内 re-check 是普通 SELECT（非 FOR UPDATE）、`platform_listing_skus` 无唯一约束兜底 → 双请求可各建一套主数据，后写覆盖先写，留下无映射孤儿 SKU | `listing-onboarding.service.ts:97-103`、`listing.service.ts:351-375`、`platform-listing-sku.entity.ts:19-24` | T1 |
| 3 | **类目空缺且无自动路径**：`raw_data` 里已存 `description_category_id`/`type_id`（同步原样入库，`ozon.mapper.ts:53`），但内部类目无平台映射、建档弹窗无类目字段 | `platform-listing-sku.entity.ts` raw_data、`categories` 表注释 "no platform mapping" | T3 |
| 4 | **无图片**：规范确认 v3 info/list 含 `primary_image`/`images`/`color_image`，已随 raw_data 入库但从未展示；`sku_images` 基建完整（`SkuImageService` + `products.main_image_id`）却用不上 | `docs/ozon-seller-openapi.json` schema `v3GetProductInfoListResponseItem`（已核对含全部图片字段） | T6 |
| 5 | **尺寸/重量缺失**：完整来源 `/v4/product/info/attributes`（depth/height/width + dimension_unit、weight + weight_unit）代码从未调用 | 规范 schema `productv4GetProductAttributesV4ResponseResult`；全仓无调用 | T5 |
| 6 | **品牌空缺**：弹窗无品牌字段；且 OZON 规范**无具名 brand 字段**（仅 attributes 泛化特征，无固定 attribute ID），自动提取链路长 | 规范全文核对；`ListingsPage.tsx:1313-1368` 表单仅 4 项 | T4 |
| 7 | **多变体连续操作重复劳动**：每次提交后手动关弹窗、找行、再点 | `ListingsPage.tsx:213-238` | T7 |
| 8 | 快速建档**尚未在真实数据上用过**（products/skus 各 1 条均为测试数据） | Sprint 9 规划 §现状 | T8 |

## 1.3 平台事实查证（2026-09-14，`docs/ozon-seller-openapi.json` 字段级核对）

| 事实 | 证据 | 状态 |
|---|---|---|
| `/v1/description-category/tree` 请求参数 `language` 枚举含 **`ZH_HANS`（简体中文）** | schema `languageLanguage`: `["DEFAULT","RU","EN","TR","ZH_HANS"]` | 规范确认，**真实中文质量待 T0 冒烟** |
| 树节点字段：`description_category_id` / `category_name` / `children` / `disabled` / `type_id` / `type_name` | schema `v1GetTreeResponseItem` | 规范确认 |
| `/v3/product/info/list` 响应含 `primary_image`、`images`、`color_image`、`description_category_id`、`type_id`、`volume_weight` | schema `v3GetProductInfoListResponseItem` 全字段核对 | 已随同步原样入 `raw_data`（`ozon.mapper.ts:62-65`） |
| `/v4/product/info/attributes` 含 `depth`/`height`/`width` + `dimension_unit`(mm/cm/in)、`weight` + `weight_unit`（规范未枚举取值） | schema `productv4GetProductAttributesV4ResponseResult` | 规范确认，**真实响应结构/单位实际取值待 T0 冒烟** |
| 品牌**无具名字段**，仅 `attributes[]` 泛化特征数组（需先查 `/v1/description-category/attribute` 特征元数据，且无固定品牌特征 ID） | 规范全文 grep | 本期**不做**品牌自动提取 |
| 当前代码仅调用 `/v3/product/list`、`/v3/product/info/list`、`/v3/posting/fbs/*` | `ozon.client.ts:83-147` | v4 与 tree 均未接入 |

> ⚠ 规范 ≠ 真实响应（AGENTS §88）。所有标「待冒烟」的事实未验证前，对应实现不得动工。

---

# 2. 核心判断

1. **靶子已经挂好**：Sprint 9 规划记录有 4 个 `ORDER_SKU_MAPPING_FAILED` OPEN 异常，
   正等着用快速建档走查清偿；但快速建档本身从未在真实数据上用过（§1.2 #8）。
   先把建档体验补到位，再走查，一次成功。
2. **类目是主要缺口，而成本恰好消失了**。原方案需要人工在俄语类目名下做映射
   （工作人员不识俄语），而规范证实 tree 接口**官方直出简体中文**（`ZH_HANS`）——
   「以 OZON 树为骨架一键生成内部三级类目 + 映射自动落库」的人工成本只剩
   一次导入确认。
3. **图片与尺寸重量的数据底座已经存在**：v3 响应（含图片）已在 `raw_data` 里躺着，
   建档弹窗展示图片是纯前端改动；v4 attributes 接入后，尺寸/重量在 FBO 推送
   （Sprint 10）之前就有了着落。
4. **数据模型债现在还便宜**：多变体裂变尚未产生真实脏数据（快速建档未实战），
   TOCTOU 窗口尚未被并发触发。趁未实战修复，不需要数据清洗。

---

# 3. Sprint 8.5 范围

> 模块归属约定（架构边界内，实施时如需微调须遵守 AGENTS §5/§9 依赖方向）：
> - 树缓存表与同步器 → `integration/ozon`（平台参考数据，按 SyncJob 记录）；
> - `platform_category_mappings` → `listing` 模块（与 `platform_listing_skus` 同域，onboarding 就近读取）；
> - 类目导入编排 → `listing` 模块编排服务，跨模块经 catalog 公开 Service 批量建类目（单事务），
>   **禁止**循环 HTTP POST、禁止跨模块 import Repository。

## T0 平台事实冒烟（先于一切平台相关实现）

1. **tree `ZH_HANS`**：真实中文质量抽查（人工判读）、树深度分布、节点总规模、
   `disabled` 分布。结论记入 `docs/integrations/ozon.md`（含验证日期，§87）。
2. **v4 attributes**：真实响应结构、`dimension_unit`/`weight_unit` 实际取值、
   批量 filter 行为与限流。同样记入 ozon.md。
3. **存量数据直查**（SQL，零 API）：1324 条 listing 的 `raw_data` 中
   `primary_image` 非空率、`description_category_id`/`type_id` 非空率。
4. **分支预案**：若 `ZH_HANS` 中文质量不可用 → 类目自动填充降级为
   「纯人工 Cascader + 记住此映射」，离线翻译管线另行立项再议（§6）；
   其余任务不受影响。

## T1 onboard 事务硬化

1. `ListingOnboardingService.onboard` 事务**开头**对 mapping 行
   `SELECT … FOR UPDATE`，把「检查 → 建档 → 映射」全程串行化。
2. 重复提交语义**保持 409** `LISTING_SKU_MAPPING_INVALID_STATE` 不变（并发双请求
   仅一成功，另一在锁释放后 re-check 失败，不产生任何主数据）。
3. 测试：真实 PG integration——并发双 onboard 仅一成功、无孤儿 Product/SKU。

## T2 多变体挂靠

1. 语义：同 listing **第一个**变体建档新建 Product；其余变体默认挂到该 listing
   已 onboard 的 Product 下（`nextSkuCode(productId)` 顺延 SKU002/003…，**无新编码规则**）。
2. 弹窗提供显式「另建新商品」切换（应对变体实为不同商品的脏数据）。
3. DTO 扩展：`existingProductId?`（缺省 = 自动挂靠/自动新建，按 listing 内
   是否已有 onboard 产物判定）。
4. 测试：一条多变体 listing 连续建档 → 断言 1 Product + N SKU + N MAPPED；
   显式另建 → 2 Product。

## T3 类目体系（本 Sprint 核心，新表 ×2）

### T3a 树同步（integration/ozon）

- 拉取 `/v1/description-category/tree` 两次（`language=ZH_HANS` + `language=RU`），
  按 `description_category_id`/`type_id` 合并双语名。
- 落缓存表 `platform_category_nodes`：`platform_id`（泛化，本期仅 OZON）、
  `external_category_id`、`external_type_id`、`name_zh`、`name_ru`、父引用、
  `disabled`、`fetched_at`。手动触发，本期不做定时再同步。
- 按 SyncJob 体系记录（AGENTS §43/§44，不做无记录同步）。

### T3b 一键导入（dry-run → 确认 → 单事务批量）

1. **dry-run 预演报告**（不落库）：节点总数与建树预览、层级塌缩明细
   （见下）、与现有 `categories` 按 `name_ru` 精确查重的冲突清单、歧义报错
   （AGENTS §89：先查重、歧义报错、禁止静默丢弃）。
2. **层级塌缩规则**（内部表硬性 1..3 级，DB CHECK）：
   L1 = OZON 顶级类目；L2 = type 的直接父类目；L3 = type（`type_name`）。
   OZON 更深的中间层级跳过，跳过项在预演报告中列出。
3. **粒度：全保真**——OZON type 逐个建为内部三级类目（用户已确认接受千级
   节点量级，前端 Cascader 配搜索）。
4. 确认后**单事务**批量：建 `categories`（`name_zh`=中文名、`name_ru`=俄语原名、
   `code` 自动生成、仅导入 `disabled=false`）+ 写 `platform_category_mappings`
   （`(external_category_id, external_type_id) → internal_category_id`）。
   建类目经 catalog 模块公开 Service（复用常规 level===3 校验），不循环 HTTP。
5. 既有 categories 数据当前接近空（仅测试数据）；导入按新树处理，预演报告
   负责暴露任何真实冲突。

### T3c 建档弹窗类目填充

- 从 `raw_data` 读 `(description_category_id, type_id)` → **复合键精确匹配**
  映射表：命中 → 内部类目自动选中（可改）；未命中 → 空 + 提示「该 OZON 类目
  尚未映射」，人工用三级 Cascader 选择。
- 「记住此映射」勾选（默认勾）：提交时在 onboard 同一事务内写映射表，
  同类目后续 listing 全部自动命中。
- 永不猜测：任何未命中都回退人工路径，不按名称相似度自动匹配。

## T4 弹窗品牌字段

- 品牌 Select（showSearch）+ 搜不到现场快建（`POST /brands`），
  完全复用 `ProductsPage.tsx:1010-1041` 既有模式；人工选择，不做自动提取。
- DTO 扩展 `brandId?`，`createForOnboardingInTx` 复用常规品牌存在性校验。

## T5 v4 attributes enrichment + 尺寸/重量预填

1. BullMQ 任务按 Store 批量调用 `/v4/product/info/attributes`
   （沿用 `PRODUCT_INFO_BATCH` 批量模式与限流节奏），结果**原样**并入
   `platform_listing_skus.raw_data`（新增独立键，如 `product_attributes`，
   不覆写既有键）。按 SyncJob 记录。
2. 建档弹窗预填**可编辑**的尺寸/重量：`mm/cm/in → 整数 mm`、weight → g
   （单位实际取值以 T0 冒烟为准）；`volume_mm3` 沿用后端重算，前端不可写。
3. 未同步/字段缺失 → 留空不阻断。

## T6 SKU 图片

1. **弹窗预览**：`raw_data.product_info.primary_image` CDN 直链，纯前端展示。
2. **异步转存**：onboard 事务提交成功后入 BullMQ——下载
   `color_image ?? primary_image` → `SkuImageService.upload()`
   （现有 ObjectStorageService 通道，私有桶）→ `isPrimary=true` →
   首次回填 `products.main_image_id`。
3. 失败自动重试；**不进建档事务**，图片失败不影响建档事实；不在事务内做
   任何外部 HTTP 下载。

## T7 保存并下一变体

- 提交成功面板提供「保存并下一变体」：同 listing 仍有 UNMAPPED 变体 →
  直开下一个（Product 锁定挂靠、类目/品牌/条码开关沿用、名称预填变体信息）；
  无 → 提示完成。纯前端，无新接口。

## T8 验收走查（真实数据）

沿用 Sprint 9 挂起的 4 个 `ORDER_SKU_MAPPING_FAILED` OPEN 异常：

```text
1. 类目导入验收：dry-run 报告 → 确认导入
       ↓ 断言 三级结构 / name_zh 中文名 / name_ru 原名 / 映射行数与预演一致
2. 对异常 listing 点「建档并映射」
       ↓ 断言 弹窗显示商品图 + 类目自动选中 + 提交后 SKU 首图异步落桶
3. 变体 listing 连续「保存并下一变体」建完
       ↓ 断言 1 Product + N SKU，无裂变
4. 订单行「重试解析」→ MAPPED + BACKORDERED
5. 登记采购 → 扫码收货（贴刚打印的条码）→ 重试分配 → 拣货 → 发货
       ↓ 断言 与 Sprint 8 T5 走查一致（该环节主责仍在 Sprint 9）
```

---

# 4. 决策记录（grilling 会话 2026-09-14，用户逐项确认，不再开放）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 多变体语义 | 同 listing 后续变体**默认挂已有 Product**，弹窗可切换「另建新商品」 |
| 2 | 并发/重复提交 | mapping 行 `FOR UPDATE` 锁行；重复提交**保持 409**，不做幂等成功 |
| 3 | 映射基数 | **允许多平台变体 → 同一 Internal SKU**（人工映射路径），不拦截不加约束 |
| 4 | DRAFT 语义 | Product 停留 DRAFT **仅作「档案未补全」标记，不阻断任何业务**；可见性放 backlog |
| 5 | 类目自动填充 | 弹窗内「选择并记住」；后续升级为 **OZON 树一键导入**（见 #9） |
| 6 | 尺寸/重量 | **本期就做**自动预填（用户否决了后移方案） |
| 7 | v4 调用时机 | **后台 BullMQ enrichment 预落库**，建档只读库；不做弹窗实时调平台 |
| 8 | 品牌 | 人工 Select + 快建；**不做**自动提取（数据底座随 enrichment 入库，将来增量做） |
| 9 | 类目导入粒度 | **全保真：type → 三级类目**，接受千级节点量级；`ZH_HANS` 官方中文直出，不做翻译管线 |
| 10 | SKU 图片 | **异步转存**自有桶（`color_image ?? primary_image`）；弹窗预览用 CDN 直链 |
| 11 | Sprint 归属 | **单开 Sprint 8.5**；Sprint 9 主线（订单状态同步）保持聚焦 |

> 被取代的中间结论：早期「映射键仅用 `description_category_id`、`type_id` 建列备用」
> 在 #9 全保真确定后**升级为 `(category_id, type_id)` 复合键精确匹配**，以 §3 T3c 为准。

---

# 5. 业务规则与文档连带变更

| 文档 | 变更 |
|---|---|
| `docs/business-rules/master-data.md` | par12 快捷建档规则重写：挂靠语义、新增字段（类目/品牌/尺寸重量/图片）、409 并发语义、DRAFT 标记语义、图片异步转存；**新增规则**：多变体→同一 SKU 允许、DRAFT 不阻断 |
| `docs/decisions/0014-*` | 建档增强语义：多变体挂靠 + FOR UPDATE 并发 + 异步图片（ADR，编号顺延） |
| `docs/decisions/0015-*` | 类目体系：OZON 树导入、`platform_category_nodes`/`platform_category_mappings`、复合键映射（ADR） |
| `docs/integrations/ozon.md` | T0 冒烟后补记：tree（含 ZH_HANS）与 v4 attributes 的 Endpoint/分页/限流/已知坑/验证日期（§87） |
| `docs/WCIES_下一阶段规划_Sprint_9_*.md` | 补一行交叉引用：建档增强移至 Sprint 8.5，其走查的「建档」环节以增强版执行 |
| `AGENTS.md` | **不改**——无架构级变更，两张新表均在现有模块边界内 |

---

# 6. 本 Sprint 不做的事

1. **不做独立类目映射管理页**——弹窗「记住此映射」+ 一键导入已覆盖，管理页按需后移。
2. **不做品牌自动提取**（v4 attributes 特征元数据匹配）——底座本期已入库，提取逻辑另行立项。
3. **不做跨 listing 连续建档队列**——1323 存量清偿主通道仍是 Sprint 8 T2 的 Excel 闭环。
4. **不做 ZH_HANS 失败后的离线翻译管线**——仅当 T0 冒烟失败才立项再议。
5. **不做树定时自动再同步**——树变更低频，手动触发；后续可加。
6. **不动 Inventory Core**——建档仍不创建任何库存余额（沿 Sprint 8 语义，NO_INVENTORY_RECORD ≠ 0，§20）。
7. **不新增业务状态枚举**、**不做渠道推送/任何平台写操作**（Sprint 10 且需专项确认）。
8. **不做标题相似度自动映射建议**（沿 Sprint 8 §6.7 结论不变）。

---

# 7. 验收基线与 Migration

代码基线：Sprint 8 收尾（提交 `20b4791`，lint / typecheck / check:arch /
unit / integration / build 通过；integration 串行 220+9 pass）。
开发库已有真实业务事实，**任何脚本不得破坏开发库**（§89）。

Schema 变更（均需 Entity + Migration 同时提交，§55）：

| 新表/改动 | Sprint |
|---|---|
| `platform_category_nodes`（树缓存） | T3a |
| `platform_category_mappings`（映射） | T3b |

Migration 编号自 `20260914_001` 起编（上一 Migration 止于 `20260912_004`，
Sprint 8 无 Schema 变更）。预计 1–2 个 Migration，其余任务零 Schema 变更
（尺寸/重量、`sku_images`、`main_image_id` 列均已存在）。

提交前检查（§82）：lint / typecheck / check:architecture / 相关 unit +
integration（新增：并发锁行、挂靠、导入、映射填充、enrichment 落库、图片任务）。

---

# 8. 参考索引

| 内容 | 路径 |
|---|---|
| 开发纪律（必读） | `AGENTS.md` |
| Sprint 8 规划（T1 起点） | `docs/WCIES_下一阶段规划_Sprint_8_批量建档与映射补齐.md` |
| Sprint 9 规划（主线与 4 个异常靶子） | `docs/WCIES_下一阶段规划_Sprint_9_订单状态同步与运营闭环.md` |
| OZON 官方规范（字段级查证来源） | `docs/ozon-seller-openapi.json` |
| OZON 集成事实（T0 后更新） | `docs/integrations/ozon.md` |
| 主数据与编码（par12 待重写） | `docs/business-rules/master-data.md` |
| 决策记录 | `docs/decisions/0001`–`0013`（本 Sprint 新增 0014–0015） |
| 术语表 | `CONTEXT.md` |
