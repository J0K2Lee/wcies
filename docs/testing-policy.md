# WCIES 测试策略（2026-10-26）

> 目的：**按改动的影响面决定验证深度**，既不为了小改动跑 6 分钟全量集成，
> 也不因为图快放过真正会坏的地方。
>
> 全量集成一次约 6.5 分钟（含 build + ensure-test-db）；定向跑 1–3 个 spec 约
> 1–2 分钟。这个策略就是为了把大部分改动留在后者。

---

## 1. 分级

| 级别 | 适用改动 | 必跑 | 预计耗时 |
|---|---|---|---|
| **L0 文档/文案** | `docs/**`、注释、纯文案（不含逻辑）、样式/CSS、README | `npx eslint .`（只查改到的文件即可）| <1 分钟 |
| **L1 单模块内部逻辑** | 单个模块内的纯函数、私有方法、单服务行为；不改 API 契约、不改库、不改跨模块调用 | 该包 typecheck + 相关 unit spec + lint | 1–2 分钟 |
| **L2 跨模块/契约/序列化** | 改公开 Service/端口/DTO/Mapper/响应结构；影响 2+ 模块；改队列 payload；改实体但无 schema 变更 | L1 + **相关集成 spec 子集**（见 §3） | 2–4 分钟 |
| **L3 核心域/基础设施** | 库存、订单状态机、同步、认证权限、全局管道/错误映射、`packages/shared`、`packages/platform-contracts`、`infrastructure/**`、迁移、数据修复脚本 | L2 + **全量集成** `pnpm test:integration` | 8–10 分钟 |
| **L4 Schema 变更** | 新增/修改 `database/migrations/**`、实体列变更、索引/约束 | L3 + 测试库迁移验证（`npx tsx scripts/ensure-test-db.ts`）+ 相关数据修复脚本 dry-run | 10–15 分钟 |

判定规则：**拿不准就取高一级**；一次提交跨 3 个及以上模块 → 直接 L3。

---

## 2. 常用命令

```bash
# L1：单测（按文件路径过滤，不跑别的）
pnpm --filter @wcies/api test -- <path-fragment>        # 如 -- wb.mapper
pnpm --filter @wcies/web test -- <path-fragment>

# L2：定向集成（必须先 build：集成用例 spawn 的是 dist/main.js）
pnpm --filter @wcies/api build
npx vitest run --config vitest.config.integration.ts \
  tests/integration/<spec>.integration.spec.ts [更多 spec…]

# L3：全量集成（自带 build + ensure-test-db）
pnpm test:integration

# 每个改动都要过的静态检查（本地很快）
npx eslint <changed paths>   && pnpm typecheck
```

改到迁移时，定向集成前先跑一次 `npx tsx scripts/ensure-test-db.ts`，否则测试库
schema 与 dist 不一致，失败原因会伪装成业务 bug。

---

## 3. 改动 → 相关集成 spec（L2 用）

| 改动位置 | 需要跑的 spec |
|---|---|
| `modules/order/**` | `orders`、`order-platform-status-sync`、`order-shipment-flow`、`order-purge`、`order-facts-rotation` |
| `modules/inventory/**` | `inventory`、`inventory-import`、`transfer`、`picking` |
| `modules/picking/**` | `picking`、`picking-ship-atomicity`、`order-shipment-flow` |
| `modules/shipment/**` | `shipment.interception`、`shipment-item-void`、`order-shipment-flow` |
| `modules/interception/**` | `shipment.interception`、`order-platform-status-sync` |
| `modules/purchase/**` | `purchase`、`purchase-receipt`、`purchase-e2e`、`replenishment`、`finance` |
| `modules/listing/**` | `listing`、`sprint8-onboarding`、`sprint8.5-onboarding`、`sku-match-candidates` |
| `modules/product/**` | `master-data`、`sku-merge`、`barcode-resolve`、`import-center`、`sku-category-brand-migration` |
| `modules/sync/**`、`modules/integration/**` | `sync`、`order-platform-status-sync`、`order-facts-rotation` |
| `modules/exception/**`、`modules/notification/**` | `order-platform-status-sync`、`shipment.interception` |
| `modules/import/**` | `import-center`、`inventory-import` |
| `modules/warehouse/**` | `warehouse`、`inventory`、`picking` |
| `modules/auth/**`、`modules/user/**` | `user`（unit 为主）；无对应集成时取 L3 |
| `modules/finance/**`、`modules/settlement/**` | `finance`、`purchase-e2e` |
| `apps/web/**` | web unit（`pnpm --filter @wcies/web test`）+ typecheck；不跑集成 |
| `apps/api/src/common/**`（管道/过滤器/响应包装） | 全量（L3）——影响所有接口 |

一条改动命中多行时，取并集。

---

## 4. 必须跑全量（L3）的硬触发条件

命中任意一条即全量，不允许只跑子集：

1. `packages/shared/**`、`packages/platform-contracts/**`（全项目共用）；
2. `apps/api/src/common/**`、`apps/api/src/infrastructure/**`（管道/错误/队列）；
3. `database/migrations/**`；
4. `modules/inventory/**`、`modules/order/services/order-status*.ts`、`modules/sync/**`；
5. 新增或修改 **API 路由 / DTO 校验 / 错误映射**（`openapi.json` 会变）；
6. 修改跨模块端口（`*/ports/*.ts`）或它的实现；
7. 一次提交涉及 ≥3 个模块；
8. 发布前 / 每个工作日收尾（见 §5）。

---

## 5. 兜底规则

- **每个工作日至少跑一次全量**（收尾时），以及任何 push 之前。
- 全量出现失败时，先判断是不是已知的负载敏感用例（见 memory
  `integration-suite-flaky-tests`）；单独跑该 spec 通过即放行，但仍要在对话里
  说明「这是既有 flaky，不是本次回归」。
- **不为通过而改测试**：如果新代码让旧用例变红，先判断是「用例过期」还是
  「行为坏了」；前者改成新契约并在提交信息里写明，后者修代码。
- 纯测试文件改动（`*.spec.ts`）不需要跑全量，但必须跑改到的那个 spec。

---

## 6. AI 执行约定

1. 动手前先按 §1 给这次改动**定级**，并在回复里说明「本次按 Lx 验证」；
2. L2 只跑 §3 映射出的 spec 子集，并在提交信息里列出跑了哪些；
3. L3/L4 才跑全量，并把结果（通过数/失败用例/是否 flaky）写进提交信息；
4. 如果改着改着范围扩大到更高等级（例如顺手改了共享包），**升级验证级别**，
   不能沿用开工时的定级。
