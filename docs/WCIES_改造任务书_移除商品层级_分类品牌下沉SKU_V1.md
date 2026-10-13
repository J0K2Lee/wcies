# WCIES 改造任务书：移除商品层级，分类/品牌下沉 SKU（V1）

> 2026-10-13 拍板。本任务书是唯一实施依据；与 AGENTS.md 规则 23/24 的历史表述冲突之处，以本任务书（用户已确认的业务决策）为准，并在 T9 同步修订文档。
>
> 决策记录：
> - **D1 删表**：两阶段 Migration（阶段一加列回填，阶段二验证后 drop products）。
> - **D2 SKU 编码**：新全局序列 `SKU%09d`（9 位，最小宽度自然进位）；migration 回填序列起点 = 现有 sku_code 数字后缀最大值 + 1；存量编码冻结不迁移。
> - **D3 快捷建档后 SKU = ACTIVE（启用）**：Product 的 DRAFT「档案未补全」语义整体废除，不迁移到 SKU；`POST /skus` 的默认状态维持现状不变。
> - **D4 补品牌管理 UI**：与分类管理弹窗同级、同交互模式（列表/改名/停用/删除），入口放 SKU 管理页。
> - **D5 继承语义**：每个 SKU 从原属 Product 继承 category_id/brand_id 一份，之后各 SKU 可独立修改。
> - **D6 直接破坏式删除 `/products` API**：无兼容期，前端同步改。
>
> 全程硬约束（每个任务必须遵守）：
> - 不得改动 integration 层任何平台侧 `product_id` / `description_category_id`（同名异物）；`sync/product-enrichment` 是 OZON listing 属性拉取，不动。
> - `platform_category_mappings` 挂的是 categories 表，保留不动。
> - 库存/订单/采购/调拨/财务只依赖 SKU，本改造不得触碰这些模块的表结构。
> - 每个任务完成时：lint + typecheck + 相关单测必须过；涉及库存核心不需要跑 Integration Test（本改造不碰库存写路径）。
> - openapi.json / api-client 生成物在 T7 末统一重新生成后随 T7 提交。
> - 提交按任务隔离，禁止跨任务混提。

---

## T1 数据库 Migration 阶段一：skus 加分类/品牌列 + 回填 + 全局序列

**Goal**：schema 具备"分类/品牌是 SKU 字段"的物理形态；products 表结构不动。

**Allowed directories**：`database/migrations/`、`apps/api/src/modules/product/entities/sku.entity.ts`

**Required reading**：`database/migrations/20260908_005/006/007`（categories/products/skus 建表）、`apps/api/src/modules/product/entities/sku.entity.ts`、`docs/business-rules/master-data.md` §1

**Inputs / 实现**：新建 `database/migrations/20261013_001_sku_category_brand.ts`：
1. `ALTER TABLE skus ADD COLUMN category_id uuid NULL REFERENCES categories(id)`、`ADD COLUMN brand_id uuid NULL REFERENCES brands(id)`；加 `idx_skus_category`、`idx_skus_brand`。
2. 回填：`UPDATE skus s SET category_id = p.category_id, brand_id = p.brand_id FROM products p WHERE s.product_id = p.id`（N:1 确定继承，§89 无歧义；回填行数写审计日志）。
3. `ALTER TABLE skus ALTER COLUMN product_id DROP NOT NULL`（阶段二删表前置）。
4. 全局序列回填（D2）：从 `sku_code` 取 9 位数字后缀最大值，`INSERT INTO business_code_sequences (scope_key, next_value) VALUES ('sku', max+1) ON CONFLICT (scope_key) DO NOTHING`；发现非数字后缀的存量 sku_code 直接报错中止（防御，理论上不存在）。
5. 同文件更新 `sku.entity.ts`：新增两列（nullable，无 relation，与现有 products 列风格一致）。

**Tests**：新集成测试（真实 PG，参照现有 migration 测试惯例）验证：回填后 skus 两列与原 product 一致；序列起点 = max+1；重复执行不炸（migration 幂等由 TypeORM 表保证）。

**Forbidden**：不动 products 表任何列/约束；不删任何行；不修改 business-code.service（T2 的事）。

---

## T2 BusinessCodeService：SKU 全局发号

**Goal**：新 SKU 编码 `SKU%09d` 可用；旧 PN/派生码函数暂留（调用方 T3/T5/T6 才删），保证本任务合入后全仓编译通过。

**Allowed directories**：`apps/api/src/infrastructure/business-code/`

**Required reading**：`business-code.service.ts`（93-95、219-238）、`business-code.service.spec.ts`

**Inputs / 实现**：
1. `formatSkuCode(seq: number)` 改为单参 `SKU%09d`（保留最小宽度语义）。
2. 新增 `nextSkuCodeGlobal(manager?)`：scope `'sku'`（T1 已回填起点）。
3. 旧 `nextSkuCode(productId, productCodeSeq)`、`skuScope()` 标注 `@deprecated`（T9 删），暂不改动其行为。
4. `nextProductCode` 暂留（product.service 仍调用，T3 删）。

**Tests**：单测断言新格式与取号连续性（首次取号 = T1 回填的 max+1）。

**Forbidden**：不改 product/listing/import 任何调用方。

---

## T3 移除 Product 层（product 模块核心改造）

**Goal**：`/products` 全套路由与 ProductService/Repository/Entity 消失；SKU 直建不再需要 productId；SKU 列表/详情携带分类与品牌。

**Allowed directories**：`apps/api/src/modules/product/`（不含 barcode/sku-image/sku-bundle 子域的行为变更）、`apps/api/src/app.module.ts`

**Required reading**：product.controller/product.service/product.repository/product.entity、sku.controller/sku.service/sku.repository、`dto/product-sku.dto.ts`、`errors/product-errors.ts`、`constants/sku-delete.constants.ts`、`services/sku-image.service.ts`

**Inputs / 实现**：
1. 删除：`product.controller.ts`、`product.service.ts`、`product.repository.ts`、`product.entity.ts`。
2. `product.module.ts`：保留模块名 ProductModule 与现有导出（SkuService/BarcodeService/SkuImageService/ProductRepository 导出中删掉 ProductRepository/ ProductService）——11 个消费模块零改动。
3. `sku.service.ts`：
   - `create()`：去掉 productId 参数与查 Product 逻辑；编码改 `nextSkuCodeGlobal()`；新增 categoryId/brandId 校验（存在性 + 分类必须 level=3，复用 catalog 公开 Service，抛既有 `CATEGORY_NOT_FOUND`/`BRAND_NOT_FOUND`/`CATEGORY_LEVEL_INVALID`）。
   - 删除 `listByProductId`；`assertImageBelongsToProduct` 链简化为 image→sku。
   - `createForImport` / SKU 导入入口同步去 Product 化（T6 收尾模板层）。
4. `sku.repository.ts`：列表/详情去掉 `innerJoin products`；brandId/categoryId 过滤直查 skus 列；展示名走 LEFT JOIN brands/categories（与原 product.repository 风格一致）。
5. DTO：`CreateSkuRequestDto` 删 `productId` 增 `categoryId?/brandId?`；`UpdateSkuRequestDto` 增 `categoryId?/brandId?`（null 可清空）；`SkuListQueryDto` 的 brandId/categoryId 语义改直查（categoryId 仍为含子树筛选，递归 CTE 逻辑从 product.repository 迁来）；`SkuResponseDto/SkuListItemDto` 删 productId/productCode/productName，增 categoryName/brandName（categoryId/brandId）。
6. 错误码清理：删 `PRODUCT_NOT_FOUND`、`PRODUCT_CODE_ALREADY_EXISTS`、`PRODUCT_IN_USE`、`PRODUCT_HAS_BUSINESS_HISTORY` 及对应错误类；`sku-delete.constants.ts` 若引用 products 表（引用检查清单）同步移除该检查项。
7. SKU 强删端点 `DELETE /skus/:id?force` 保留，级联范围不变（条码/图片/映射/捆绑）。
8. `app.module.ts` 无需改动（模块注册保留）。

**Tests**：`sku.service.spec.ts` 重写（去 product mock，加分类/品牌校验用例）；全仓 typecheck 保证无残留 import。

**Forbidden**：不改 catalog 模块（T4）；不改 listing/import（T5/T6）；不删 business-code 旧函数（T9）。

---

## T4 catalog 模块：删除保护改挂 SKU + 品牌管理核对

**Goal**：分类/品牌的删除保护与计数按 skus 新列执行；品牌管理后端能力齐全（供 T7 前端消费）。

**Allowed directories**：`apps/api/src/modules/catalog/`

**Required reading**：`catalog.repository.ts`（58-61、174-199）、`catalog-errors.ts`（89-110）、`catalog.controller.ts`、`catalog.service.ts`

**Inputs / 实现**：
1. 删除保护 SQL：`products WHERE brand_id/category_id` → `skus WHERE brand_id/category_id`（含子树递归计数版本）。
2. 错误文案：BRAND_IN_USE/CATEGORY_IN_USE 的「已被商品引用」改「已被 SKU 引用」；`CATEGORY_LEVEL_INVALID` 文案中"商品"表述同步改。
3. 核对 `/brands` CRUD：确认已有 PATCH（改名/停用）与 DELETE（零引用真删，决策 0003 语义）；缺则补齐到与 categories 同等能力（D4 的后端前提）。
4. 类目规则第 5 条（"已有商品的节点移动后不再是三级 → 拒绝"）判据改为按 skus 计数，规则本身不变。

**Tests**：`catalog-levels.integration.spec.ts`、`delete-protection.integration.spec.ts` 中 brand/category 部分改挂 SKU fixture（product 部分的清理在 T8 统一扫）。

**Forbidden**：不改类目树三层规则本身；不加新错误码。

---

## T5 listing 快捷建档改造（改动量最大的后端任务）

**Goal**：onboard 一事务内直接建 SKU（ACTIVE，D3）+ 可选条码 + 绑定映射；挂靠/另建商品概念消失。

**Allowed directories**：`apps/api/src/modules/listing/`

**Required reading**：`listing-onboarding.service.ts`（114、166-215、369）、`listing.repository.ts`（276-403）、`dto/listing.dto.ts`（184-192、308）、`listing-onboarding.service.spec.ts`、master-data.md §12/14/15/16

**Inputs / 实现**：
1. `OnboardRequestDto`：删 `createNewProduct`/`existingProductId`/`productNameZh`；`brandId?`/`categoryId?` 保留（语义=直接写 SKU）；`rememberCategoryMapping` 保留。
2. onboarding service：删 `createForOnboardingInTx`/`getEntityByIdInTx` 调用；事务内 `SkuService` 建档（nameZh 缺省仍取 `listing.title`，两者为空仍 422 `LISTING_ONBOARD_NAME_REQUIRED`）；SKU 状态 ACTIVE；编码 `nextSkuCodeGlobal()`（事务内取号不烧号）；审计动作删 CREATE product，保留 CREATE sku/barcode 与 MAP。
3. `listing.repository.ts`：删 `findFirstMappedProductInTx`；变体列表/onboarding 上下文里 product_id/product_code/product_name 展示字段改为 SKU 自身字段（或删除，视 DTO 契约）。
4. 平台类目映射（§15/§17/§18）与图片异步转存（§19，除去掉「回填 products.main_image_id」分支）逻辑保留。
5. `latestPurchasePrice` 随事务写 SKU（§22）不变。

**Tests**：`listing-onboarding.service.spec.ts` 重写：直建 SKU 断言、无 product mock、ACTIVE 断言、类目映射同事务写入断言。

**Forbidden**：不动 `platform_category_mappings` 表与其写入路径；不动 Listing 唯一键与映射状态机；onboard 只允许 UNMAPPED 变体发起的 409 规则不变。

---

## T6 import SKU 导入改造

**Goal**：SKU 导入模板与 handler 去 Product 化。

**Allowed directories**：`apps/api/src/modules/import/`

**Required reading**：`handlers/sku-import.handler.ts`（3、48、167、215-238）、`import-template.service.ts`（33-34）、master-data.md 导入节（§194 附近）

**Inputs / 实现**：
1. 模板列：删 `product_code`；`product_name_zh` 改为 `name_zh`（SKU 名，必填）；新增可选 `brand`/`category`（按名称精确匹配，匹配不到 → 行错误 `BRAND_NOT_FOUND`/`CATEGORY_NOT_FOUND`，不自动创建）。
2. handler：删 getEntityByCode/createForImport 建品链路；每行直接 `SkuService.create`（或导入内部入口），SKU 编码全局取号。
3. 行级校验语义不变（Row Number + Error Code + Error Message；单行失败不阻塞整批）。

**Tests**：`import-center.integration.spec.ts` fixture 与断言更新；handler 单测补 name_zh 必填用例。

**Forbidden**：不动 ImportJob 框架与其他导入类型。

---

## T7 前端改造 + 契约再生成

**Goal**：商品页消失；SKU 页成为主数据中枢（含分类/品牌管理入口）；建档链路全部对齐新契约。

**Allowed directories**：`apps/web/src/`、`openapi.json`、`packages/api-client/`（仅生成物）

**Required reading**：`App.tsx`/`AppLayout.tsx`、`pages/products/ProductsPage.tsx`（1328-1573 分类管理弹窗为迁移源）、`pages/skus/SkusPage.tsx`、`components/SkuCreateModal.tsx`、`components/ListingOnboardModal.tsx`、`components/QuickCreateModals.tsx`、`pages/orders/OrdersPage.tsx`（2920-2932 快捷建档）、`pages/listings/ListingsPage.tsx`、`pages/import/ImportPage.tsx`

**Inputs / 实现**：
1. 删：`ProductsPage.tsx`、`/products` 路由、「商品管理」菜单项。
2. `SkusPage.tsx`：分类管理弹窗从 ProductsPage 迁入（树搜索/改名/排序/停用/删除交互原样）；新增品牌管理弹窗（与分类管理同级交互：列表/改名/停用/删除，D4）；列表列「商品(brandName)」改「品牌/分类」；新建/编辑表单加品牌 Select（含快建）+ 三级分类级联（只可选三级叶子，复用既有 cascader helper）；筛选直连新字段。
3. `SkuCreateModal.tsx`：删商品搜索选择器与 productId 提交；顺手清理失效缓存键 `['product-detail']`。
4. `ListingOnboardModal.tsx`：删 createNewProduct/existingProductId/pinnedProductId 与「下一变体沿用」逻辑；品牌/分类选择保留（落 SKU）；类目建议与「记住此映射」保留。
5. `OrdersPage.tsx` 快捷建档、`ListingsPage.tsx` 变体展示随新契约对齐（productName→skuName 等）。
6. `ImportPage.tsx` + `StatusBadge.tsx`：导入类型文案去掉「含商品」表述。
7. 契约再生成：`pnpm --filter @wcies/api build && pnpm openapi:export && pnpm api-client:generate`；`WciesPaths` 类型变化会在编译期暴露全部漏改调用点——typecheck 归零才算完成；openapi.json 与 api-client 本次随 T7 提交（此前刻意不提交的积压一并落盘）。
8. GlobalSearch 不动（无 product 字段）。

**Tests**：`pnpm --filter web typecheck` + 既有 web 测试通过；手工核对清单：SKU 新建/编辑（品牌+分类）、分类管理、品牌管理、listing 快捷建档、订单行快捷建档、SKU 导入。

**Forbidden**：不动库存/采购/调拨/退货/财务页面；不改 design-system 组件。

---

## T8 存量测试扫改

**Goal**：全部依赖 `POST /products` fixture 的测试改为直建 SKU；Product 层契约测试删除。

**Allowed directories**：`tests/integration/`、`apps/api/src/**/*.spec.ts`

**Required reading / 改造清单**（普查所得）：
- 删除/重写主体：`master-data.integration.spec.ts`（141-263 products 生命周期）、`business-code.integration.spec.ts`（PN 断言删、SKU 断言改 `SKU%09d`）、`force-delete.integration.spec.ts`（product 级联部分删）、`delete-protection.integration.spec.ts`（113-272 product 部分删，brand/category 部分已在 T4 改）、`catalog-levels.integration.spec.ts`（商品过滤→SKU 过滤）。
- fixture 链路替换：`barcode-resolve`、`import-center`、`sprint8-onboarding`、`sprint8.5-onboarding`、`listing.integration.spec.ts` 及其余 20+ 文件中「建品+建 SKU」两步 fixture 合并为一步直建 SKU。
- 直查 products 表的断言（sprint8-onboarding:154 等）全部移除。

**Forbidden**：不因图省事跳过或删除与 Product 无关的用例；flaky 用例处理遵照既有备忘（负载敏感 4 例单独跑）。

---

## T9 文档 + ADR + Migration 阶段二 + 代码清理

**Goal**：决策与规则文档与实现一致；products 表物理删除；死代码清零。

**Allowed directories**：`docs/`、`AGENTS.md`（修订内容先向用户展示确认）、`database/migrations/`、`apps/api/src/infrastructure/business-code/`、`scripts/`

**Inputs / 实现**：
1. 新 ADR：`docs/decisions/0020-移除商品层级分类品牌下沉SKU.md`——记录 D1-D6、单射继承回填、显式推翻 0002（SKU 派生编码）／0014（多变体挂靠）／0008 中 /products 强删部分；0019 条码不受影响。
2. `master-data.md`：编码表（删 Product 行，SKU 行改 `SKU%09d` 全局序列）、删除策略（删 PRODUCT_* 错误码与强删端点）、listing 节（§12/14/16 按新流程改写，§15/17/18 类目映射不变）、导入模板、错误码表、操作日志实体清单。
3. `AGENTS.md` 规则 23/24 及其它「Product/SKU 双层」表述改为「Internal SKU 是唯一商品主数据，分类/品牌是 SKU 字段」；规则 101 冻结清单同步核对（第 1 条 Internal SKU 身份不变，无违反）。
4. `architecture/overview.md` ER 图与模块说明更新。
5. business-code 清理：删 `SCOPE_PRODUCT`/`skuScope`/`formatProductCode`/`nextProductCode`/旧 `nextSkuCode`/`nextProductCode` 及其单测断言。
6. Migration 阶段二 `202610XX_002_drop_products.ts`：drop `fk_skus_product`（若 TypeORM 命名不同以实际为准）→ `DROP TABLE products` → drop `seq_product_code` 序列 → `DELETE FROM business_code_sequences WHERE scope_key='product' OR scope_key LIKE 'sku:%'`。前置条件：T1-T8 全部合入且 dev 环境手工验证通过，执行前向用户确认。
7. `scripts/reset-dev-database-*.ts` 核对 TRUNCATE 列表（products 表删除后自然不需列）。

**Tests**：全量 lint + typecheck + unit + architecture check；Integration Test 全量跑一遍（flaky 4 例按备忘单独复跑）。

**Forbidden**：不修改任何已进入共享环境的历史 migration 文件（§56）。

---

## 验收清单（全部任务完成后）

1. `POST /api/v1/skus` 直建成功，编码 `SKU%09d`，brand/category 可选且分类必须三级。
2. `/api/v1/products*` 全部 404；前端无商品管理入口。
3. SKU 页可管理分类与品牌（增删改停用），品牌/分类被 SKU 引用时不可删只能停用。
4. listing 快捷建档产出 ACTIVE SKU，多变体不再挂靠；「记住类目映射」仍工作。
5. SKU 导入不再需要商品列。
6. `products` 表不存在；`business_code_sequences` 无 product 死行。
7. 全量检查绿：lint / typecheck / check:architecture / unit / integration。
