# WCIES 架构总览

> Sprint 0 工程骨架说明。完整架构设计见 `docs/WCIES_跨境电商综合管理系统——总体技术架构设计_V1.md` 与 `docs/WCIES_工程架构与_Monorepo_目录设计_V1.md`。
>
> 注：上述两份设计文档是 Sprint 0/1 时期的历史快照，其中「Product / SPU → SKU
> 双层主数据」的表述已被 2026-10-13 决策
> `docs/decisions/0020-移除商品层级分类品牌下沉SKU.md` 取代；本文 §7 记录当前
> 主数据模型。

## 1. 进程拓扑

Sprint 0 交付两个可运行进程，共享同一代码库（`apps/api`）：

```text
apps/api/src/main.ts    # HTTP API 进程（NestJS + Express）
apps/api/src/worker.ts  # 队列 Worker 进程（BullMQ 消费者，无 HTTP）
```

两者通过 Redis（BullMQ）通信。开发期以 `pnpm dev` / `pnpm dev:worker` 分别启动；未来部署时拆分为两个容器（同镜像、不同入口）。

> 同步调度 tick（`sync-scheduler-tick`，每 30s）由 `SyncModule.onModuleInit` 注册——
> API 与 Worker 进程都加载 `SyncModule`，任一进程在即可保证调度存在（BullMQ 按
> jobId 幂等去重，双进程注册安全）。此前注册只放在 Worker 进程，dev 只跑 API 时
> 自动同步静默失效（2026-10-12 修复，ON-003 实证）。自动轮询的**频率**分三层
> （2026-10-26）：`ORDER_SYNC_INTERVAL_SECONDS` / `LISTING_SYNC_INTERVAL_SECONDS`
> 是系统默认（0 = 系统级关闭，店铺配置不能绕过）；店铺可在
> `settings.sync.orderSyncIntervalMinutes` / `listingSyncIntervalMinutes` 上覆盖
> （统一存分钟，界面按「数字 + 单位（分钟/小时/天）」填写；订单下限 1、商品链接
> 下限 5，上限 30 天），并且必须
> `settings.sync.orderSyncEnabled` / `listingSyncEnabled` 为 true。店铺同步概览
> 接口返回实际生效的间隔（`orderSyncIntervalMinutes` / `listingSyncIntervalMinutes`），
> 店铺抽屉里的「实际生效」与「同步过期」判定都以它为准。

## 2. 基础设施依赖

| 组件 | 用途 | 说明 |
|---|---|---|
| PostgreSQL | 唯一业务事实源 | TypeORM，`synchronize = false`，Schema 仅经 Migration（`database/migrations/`） |
| Redis | BullMQ 队列 / 缓存与分布式锁预留 / 登录限流 | 不存放唯一关键业务事实 |
| MinIO | S3 兼容对象存储 | 统一经 `ObjectStorageService` 访问，Bucket 私有，读取走 Signed URL |

## 3. API 分层

```text
Controller（HTTP、DTO 校验）
  → Service（业务规则）
    → Repository（仅数据访问）
      → PostgreSQL
```

- 全局前缀 `/api/v1`；health 探针（`/health/live`、`/health/ready`）挂在前缀之外。
- 全局 `ValidationPipe`（whitelist + forbidNonWhitelisted + transform）。
- 全局 `GlobalExceptionFilter`：DomainError / HttpException / TypeORM 错误 / 未知错误 → 统一 `{ success:false, error:{code,message,details}, requestId }`。SQL、堆栈、密钥只落服务端日志。
- 统一成功响应 `{ success:true, data }` / 分页 `{ success:true, data, meta }`，由 controller 显式返回（`ok()` / `okPage()`），保证 OpenAPI 类型与线上一致。
- 认证：JWT（HttpOnly Cookie `wcies_session`）+ 全局 `JwtAuthGuard`，`@Public()` 显式豁免。

## 4. 横切关注点

- **Request ID**：Express 中间件读取/生成 `X-Request-ID`，回写响应头，并写入 `AsyncLocalStorage` 请求上下文。
- **结构化日志**：Pino（`AppLoggerService` 实现 NestJS LoggerService）。自动合并上下文（requestId/userId/storeId/platform/jobId），敏感字段 redact。开发 pretty、生产 JSON。
- **配置**：`@nestjs/config` + Joi 启动校验（`apps/api/src/config/env.validation.ts`）。缺失关键 ENV 时进程拒绝启动。
- **凭证加密**：`CredentialEncryptionService`（AES-256-GCM），密钥来自 `CREDENTIAL_ENCRYPTION_KEY`。
- **运行时系统设置**：`system_settings`（key → jsonb）承载需要运维在线调整的参数，
  当前唯一的键是 `orderFallbackHours`（订单平台事实回读的分阶段阈值
  2h/12h/24h）。读取走 `SystemSettingsService`（非法值回退默认），修改仅管理员
  （`PATCH /api/v1/system/settings`），页面在「系统设置 → 订单回读频率」。
  这类参数不放 ENV：改 ENV 需要重启，而回读频率是运营现场可调的。
- **推送订阅健康巡检**：`WebhookHealthService` 随调度 tick 每 6h 扫一遍店铺，
  平台侧订阅被暂停 → 异常 + 通知；店铺抽屉可「立即体检」（只读探测）。
  巡检结果只进异常/通知，不改订阅状态（真实写操作仍须人工/运维脚本显式触发）。

## 5. 关键工程约束（与 AGENTS.md 对齐）

1. tsx（esbuild）不支持 `emitDecoratorMetadata` —— API 运行时一律使用 `@nestjs/cli`（tsc）编译产物；tsx 仅用于无装饰器的脚本（迁移、seed、架构检查）。
2. 迁移 CLI datasource（`apps/api/src/database/datasource.ts`）的 `entities` 指向 `apps/api/dist`：`migration:generate` 前需 `pnpm --filter @wcies/api build`；run/revert/show 不加载实体。
3. 被 DI 注入的类必须使用值导入（不能用 `import type`），ESLint `consistent-type-imports` 以 `no-type-imports` 方向启用以避免冲突。
4. `packages/api-client` 的 schema 由 OpenAPI 生成并提交入库；API 变更后运行 `pnpm openapi:export && pnpm api-client:generate`。

## 6. 已知缺口：OpenAPI response schema（技术债，待统一修复）

**现象**：部分 Controller 的返回类型未被 Swagger 正确采集，`openapi.json` 中的
envelope schema 为空对象（`properties: {}`），被引用的业务 DTO 完全不出现在
`components.schemas` 中。已确认受影响：`ShipmentEnvelopeDto`（因此
`ShipmentDetailDto` 缺失）。

**后果**：

- `pnpm openapi:export && pnpm api-client:generate` 对这些接口**不产生任何 diff**，
  容易误判为"契约无变化"；
- 前端拿不到生成类型，只能长期维护**手写本地 interface**（如
  `apps/web/src/pages/shipments/ShipmentDetailPage.tsx` 的 `ShipmentDetail`），
  与后端 DTO 漂移时没有编译期保护；
- AGENTS.md §72「前端优先使用 OpenAPI 生成的 api-client」在这些页面上实际未生效。

**本次不修复的原因**：VOIDED 改造已包含 migration / repository / service / 前端 /
测试，把"统一梳理所有 Controller 的 response 类型"纳入其中属于范围蔓延
（AGENTS.md §95），应作为独立的架构清理单独排期。

**后续统一修复要点**：

1. controller 方法显式声明返回类型，或在 envelope DTO 上用 `@ApiProperty` 显式
   引用业务 DTO，使 Swagger 能采集到；
2. 校验方式：导出后 `grep ShipmentDetailDto openapi.json` 必须命中，且
   `ShipmentEnvelopeDto.properties` 非空；
3. 补齐后重新生成 api-client，并把前端手写 interface 逐步替换为生成类型。

## 7. 主数据模型（2026-10-13 决策 0020 起）

**Internal SKU 是唯一商品主数据**——不存在独立的 Product / SPU 层（`products`
表已在迁移 `20261013_002` 删除）。

```text
brands ──┐
         ├─→ skus （category_id / brand_id 为 SKU 自身字段，均可空）
categories┘        │
                   ├─→ sku_barcodes        （1:N，至多一个 is_primary）
                   ├─→ sku_images          （1:N）
                   ├─→ sku_bundle_components（自引用 N:M 组合装）
                   └─→ platform_listing_skus（映射到平台变体；listing 记录独立保留）
                            │
platforms ─→ stores ─→ platform_listings ┘

platform_category_mappings ─→ categories   （平台类目 → 内部三级分类，不挂 SKU/商品）
```

要点：

- **模式**：`skus` 挂分类/品牌（`category_id` / `brand_id`，FK + 索引），分类仍
  必须三级（决策 0005）；`skus.product_id` 已随商品层移除。
- **编码**：`sku_code` = `SKU%09d`，单一 `business_code_sequences` 作用域
  `sku`（决策 0020 D2）；品牌 `BN%05d`、分类 `CN%05d` 不变。
- **路由**：`/api/v1/skus*`（含 `DELETE /skus/:id?force=true`）为唯一主数据
  入口；`/api/v1/products*` 已删除（全 404）。
- **依赖方向不变**：Controller → Service → Repository → PostgreSQL；跨模块只经
  公开 Service（catalog 暴露 `CatalogService` 供 SKU 校验分类/品牌与名称匹配）。
- **库存/订单/采购/调拨/财务只依赖 SKU**，本次改造未触碰这些模块的表结构。
- **平台侧同名异物**：integration 层的 `product_id` / `description_category_id`
  是平台字段，与已删除的内部 Product 层无关，不得混改。
