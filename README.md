# WCIES

跨境电商综合管理系统（Cross-border E-commerce Integrated Management System）。

当前阶段：**Sprint 0 — 工程骨架与基础设施**。业务模块（商品 / SKU / 库存 / 订单 / 平台集成）自 Sprint 1 开始实现。

## 技术栈

- **Frontend**: TypeScript · React · Vite · Ant Design · React Router · TanStack Query
- **Backend**: TypeScript · Node.js 24 · NestJS · TypeORM · REST + OpenAPI/Swagger
- **Data**: PostgreSQL · Redis · BullMQ · MinIO（S3 兼容对象存储）
- **Infra**: pnpm Monorepo · Docker Compose

## 环境要求

```text
Node.js >= 24（见 .nvmrc）
pnpm >= 12
Docker + Docker Compose
```

## 首次启动

```bash
cp .env.example .env        # 按需修改（本地开发默认值开箱即用）

pnpm install

docker compose up -d        # 启动 postgres / redis / minio

pnpm db:migrate             # 执行数据库迁移

pnpm seed:dev               # 创建开发管理员（读取 .env 中 ADMIN_*）

pnpm dev                    # 同时启动 API(:3000) 与 Web(:5173)
```

如需后台队列 Worker（独立进程）：

```bash
pnpm dev:worker
```

## 服务地址

| 服务 | 地址 | 说明 |
|---|---|---|
| Web | http://localhost:5173 | 前端开发服务器（`/`、`/login`、`/health-test`） |
| API | http://localhost:3000/api/v1 | REST API 前缀 |
| Swagger UI | http://localhost:3000/api/docs | 接口文档 |
| OpenAPI JSON | http://localhost:3000/api/docs-json | 用于生成 api-client |
| Health | http://localhost:3000/health/live · /health/ready | 存活 / 就绪探针 |
| MinIO Console | http://localhost:9001 | 对象存储控制台（`wcies_minio_dev` / `wcies_minio_dev_secret`） |
| PostgreSQL | localhost:5432 | `wcies` / `wcies_dev_password` / `wcies_dev`（仅本地开发） |

## 常用命令

```bash
pnpm dev                # API + Web 并行开发
pnpm dev:worker         # 独立 Worker 进程
pnpm build              # 构建所有包
pnpm lint               # ESLint
pnpm typecheck          # TypeScript 检查
pnpm test               # 单元测试
pnpm test:integration   # 集成测试（需要 docker compose 服务运行）
pnpm check:arch         # 架构规则检查

pnpm db:migrate         # 执行迁移
pnpm db:rollback        # 回滚上一个迁移
pnpm db:migration:show  # 迁移状态
pnpm db:migration:create <Name>    # 新建空迁移（PascalCase 名）
pnpm db:migration:generate <Name>  # 从实体差异生成迁移（需先 build api）

pnpm openapi:export     # 导出 openapi.json（需 docker 服务运行 + api 已 build）
pnpm api-client:generate # 重新生成 @wcies/api-client 类型

pnpm docker:up / docker:down
```

## 测试账号

开发管理员由 `pnpm seed:dev` 从 `.env` 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 创建（默认 `admin` / `change-me-admin-password`，请自行修改）。

## 仓库结构

```text
apps/
  web/          # React + Vite + Ant Design 前端
  api/          # NestJS API（main.ts = HTTP，worker.ts = 队列 Worker）
packages/
  shared/              # 跨端通用类型（响应封装、分页）
  api-client/           # OpenAPI 生成的类型化客户端（openapi-fetch）
  platform-contracts/   # 平台适配器契约（PlatformAdapter）
database/migrations/    # TypeORM 迁移（唯一 Schema 事实源）
tests/integration/      # 跨进程集成测试
docs/                   # 架构 / 业务规则 / 集成文档
scripts/                # db / architecture-check / api-client 生成脚本
```

## 开发纪律

见 [AGENTS.md](./AGENTS.md)（硬性规则）。关键约束：

- Schema 只能通过 Migration 变更（`synchronize = false` 全环境生效）
- 所有库存变化必须经过 Inventory 模块并写流水（自 Sprint 起严格执行）
- Controller 不 import Repository；模块间只通过公开 Service 交互
- 业务状态禁止 magic string，统一枚举 / 常量
- 密钥不入库不入 Git；`.env` 不提交
