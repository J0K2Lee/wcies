# WCIES 依赖规则

> 硬性边界。由 `scripts/check-architecture.ts`（`pnpm check:arch`）在 pre-commit 与 CI 强制执行；违规时命令返回非 0。

## 1. 分层依赖方向

```text
Web (apps/web)
  ↓ REST / OpenAPI（仅通过 @wcies/api-client）
Controller → Service → Repository → PostgreSQL
Sync / 业务 Service → PlatformAdapter → Platform Client → 平台 API
```

禁止反向依赖。

## 2. 检查规则（Sprint 0 起生效）

### Rule 1 — Controller 不得 import Repository

Controller 只负责 HTTP、DTO 校验、调用 Service。

### Rule 2 — Web 不得 import 后端内部实现

`apps/web` 禁止 import `@wcies/api/*`、`apps/api/**`（含 Entity）。后端类型只能通过 `@wcies/shared`（通用契约）与 `@wcies/api-client`（OpenAPI 生成）进入前端。

### Rule 3 — Integration 不得 import Inventory 内部实现

平台集成代码（现在或未来的 `modules/integration` 及所有 `modules/inventory` 之外的代码）禁止 import `modules/inventory/repositories|entities|internal`。库存只能通过 Inventory 模块公开 Service 访问（AGENTS.md §10）。

### Rule 4 — 模块间不得 import 对方内部 Repository / Entity

`modules/<A>` 内的文件不得解析到 `modules/<B>/repositories|entities|internal`（B ≠ A）。跨模块交互只允许对方导出的 Service / Public DTO / Contract / Public Event。

## 3. 包依赖

| 包 | 允许依赖 |
|---|---|
| `@wcies/web` | `@wcies/api-client`、`@wcies/shared` |
| `@wcies/api-client` | `@wcies/shared`（生成 schema 独立） |
| `@wcies/platform-contracts` | 无（纯契约） |
| `@wcies/shared` | 无（纯类型/常量） |
| `@wcies/api` | 以上三个包 |

## 4. 已知豁免

- `apps/api/src/database/datasource.ts`（迁移 CLI）与测试代码不受模块边界约束。
- 架构检查当前不解析路径别名（项目内部使用相对导入）。
