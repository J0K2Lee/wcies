# WCIES Agent Task — Sprint 6 手工测试问题修复

> **本任务书来源**：用户在 2026-09-10 完成手工 GUI 测试后提交的 30 条问题清单
> （原始文件：`docs/#WCIES 2.0 人工测试.MD`）。
>
> **本任务书性质**：主数据治理 + 前端可用性修复。**不是**新业务功能 Sprint。
>
> **执行前必读**：`AGENTS.md` 全文（根级硬性纪律）、`docs/business-rules/master-data.md`、
> 本任务书第 4 节（事实基线）。第 3 节的决策已由用户拍板，**执行会话不得重新讨论或改回**。

---

## 目录

- [第 0 节 使用说明](#第-0-节-使用说明)
- [第 1 节 环境与启动](#第-1-节-环境与启动)
- [第 2 节 当前基线](#第-2-节-当前基线)
- [第 3 节 已锁定决策](#第-3-节-已锁定决策不得重新讨论)
- [第 4 节 事实基线](#第-4-节-事实基线)
- [第 5 节 任务分解与依赖](#第-5-节-任务分解与依赖)
- [第 6 节 T0 文档先行](#第-6-节-t0--文档先行阻塞-t2t3)
- [第 7 节 T1 后端异常过滤器修正](#第-7-节-t1--后端异常过滤器修正无-migration)
- [第 8 节 T2 编码体系](#第-8-节-t2--编码体系migration--service)
- [第 9 节 T3 三级分类 + 品牌命名](#第-9-节-t3--三级分类--品牌命名migration)
- [第 10 节 T4 删除能力](#第-10-节-t4--删除能力零引用校验)
- [第 11 节 T5 前端独立改进](#第-11-节-t5--前端独立改进不依赖后端改动)
- [第 12 节 T6 前端接线](#第-12-节-t6--前端接线依赖-t2t3t4)
- [第 13 节 T7 基础设施与文档](#第-13-节-t7--基础设施与文档)
- [第 14 节 验证与提交](#第-14-节-验证与提交)
- [第 15 节 附录](#第-15-节-附录)

---

## 第 0 节 使用说明

### 0.1 允许修改的目录

```text
apps/api/src/            后端业务代码
apps/api/scripts/        seed / 一次性脚本
apps/web/src/            前端代码
database/migrations/     新增 migration（禁止修改历史文件）
docs/                    业务规则文档、决策记录、报告
CONTEXT.md               仓库根术语表（新建）
docker-compose.yml       T7 前端容器
```

### 0.2 必须遵守的 AGENTS.md 条款

| 条款 | 要求 |
|---|---|
| §55 | Entity 与 Migration 必须**同时提交**，禁止只改一处 |
| §56 | Migration 进入共享环境后**不修改原文件**，需要修正就新建 |
| §57 | UUID 是数据库身份，业务编号是独立字段，不得混用 |
| §73 | **禁止擅自安装新依赖或升级依赖版本** |
| §84 / §85 / §86 | 长期业务知识进 `docs/`；改业务规则必须同步改文档 |
| §96 | 不得静默进行架构迁移 |
| §97 | **不得为了实现方便而简化业务规则** |
| §98 | 不得自行新增业务状态枚举 |
| §99 | 不得删除"看起来没用"的字段 |
| §100 | 宣布完成前必须逐项自检 |

### 0.3 硬性禁止

1. **禁止修改任何库存 / 订单业务规则**（AGENTS.md §10/§97）。本任务书不触碰 InventoryService 的任何写入路径。
2. **禁止绕过 `InventoryService`** 操作库存表。
3. **禁止新增或升级任何依赖**。本任务书全部改动均可用现有依赖完成。
4. **禁止修改历史 Migration 文件**。
5. **禁止删除用户提供的 `docs/#WCIES 2.0 人工测试.MD`**（只建议改名，是否改名由用户决定）。
6. **禁止把"环境 OOM，单 worker 全部通过"写成"默认测试通过"**（任务书 §73 要求如实表述）。
7. **禁止在报告中使用模糊表述**。修复不了的要写明"未修复 + 原因"，不要写"已优化"。

### 0.4 关于第 4 节的使用方式

第 4 节列出了所有已核实的事实，**每条都带 `文件:行号`**。这些行号在 2026-09-10 的
`main` 分支（HEAD = `65b3abb`）上核实过。执行会话**不需要重新探索这些内容**，直接按引用定位。

注意：若先执行了前面的任务导致行号偏移（例如 T2 改了 `product-sku.dto.ts`），
后续任务的行号需要按 diff 自行校正。每个任务内部的行号在同一任务内是准确的。

---

## 第 1 节 环境与启动

### 1.1 服务地址

| 服务 | 地址 | 说明 |
|---|---|---|
| Web | http://localhost:5173 | 前端开发服务器（BrowserRouter，非 hash 路由） |
| API | http://localhost:3000/api/v1 | REST 前缀 |
| Swagger UI | http://localhost:3000/api/docs | 接口文档 |
| OpenAPI JSON | http://localhost:3000/api/docs-json | 用于生成 api-client |
| Health | http://localhost:3000/health/live · `/health/ready` | 存活 / 就绪探针（**无鉴权**） |
| MinIO Console | http://localhost:9001 | `wcies_minio_dev` / `wcies_minio_dev_secret` |
| PostgreSQL | localhost:5432 | `wcies` / `wcies_dev_password` / `wcies_dev` |
| Redis | localhost:6379 | BullMQ |

### 1.2 命令清单（命令名已核实，勿臆造）

```bash
pnpm install              # 安装依赖
pnpm docker:up            # 启动 postgres / redis / minio
pnpm db:migrate           # 执行迁移
pnpm db:rollback          # 回滚最后一个迁移
pnpm db:migration:show    # 列出已执行 / 待执行
pnpm db:migration:create <Name>   # 新建空迁移脚手架（自动命名，见 §1.3）
pnpm seed:dev             # 创建开发管理员（读 .env 的 ADMIN_*）
pnpm seed:sprint1         # 幂等示例数据
pnpm dev                  # API(:3000) + Web(:5173) 并行
pnpm dev:api              # 仅 API
pnpm dev:web              # 仅 Web
pnpm dev:worker           # 独立队列 Worker

pnpm lint                 # eslint
pnpm typecheck            # 全量类型检查
pnpm check:arch           # 架构检查（注意：不是 check:architecture）
pnpm test                 # 单元测试
pnpm test:integration     # 集成测试（先确保 wcies_test 库）
pnpm build                # 全量构建
pnpm openapi:export       # 导出 openapi.json
pnpm api-client:generate  # 由 openapi.json 生成 api-client
pnpm check:openapi        # 校验 openapi.json 与代码一致
```

### 1.3 Migration 命名与创建

**必须用脚手架命令创建，禁止手工命名文件：**

```bash
pnpm db:migration:create AddBusinessCodeSequences
# → database/migrations/20260912_001_add_business_code_sequences.ts
```

命名规则（`scripts/db.ts`）：文件名 `YYYYMMDD_NNN_snake_name.ts`，
类名由脚本自动追加 `Date.now()` 毫秒时间戳（TypeORM 依赖类名排序）。
**最新已存在迁移是 `20260911_007_sku_units_g_mm_and_purchase_url.ts`。**

### 1.4 集成测试的已知环境问题

集成测试默认并行运行时会出现 `read ECONNRESET` 导致部分文件失败（
本机 2026-09-10 实测：默认并行 3 个文件失败 / 15 用例失败）。

**处理方式**：改用单 worker 运行 ——

```bash
npx vitest run --config vitest.config.integration.ts --maxWorkers=1
# 实测：16 文件 / 134 用例全部通过
```

**报告措辞要求**（任务书 §73）：必须如实写
「环境并行不稳，单 worker 全部通过」，**不得**写成「默认测试通过」。

### 1.5 数据库访问注意

```bash
# 正确：必须带 -i，否则 psql 读不到 stdin，静默退出、无任何输出、无任何效果
docker exec -i wcies-postgres psql -U wcies -d wcies_dev -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) FROM stores;
SQL

# 错误：漏了 -i，命令"看起来成功"但什么都没做
docker exec wcies-postgres psql -U wcies -d wcies_dev <<'SQL'
...
SQL
```

---

## 第 2 节 当前基线

### 2.1 数据库当前状态（2026-09-10 清理后）

| 表 | 行数 |
|---|---|
| `platforms` | 3（OZON / WB / YANDEX） |
| `users` | 1（admin） |
| `migrations` | 52 |
| brands / categories / products / skus / sku_barcodes | 0 |
| platform_listings / platform_listing_skus | 0 |
| warehouses / warehouse_bins / store_warehouse_bindings / stores | 0 |
| inventory_balances / ... / operation_logs | 0 |

**含义**：这是一个**干净的空白起点**。所有自动编码、分类层级、品牌改名等
改动都在**空表**上执行，不存在历史数据兼容负担 —— 但仍必须写正确的
回填 SQL（因为生产环境将来会有数据，且集成测试库会自行播种）。

### 2.2 测试基线

| 项 | 数量 |
|---|---|
| 单元测试 | 104 用例 / 15 文件 |
| 集成测试 | 134 用例 / 16 文件（独立 `wcies_test` 库） |
| 迁移文件 | 52 个 |

`wcies_test` 库由 `scripts/ensure-test-db.ts` 自行播种，**与 dev 库完全隔离**。

### 2.3 备份与恢复路径

| 项 | 位置 / 命令 |
|---|---|
| 全量备份 | `E:\wcies-backups\wcies_dev_20260910_235519.dump`（6.4 MB） |
| 备份内容 | 清理前数据：135 店铺 / 36,376 SKU / 1,439 listings / 真实凭证 |
| 恢复示例数据 | `pnpm seed:sprint1`（幂等） |
| 还原备份 | `pg_restore`（需用户明确要求，不要自行执行） |

> **注意**：备份包含真实的 OZON 店铺凭证。**禁止**把备份文件或其中的明文凭证
> 写入 git、日志或 API Response（AGENTS.md §29）。

### 2.4 当前分支

```text
main，HEAD = 65b3abb
工作区有 2 个未跟踪项：
  .zcode/plans/plan-sess_*.md            （工具产物，勿提交）
  docs/#WCIES 2.0 人工测试.MD             （用户测试清单，见 §0.3 第 5 条）
```

---

## 第 3 节 已锁定决策（不得重新讨论）

> 以下 20 条已由用户在 2026-09-10 逐项确认。**执行会话不得改回、不得重新讨论、不得"优化"成别的方案。**
> 如执行中发现问题确实无法按此实现，**停下来报告**，不要自行改方案。

| # | 项 | 决定 |
|---|---|---|
| 1 | 交付边界 | 一次性全做（含 Migration 与冻结规则修订） |
| 2 | 删除策略 | **零引用才可删**；有引用返回 `*_IN_USE` + 提示"只能停用"；零引用真删 |
| 3 | 仓库编码 | `ZG/PT/SF/TH-%02d`，对应 SELF/PLATFORM/THIRD_PARTY/RETURN_TEMP；**类型创建后不可改** |
| 4 | 店铺编码 | `ON/WS/YX-%03d`（严格按平台**首尾字母**：Ozon→ON、Wildberries→WS、Yandex→YX） |
| 5 | 品牌编码 | `BN%05d` |
| 6 | 分类编码 | `CN%05d`，一/二/三级**共用一条序列** |
| 7 | 商品编码 | `PN%06d`（**替换现有 `PRD%06d`**），创建后只读 |
| 8 | SKU 编码 | `SKU{商品序号 6 位}{商品内 SKU 序号 3 位}`，如 `SKU000001001`；生成后冻结 |
| 9 | 内部条码 | **保持独立** `WCSKU%08d`，不与 SKU 编码合并（扫码载体越短越好扫） |
| 10 | 序号溢出 | 宽度是**最小宽度**，溢出自然进位（`%02d` 对 100 输出 `100`），不报错 |
| 11 | 品牌命名 | `name_zh` 列改名为 `name`（一般名称，必填）；**新增** `name_zh`（中文名，可空）；保留 `name_en`/`name_ru` |
| 12 | 分类层级 | 最多三级；存 `level` 列 + CHECK；商品分类**选填**，填则**必须三级** |
| 13 | 分类重名 | **同父下唯一**（含根级之间）；错误码 `CATEGORY_NAME_DUPLICATED` |
| 14 | 分类管理 | **补管理视图**（编辑 / 停用 / 启用 / 零引用删除 / 同级排序 / 改父） |
| 15 | Reservation 中文 | **库存占用**（术语表锁定，全站统一；页面标题与菜单用此词） |
| 16 | 首页 | 改运营看板（4 KPI + 运营待办 + 趋势 + 异常流），**全部真实数据源** |
| 17 | 店仓绑定 | **保留页面**，另在仓库详情 / 店铺详情加"管理绑定"快捷入口 |
| 18 | 扫码 | 结论：**Code128 一维条码**（非 EAN-13）；本轮只写文档不实现 |
| 19 | 用户管理 | 本轮**不做**用户 CRUD（需先定权限模型）；只做顶栏真实用户 + 退出登录 |
| 20 | 前端 Docker | dev（Vite + 热加载）+ 生产（nginx 多阶段）；**不新增依赖** |

### 3.1 十条编码规则速查

| 对象 | 规则 | 序列作用域 | 示例 |
|---|---|---|---|
| 仓库 | `{前缀}-%02d` | `warehouse:{TYPE}` | `ZG-01` / `TH-01` |
| 店铺 | `{前缀}-%03d` | `store:{PLATFORM}` | `ON-001` / `YX-001` |
| 品牌 | `BN%05d` | `brand` | `BN00001` |
| 分类 | `CN%05d` | `category` | `CN00251` |
| 商品 | `PN%06d` | `product` | `PN000001` |
| SKU | `SKU%06d%03d` | `sku:{productId}` | `SKU000001001` |
| 内部条码 | `WCSKU%08d` | 现有 sequence，**不改** | `WCSKU00000001` |

前缀映射：

```text
仓库类型 → 前缀
SELF         → ZG   （自管）
PLATFORM     → PT   （平台）
THIRD_PARTY  → SF   （第三方）
RETURN_TEMP  → TH   （退货暂存）

平台 → 前缀
OZON   → ON
WB     → WS
YANDEX → YX
```

### 3.2 序号作用域语义

- `warehouse:{TYPE}`：四种仓库类型**各自独立**递增 → 第一个自管仓 `ZG-01`，第一个第三方仓 `SF-01`。
- `store:{PLATFORM}`：三个平台**各自独立**递增 → 第一个 OZON 店 `ON-001`，第一个 WB 店 `WS-001`。
- `sku:{productId}`：**每个商品**独立递增 → 每个商品的第一个 SKU 都是 `001`。

---

## 第 4 节 事实基线

> 所有引用均在 2026-09-10 / HEAD `65b3abb` 上核实。执行会话可直接定位，无需重新探索。

### 4.1 认证现状

**后端已经防住了，前端是 fail-open。**

- 全局守卫：`apps/api/src/app.module.ts:71` 注册 `{ provide: APP_GUARD, useClass: JwtAuthGuard }`。
- 守卫实现：`apps/api/src/modules/auth/guards/jwt-auth.guard.ts:27-61`
  - 读 `@Public()` 元数据（`decorators/public.decorator.ts:3-6`，key = `isPublicRoute`）
  - 从 **HttpOnly cookie `wcies_session`** 读 JWT（`:37-41`），**不支持 `Authorization: Bearer`**
  - `jwtService.verifyAsync` → 加载 user → 必须 `status === ACTIVE`
  - 失败抛 `UnauthorizedError`（401 / `AUTH_UNAUTHORIZED`）
- 公开路由（其余全部受保护）：
  - `POST /api/v1/auth/login`（`auth.controller.ts:22`）
  - `POST /api/v1/auth/logout`（`auth.controller.ts:49`）
  - `GET /health`、`/health/live`、`/health/ready`（`health.controller.ts:38,46,54`）
  - `POST /api/v1/webhooks/ozon/stores/:storeCode`（`ozon-webhook.controller.ts:18`，类级 `@Public()`）
- `GET /api/v1/auth/me` **受保护**。
- 管理员守卫：`apps/api/src/modules/auth/guards/admin.guard.ts`（`request.user.role !== 'ADMIN'` → 403）。

**前端问题：**

- `apps/web/src/app/App.tsx:31-65`：裸 `<Routes>`，**无任何认证检查、无 loader、无 redirect**。
- `apps/web/src/app/providers.tsx:30`：`BrowserRouter`（非 hash 路由）。
- `packages/api-client/src/client.ts:19-25`：openapi-fetch + `credentials: 'include'`，
  无 `Authorization` 头；单例在 `apps/web/src/api/client.ts:4`。
- **无 401 拦截、无跳转登录**：`apps/web/src/api/hooks.ts:44-46` 与 `:68-70`
  只 `throw new Error(error.error.message)`，**丢弃 `error.code` 与 `error.details`**。
- 页面从不读 `isError` → 401 被渲染成"空列表"（这是用户看到"能进页面但无数据"的原因）。
- `LoginPage.tsx:25-28`：成功后 `navigate('/')`，**无 `redirect` 回跳**。
- `AppLayout.tsx:325-340`：顶栏用户名**写死 "Admin"**。
- **全站无退出登录**：`/auth/logout` 从未被前端调用。

### 4.2 "Request validation failed" 的真实根因

**这不是字段校验失败，是被误标的 404。**

文件：`apps/api/src/common/filters/global-exception.filter.ts`

```typescript
// :117-138  normalizeHttpException
const code =
  status === 400 && this.isValidationBody(body)      // ← code 这里判了 400
    ? 'COMMON_VALIDATION_FAILED'
    : (HTTP_STATUS_TO_CODE[status] ?? 'COMMON_HTTP_ERROR');

if (typeof body === 'string') {
  message = body;
} else if (this.isValidationBody(body)) {            // ← message 这里没判 400（BUG）
  details.validationErrors = body.message;
  message = 'Request validation failed';
}

// :140-149  isValidationBody —— 从不检查 status
private isValidationBody(body: string | object): body is {...} {
  return (
    typeof body !== 'string' &&
    'message' in body &&
    (Array.isArray(body.message) || typeof body.message === 'string') &&
    'statusCode' in body
  );
}
```

Nest 默认 `NotFoundException` 的 body 是 `{message:'Cannot POST /path', error:'Not Found', statusCode:404}`，
**同时满足 `message` + `statusCode`** → 被 `isValidationBody` 判定为校验失败 → message 被改写。

**实测（2026-09-10 对本地 dev API）：**

```json
// 真实 400（公开登录路由）
{"success":false,"error":{"code":"COMMON_VALIDATION_FAILED","message":"Request validation failed",
 "details":{"validationErrors":["usernameOrEmail must be longer than or equal to 3 characters", ...]}}}

// 未匹配路由 404 —— 同样显示 "Request validation failed"
{"success":false,"error":{"code":"COMMON_NOT_FOUND","message":"Request validation failed",
 "details":{"validationErrors":"Cannot POST /api/v1/warehouses//bins/batch"}}}

{"success":false,"error":{"code":"COMMON_NOT_FOUND","message":"Request validation failed",
 "details":{"validationErrors":"Cannot POST /api/v1/stores//credentials"}}}
```

**判别特征**：真实 400 的 `details.validationErrors` 是**数组**；
404 误报时是**字符串**。可据此写断言测试。

`ValidationPipe` 配置：`apps/api/src/main.ts:37-43`

```typescript
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
}));
```

**附带瑕疵（非阻断）**：`main.ts:54-62` 给 Swagger path 重复添加 `/api/v1` 前缀，
导致 live 文档出现 `/api/v1/api/v1/...` 这样加倍路径。仅影响文档显示，
运行时路由正确；但 `openapi.json` 与 `check:openapi` 会受影响，T1 顺手修正。

### 4.3 弹窗"未在最前" + "空路径 404"（同一条因果链）

**两个症状是同一个根因，不要当成两个 bug 修。**

**链路：**

1. 弹窗/表单提交时用 `detailId ?? ''` 拼路径参数。
   **全量排查结果：写路径 5 处（全部有同样缺陷），读路径 6 处（风险低）。**

   **写入路径（必须全部修，用户只报了其中 2 处）**：

   ```text
   ① apps/web/src/pages/warehouses/WarehousesPage.tsx:140   批量建位       ← 用户第 3 条
   ② apps/web/src/pages/stores/StoresPage.tsx:256           配置凭证       ← 用户第 6 条
   ③ apps/web/src/pages/stores/StoresPage.tsx:272           校验凭证
   ④ apps/web/src/pages/warehouses/BinsPage.tsx:39          新建库位       ← 用户未报，同缺陷
   ⑤ apps/web/src/pages/listings/ListingsPage.tsx:55        人工映射       ← 用户未报，同缺陷
   ```

   ①② 的代码形态：

   ```typescript
   // WarehousesPage.tsx:137-141
   mutationFn: (values: Record<string, string>) =>
     apiPost<{ createdCount: number }>('/api/v1/warehouses/{warehouseId}/bins/batch', values, {
       warehouseId: detailId ?? '',
     }),

   // StoresPage.tsx:251-257
   apiPost('/api/v1/stores/{storeId}/credentials',
     { credentialType: 'MAIN_API', payload: values },
     { storeId: detailId ?? '' })
   ```

   ④⑤ 的代码形态（同一模式，同样会发空路径请求）：

   ```typescript
   // BinsPage.tsx:39
   apiPost('/api/v1/warehouses/{warehouseId}/bins', values, { warehouseId: warehouseId ?? '' }),

   // ListingsPage.tsx:55
   apiPost('/api/v1/listings/{listingId}/skus/{id}/map',
     { skuId }, { listingId: detailId ?? '', id: mapTarget?.id ?? '' })
   ```

   **读取路径（风险低，多数已有 `enabled` 保护，但要确认）**：

   ```text
   WarehousesPage.tsx:107  ·  ProductsPage.tsx:95, :104  ·  ListingsPage.tsx:112
   StoresPage.tsx:211, :218   （这两个已用 enabled: detailId !== null 保护）
   ```
2. 空路径 → `/api/v1/warehouses//bins/batch` → 404 → 被 §4.2 的过滤器误标为"校验失败"。
3. `detailId` 为什么会空：
   - Drawer 与 Modal 的 z-index **都是 1100**
     （`token.zIndexPopupBase(1000) + containerBaseZIndexOffset(100)`）；
   - Modal 因为 `forceRender` 从页面挂载起就存在 portal；
   - Drawer 的 portal 在打开时才挂载 → **同层级、后挂载 → Drawer 盖在 Modal 上**（用户看到的"弹窗未在最前"）；
   - 用户点击 Drawer 遮罩 → `onClose={() => setDetailId(null)}`
     （`WarehousesPage.tsx:428`、`StoresPage.tsx:737`）→ `detailId` 置空；
   - 但 Modal 的 `open` state 独立，且 `forceRender` 使其保持挂载 → 点"确定"就发出空路径请求。

4. `forceRender` 的历史：它是此前为消除 antd "useForm not connected" 警告而添加的
   （commit `866ed68`），应改为"打开时 `resetFields`"。

**凭证弹窗回显旧值（用户第 7 条）：**

- `StoresPage.tsx:261`：仅在 `onSuccess` 里调 `credentialForm.resetFields()`；
- `onCancel`（`:811`）**不重置** → 下次打开仍是上次输入的内容。

### 4.4 写接口矩阵

> **关键结论：绝大多数"不能编辑/删除"的诉求，后端接口早已存在，只是前端没做按钮。**
> 行号均在对应 controller 文件内。

| 实体 | 已有接口 | 缺失 |
|---|---|---|
| Warehouse | `POST /warehouses` :55、`PATCH /warehouses/:id` :72、`POST /warehouses/:id/activate` :83、`/deactivate` :94 | DELETE |
| WarehouseBin | `POST /warehouses/:wid/bins` :122、`/bins/batch` :133、`PATCH .../bins/:binId` :144、`/disable` :156、`/enable` :168 | DELETE |
| StoreWarehouseBinding | `POST /stores/:sid/warehouse-bindings` :210、`PATCH .../:id` :221、`/disable` :233、`/enable` :245 | DELETE |
| Store | `POST /stores` :42、`PATCH /stores/:id` :59、`/activate` :70、`/deactivate` :81 | DELETE |
| Brand | `POST /brands` :34、`PATCH /brands/:id` :44（DTO 含 `status`） | DELETE、独立启停路由 |
| Category | `POST /categories` :64、`PATCH /categories/:id` :74（含 `status`、环检测） | DELETE |
| Product | `POST /products` :43、`PATCH /products/:id` :60、`/activate` :71、`/deactivate` :82 | DELETE |
| Sku | `POST /skus` :66、`PATCH /skus/:id` :83、`/activate` :94、`/deactivate` :105 | DELETE |
| SkuBarcode | `POST /skus/:skuId/barcodes` :127、`/generate-internal` :138、`PATCH .../:id` :149、**`DELETE .../:id` :161** | — |
| PlatformListing | `POST /listings` :72、`PATCH /listings/:id` :116、`/activate` :127、`/deactivate` :138 | DELETE |
| ListingSku | `POST /listings/:listingId/skus` :149、`/map` :160、`PATCH .../:id` :175、`DELETE .../:id` :187 | — |
| Platform | 只有 `GET /platforms`、`GET /platforms/:id`（`platform.controller.ts:14,21`）—— **有意只读**，不开放写 | — |

Controller 文件位置：

```text
apps/api/src/modules/warehouse/controllers/warehouse.controller.ts   （含 3 个 controller 类）
apps/api/src/modules/store/controllers/store.controller.ts
apps/api/src/modules/store/controllers/store-credential.controller.ts
apps/api/src/modules/catalog/controllers/catalog.controller.ts
apps/api/src/modules/product/controllers/product.controller.ts
apps/api/src/modules/product/controllers/sku.controller.ts
apps/api/src/modules/listing/controllers/listing.controller.ts
apps/api/src/modules/platform/controllers/platform.controller.ts
```

**既有缺口（T4 必须修）：**

`DELETE /listings/:listingId/skus/:id` 的注释与文档声称"无订单历史才可删"
（`listing.service.ts:340` 上方注释 "Allowed while the mapping has no order history (spec §66)"），
但实际实现**没有任何引用检查**：

```typescript
// apps/api/src/modules/listing/services/listing.service.ts:340-357  deleteMapping
/** Allowed while the mapping has no order history (spec §66). */
async deleteMapping(
  listingId: string,
  mappingId: string,
  operator: OperatorContext,
): Promise<void> {
  const mapping = await this.findOwnedMappingOrThrow(listingId, mappingId);
  await this.repository.deleteMapping(mappingId);     // ← :347 直接删，无校验
  await this.operationLog.record({ ... });            // operation log 已有
}
```

```typescript
// apps/api/src/modules/listing/repositories/listing.repository.ts:251-253
async deleteMapping(id: string): Promise<void> {
  await this.mappingRepository.delete({ id });      // ← 撞 FK 时抛原始数据库错误
}
```

有订单引用时会撞 FK（`order_items.listing_sku_id`，见 `20260909_002:58-61`），
用户看到的是数据库级错误而非业务错误。

### 4.5 编码现状

**已有的 PostgreSQL sequence（3 条，均为业务编码）：**

| 序列 | 定义位置 | 用途 |
|---|---|---|
| `seq_product_code` | `database/migrations/20260908_006_create_products.ts:10` | 商品 |
| `seq_sku_code` | `database/migrations/20260908_007_create_skus.ts:10` | SKU |
| `seq_internal_barcode` | `database/migrations/20260908_008_create_sku_barcodes.ts:11` | 内部条码 |

**格式化位置：**

| 对象 | 格式 | 位置 |
|---|---|---|
| Product | `PRD%06d` | `apps/api/src/modules/product/repositories/product.repository.ts:100-105` |
| SKU | `SKU%06d` | `apps/api/src/modules/product/repositories/sku.repository.ts:197-202` |
| 内部条码 | `WCSKU%08d` | `apps/api/src/modules/product/repositories/sku-barcode.repository.ts:38-43` |

**不存在的东西**：`business_number_sequences` 表、`BusinessCodeService` 类
（Sprint 0 文档 `docs/WCIES_Sprint_0_工程初始化规格_V1.md:2320-2345` 只写了"可以预留"）。

**code 字段归属现状：**

| 实体 | code 来源 | DTO 位置 |
|---|---|---|
| Product | **可选**，省略则服务端生成 | `dto/product-sku.dto.ts:24-32`（ApiProperty 描述已写明 "Auto-generated (PRD%06d) when omitted"） |
| SKU | **可选**，省略则服务端生成 | `dto/product-sku.dto.ts:191-199`（描述 "Auto-generated (SKU%06d) when omitted"） |
| Warehouse | 客户端必填 | `dto/warehouse.dto.ts:23-27`（`CreateWarehouseRequestDto`） |
| Store | 客户端必填 | `dto/store.dto.ts:6-14`（`CreateStoreRequestDto`） |
| Brand | 客户端必填 | `dto/catalog.dto.ts:7-11` |
| Category | 客户端必填 | `dto/catalog.dto.ts:82-91` |
| Bin | 客户端必填（barcode 可自动） | `dto/warehouse.dto.ts:205-239` |

**唯一性约束（已存在）：** `warehouses.warehouse_code`、`stores(platform_id, store_code)`、
`brands.code`、`categories.code`。

**Excel 导入类型**（`apps/api/src/modules/import/entities/import-job.entity.ts:17-25`）：

```typescript
IMPORT_TYPES = ['SKU', 'BARCODE', 'WAREHOUSE', 'BIN', 'LISTING_MAPPING', 'INITIAL_INVENTORY']
```

**自动编码必须兼容导入模板**：导入时 `code` 留空应走自动生成，不能报错。

### 4.6 分类与品牌表结构（现状）

**`categories`**（`database/migrations/20260908_005_create_brands_categories.ts:29-63`）：

```text
id            uuid PK
parent_id     uuid NULL，自引用 FK（fk_categories_parent）
code          varchar(100) NOT NULL UNIQUE（uq_categories_code）
name_zh       varchar(200) NOT NULL
name_ru       varchar(200) NULL
sort_order    integer NOT NULL DEFAULT 0
status        varchar(30) NOT NULL DEFAULT 'ACTIVE'
created_at / updated_at
索引：idx_categories_parent (parent_id)
```

**缺**：`level`、`name_en`、深度限制、同名校验。

**`brands`**（同文件 `:8-27`）：

```text
id         uuid PK
code       varchar(100) NOT NULL UNIQUE（uq_brands_code）
name_zh    varchar(200) NOT NULL
name_en    varchar(200) NULL
name_ru    varchar(200) NULL
status     varchar(30) NOT NULL DEFAULT 'ACTIVE'
created_at / updated_at
```

**`products` / `skus`**：只有 `name_zh` / `name_ru`，**无 `name_en`**。

**分类的两个现有缺陷：**

1. `apps/web/src/pages/products/ProductsPage.tsx:198-201` 的 `flatCategories`
   **只展开两层**（根 + 一层子节点）→ **三级类目现在根本选不到**。
2. `apps/api/src/modules/product/repositories/product.repository.ts:59-60`
   用 `category_id = :categoryId` **精确匹配** → 选一级分类查不出子类商品。

**状态常量位置：**

| 常量 | 值 | 位置 |
|---|---|---|
| `COMMON_STATUSES` | `['ACTIVE','INACTIVE']` | `catalog/dto/catalog.dto.ts:5` |
| `WAREHOUSE_STATUSES` | `['ACTIVE','INACTIVE']` | `warehouse/entities/warehouse.entity.ts:62` |
| `WAREHOUSE_TYPES` | `['SELF','PLATFORM','THIRD_PARTY','RETURN_TEMP']` | `warehouse/entities/warehouse.entity.ts:59` |
| `STORE_STATUSES` | `['ACTIVE','INACTIVE']` | `store/constants/store.constants.ts:1` |
| `CREDENTIAL_TYPES` | `['MAIN_API']` | `store/constants/store.constants.ts:4` |
| `PRODUCT_STATUSES` | `['DRAFT','ACTIVE','INACTIVE']` | `product/entities/product.entity.ts:57` |
| `SKU_STATUSES` | `['DRAFT','ACTIVE','INACTIVE']` | `product/entities/sku.entity.ts:101` |
| `LISTING_STATUSES` | `['ACTIVE','INACTIVE']` | `listing/entities/platform-listing.entity.ts:54` |
| 映射状态 | `UNMAPPED` / `MAPPED`（含 DB CHECK） | `database/migrations/20260911_001:40-49` |
| 履约模式（8 个） | `OZON_RFBS/.../YANDEX_FBY` | `docs/business-rules/master-data.md:56` |

**软删除现状**：**所有表都没有** `deleted_at` / `is_deleted`。
唯一的软删模式是 3 张 shipment 表的 `status ACTIVE/VOIDED + voided_at`
（`database/migrations/20260910_010` / `011`），**仅此一处**。

**外键现状**：**所有 FK 均未指定 `onDelete` → PostgreSQL 默认 `NO ACTION`（阻塞删除）**。
硬删会被引用自动拦截（错误形态是数据库级错误，不是业务错误 —— 所以 T4 必须在服务层预检）。

### 4.7 前端标签与英文泄漏（逐行清单）

**已有的 label map（设计系统）：**

- `apps/web/src/design-system/components/StatusBadge.tsx:104-155`：
  `ERP_STATUS_META`（含 label）、`FULFILLMENT_STATUS_META`（**只有 tone，无 label**）、
  `PICKING_STATUS_META`、`INVENTORY_STATUS_META`、`SKU_STATUS_META`、`SYNC_STATUS_META`
- `apps/web/src/design-system/components/RiskIndicator.tsx:9-13`：`RISK_META`
- `apps/web/src/design-system/components/PlatformTag.tsx:7-12`：`PLATFORM_META`

**硬编码英文列名（库存流水）：**

- `apps/web/src/pages/inventory/InventoryTransactionsPage.tsx`
  第 113 / 120 / 130 / 132 / 139 行：`Before` / `Change` / `After` / `Reserved Δ` / `Picked Δ`
- `apps/web/src/pages/inventory/InventoryPage.tsx:737-759` 重复了同一组列名；
  其中 `:738` 的 `transactionType` **没有 render**，原样输出英文枚举。

**硬编码英文状态机提示：**

- `apps/web/src/pages/inventory/ReservationsPage.tsx:159`：
  `状态机：ACTIVE → PICKED → CONSUMED；ACTIVE 可释放；PICKED 可取消拣货回 ACTIVE`
- 同文件 `:84-89`：确认文案混英文（`释放占用（Reserved -N）`、`拣货（Reserved → Picked）` 等）

**状态枚举直出 DOM（无中文 label）：**

| 文件 | 行号 | 直出内容 |
|---|---|---|
| `import/ImportPage.tsx` | 30-36, 144, 150 | `VALIDATED/PENDING_IMPORT/IMPORTING/COMPLETED/FAILED` |
| `interceptions/InterceptionsPage.tsx` | 20-28, 47, 79 | `CREATED/ASSIGNED/LOCATING/INTERCEPTED/FAILED/RETURNED_TO_STOCK/CLOSED` |
| `interceptions/InterceptionDetailPage.tsx` | 59, 141, 153-157, 188 | 同上（Step 标题） |
| `shipments/ShipmentsPage.tsx` | 25-33, 78, 132 | `DRAFT/READY_TO_PACK/PACKING/READY_TO_SHIP/SHIPPED/CANCELLED/EXCEPTION` |
| `shipments/ShipmentDetailPage.tsx` | 82, 195, 294, 352 | shipment / package / item 状态 |
| `shipments/PackageWorkPage.tsx` | 148, 150 | `pkg.status` / `shipmentStatus` |
| `orders/OrdersPage.tsx` | 410, 431, 475, 682, 969 | `Reserved`、状态历史 `from → to`、fulfillment label |
| `sync/SyncCenterPage.tsx` | 620, 832 | `eventType`、事件抽屉 `status` |
| `skus/SkusPage.tsx` | 821, 912 | `barcodeType`、`platformCode` |
| `stores/StoreBindingsPage.tsx` | 132, 136, 193 | `platformCode`、`fulfillmentMode` |
| `stores/StoresPage.tsx` | 918 | `credentialType`（如 `MAIN_API`） |
| `warehouses/WarehousesPage.tsx` | 502, 527, 530 | 绑定 `fulfillmentMode`、非 ACTIVE 状态 |
| `listings/ListingsPage.tsx` | 215, 238, 376-380 | `platformCode`、状态、`MAPPED`/`UNMAPPED` 标签（`:184-185` 已有中文选项，但表格标签没用） |
| `DashboardPage.tsx` | 304, 339 | 非 ACTIVE 店铺状态、非 ORDER_SYNC 任务类型 |

**平台显示名问题：**

- `PlatformTag.tsx:7-12` 的 `PLATFORM_META` 用的 key 是 **`WILDBERRIES`**，
  但数据库里平台 code 是 **`WB`** → **WB 一直落到"原样输出"回退分支**（显示 `WB` 而不是设计好的标签）。
- `apps/web/src/pages/stores/StoresPage.tsx:778`（新增店铺的平台下拉）用
  `` `${platform.code} · ${platform.name}` `` 拼接 → 产生用户看到的
  `OZON · OZON`、`WB · Wildberries`、`YANDEX · Yandex Market`。
- 数据库 `platforms` 种子值（`database/migrations/20260908_001_create_platforms.ts:32-35`）：

```text
('OZON',   'OZON',          'ACTIVE')
('WB',     'Wildberries',   'ACTIVE')
('YANDEX', 'Yandex Market', 'ACTIVE')
```

**设计系统漏网页（无 PageHeader / FilterBar / DataTable / ContextRail，纯 antd）：**

- `apps/web/src/pages/products/ProductsPage.tsx`（外层布局在 `:204`）
- `apps/web/src/pages/listings/ListingsPage.tsx`（`:146`）

其余同样无 Rail：库存流水页、Reservation 页、Import、Interceptions、Shipments、
StoreBindings、Bins。**本任务书只要求补齐前两页**（用户明确提出的），其余不扩大范围。

**无 i18n 框架**：全部硬编码中文文案（属预期，**不引入 i18n 架构**）。

### 4.8 SKU 图片上传（不是"未实现"，是 bug）

前后端**都已实现**：

- 前端：`apps/web/src/pages/skus/SkusPage.tsx:864-870` 的 `<Upload customRequest>` →
  `uploadMutation`（`:291-310`）→ `fetch('/api/v1/skus/${drawerId}/images')`
- 后端：`apps/api/src/modules/product/controllers/sku.controller.ts:185-202`
  （`@UseInterceptors(FileInterceptor('file'))`，multipart）
  → `apps/api/src/modules/product/services/sku-image.service.ts:43-94`
  （校验 mime / size，key = `products/{productId}/skus/{skuId}/{uuid}.{ext}`，写 `sku_images` 表）
  → `apps/api/src/infrastructure/storage/object-storage.service.ts`
  （AWS SDK `S3Client` + `@aws-sdk/s3-request-presigner`，bucket 配置在 `app.s3`）

限制（`apps/api/src/modules/product/entities/sku-image.entity.ts:43-45`）：

```text
IMAGE_MIME_TYPES = ['image/png','image/jpeg','image/webp','image/gif']
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024   （5 MB）
```

**前端没有"删除图片"按钮**，但 API 已支持 `DELETE /skus/:skuId/images/:imageId`。

**失败候选（T5 需实测定位，不要猜）**：

1. 未选文件时 Upload 无任何反馈
2. dev 环境 MinIO 未启动 / bucket 未创建
3. mime / 5MB 校验静默失败，错误提示未展示

### 4.9 冻结规则冲突点

`docs/business-rules/master-data.md`：

```text
:23   Store/Warehouse/Binding/Listing：ACTIVE / INACTIVE(DISABLED)；不提供硬 DELETE。
:24   例外（spec §117）：无业务引用的 Barcode、SKU 图片、错误创建的数据允许物理删除。
:102-104  变更以下内容必须先改文档：编码规则、状态模型、条码唯一性、体积计算、
          履约模式集合或匹配规则、Listing 唯一性、Resolver 语义、导入模板或重复处理策略。
```

**决策 #2（零引用才可删）是把 `:24` 已有的例外在代码里落地，不是推翻 `:23`。**
但 `:102-104` 要求"改编码规则必须先改文档" → **T0 必须先于 T2/T3 完成**。

### 4.10 用户 30 条问题的逐条归属

| 用户原文位置 | 问题 | 归属任务 |
|---|---|---|
| 用户管理 1 | 未登录可进各页面 | T5 |
| 仓库 1 | 创建仓库可输入联系方式 | T6 |
| 仓库 2 | 批量建位弹窗未在最前 | T5 |
| 仓库 3 | 批量建位报 "Request validation failed" | T1 + T5 |
| 仓库 4 | 批量建位逻辑不明确 | T6 |
| 仓库 5 | 仓库无法编辑/删除/改启停 | T4 + T6 |
| 仓库 6 | 仓库编码自动编码 | T2 + T6 |
| 店铺 1 | 平台下拉显示多余 | T5 |
| 店铺 2 | 店铺编码自动编码 | T2 + T6 |
| 店铺 3 | 不同平台不同输入框 | **本批次不做**（记入 API Gap，待多平台完善） |
| 店铺 4 | 店铺无法编辑/删除 | T4 + T6 |
| 店铺 5 | 配置凭证弹窗未在最前 | T5 |
| 店铺 6 | 配置凭证报 "Request validation failed" | T1 + T5 |
| 店铺 7 | 凭证不应预填 | T5 |
| 店仓绑定 1 | 无法编辑/删除/启停 | T4 + T6 |
| 店仓绑定 2 | 模块是否多余 | 保留 + 快捷入口（T5/T6） |
| 商品 1 | 品牌编码自动 | T2 |
| 商品 2 | 品牌名称四字段 | T3 + T6 |
| 商品 3 | 三级分类（重点探讨项） | T3 + T6 |
| 商品 4 | 分类编码自动 | T2 + T6 |
| 商品 5 | 商品编码自动 | T2 + T6 |
| SKU 1 | SKU 编码规则 + 内部条码是否一致 | T2 + T0（文档结论：保持独立） |
| SKU 2 | 上传图片无响应 | T5 |
| SKU 3 | SKU 平台映射新建按钮 | T5 |
| SKU 映射 1 | 无法编辑/删除/启停 | T4 + T6 |
| UI 1 | 首页 Mapping 覆盖率信息价值低 | T5 |
| UI 2 | 首页店铺在线与侧栏重合 | T5 |
| UI 3 | 首页改运营看板 | T5 |
| UI 4 | 商品管理没有右侧栏 | T5 |
| UI 5 | SKU 映射没有右侧栏 | T5 |
| UI 6 | Reservation 显示英文 | T5 |
| UI 7 | 字段/属性/列名英文需排查 | T5 |
| 功能 1 | webhook 是否实现 / 本地怎么测 | T7 |
| 其他 1 | 前端 Docker 部署 + 热加载 | T7 |
| 其他 2 | 扫码用条码还是二维码 | T7（只出结论） |

---

## 第 5 节 任务分解与依赖

### 5.1 依赖图

```text
T0 文档先行（必须先于 T2/T3 —— master-data.md:102-104 要求）───┐
                                                              │
T1 后端异常过滤器修正  [独立，无 Migration]                    │
                                                              ▼
T2 编码体系 (Migration)  →  T3 三级分类 + 品牌 (Migration)  →  T4 删除能力
        （三者改同一批文件，必须串行；不要并行编辑同一文件）
                                                              │
                                                              ▼
                                                     T6 前端接线（依赖 T2/T3/T4 的接口）

T5 前端独立改进  [独立，不依赖后端改动]
T7 基础设施与文档  [独立，不碰 src 之外的东西]
```

**T5 与 T2/T3/T4 无冲突**（前者只改 `apps/web`，后者只改 `apps/api` + `database`），可并行。
**T6 必须等 T2/T3/T4 全部完成后开始**（它接线的接口由那三个任务产出）。

### 5.2 多会话分配建议

| 会话 | 任务 | 可修改目录 |
|---|---|---|
| 会话 A（后端） | T0 → T1 → T2 → T3 → T4 | `apps/api/src`、`database/migrations`、`docs` |
| 会话 B（前端） | T5（可并行）→ 等 A 完成后 T6 | `apps/web/src` |
| 会话 C（文档/基础设施） | T7 | `docs`、`docker-compose.yml`、`apps/web/Dockerfile`（新建） |

**冲突警告**：T0 与 T7 都改 `docs/`，需约定文件边界 ——
T0 改 `master-data.md` / 新建 `CONTEXT.md` + `docs/decisions/`；
T7 改 `docs/manual-test-fix-report.md` + 新建扫码与 Webhook 文档。**不要同时改同一文件。**

### 5.3 每任务的提交要求

- 开工前先打 **checkpoint commit**（记录当前状态，便于回滚）。
- **每个任务独立提交**，不要攒成一个大提交。
- Commit message 用 Conventional Commits，与既有风格一致：

```text
feat(api-catalog): add three-level category with level column and parent-name uniqueness
fix(api-common): stop mislabeling 404 responses as validation failures
feat(web): add auth gate with login redirect and 401 handling
docs(business-rules): rewrite coding rules and deletion policy for Sprint 6
```

---

## 第 6 节 T0 — 文档先行（阻塞 T2/T3）

> **为什么必须先做**：`docs/business-rules/master-data.md:102-104` 明确规定
> "变更编码规则、状态模型必须先改文档"。本任务书要改编码规则和删除策略，
> 因此文档必须在代码之前落地（AGENTS.md §84/§86）。

### 6.1 产出物

#### (1) `CONTEXT.md`（**仓库根，新建**）

**只放术语，不放实现细节**。这是全项目的统一语言表，中英对照。

至少收录以下术语（可补充，不可删减）：

| 中文 | 英文 | 说明 |
|---|---|---|
| 库存占用 | Reservation | 订单占住库存但商品仍在货架 |
| 已拣货 | Picked | 商品已从库位取出 |
| 现存 | On Hand | 实际在库数量 |
| 可售 | Available | 推导值，非独立事实源 |
| 安全库存 | Safety Stock | |
| 渠道库存 | Channel Inventory | 准备推送给平台的数量 |
| 内部 SKU | Internal SKU | 统一库存身份 |
| 平台 SKU | Platform SKU | 外部映射，不是主键 |
| 商品 | Product / SPU | |
| 商品链接 | Listing | |
| 映射 | Mapping（MAPPED / UNMAPPED） | |
| 类目树 / 三级分类 | Category Tree | 最多三级 |
| 一般名称 | General Name | 品牌的主显示名 |
| 拦截 | Interception | Picked 订单取消后的追回流程 |
| 库位 | Bin | |
| 单据占用号 | Reservation No | |

**格式要求**：Markdown 表格，中英两列 + 简短说明。**不要**写字段名、表名、代码。

#### (2) `docs/decisions/`（新建目录，AGENTS.md §85）

目录当前**不存在**，需创建。按顺序写 6 份决策记录：

**`0001-集中式业务编码序号表.md`**

必须论证的内容：

- **为什么用一张 `business_code_sequences` 表 + 作用域 key，而不是给每个实体建 PG sequence**：
  店铺编码需要"按平台各自递增"，SKU 编码需要"按商品各自递增" ——
  这两个需求本质是**动态作用域序号**。用 PG sequence 实现意味着要为每个平台、
  **每个商品**建序列（商品数量不定 → 不可能），所以必须自上而下建作用域序号能力。
- **原子性论证**：单条 SQL 完成"取号 + 递增"，无读-改-写窗口。
- **并发测试要求**：N 个并发请求取同一作用域，必须得到 N 个互不重复的号。

**`0002-SKU编码派生自商品编码.md`**

- `SKU{商品序号 6 位}{商品内 SKU 序号 3 位}` 的语义。
- **商品编码为什么必须转只读**：SKU 编码从商品编码派生，若商品编码可改，
  SKU 编码的派生关系就断裂（已打印的标签无法追认）。
- **SKU 编码为什么生成后冻结**：标签已打印贴到实物上，编码不能失效。

**`0003-零引用才允许物理删除.md`**

- 引用检查作为删除的前置条件；被引用返回 `*_IN_USE`。
- 与 `master-data.md:23`（不提供硬 DELETE）和 `:24`（错误创建的数据允许物理删除）的关系：
  **本决策是 `:24` 例外条款的落地，不是推翻 `:23`。**
- 与 AGENTS.md §25（业务数据可追溯）的一致性论证。

**`0004-前端认证守卫与401处理策略.md`**

- 后端已全局守卫（`APP_GUARD`），前端为何仍需 `AuthGate`：
  避免"外壳渲染 + 空数据"的误导性 UI。
- `redirect` 回跳策略。
- 401 为何不能重试（重试只会再拿一个 401）。
- 为何要保留 `error.code` / `error.details`（诊断能力）。

**`0005-三级分类语义.md`**

- 最多三级；商品只挂三级；同父下名称唯一。
- `level` 列 + CHECK 的设计选择（"最多三级"由数据库兜底，不可被任何代码路径绕过）。
- 四个边界场景（见 §9.4）。

**`0006-品牌命名语义.md`**

- 一般名称 / 中文名 / 英文名 / 俄文名 四个语义槽。
- `name` 为默认显示字段；其余为可选补充。

#### (3) 改 `docs/business-rules/master-data.md`

| 位置 | 改动 |
|---|---|
| §1 编码规则 | **整表重写**：保留 Product/SKU/内部条码/Bin 四行（Product 格式改为 `PN%06d`），新增 仓库/店铺/品牌/分类 四行；补作用域说明与"溢出进位"说明 |
| §2 状态模型 | 把"不提供硬 DELETE"改写为"零引用才可删 + 有引用返回 `*_IN_USE`" |
| 新增章节 | 「分类层级」：三级规则、商品只挂三级、同父唯一、level 与 CHECK |
| §12 错误码 | 补 T2/T3/T4 新增的全部错误码 |

**注意**：`master-data.md` 是**冻结规则文档**，改动要克制 —— 只改上述四处，
不要顺手重写其他章节（AGENTS.md §95：只改必要范围）。

### 6.2 完成标准

- `CONTEXT.md` 存在且只有术语。
- `docs/decisions/` 下 6 份文件存在，每份都有 `# 标题` / 状态 / 背景 / 决策 / 理由 / 影响。
- `master-data.md` 的 §1、§2、§12 已更新且新增分类章节。
- **此时不要改任何代码。**

---

## 第 7 节 T1 — 后端异常过滤器修正（无 Migration）

### 7.1 问题

见 §4.2。`isValidationBody()` 不检查 HTTP 状态码，导致**所有 404 被误标为校验失败**。

### 7.2 改动

**文件**：`apps/api/src/common/filters/global-exception.filter.ts`

**改法**：`normalizeHttpException` 的 message 分支必须与 code 分支使用同一判定条件
（即 `status === 400 && this.isValidationBody(body)`），而不是单独调用 `isValidationBody(body)`。

推荐实现方式（二选一，优先第一种 —— 改动最小、语义最清晰）：

**方案 A**：给 `isValidationBody` 增加 `status` 参数

```typescript
// 调用点（message 分支）：
} else if (status === 400 && this.isValidationBody(body)) {
  details.validationErrors = body.message;
  message = 'Request validation failed';
}

// 同时把 code 分支的重复判断收敛：
const isValidation = status === 400 && this.isValidationBody(body);
const code = isValidation ? 'COMMON_VALIDATION_FAILED'
                          : (HTTP_STATUS_TO_CODE[status] ?? 'COMMON_HTTP_ERROR');
```

**方案 B**：把 `isValidationBody` 的签名改为 `(status: number, body: string | object)`，
在函数内部统一判断 `status === 400`。

无论选哪种，**必须保证 code 与 message 使用完全相同的判定**，否则会再次出现
"code 说 404、message 说校验失败"的不一致。

### 7.3 顺带修正（低风险）

`apps/api/src/main.ts:54-62` 的 Swagger path 重写会重复添加 `/api/v1` 前缀。
当前的判断是 `path.startsWith('/health') ? path : \`${apiPrefix}${path}\``，
但 `document.paths` 里的 key 已经**不含** global prefix（Nest 的 `setGlobalPrefix`
不会出现在 Swagger 文档路径里）。实际运行后 live 文档出现 `/api/v1/api/v1/...`。

**修正方式**：移除这段重写（让 Swagger 按实际路由输出），或改为只在缺少前缀时补。
**修正后必须验证**：
- `pnpm openapi:export` 输出的 `openapi.json` 路径为单前缀
- `pnpm check:openapi` 通过
- 前端 `api-client` 的路径模板（`WciesPaths`）与后端路由一致 ——
  **这一步很关键**：`api-client` 是从 `openapi.json` 生成的，如果路径变了，
  `apps/web/src/api/hooks.ts` 里所有 `'/api/v1/xxx'` 的 key 都会失配。

> **风险提示**：若这段重写被移除后 `check:openapi` 或前端类型检查失败，
> 说明 `api-client` 依赖了加倍前缀。此时**回退这段改动，只保留 §7.2 的修复**，
> 并在报告中记录"Swagger 路径加倍问题未修（会破坏 api-client 生成物）"。
> 不要为了修文档瑕疵而改动整个 api-client 契约。

### 7.4 测试

新增单元测试（放在 `apps/api/src/common/filters/` 附近的测试文件中，
参考现有测试的组织方式）：

| 场景 | 构造 | 断言 |
|---|---|---|
| 404 不再误报 | `NotFoundException`（body 为 `{message, error, statusCode}`） | `code === 'COMMON_NOT_FOUND'`；`message !== 'Request validation failed'`；`details.validationErrors` 不存在，或为原始路径字符串 |
| 真实 400 仍正常 | 校验失败体（`message` 为数组） | `code === 'COMMON_VALIDATION_FAILED'`；`details.validationErrors` **是数组** |

**回归验证**：跑全量集成测试（异常过滤器影响**所有**接口的错误响应形状）。

### 7.5 完成标准

- 单测通过，覆盖上表两个场景。
- 全量集成测试通过（未引入回归）。
- **手工验证**：用 curl 或浏览器对不存在的路径发请求，确认返回
  `COMMON_NOT_FOUND` 而非 "Request validation failed"。

---

## 第 8 节 T2 — 编码体系（Migration + Service）

### 8.1 Migration

用脚手架创建：`pnpm db:migration:create AddBusinessCodeSequences`

**表 `business_code_sequences`：**

```sql
CREATE TABLE business_code_sequences (
  scope_key   varchar(120) PRIMARY KEY,
  next_value  bigint       NOT NULL,
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
```

**`products` 增加 `code_seq`：**

```sql
ALTER TABLE products ADD COLUMN code_seq integer;
-- 回填：解析现有 product_code 的数字部分
UPDATE products
   SET code_seq = NULLIF(regexp_replace(product_code, '\D', '', 'g'), '')::integer
 WHERE product_code ~ '\d';
-- 无法解析的行：按 created_at 排序补号（从现有最大值之后开始）
-- （本机当前 products 为空，但必须写正确以适配生产）
ALTER TABLE products ALTER COLUMN code_seq SET NOT NULL;
CREATE UNIQUE INDEX uq_products_code_seq ON products (code_seq);
```

> **为什么需要 `code_seq`**：SKU 编码 = `SKU{商品序号}{商品内序号}`，
> 必须有一个稳定的"商品序号"事实源。从 `product_code` 字符串反解数字
> 既脆弱（格式可能变）又昂贵。单独存整数列，SKU 编码直接读取。

> **注意**：`uq_products_code_seq` 是新增的唯一约束，`code_seq` 必须 `NOT NULL`。
> 回填逻辑要处理"解析不出数字"的行 —— 本机表为空，但迁移必须对生产数据正确
> （生产可能有手工指定的 `product_code`）。无法解析的行按 `created_at` 排序
> 从最大已用序号之后连续补号，**不要**用 `ROW_NUMBER()` 直接当序号（会与已解析出的号冲突）。

**`platforms.name` 规范化：**

```sql
UPDATE platforms SET name = 'Ozon'          WHERE code = 'OZON';
UPDATE platforms SET name = 'Wildberries'   WHERE code = 'WB';
UPDATE platforms SET name = 'Yandex'        WHERE code = 'YANDEX';
```

**同时修改种子迁移之外的地方**：`database/migrations/20260908_001_create_platforms.ts`
是历史迁移，**不要改**（AGENTS.md §56）。用新迁移 UPDATE 即可。

**`down` 必须实现**：删表、删列、把 name 改回原值。

### 8.2 `BusinessCodeService`

**放置位置**：建议 `apps/api/src/modules/<common 或 master-data 模块>`。
**必须通过公开 Service 供各模块调用**，禁止其他模块直接 import 它的 repository（AGENTS.md §9）。

**核心取号方法：**

```typescript
/**
 * 原子取号：单条 SQL 完成"不存在则插入 1 / 存在则 +1 并返回"，无读-改-写窗口。
 */
async next(scopeKey: string): Promise<number> {
  const result = await this.dataSource.query<{ next_value: string }[]>(
    `INSERT INTO business_code_sequences (scope_key, next_value, updated_at)
     VALUES ($1, 1, now())
     ON CONFLICT (scope_key)
     DO UPDATE SET next_value = business_code_sequences.next_value + 1,
                   updated_at = now()
     RETURNING next_value`,
    [scopeKey],
  );
  return Number(result[0].next_value);
}
```

> **注意**：PostgreSQL 返回 `bigint` 时驱动可能给字符串，必须显式 `Number(...)`。

**格式化方法**（宽度是最小宽度，溢出自然进位 —— `padStart` 天然满足）：

```typescript
// 仓库：warehouse:{TYPE} → ZG-01 / PT-01 / SF-01 / TH-01
// 店铺：store:{PLATFORM}   → ON-001 / WS-001 / YX-001
// 品牌：brand              → BN00001
// 分类：category           → CN00251
// 商品：product            → PN000001
// SKU： sku:{productId}    → SKU000001001
```

前缀映射表要写成 typed constant（AGENTS.md §64：禁止 magic string）：

```typescript
const WAREHOUSE_CODE_PREFIX: Readonly<Record<string, string>> = {
  SELF: 'ZG', PLATFORM: 'PT', THIRD_PARTY: 'SF', RETURN_TEMP: 'TH',
};
const PLATFORM_CODE_PREFIX: Readonly<Record<string, string>> = {
  OZON: 'ON', WB: 'WS', YANDEX: 'YX',
};
```

### 8.3 接入六类实体

| 实体 | 改动 |
|---|---|
| Warehouse | Create DTO 的 `warehouseCode` 改可选；服务端生成；**`UpdateWarehouseRequestDto` 移除 `warehouseType`**（决策 #3：类型创建后不可改） |
| Store | Create DTO 的 `storeCode` 改可选；服务端生成 |
| Brand | Create DTO 的 `code` 改可选；服务端生成 |
| Category | Create DTO 的 `code` 改可选；服务端生成 |
| Product | 格式从 `PRD%06d` 改为 `PN%06d`；**`UpdateProductRequestDto` 移除 `productCode`**（决策 #7：创建后只读）；写 `code_seq` |
| SKU | 格式从 `SKU%06d` 改为 `SKU%06d%03d`（读取商品的 `code_seq`）；**`UpdateSkuRequestDto` 移除 `skuCode`**（决策 #8：生成后冻结） |

**现有 DTO 位置（供快速定位，行号已核实）：**

```text
Warehouse  Create :23-77    Update :79-130     apps/api/src/modules/warehouse/dto/warehouse.dto.ts
Store      Create :6-37     Update :39-62      apps/api/src/modules/store/dto/store.dto.ts
Brand      Create :7-29     Update :31-54      apps/api/src/modules/catalog/dto/catalog.dto.ts
Category   Create :82-110   Update :112-141    apps/api/src/modules/catalog/dto/catalog.dto.ts
Product    Create :24-59    Update :61-105     apps/api/src/modules/product/dto/product-sku.dto.ts
SKU        Create :191-301  Update :303-403    apps/api/src/modules/product/dto/product-sku.dto.ts
```

**现有生成逻辑（要改造的调用点，行号已核实）：**

```text
Product 生成 : apps/api/src/modules/product/services/product.service.ts:79-92   （创建）
             : apps/api/src/modules/product/services/product.service.ts:231     （导入路径）
Product 仓储 : apps/api/src/modules/product/repositories/product.repository.ts:100-105
SKU 生成     : apps/api/src/modules/product/services/sku.service.ts:119-140      （创建）
SKU 仓储     : apps/api/src/modules/product/repositories/sku.repository.ts:197-202
条码生成     : apps/api/src/modules/product/services/barcode.service.ts:74-79    （保持不变）
```

**内部条码保持不变**：继续用现有 `seq_internal_barcode` + `WCSKU%08d`（决策 #9）。
**不要**动 `sku-barcode.repository.ts:38-43`。

#### ⚠ 移除"编码可编辑"时必须一并移除其校验逻辑

编码字段**当前不只是个字段，PATCH 路径上有配套的冲突校验逻辑**。
仅在 DTO 里删掉字段是不够的 —— 必须同时删掉服务层的对应分支，否则会留下死代码：

```typescript
// apps/api/src/modules/product/services/product.service.ts:143-152  （update 中的编码校验）
if (dto.productCode !== undefined) {
  const trimmed = dto.productCode.trim();
  if (trimmed !== existing.product.productCode) {
    const conflict = await this.repository.findByCode(trimmed);
    if (conflict !== null && conflict.id !== id) {
      throw new ProductCodeAlreadyExistsError(trimmed);
    }
  }
}
// 以及 :169  if (dto.productCode !== undefined) patch.productCode = dto.productCode.trim();
```

```typescript
// apps/api/src/modules/product/services/sku.service.ts:182-190  （update 中的编码校验）
if (dto.skuCode !== undefined) {
  const trimmed = dto.skuCode.trim();
  if (trimmed !== found.sku.skuCode) {
    const conflict = await this.repository.findByCode(trimmed);
    if (conflict !== null && conflict.id !== id) {
      throw new SkuCodeAlreadyExistsError(trimmed);
    }
  }
}
// 以及 :199  if (dto.skuCode !== undefined) patch.skuCode = dto.skuCode.trim();
```

> **注意**：`ProductCodeAlreadyExistsError` / `SkuCodeAlreadyExistsError` 在**创建**路径
> （`:83-86` / `:123-126`）仍然需要保留 —— 手工指定编码的导入场景仍会重复。
> 只删 update 路径的分支。

**同时检查**：`dto/product-sku.dto.ts:451-456` 的排序白名单里含 `skuCode`，
这是**查询排序**用途，**保留不动**（不是编辑）。

### 8.4 兼容 Excel 导入

导入类型（§4.5）中涉及编码的有 `SKU` / `WAREHOUSE` / `BIN` / `LISTING_MAPPING`。

**要求**：导入模板中 `code` 字段**留空时走自动生成**，不能报错、不能拒绝。
有值时保留"重复即 Reject 并报告"的既有行为（`master-data.md:93`：绝不静默覆盖）。

需检查的文件：`apps/api/src/modules/import/handlers/*`（特别是 `sku-import.handler.ts`）。

### 8.5 其他同步项

- `apps/api/scripts/seed-sprint1-data.ts`：**注意**该脚本曾因 SKU 列名从 `weight_kg`/`length_cm`/`volume_cm3`
  改为 `weight_g`/`length_mm`/`volume_mm3` 而失效（已在 commit `97876ab` 修复）。
  **新增字段时不要引用旧列名。** 若 seed 里硬编码了 store/warehouse code，需与新编码格式一致或改为留空自动生成。
- `pnpm openapi:export` + `pnpm api-client:generate`：DTO 变更后必须重新生成。
- `pnpm check:openapi` 必须通过。

### 8.6 测试

**单元测试：**

- 每个格式化函数的格式断言（含边界：序号 1 → `01`，序号 100 → `100`）

**集成测试（真实 PostgreSQL）：**

| 用例 | 断言 |
|---|---|
| 格式 | 创建各实体后 code 匹配预期正则 |
| **作用域隔离** | 第一个 OZON 店 `ON-001`、第一个 WB 店 `WS-001`（互不影响） |
| **作用域隔离** | 同一商品下 SKU 从 `001` 开始；不同商品各自从 `001` 开始 |
| **并发取号不重号** | N 个并发请求取同一作用域 → 得到 N 个**互不重复**的号（这是 `ON CONFLICT` 语义的核心验证） |
| 溢出进位 | 人为把 `next_value` 设为 99 → 下一个仓库编码是 `ZG-100`（不是报错） |
| SKU 派生 | 商品 `PN000001` 的 SKU 为 `SKU000001001`、`SKU000001002` |

> **并发测试必须用真实 PG**（AGENTS.md §77：库存/编码这类并发敏感逻辑不得全部 Mock）。

### 8.7 完成标准

- Migration up/down 均可用；空库全量迁移通过。
- 六类实体创建时留空 code → 自动生成且格式正确。
- 商品编码 / SKU 编码在 PATCH 中被忽略或拒绝（不可修改）。
- 仓库类型不可修改。
- 上述集成测试全部通过。
- `master-data.md §1` 与实现一致。

---

## 第 9 节 T3 — 三级分类 + 品牌命名（Migration）

### 9.1 分类 Migration

用脚手架创建：`pnpm db:migration:create AddCategoryLevelAndNameUniqueness`

```sql
ALTER TABLE categories ADD COLUMN level smallint;

-- 递归回填（有数据时也正确）
WITH RECURSIVE d AS (
  SELECT id, 1 AS lvl FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, d.lvl + 1 FROM categories c JOIN d ON c.parent_id = d.id
)
UPDATE categories c SET level = d.lvl FROM d WHERE d.id = c.id;

ALTER TABLE categories ALTER COLUMN level SET NOT NULL;
ALTER TABLE categories ADD CONSTRAINT ck_categories_level    CHECK (level BETWEEN 1 AND 3);
ALTER TABLE categories ADD CONSTRAINT ck_categories_root     CHECK ((level = 1) = (parent_id IS NULL));
CREATE UNIQUE INDEX uq_categories_parent_name
  ON categories (parent_id, lower(name_zh)) NULLS NOT DISTINCT;
```

> **`NULLS NOT DISTINCT` 是必需的**：PostgreSQL 默认认为每个 NULL 互不相同，
> 不加这个限定，**根级分类之间（`parent_id` 均为 NULL）的重名不会被拦截**。
> 本机 PostgreSQL 18 支持该语法。

**`down` 必须实现**：删索引、删两条 CHECK、删列。

### 9.2 品牌 Migration

用脚手架创建：`pnpm db:migration:create RenameBrandNameZhToName`

```sql
ALTER TABLE brands RENAME COLUMN name_zh TO name;      -- 原 name_zh → 一般名称
ALTER TABLE brands ADD COLUMN name_zh varchar(200) NULL;  -- 新增中文名（可空）
UPDATE brands SET name_zh = name WHERE name_zh IS NULL;   -- 回填：原值即中文名
```

> **回填说明**：原 `name_zh` 是必填且语义上就是中文名，因此
> `name`（一般名称）与 `name_zh`（中文名）初始值相同是合理的。

**同步更新**（这一步容易漏，必须逐项检查）：

- `apps/api/src/modules/catalog/entities/brand.entity.ts`（`:23` 附近的 `nameZh`）
- `apps/api/src/modules/catalog/dto/catalog.dto.ts`（Create/Update/Response 三个 DTO 的 `:13-79`）
- `apps/api/src/modules/catalog/catalog.service.ts`（`brandToResponse` `:250-261`、
  `createBrand` `:50-56`、`updateBrand` `:77-105` 的 operation-log 字段名）
- 前端所有 `nameZh` 引用（T6 承接）

### 9.3 分类业务规则（服务层）

**文件**：`apps/api/src/modules/catalog/catalog.service.ts`
（现有 `createCategory` `:120-154`、`updateCategory` `:156-209`、`assertNoCycle` `:217-231`）

| 规则 | 行为 | 错误码 |
|---|---|---|
| 最多三级 | 创建/改父时算**整棵子树最终深度**，> 3 拒绝 | `CATEGORY_DEPTH_EXCEEDED` |
| 商品只挂三级 | 商品分类非空时其 `level` 必须 = 3 | `CATEGORY_LEVEL_INVALID` |
| 同父下名称唯一 | DB 唯一索引兜底 + 服务层预检给友好提示 | `CATEGORY_NAME_DUPLICATED` |
| 改父不能让已有商品越级 | 节点下有商品而移动后不再是三级 → 拒绝 | `CATEGORY_LEVEL_INVALID` |
| 删除有子节点 | 拒绝 | `CATEGORY_HAS_CHILDREN` |
| 删除有商品 | 拒绝 | `CATEGORY_IN_USE` |
| 停用 | 不级联子节点；停用节点及其子树在商品表单不可选 | — |

**新增错误码**要加进 `apps/api/src/modules/catalog/errors/catalog-errors.ts`
（现有：`BrandCodeAlreadyExistsError`、`CategoryCodeAlreadyExistsError`、
`CategoryCycleInvalidError`、`CategoryNotFoundError`、`BrandNotFoundError`），
并补进 `master-data.md §12`。

### 9.4 四个必须处理的边界场景

**A — 合法与越级**

> 「数码 → 外设 → 键盘」已存在。把另一个一级「配件」挂到「数码」下 → 变二级，**合法**；
> 但把「配件」下的「线材」挂到「键盘」下 → 会变四级 → **拒绝**。

**B — 整棵子树高度（最易写错）**

> 带 3 层子树的「数码」整体挂到另一个一级下 → 子树高度 3 + 新父 1 = 4 → **拒绝**。
>
> **校验必须算整棵子树的高度，不能只看被移动的那个节点本身。**
> 这是本任务最容易实现错误的点，必须写测试锁住。

**C — 已有商品阻止越级**

> 三级「键盘」下已挂 12 个商品，要把「键盘」移到二级位置 →
> 这 12 个商品就挂在二级上了 → **拒绝**，提示"该类目下有商品，不可移动"。

**D — 停用不级联**

> 停用「数码」→ 它和子树在商品表单里都不可选，但数据库层级与商品挂载关系**不变**；
> 重新启用即恢复。

### 9.5 接口改动

| 接口 | 改动 |
|---|---|
| `POST /categories` | `code` 改为可选（走 T2 的 `CN%05d`） |
| `DELETE /categories/:id` | **新增**（零引用才可删，见 T4） |
| `GET /products?categoryId=` | 从**精确匹配**改为**含子树**（递归 CTE） |

**含子树筛选的实现位置**：`apps/api/src/modules/product/repositories/product.repository.ts:59-60`

```typescript
// 现状（精确匹配 —— 选一级分类查不出子类商品）
if (filters.categoryId !== undefined) {
  qb.andWhere('product.category_id = :categoryId', { categoryId: filters.categoryId });
}
```

改为递归 CTE 或等价的子树 id 集合查询。**这是分类树对运营产生价值的前提**，
否则一级/二级分类只是展示层级。

### 9.6 前端改动（由 T6 承接，此处先记录规格）

**「新增分类」弹窗**（替换 `ProductsPage.tsx:500-537` 现有实现）：

```text
一级分类   [下拉选择 ▾]      [＋新增一级分类]
二级分类   [下拉选择 ▾]      [＋新增二级分类]    ← 选项 = 所选一级的子节点；未选一级时禁用
三级分类   [名称输入框]
俄文名称   [选填]
```

- **编码不出现在表单里**（决策 #6）。
- 两个内联按钮各弹一个小输入框（名称 + 俄文名，编码自动）。
- 创建成功后**自动选中**新节点（`ProductsPage.tsx:164-167` 已有此模式，沿用）。

**商品表单的分类选择**：改用 `Cascader`（antd 自带，**不新增依赖**），
一级二级只作为路径、**只能选三级**。

**列表与详情**：列表「分类」列显示三级短名；详情抽屉显示完整路径（`数码 / 外设 / 键盘`）。

**「分类管理」视图**（决策 #14）：树形展示 + 编辑（改名 / 俄文名）+ 停用 / 启用 +
零引用删除 + 同级排序 + 改父（带 §9.4 全部校验）。

**修现有缺陷**：`ProductsPage.tsx:198-201` 的 `flatCategories` 只展开两层 ——
改为支持三级（或改用 Cascader 后自然解决）。

### 9.7 品牌前端改动（由 T6 承接）

表单字段改为：**一般名称（必填）/ 中文名 / 英文名 / 俄文名**。
**全站默认显示一般名称**（替换所有 `nameZh` 引用）。

### 9.8 测试

| 用例 | 断言 |
|---|---|
| 深度上限 | 建到三级成功；尝试建四级 → `CATEGORY_DEPTH_EXCEEDED` |
| **子树高度** | 带 3 层子树的节点挂到一级下 → 拒绝（场景 B） |
| 商品越级 | 有商品的三级节点移到二级 → `CATEGORY_LEVEL_INVALID`（场景 C） |
| 商品挂载 | 商品挂二级 / 一级 → `CATEGORY_LEVEL_INVALID`；挂三级成功 |
| 同父重名 | 同父下同名 → `CATEGORY_NAME_DUPLICATED`；**根级之间同名也拦截**（验证 `NULLS NOT DISTINCT`） |
| 跨父同名 | 不同父下的同名 → **允许** |
| 删除保护 | 有子节点 → `CATEGORY_HAS_CHILDREN`；有商品 → `CATEGORY_IN_USE`；零引用 → 真删成功 |
| 含子树筛选 | 选一级分类能查出其下三级分类的商品 |
| 品牌改名 | `name` 必填、`name_zh` 可空；`brandToResponse` 字段正确 |

> **注意**：`level` 在改父时必须**整棵子树一起更新**，且必须在**同一事务**内。
> 必须写测试锁住这一点（改父后子节点的 level 正确）。

### 9.9 完成标准

- Migration up/down 可用；空库全量迁移通过。
- §9.3 全部规则实现，§9.4 四个场景有测试。
- §9.8 全部用例通过。
- 商品分类筛选支持子树。
- 品牌四字段语义正确。
- `master-data.md` 新增章节与实现一致。

---

## 第 10 节 T4 — 删除能力（零引用校验）

### 10.1 目标

为下列实体增加 `DELETE` 端点 + **服务层引用检查**：

```text
Warehouse / WarehouseBin / Store / StoreWarehouseBinding /
Brand / Category / Product / Sku / PlatformListing / ListingSku
```

**决策 #2：零引用才可删。** 有引用 → 明确业务错误码 + 提示"只能停用"；零引用 → 真删 + 记 operation log。

### 10.2 为什么必须在服务层预检

**所有 FK 均未指定 `onDelete` → PostgreSQL 默认 `NO ACTION`（阻塞）。**

如果只依赖数据库，撞 FK 时抛的是**原始数据库错误**，会被
`global-exception.filter.ts:94-106` 捕获并统一映射为 `DatabaseDomainError` ——
用户看到的是通用数据库错误，**无法知道是"被引用所以不能删"**。

所以必须在服务层**先查引用**，查到就抛业务错误。

### 10.3 引用检查清单（FK 已核实全为 NO ACTION）

| 被删实体 | 必须检查的引用来源 |
|---|---|
| `warehouses` | `warehouse_bins`、`store_warehouse_bindings`、`inventory_balances`、`inventory_safety_stocks`、`inventory_reservations`、`inventory_serials`、`inventory_transactions`、`order_items`、`order_interceptions`、`picking_tasks`、`shipments` |
| `warehouse_bins` | `inventory_balances`、`inventory_reservation_lines`、`inventory_serials`、`inventory_transactions` |
| `stores` | `platform_credentials`、`store_warehouse_bindings`、`platform_listings`、`orders`、`system_exceptions`、`sync_jobs`、`sync_cursors`、`external_raw_events` |
| `platforms` | `stores`、`platform_listings`（**只读，不提供删除**） |
| `brands` | `products` |
| `categories` | 自身（`parent_id`）、`products` |
| `products` | `skus`、`sku_images` |
| `skus` | `sku_barcodes`、`sku_images`、`sku_bundle_components`(×2)、`inventory_balances`、`inventory_safety_stocks`、`inventory_reservations`、`inventory_serials`、`inventory_transactions`、`order_items`、`picking_task_items`、`package_items`、`package_item_serials`、`platform_listing_skus`、`shipment_items` |
| `platform_listings` | `platform_listing_skus` |
| `platform_listing_skus` | `order_items`（← 这是 §4.4 缺口要修的） |

> **实现提示**：不要为每个实体写一堆 `COUNT(*)` 判断。建议在
> **同一个模块的 repository 内**写一个"检查某外键是否有引用"的辅助查询
> （按 `information_schema` 或显式列出的表逐一 count），
> 但**引用检查的调用与错误抛出必须在 Service**（AGENTS.md §8：
> Repository 只负责查询，不得决定业务规则）。

### 10.4 错误码

```text
WAREHOUSE_IN_USE / BIN_IN_USE / STORE_IN_USE / BINDING_IN_USE /
BRAND_IN_USE / CATEGORY_IN_USE / PRODUCT_IN_USE / SKU_IN_USE /
LISTING_IN_USE / LISTING_SKU_MAPPING_IN_USE
```

`CATEGORY_HAS_CHILDREN` 单独（子节点不是"引用"而是层级关系）。

错误信息统一包含 **"该记录已被引用，只能停用不能删除"** 的语义 + 具体引用来源。

### 10.5 修既有缺口

**`DELETE /listings/:listingId/skus/:id`**（`apps/api/src/modules/listing/services/listing.service.ts:340-357`）
注释声称"无订单历史才可删"，但**没有实现检查**。

改为：显式检查 `order_items.listing_sku_id` 引用 → 有则抛
`LISTING_SKU_MAPPING_IN_USE`；无则删除。

### 10.6 operation log

全部删除操作必须记 `operation_logs`（`master-data.md §11` 要求）。

参照现有模式（如 `catalog.service.ts:57-64` 的 `operationLog.record`），
`action: 'DELETE'`。

### 10.7 前端（由 T6 承接）

详情抽屉提供：**编辑 / 启用 / 停用 / 删除**。
删除按钮在两处受限：被拒时**展示后端返回的具体原因**（不要吞掉错误）。

### 10.8 测试

| 用例 | 断言 |
|---|---|
| 零引用可删 | 新建的仓库（无 bin / 无绑定 / 无库存）→ 删除成功 |
| 有引用拒删 | 仓库下有 bin → `WAREHOUSE_IN_USE`；错误信息含"只能停用" |
| 分类删除 | 有子节点 → `CATEGORY_HAS_CHILDREN`；有商品 → `CATEGORY_IN_USE` |
| 品牌删除 | 有商品引用 → `BRAND_IN_USE` |
| **映射删除（缺口修复）** | 有订单引用的 mapping → `LISTING_SKU_MAPPING_IN_USE`（**不再是 FK 错误**） |
| operation log | 删除后 `operation_logs` 有对应记录 |

### 10.9 完成标准

- 10 个实体都有 DELETE 端点 + 引用检查。
- 被引用时的错误码明确、信息可读（不暴露数据库细节）。
- §4.4 的映射删除缺口已修。
- 全部删除操作有 operation log。
- 上述测试通过。

---

## 第 11 节 T5 — 前端独立改进（不依赖后端改动）

> **可与其他任务并行**。全部改动在 `apps/web/src`。

### 11.1 认证闭环

**新增 `AuthGate` 组件**（建议 `apps/web/src/app/AuthGate.tsx`）：

- 启动时探测 `GET /api/v1/auth/me`（`retry: false`）。
- 加载中 → 显示加载态（不要闪一下空页面）。
- 未认证 → `navigate('/login?redirect=<当前路径>')`。
- 已认证 → 渲染 children。
- 把探测到的用户信息提供给顶栏使用。

**路由接入**：`apps/web/src/app/App.tsx:35-62` 的 `<Route element={<AppLayout />}>`
外层包一层 `<AuthGate>`（或改为 `AppLayout` 内的守卫，二选一，保持简洁）。

**登录页回跳**：`apps/web/src/pages/LoginPage.tsx:25-28` 改为读取 `redirect` 参数并回跳
（无参数时回 `/`）。

**401 处理**：`apps/web/src/app/providers.tsx:9-17` 的 `queryClient` 增加：

- 401 错误**不重试**（现有 `retry: 1` 对 401 无意义，只会再拿一个 401）；
- 401 时清认证状态并跳登录页，提示"登录已过期，请重新登录"；
- **注意**：`/auth/login` 自身的 401（密码错误）必须排除，否则会把用户踢出登录页。

**保留错误详情**：`apps/web/src/api/hooks.ts` 的四个 `apiXxx`
（`:44-46`、`:68-70`、`:84-86`、`:100-102`、`:109-111`）目前只取 `error.error.message`，
**丢弃了 `code` 与 `details`**。

改为抛出携带完整信息的错误对象（例如自定义 `ApiError extends Error`
带 `code` / `details` 字段），让页面能显示可诊断的信息。

**顶栏**：`apps/web/src/app/AppLayout.tsx:325-340` 把写死的 "Admin" 换成
真实用户名 + 角色；新增**退出登录**（调 `POST /api/v1/auth/logout` 后跳 `/login`）。

**`/health-test` 保持在守卫内**（内部诊断页，不需要公开）。

### 11.2 弹窗链路根修

见 §4.3 的完整因果链。**必须同时解决三个问题，它们是同一条链**：

**(1) id 快照**：打开弹窗时把实体 id 快照进弹窗自己的 state，不再依赖 `detailId`。

```typescript
// 反例（现状）：提交时读 detailId，此时可能已被 Drawer 的 onClose 置空
{ warehouseId: detailId ?? '' }

// 正例：打开弹窗时快照，提交时用快照
const [batchWarehouseId, setBatchWarehouseId] = useState<string | null>(null);
// 打开：setBatchWarehouseId(detailId); setBatchOpen(true);
// 提交：batchMutation.mutate({ values, warehouseId: batchWarehouseId })
```

**(2) 提交前断言**：id 为空时**不发请求**，直接提示。

**(3) 层级**：显式提升弹窗层级（`zIndex`）**或**改为在 Drawer 内渲染，
解决"弹窗不在最前"。

**清理 `forceRender`**（`grep -rn forceRender apps/web/src` 全量结果，共 **5 处**）：

```text
apps/web/src/pages/stores/StoresPage.tsx:768        （新增店铺弹窗）
apps/web/src/pages/stores/StoresPage.tsx:810        （凭证弹窗）
apps/web/src/pages/warehouses/WarehousesPage.tsx:384
apps/web/src/pages/warehouses/WarehousesPage.tsx:551   （批量建位弹窗）
apps/web/src/pages/sync/SyncCenterPage.tsx:881
```

**必须全量 grep 确认**（不要只改上面 5 处，因为其他任务可能新增）。

改为 **"打开时 `resetFields()`、关闭时重置"** 的模式。

**凭证弹窗不回显**（用户第 7 条）：
- `onCancel`（`StoresPage.tsx:811`）也要重置表单；
- 改为显示"当前已配置（类型 / 更新时间）"，输入留空 = 不修改。

**同类弹窗一并收口**：`WarehousesPage.tsx`、`StoresPage.tsx` 是已知的两处，
检查是否有其他页面用了同样的 `detailId ?? ''` 模式（搜 `?? ''`）。

### 11.3 中文化

**(1) 库存流水列名**：

```text
Before       → 变更前
Change       → 变更量
After        → 变更后
Reserved Δ   → 占用变化
Picked Δ     → 已拣变化
```

位置：`InventoryTransactionsPage.tsx:113-143` + `InventoryPage.tsx:737-759`。
同时给 `InventoryPage.tsx:738` 的 `transactionType` 加上 label render（现在直出英文）。

**(2) Reservation 全站改称「库存占用」**（决策 #15）：

- 页面标题、菜单、列名统一；
- `ReservationsPage.tsx:159` 的状态机提示改为中文：
  `状态机：已占用 → 已拣货 → 已出库；已占用可释放；已拣货可取消拣货回已占用`
- `:84-89` 的确认文案改中文（`释放占用`、`拣货（已占用 → 已拣货）` 等）。

**(3) 补全 §4.7 列出的 11 处英文枚举直出**。

**(4) 补 `FULFILLMENT_STATUS_META` 的 label**
（`StatusBadge.tsx:119-125` 目前是 `Record<string, StatusTone>`，**只有 tone 没有 label**）：
`PENDING→待处理`、`RESERVED→已占用`、`BACKORDERED→缺货`、`PICKED→已拣货`、`RELEASED→已释放`。

改完后 `OrdersPage.tsx:475` 的 `label={value}` 要改为查表。

**(5) 落地规则**：**枚举禁止直出 DOM，统一走 label map**，未命中回退原值
（保留原值便于排查，但要在一处集中回退，不要在页面里散落 `?? value`）。

### 11.4 平台显示名

**新增统一 `PLATFORM_META`**（决策 #4 的显示语义）：

```text
OZON   → Ozon
WB     → Wildberries
YANDEX → Yandex
```

- 位置：`apps/web/src/design-system/components/PlatformTag.tsx:7-12`。
- **修 `WILDBERRIES` 失效 key**（数据库里是 `WB`，导致 WB 一直走回退分支）。
- 所有下拉 / 标签只显示显示名，**不再拼 `code · name`** ——
  改 `StoresPage.tsx:778`（这个 是 `OZON · OZON` 的来源）。
- 检查其他拼接点：`StoresPage.tsx:670`、`ListingsPage.tsx:159,274`、
  `PlatformMappingsPage.tsx:269-272`、`OrdersPage.tsx:602`、
  `StoreBindingsPage.tsx:111,178`、`SyncCenterPage.tsx:907`、`GlobalSearch.tsx:174,228`、
  `DashboardPage.tsx:588`。

### 11.5 设计系统补齐

`ProductsPage.tsx` 与 `ListingsPage.tsx` 改为
`PageHeader + FilterBar + DataTable + ContextRail + Drawer`，与其余 12 页一致。

参考已完成的页面（如 `StoresPage.tsx`、`SkusPage.tsx`）的写法。
`ContextRail` 的用法见 `apps/web/src/design-system/components/ContextRail.tsx:132-141`
的 `useContextRail`。

### 11.6 SKU 平台映射入口

在 SKU 详情增加"关联平台 Listing"：

1. **映射已有 UNMAPPED 变体**为当前 SKU → `POST /listings/:listingId/skus/:id/map`；
2. **手工新建** Listing + 变体并映射 → `POST /listings`。

**不新增后端接口**（接口已存在，见 §4.4）。

### 11.7 SKU 图片上传

**先实测定位根因，不要猜**（三个候选见 §4.8）。定位后在报告中**写明实际根因**。

修复范围：
- UI 反馈（未选文件 / 上传中 / 失败要有明确提示）；
- 错误提示（mime / 5MB 校验失败要展示后端返回的原因）；
- dev 对象存储检查（MinIO 是否启动、bucket 是否创建）。

**顺带补"删除图片"按钮**（API 已支持 `DELETE /skus/:skuId/images/:imageId`，前端没有）。

#### ⚠ 上传用的是裸 `fetch`，绕过了 api-client

`apps/web/src/pages/skus/SkusPage.tsx:291-310` 的 `uploadMutation`
直接调 `fetch('/api/v1/skus/${drawerId}/images', ...)`，**违反 AGENTS.md §72**
（前端优先使用 OpenAPI 生成的 api-client，禁止到处手写 fetch）。

它的错误处理也不完整 —— 只处理 `body.success === false`，
若响应体不是 JSON（如网关返回 HTML），`response.json()` 会先抛异常，
错误信息变成无意义的解析错误：

```typescript
const body = (await response.json()) as { success: boolean; error?: { message: string } };
if (!body.success) {
  throw new Error(body.error?.message ?? '上传失败');
}
```

**建议**：排查根因时优先怀疑这里。若要修，改为走 `api-client`
（或至少补 `response.ok` 判断 + 非 JSON 响应兜底），
但**不要为此改动 `api-client` 的生成物结构**。

### 11.8 首页运营看板（决策 #16）

**当前问题**：`apps/web/src/pages/DashboardPage.tsx`

- `Mapping 覆盖率` 卡片（`title` 在 `:427`，块约 `:426-439`）：`mapped/total` 百分比，用户认为信息价值低；
- `店铺在线` 卡片（`title` 在 `:441`，块约 `:440-445`）：与 rail 的「店铺状态」区块**信息重合**。

**rail 三个区块的锚点**（`ContextSection`）：

```text
:282  店铺状态       ← 与「店铺在线」卡片重合，要改
:326  同步异常
:349  今日风险
```

**改法**：换成**待处理异常**（`/exceptions?status=OPEN`，接口已有）和
**库存预警 SKU** 两张卡；rail 的「店铺状态」区块改为「同步异常 + 库存预警」，
消除重合。

**运营看板结构**：4 KPI + 运营待办 + 趋势 + 异常流。

> **硬性约束**：**全部真实 API 数据源**。禁止 `Math.random()`、假 KPI、
> 硬编码数量/金额/趋势/错误数（Phase 2 任务书的禁令继续有效）。

### 11.9 测试与验收

- 前端无单测框架（`apps/web/package.json` 只有 typecheck / build），
  以 `pnpm typecheck` + GUI 验收为准。
- **GUI 验收必做**（见 §14.3）。

---

## 第 12 节 T6 — 前端接线（依赖 T2/T3/T4）

> **必须等 T2/T3/T4 完成后开始。**

### 12.1 移除编码输入框

各创建表单移除编码输入框，改为展示"创建后自动生成"的提示：

```text
仓库 / 店铺 / 品牌 / 分类 / 商品 / SKU
```

**编辑态**：商品编码与 SKU 编码**置灰**（不可改）；
仓库类型**置灰**并提示"类型创建后不可改"。

### 12.2 品牌表单

字段改为：**一般名称（必填）/ 中文名 / 英文名 / 俄文名**。
全站默认显示**一般名称**（替换所有 `nameZh` 引用）。

### 12.3 分类

见 §9.6 的完整规格：多级「新增分类」弹窗 + `Cascader` + 「分类管理」视图。

### 12.4 详情抽屉操作按钮

按 T4 的接口加：**编辑 / 启用 / 停用 / 删除**。
删除被拒时**展示后端返回的具体原因**。

覆盖面（用户诉求涉及的）：仓库、库位、店铺、店仓绑定、品牌、分类、商品、SKU、
平台 Listing、Listing 映射。

### 12.5 仓库创建表单补字段

用户第 1 条诉求。**DTO 早已支持**（`apps/api/src/modules/warehouse/dto/warehouse.dto.ts:38-76`），
前端没渲染：

```text
contactName    联系人
contactPhone   联系电话
remark         备注
```

### 12.6 店仓绑定快捷入口

决策 #17：保留 `StoreBindingsPage`，另在**仓库详情**和**店铺详情**各加
"管理绑定"入口直达该页（带筛选参数）。

### 12.7 缓存失效注意事项

React Query 的缓存失效**必须使用共享的 queryKey 前缀**。
Phase 2 曾出现"KPI 不刷新"的真实缺陷（count 查询用 `['x-count', ...]`，
而失效用 `['x']`）。

**规则**：count / list / detail 查询的 queryKey **都以实体名为第一段**
（如 `['exceptions', 'count', 'OPEN']`、`['exceptions', page]`），
失效时用 `invalidateQueries({ queryKey: ['exceptions'] })` 即可全部命中。

---

## 第 13 节 T7 — 基础设施与文档

### 13.1 前端 Docker 化（决策 #20）

**不新增依赖**（AGENTS.md §73）。

- **dev 模式**：`docker-compose.yml` 增加 `web` 服务，跑 Vite dev server + HMR。
  注意配置 `server.hmr.host`，否则容器内 HMR 无法连回宿主。
  端口映射 5173。
- **生产模式**：多阶段构建 — 阶段 1 用 `node` 镜像跑 `pnpm build`，
  阶段 2 用 `nginx` 镜像托管 `dist/` 静态文件。
  SPA 需要 nginx 的 `try_files ... /index.html` 回退（当前用 BrowserRouter，非 hash 路由）。

**Dockerfile 放在** `apps/web/Dockerfile`。

### 13.2 dev Webhook 重放脚本

**回答用户的疑问："webhook 是否还未实现？本地无公网 IP 如何测试？"**

**事实**：Webhook 入口**已实现**且是公开路由：
`POST /api/v1/webhooks/ozon/stores/:storeCode`（`ozon-webhook.controller.ts:18`，类级 `@Public()`）。

**本地测试不需要公网 IP** —— 直接对 `localhost:3000` POST 模拟 OZON 回调即可。

**新增一个 dev 重放脚本**（放在 `apps/api/scripts/`）：
从 `external_raw_events` 表取一条记录重新入队，用于验证：

- 幂等（同一事件重复处理不产生重复订单）
- raw event 落库（`external_raw_events` 有记录）
- 入队（BullMQ 收到 job）

脚本必须检查 `NODE_ENV`，**生产环境拒绝执行**（AGENTS.md §93）。

### 13.3 报告 `docs/manual-test-fix-report.md`

对用户 30 条问题逐条给出处置表：

| 列 | 说明 |
|---|---|
| 问题 | 用户原文 |
| 处置 | 已修复 / 部分修复 / 未修复 |
| 说明 | 修了什么；未修的写明原因 |
| 归属任务 | T1–T7 |

**禁止模糊表述**。未修复的必须写明"未修复 + 原因"。

参考 §4.10 的归属表作为骨架。

### 13.4 扫码结论（只出文档）

决策 #18：**Code128 一维条码**。

论据（写入文档）：

- 仓库场景用激光扫码枪，一维码识别最快、抗倾斜/破损最好、设备最便宜；
- **不用 EAN-13**（那需要申请 GS1 前缀）；
- 只有需要"一次扫出多个字段"（SKU + 批次 + 数量）时才上 QR。

**本轮不实现。**

### 13.5 文件改名建议

`docs/#WCIES 2.0 人工测试.MD` 的文件名以 `#` 和空格开头，
会破坏 glob 与部分工具链。建议改名为 `docs/manual-test-2026-09-10.md`。

**内容不动。是否改名由用户决定** —— 在报告中提出建议，**不要自行改名**。

### 13.6 同步项

- Excel 导入模板与校验（见 §8.4）
- `apps/api/scripts/seed-sprint1-data.ts`（见 §8.5）
- `pnpm openapi:export` + `pnpm api-client:generate` + `pnpm check:openapi`

---

## 第 14 节 验证与提交

### 14.1 每任务完成即跑

```bash
pnpm lint
pnpm typecheck
pnpm check:arch     # 注意命令名
pnpm test
pnpm build
```

涉及 Migration 时追加：

```bash
pnpm db:migrate
pnpm db:rollback    # 验证 down 可用
pnpm db:migrate     # 再 up
```

### 14.2 集成测试

```bash
pnpm test:integration
# 若并行失败（ECONNRESET）：
npx vitest run --config vitest.config.integration.ts --maxWorkers=1
```

**报告措辞**：若用了单 worker，必须写「环境并行不稳，单 worker 全部通过」，
**不得**写「默认测试通过」。

### 14.3 必须新增的测试

| 任务 | 测试 |
|---|---|
| T1 | 404 不再误报为校验失败；真实 400 仍返回数组 |
| T2 | 编码格式；作用域隔离（平台/商品）；**并发取号不重号**；溢出进位；SKU 派生 |
| T3 | 深度上限；**子树高度**（场景 B）；商品越级（场景 C）；同父重名（**含根级**）；跨父同名允许；删除保护；含子树筛选；品牌改名 |
| T4 | 零引用可删；有引用拒删（各实体）；**映射删除缺口修复**；operation log |

### 14.4 空库迁移验证

必须验证**空库**全量迁移通过（不只是增量）：

```bash
# 示意：新建一个空库跑全部迁移，确认 52 + 新增 全部成功
# 具体命令参考 scripts/db.ts 与 .env 的 DB 配置
```

### 14.5 GUI 验收

**真实浏览器**，跑全部路由，三档分辨率：

```text
1920×1080 / 1440×900 / 1366×768
```

**Console 必须 0 error**（antd 弃用 API 必须清零 —— 这是一贯要求）。

截图归档到 `gui-redesign-phase3-screenshots/`。

> **警告**：截图目录**不要被 `git add -A` 误纳入代码提交**（此前踩过：
> 截图被 stage 进重构提交，需要 `git reset --soft HEAD~1` 回滚重提）。
> .gitignore 目前**没有**忽略 `gui-*screenshots/`。
> 要么显式指定路径提交，要么先加 .gitignore。

### 14.6 提交

- 开工前打 **checkpoint commit**。
- **每任务独立提交**，不要一个大提交。
- Commit message 见 §5.3。

### 14.7 完成任务后的自检（AGENTS.md §100）

```text
Scope       是否只修改了必要范围？
Architecture 是否违反模块边界？
Data        是否有 Migration 遗漏？
Inventory   是否绕过 InventoryService？
Idempotency 外部事件/库存动作是否可能重复？
Security    是否泄露 Secret？
Errors      错误码是否明确？
Tests       测试是否覆盖核心规则？
Docs        业务规则或架构是否需要更新？
Build       lint / typecheck / test 是否通过？
```

---

## 第 15 节 附录

### 15.1 已知坑与踩过的雷

**（1）`docker exec` 缺 `-i` 会静默无输出**
第一次 TRUNCATE 漏了 `-i`，psql 读不到 stdin 立即退出，命令"看起来成功"但什么都没做。
核对行数时才发现。**任何 pipe/heredoc 给 psql 都必须带 `-i`。**

**（2）`git add -A` 会误纳入截图目录**
Phase 2 曾把截图 stage 进重构提交，需 `git reset --soft HEAD~1` + `git restore --staged` 重提。

**（3）批量替换会误伤同名属性**
用脚本批量替换 `width={` → `size={` 时，误改了 `ListingsPage.tsx` 的 Modal
（相同的缩进层级）。**批量替换前先看命中数量与上下文，替换后 diff 全文审查。**

**（4）Vite dev server 模块图陈旧**
大量提交 + prettier 重排后，HMR 可能报
`The requested module '/src/app/X.tsx?t=...' does not provide an export named 'X'`
（而导出其实存在）。**处理：杀掉 5173 端口进程，重启 `pnpm dev:web`。**
查找进程：`netstat -ano | grep ":5173"`。

**（5）集成测试并行 ECONNRESET**
见 §1.4。

**（6）`seed-sprint1-data.ts` 曾因列名变更失效**
SKU 单位迁移（`20260911_007`）把 `weight_kg`/`length_cm`/`volume_cm3`
改为 `weight_g`/`length_mm`/`volume_mm3`，但 seed 脚本未同步 →
`column "weight_kg" of relation "skus" does not exist`。
已在 commit `97876ab` 修复。**改 schema 时务必搜 seed 与脚本。**

**（7）antd v6 弃用项**（Phase 2 已清理，新增代码不要再用）

```text
Drawer  width      → size
Space   direction  → orientation
Alert   message    → title
```

**（8）React Query 缓存失效必须共享 queryKey 前缀**
见 §12.7。

**（9）`useApiQuery` 的双层解包陷阱**
`useApiQuery<T>` 返回的是 `{ data: T, meta }`，而 `T` 本身又是
`{ data: ... }` 信封（后端响应是 `{success, data, meta}`）。
所以访问时要写 `health.data?.data?.status`（**两层**）。
Phase 2 的 `SystemPage` 崩溃就是这个原因（`Cannot read properties of undefined`）。

**（10）`forceRender` 是历史包袱**
它为消除 antd "useForm not connected" 警告而加，但造成弹窗在 Drawer 关闭后仍挂载。
**正确做法是"打开时 resetFields"**，不是 `forceRender`。

**（11）Migration 类名必须带毫秒时间戳**
TypeORM 靠类名排序。**必须用 `pnpm db:migration:create`**，
不要手工写文件（脚本会自动追加 `Date.now()`）。

### 15.2 参考文档索引

| 文档 | 用途 |
|---|---|
| `AGENTS.md` | 根级硬性纪律（102 条） |
| `docs/business-rules/master-data.md` | 主数据规则（T0 要改的） |
| `docs/business-rules/inventory.md` | 库存规则（本任务书**不改**） |
| `docs/business-rules/orders.md` | 订单规则（本任务书**不改**） |
| `docs/architecture/dependency-rules.md` | 模块依赖规则 |
| `docs/architecture/overview.md` | 架构总览 |
| `docs/integrations/ozon.md` | OZON 平台知识 |
| `WCIES_Agent_Task_—_Sprint_5_Platform_Integration_Foundation_+_OZON.md` | Sprint 5 任务书（了解 sync/listing 上下文） |
| `docs/web-redesign-phase2-report.md` | Phase 2 UI 重构报告（含 **API Gap 表**，第 13 节） |
| `handoff/wcies-sprint5-final-report.md` | Sprint 5 最终报告（含下一步建议） |
| `docs/#WCIES 2.0 人工测试.MD` | 用户原始 30 条问题清单 |

### 15.3 本任务书与既有文档的关系

- **不改** `docs/business-rules/inventory.md` 与 `orders.md`
  （本任务书不触碰库存/订单业务规则）。
- **改** `docs/business-rules/master-data.md`（见 §6.1）。
- **新建** `CONTEXT.md`、`docs/decisions/`、`docs/manual-test-fix-report.md`。

### 15.4 完成定义（DoD）

只有以下**全部**满足，才能宣布本任务书完成：

```text
T0  CONTEXT.md 存在且只含术语
    docs/decisions/0001-0006 六份决策记录存在
    master-data.md §1/§2/§12 已更新 + 新增分类层级章节

T1  404 不再被误报为 "Request validation failed"
    真实 400 仍返回数组形态的 validationErrors
    全量集成测试无回归

T2  六类实体自动编码（仓库/店铺/品牌/分类/商品/SKU）
    作用域隔离正确（平台各自递增、商品各自递增）
    并发取号不重号（真实 PG 集成测试）
    商品编码与 SKU 编码创建后不可改
    仓库类型不可改
    内部条码保持 WCSKU%08d 不变
    Excel 导入兼容（留空自动生成）

T3  分类最多三级（数据库 CHECK 兜底）
    商品只能挂三级
    同父下名称唯一（含根级）
    四条越级规则 + 四个边界场景有测试
    商品分类筛选支持子树
    分类管理视图可用
    品牌四字段命名正确

T4  10 个实体有 DELETE + 零引用检查
    被引用返回明确错误码 + "只能停用"提示
    DELETE /listings/:listingId/skus/:id 缺口已修
    全部删除记 operation log

T5  未登录访问任意页面 → 跳登录页
    登录后回跳到原路径
    401 不重试、清状态、提示"登录已过期"
    顶栏显示真实用户 + 有退出登录
    弹窗不再被 Drawer 遮盖
    批量建位 / 配置凭证不再报 "Request validation failed"
    凭证弹窗不回显旧值
    库存流水列名为中文
    Reservation 全站称"库存占用"
    11 处英文枚举直出已补中文
    平台显示名为 Ozon / Wildberries / Yandex
    商品管理页与 SKU 映射页有 ContextRail
    SKU 详情可新建平台映射
    SKU 图片上传可用（根因已定位并写明）
    首页为运营看板，全部真实数据源

T6  六类创建表单不再有编码输入框
    商品/SKU 编码编辑态置灰
    品牌表单四字段
    分类三级弹窗 + Cascader + 分类管理视图
    各详情抽屉有编辑/启用/停用/删除
    仓库表单有联系方式字段
    店仓绑定有快捷入口

T7  前端 Docker 化（dev 热加载 + 生产 nginx）
    dev Webhook 重放脚本
    docs/manual-test-fix-report.md 逐条处置
    扫码结论文档
    Excel 模板 / seed / openapi 已同步

通用
    lint / typecheck / check:arch / test / build 全通过
    集成测试全通过（措辞如实）
    空库全量迁移通过 + down 可回滚
    GUI 三档分辨率验收 + Console 0 error
    无新增依赖
    无历史 Migration 被修改
    每任务独立提交
```

---

**任务书结束。执行会话如有疑问，先阅读第 4 节事实基线与第 15 节附录，
仍无法判断时停下来向用户确认，不要自行改方案（第 3 节决策已锁定）。**
