# ADR 0016 — 映射解析不使用 Offer ID

日期：2026-09-14（Sprint 8.5R1，人工验收反馈，用户明确指示）
状态：已接受
替代范围：收紧决策 0012 的「三标识任一即可」

## 背景

Sprint 8.5 人工验收（2026-09-14）用户指出：

> 平台 Listing 的 Offer ID 会被运营修改，映射**不得**以 offer_id 为解析依据；
> 应以 Platform Product ID + Platform SKU 与本地 SKU Code 建立映射。

这一反馈有现实基础。OZON 的 `offer_id` 是**卖家货号**，运营可以在卖家后台随时改名（例如换季、
换供应商、纠正命名），而订单同步与 Listing 同步各自独立进行。WCIES 此前有**四处**把 offer_id
当作解析依据：

| # | 位置 | 行为 |
|---|---|---|
| a | `findResolveCandidates` | 订单解析的 OR 条件含 `offer_id` |
| b | `findUnmappedVariantByIdentifiers` | LISTING_MAPPING 导入按 `platform_sku_id → offer_id → seller_sku` 绑定同步行 |
| c | `addMappingInternal` | 人工映射「三标识任一即可」，纯 offer 也能建 |
| d | `order-ingestion.resolveItemSku` | 把订单行的 offer_id 传给解析器 |

风险是**静默失配**：运营改了平台上的 offer_id，仓库里的映射行还留着旧值，订单进来匹配不到，
表现为一条无法解释的 `ORDER_SKU_MAPPING_FAILED`；而如果两行恰好撞上同一个 offer，
隐患是**解析到错误的 SKU**（比失配更严重，且不会报错）。

## 决策

**解析标识收敛为 `platform_sku_id` 与 `seller_sku`；`offer_id` 退出解析链路。**

1. `ListingResolverService.resolveInternalSku` 不再接受 `offerId` 入参；
   `ResolveSkuRequestDto` 同步删除该字段。
2. `findResolveCandidates` 的 OR 条件只保留 `platform_sku_id` / `seller_sku`。
3. `findUnmappedVariantByIdentifiers`（导入绑定同步行）优先级改为
   `platform_sku_id → seller_sku`，不再按 offer 绑定。
4. `order-ingestion.resolveItemSku` 不再向解析器传 offer id。
5. 人工映射（决策 0012 收紧）：`platform_sku_id` / `seller_sku` **至少其一**，
   **纯 Offer ID 拒绝**，422 文案改为
   「至少填写 Platform SKU ID 或 Seller SKU；Offer ID 可被运营修改，不作为订单解析依据」。
   前端「新建映射」校验器与提示同步收紧。
6. 响应字段 `matchedOfferId` **保留但恒为 null**（兼容既有前端契约）。
7. **offer_id 仍是平台事实**：照常同步入库、列表展示、Excel 导出列保留、关键字搜索仍可命中。
   本次只把它从**解析/绑定**链路移除。

Platform Product ID 维度已由既有结构承载：`Listing(store + platform_product_id)`
→ 变体（`platform_sku_id`）→ 内部 SKU。因此解析落在变体的 `platform_sku_id` 上，
不需要新增 product 级解析分支。

## 为什么

- Offer ID 是**可被外部（运营）单方面修改**的标识。把它当作主键等价于让外部改动能悄悄
  使 WCIES 的映射失效——与「人工映射永不被同步覆盖」（§8.5）的保护意图直接矛盾。
- `platform_sku_id`（OZON `sku`）是平台分配的**不可编辑**标识，订单行也携带它，
  是解析的天然抓手。
- 宁可**失配并报异常**（可见、可修复），也不要**错误命中**（静默、错发）。

## 后果

- **只有 offer 的映射行不再可解析**。既有历史行不会被自动改写（AGENTS.md §99）；
  它们是 `sku_id IS NOT NULL` 的 MAPPED 行，但缺 `platform_sku_id`/`seller_sku` 时
  不会再被任何订单命中。补救方式：在该 Listing 详情用「编辑映射」补 Platform SKU ID。
- **Listing Sync 观察到 `sku = 0` 的商品**（`ozon.mapper.ts` 注释中记录的 25 行真实数据）
  其同步变体的 `platform_sku_id` 为 null，过去靠 offer 兜底解析，现在必须人工补
  Platform SKU ID，否则该商品的订单会落 `ORDER_SKU_MAPPING_FAILED`。这是本决策的
  **已知代价**，用户已明确接受。
- 订单行若三个标识都为空或只有 offer，结果为 `LISTING_SKU_RESOLVE_FAILED`
  → `ORDER_SKU_MAPPING_FAILED` + 重试路径不变（决策 0012 §2）。
- 单元/集成测试同步调整：新增「仅 offer 命中不再解析」与「纯 offer 人工映射 422」断言，
  原按 offer 解析的用例改按 `platform_sku_id`。

## 不采用的方案

- **保留 offer 作为「兜底」标识**：兜底正是风险来源——兜底会在运营改名的瞬间变成静默失配，
  且不会有人收到通知。
- **解析时同时尝试新旧 offer（历史回溯）**：需要额外记录 offer 变更历史，本批零 Schema
  变更（Sprint 8.5R1 硬约束），且仍无法排除撞号导致的错误命中。
- **删除 offer_id 字段**：它是平台原始事实（AGENTS.md §34），对账与排查都要用，
  且同步/展示/导出已依赖它。只退出解析链路。
