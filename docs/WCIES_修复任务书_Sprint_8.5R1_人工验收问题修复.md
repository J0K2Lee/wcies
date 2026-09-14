# WCIES 修复任务书（Sprint 8.5R1：人工验收问题修复）

> 依据：`AGENTS.md`、`docs/WCIES_下一阶段规划_Sprint_8.5_建档并映射增强.md`（已交付，提交 `6745293`）、
> 人工验收反馈 8 项（2026-09-14，附截图 2 张）、代码现状核查（文中行号为 2026-09-14 工作区实测）。
>
> 性质：**缺陷修复 + 一项业务规则变更**（问题 4，用户明确指示，形成决策 0016）。
>
> 修订历史：
> - v1（本版）：Sprint 8.5 人工验收 8 项问题的修复规格，含证据、方案、验收标准。

---

# 1. 问题清单与根因（有证据，非推测）

| # | 问题 | 根因（证据） |
|---|---|---|
| 1 | 建档并映射：无法输入最新采购价；商品名/SKU 名预填俄语 Listing 标题，难辨识 | 建档弹窗无采购价输入（ListingsPage 全文无 `latestPurchasePrice` 匹配）；后端 `SkuService.createForOnboardingInTx` 亦不接收该字段；名称预填取 `listing.title`（ListingsPage L527-538、`buildVariantSkuName` 以标题为基） |
| 2 | 建档并映射：商品图片不支持点击放大 | 平台图为原生 `<img>`（ListingsPage L1714-1726），非 antd Image，无预览能力 |
| 3 | 类目树落库后，商品管理的类目筛选/选择非常卡顿、出现超时 | ① `GET /api/v1/categories` 返回全量实体 DTO：`catalog.repository.ts listCategories`（L61-63）无列裁剪，`CategoryTreeItemDto extends CategoryResponseDto` 含 `code/createdAt/updatedAt` 等，7941 节点响应约 3-4MB，被商品/ SKU / Listing 三个页面整树递归消费；② antd Cascader 数据源为全量节点 |
| 4 | **业务规则**：平台 Listing 的 Offer ID 会被运营修改，映射**不得**以 offer_id 为解析依据；应以 Platform Product ID + Platform SKU 与本地 SKU Code 建立映射 | 现状四处依赖 offer_id 解析：a) `findResolveCandidates` OR 匹配三标识（`listing.repository.ts` L675-687）；b) LISTING_MAPPING 导入绑定优先级 platformSkuId→offerId→sellerSku（`findUnmappedVariantByIdentifiers` L623-647）；c) 决策 0012 人工映射「三标识任一即可」（`listing.service.ts addMappingInternal` L670-675）；d) 订单行解析传 offerId（`order-ingestion.service.ts resolveItemSku` L183-207） |
| 5 | SKU 编辑：无法启用 SN 管理 | 编辑表单无 `serialTracking` 控件（SkusPage L1387-1419 仅 8 个字段）；后端已支持（`UpdateSkuRequestDto` L307、`sku.service.update` 已处理该字段），纯前端缺失 |
| 6 | SKU 编辑：未预填当前内容，只想改一项却被要求全部填写 | 编辑表单缺 长/宽/高 三个 Form.Item（打开时预填了这三个值却无输入框承载，其余字段虽有预填但用户实测反馈未生效——预填发生在 Modal 挂载前 `setFieldsValue`（SkusPage L1051-1064），存在未连接表单实例的边缘失效风险）；数值字段用 `Input type=number` 提交字符串 |
| 7 | SKU 管理：行内图片列过小，行图/侧边栏图不可放大 | 行图片 antd Image `preview={false}` 44px（SkusPage L787-794）；rail 图片 `preview={false}` 56px（L559-566） |
| 8 | 商品管理「分类管理」严重性能问题：点击后长时间无反馈、弹窗等待、点树节点响应超时 | 分类管理 Tree（ProductsPage L1643-1652）`defaultExpandAll` 一次性渲染 7941 个节点且无 `height` 虚拟滚动（外层容器 maxHeight+overflow）；点击节点 onSelect setState 触发整树重渲染冻结；数据源同问题 3 的全量接口 |

> 附：类目节点分布（开发库实测）——一级 26、二级 542、三级（type）7365，另 8 条历史测试分类。

---

# 2. 修复方案（逐项）

## F1 建档弹窗：最新采购价 + 名称预填 Offer ID（问题 1）

**后端**
- `listing.dto.ts` `ListingOnboardRequestDto` 增加 `latestPurchasePrice?: number`（`@IsNumber() @Min(0)`，选填）。
- `sku.service.ts` `createForOnboardingInTx` 入参增加 `latestPurchasePrice`，`toNumeric` 落库。
  - 合规说明：master-data par4.3「latest_purchase_price 允许人工维护」，本修复即人工录入通道；与移动加权平均成本（par4.4，仅收货确认维护）无冲突。

**前端（ListingsPage.tsx）**
- 尺寸栏旁新增「最新采购价（CNY）」InputNumber，提交 payload 带上。
- 预填逻辑改为：**商品名与 SKU 名都优先取当前变体的 Offer ID**（`onboardSelectedVariant.offerId`）；无 Offer ID 时回退 Listing 标题。`buildVariantSkuName` 改为 Offer ID 优先。挂靠模式下商品名不可编辑（沿用既有行为），SKU 名同样预填 Offer ID。
- `startNextVariant`：SKU 名预填改为下一变体的 Offer ID。

## F2 建档图片放大（问题 2）

- 弹窗平台图由原生 `<img>` 改为 antd `Image`（保留 120px 展示尺寸，启用默认点击遮罩放大）。

## F3 类目性能（问题 3+8）

**后端**
- catalog 模块新增精简端点 `GET /api/v1/categories/tree-lite`：
  - `CategoryTreeLiteItemDto { id, parentId, nameZh, nameRu, level, sortOrder, status, children }`；
  - repository 查询按列裁剪（去 `code/createdAt/updatedAt`），payload 预计降 60%+；
  - 管理表单所需的 `parentId/sortOrder/status` 保留， picker 所需 `id/nameZh/nameRu/level` 保留；
  - `GET /categories` 旧端点行为不变（openapi 向后兼容）。

**前端**
- ProductsPage / SkusPage / ListingsPage 三处类目查询切换 `tree-lite`；`CategoryNode` 类型删除 `code`（已核查三个页面无 UI 消费 `code`）。
- 分类管理 Tree（ProductsPage）：
  - 删除 `defaultExpandAll` → `defaultExpandedKeys` = 一级节点 id（初始仅渲染 26+542 个折叠节点）；
  - 增加 `height` 属性启用 antd Tree 虚拟滚动，外层 `maxHeight+overflow` 滚动交给 Tree 自身；
  - onSelect 行为不变（纯 setState），虚拟化后重渲染成本可控。
- Cascader（商品表单/筛选）保持搜索式交互，仅换数据源。

## F4 映射解析去 Offer ID（问题 4，决策 0016，业务规则变更）

**原则**：Offer ID 可被运营修改，**不作为订单解析与绑定依据**；解析标识收敛为 **Platform SKU**（`platform_sku_id`）与 Seller SKU（用户未排除，保留）。Platform Product ID 维度已由「Listing(store + platform_product_id) → 变体(platform_sku_id) → 内部 SKU」结构承载，解析落在变体的 platform_sku_id 上。

**代码**
- `listing.repository.ts`：
  - `findResolveCandidates`：删除 `offer_id` 匹配条件（保留 platform_sku_id / seller_sku）；
  - `findUnmappedVariantByIdentifiers`：优先级改为 platformSkuId → sellerSku（删 offerId）。
- `listing-resolver.service.ts` 与 `ResolveSkuRequestDto`：删除 `offerId` 入参；响应保留 `matchedOfferId` 字段（恒 null）以兼容既有前端。
- `order-ingestion.service.ts` `resolveItemSku`：不再传 offerId。
- `listing.service.ts` `addMappingInternal`（决策 0012 校验收紧）：platformSkuId / sellerSku 至少其一，**纯 Offer ID 拒绝**（422，错误文案更新为「至少填写 Platform SKU ID 或 Seller SKU；Offer ID 可被运营修改，不作为订单解析依据」）。
- 前端「新建映射」弹窗：校验器与提示文案同步收紧。
- offer_id 仍作为平台事实同步入库、列表展示、Excel 导出列保留——**仅从解析链路移除**。

**测试**
- `listing-resolver.service.spec.ts`：删 offerId 匹配用例，补「仅 offer 命中不再解析」断言。
- `listing.integration.spec.ts`（L79/88/97/113/154）：offer 解析用例改按 platformSkuId。
- `sprint8-onboarding.integration.spec.ts`（L176-179）：`resolve?offerId=` 改 `platformSkuId`。
- 新增断言：纯 offer_id 人工映射 422。

**文档**
- master-data.md：§8 第 20 条（导入绑定优先级）、§9 Resolver 匹配语义（第 5 条 OR 标识集合）更新；错误码小节补文案变更。
- 新增 `docs/decisions/0016-映射解析不使用OfferID.md`（记录用户决策与理由：Offer ID 可被运营修改）。

## F5+F6 SKU 编辑表单（问题 5+6，SkusPage.tsx）

- 表单补齐缺失字段：
  - 长/宽/高 InputNumber（全有或全无校验，注明体积由后端按长×宽×高计算）；
  - **SN 管理 Switch**（`serialTracking`，`valuePropName="checked"`）；
  - `weightG` / `latestPurchasePrice` 改 InputNumber（消除字符串提交）。
- 预填加固：保留点击编辑时 `resetFields + setFieldsValue`，并在 Modal `afterOpenChange(open=true)`（或 `editOpen` 的 useEffect）按 `sku` 再补一次 setFieldsValue，确保全部当前值可见；只改一项即可提交（PATCH 为部分更新）。

## F7 SKU 图片放大（问题 7，SkusPage.tsx）

- 行图片 44px → 56px，去掉 `preview={false}`；
- 侧边栏 rail 图片去掉 `preview={false}`；
- Drawer「图片」Tab 已默认可预览，不动。

---

# 3. 验收标准

1. 建档弹窗：名称预填 Offer ID；可填最新采购价并正确落到 `skus.latest_purchase_price`；图片点击放大；其余 Sprint 8.5 行为（类目自动命中、挂靠、图片异步转存）不回归。
2. 分类管理：7933 节点规模下打开弹窗即时、点击树节点即时响应（无冻结/超时）；商品表单与筛选 Cascader 正常选择三级。
3. 映射规则：纯 Offer ID 的人工映射被拒（422 新文案）；修改某 listing 的 offer_id 后，订单仍按 platform_sku_id 命中解析（集成测试证明）。
4. SKU 编辑：打开即见全部当前值（含长宽高、SN 管理开关）；仅切换 SN 开关提交成功；数值字段不再以字符串提交。
5. SKU 行图与侧边栏图点击放大。
6. 门禁：lint / typecheck（api+web）/ check:architecture / check:openapi / unit / 集成测试（串行全量）全部通过；**本批零 Schema 变更（无 Migration）**；dev 库不受影响。

# 4. 测试与验证要求

- 单元：resolver、onboarding spec 更新后全绿。
- 集成：先定向（sprint8 / sprint8.5 / listing），再全量串行（`--pool=forks --poolOptions.forks.singleFork`）。
- 实机抽查（dev 环境）：建档弹窗三处改动、SKU 编辑预填与 SN 开关、分类管理打开/点击流畅度。
- 收尾：`pnpm --filter @wcies/api build` → `openapi:export` → `api-client:generate` → `check:openapi`。

# 5. 本批不做的事（范围控制）

1. 不动 Inventory Core，不做任何库存相关改动。
2. 不改 offer_id 的同步、展示、导出事实（仅从解析链路移除）。
3. 不做类目 Cascader 的远程搜索/懒加载改造——若换精简数据源后仍有卡顿，另行立项。
4. 不改 `GET /categories` 旧端点行为（保持向后兼容）。
5. 不处理 Seller SKU 语义调整（用户仅排除 Offer ID）。

# 6. 允许修改的目录

- `apps/api/src/modules/listing/**`（resolver/repository/service/dto/errors）
- `apps/api/src/modules/catalog/**`（lite 端点）
- `apps/api/src/modules/order/services/order-ingestion.service.ts`（仅 resolveItemSku 一处）
- `apps/api/src/modules/product/services/sku.service.ts`（onboard 入参）
- `apps/web/src/pages/listings/ListingsPage.tsx`、`apps/web/src/pages/products/ProductsPage.tsx`、`apps/web/src/pages/skus/SkusPage.tsx`
- `tests/integration/**`、`docs/business-rules/master-data.md`、`docs/decisions/0016-*`
- 禁止：Inventory 模块、平台 Adapter/Client、数据库 Migration
