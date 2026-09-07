# WCIES 跨境电商综合管理系统
## Sprint 0 工程初始化规格 V1

---

# 1. Sprint 0 目标

Sprint 0 的目标不是开发商品、库存、订单等业务功能，而是建立一套后续能够长期稳定开发的工程底座。

完成以后，应满足：

> 新增一个业务模块时，开发者只需要关注业务本身，而不需要重新解决数据库、日志、错误处理、配置、队列、文件存储、API规范、测试和部署等基础问题。

Sprint 0 必须完成：

1. Monorepo
2. React Web
3. NestJS API
4. PostgreSQL
5. Redis
6. BullMQ
7. Object Storage
8. TypeORM Migration
9. Swagger / OpenAPI
10. Validation
11. Global Error Handling
12. Logging
13. Request ID
14. Health Check
15. CI
16. ESLint / Prettier
17. Architecture Check
18. AGENTS.md
19. Docker Compose
20. 基础自动化测试

---

# 2. 最终工程结构

Sprint 0 创建：

```text
wcies/
│
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── shared/
│   ├── api-client/
│   ├── platform-contracts/
│   ├── eslint-config/
│   └── tsconfig/
│
├── database/
│   └── migrations/
│
├── docs/
│   ├── architecture/
│   ├── business-rules/
│   ├── integrations/
│   ├── database/
│   └── decisions/
│
├── docker/
│
├── scripts/
│
├── tests/
│   ├── integration/
│   └── e2e/
│
├── .github/
│   └── workflows/
│
├── .env.example
├── .gitignore
├── AGENTS.md
├── docker-compose.yml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

---

# 3. 根 package.json

根目录只负责：

- Workspace
- 全局脚本
- lint
- typecheck
- test
- build
- docker
- migration
- architecture check

建议命令：

```json
{
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "dev:web": "pnpm --filter @wcies/web dev",
    "dev:api": "pnpm --filter @wcies/api dev",

    "build": "pnpm -r build",

    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",

    "check:arch": "tsx scripts/check-architecture.ts",

    "db:migrate": "pnpm --filter @wcies/api migration:run",
    "db:rollback": "pnpm --filter @wcies/api migration:revert",
    "db:generate": "pnpm --filter @wcies/api migration:generate",

    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down"
  }
}
```

具体命令可以根据初始化后的工具稍作调整。

---

# 4. pnpm workspace

`pnpm-workspace.yaml`：

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

约定所有内部 package 使用：

```text
@wcies/*
```

例如：

```text
@wcies/web
@wcies/api
@wcies/shared
@wcies/api-client
@wcies/platform-contracts
```

---

# 5. Node 与 pnpm

统一开发环境：

```text
Node.js 24 LTS
pnpm
```

根目录增加：

```text
.node-version
```

或：

```text
.nvmrc
```

避免：

开发机

CI

生产服务器

使用不同 Node 版本。

---

# 6. TypeScript统一配置

根：

```text
tsconfig.base.json
```

建议：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

核心原则：

**全项目 Strict TypeScript。**

禁止为了省事：

```text
strict: false
```

---

# 7. Web初始化

`apps/web`

技术：

```text
React
Vite
TypeScript
Ant Design
React Router
TanStack Query
```

基本目录：

```text
apps/web/src/
├── app/
├── layouts/
├── pages/
├── features/
├── components/
├── api/
├── hooks/
├── stores/
├── utils/
└── assets/
```

---

# 8. Web Provider

统一建立：

```text
AppProviders
```

负责：

```text
React Query
Router
Ant Design ConfigProvider
Error Boundary
```

避免页面自行创建全局Provider。

---

# 9. Web基础路由

Sprint 0 只需要：

```text
/login

/

/health-test
```

其中：

`/`

可以先显示：

```text
WCIES Dashboard
```

不开发真实 Dashboard。

---

# 10. API初始化

`apps/api`

采用：

```text
NestJS
TypeScript
TypeORM
```

初始结构：

```text
apps/api/src/
├── main.ts
├── app.module.ts
├── config/
├── common/
├── database/
├── modules/
├── workers/
└── health/
```

---

# 11. main.ts

`main.ts` 必须统一初始化：

1. API Prefix
2. ValidationPipe
3. Global Error Filter
4. Logging
5. Request ID
6. Swagger
7. CORS
8. Graceful Shutdown

API统一：

```text
/api/v1
```

---

# 12. ValidationPipe

全局：

```typescript
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
```

目的：

客户端发送：

```json
{
  "skuId": "...",
  "quantity": 2,
  "randomField": "xxx"
}
```

如果DTO没有：

```text
randomField
```

应该直接拒绝。

防止：

错误字段静默进入业务逻辑。

---

# 13. 请求 DTO

统一采用：

```text
class-validator
class-transformer
```

例如：

```typescript
export class ExampleDto {
  @IsUUID()
  skuId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;
}
```

---

# 14. API Response

建立统一：

```text
ApiResponse<T>
```

正常：

```json
{
  "success": true,
  "data": {}
}
```

分页：

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 50,
    "total": 100
  }
}
```

---

# 15. Error Response

统一：

```json
{
  "success": false,
  "error": {
    "code": "INVENTORY_INSUFFICIENT_STOCK",
    "message": "库存不足",
    "details": {}
  },
  "requestId": "abc123"
}
```

禁止不同模块返回：

```text
msg
message
errorMessage
reason
```

不同结构。

---

# 16. Error Code基础规范

错误码使用：

```text
DOMAIN_REASON
```

例如：

```text
COMMON_VALIDATION_FAILED

COMMON_NOT_FOUND

AUTH_UNAUTHORIZED

PRODUCT_SKU_NOT_FOUND

INVENTORY_RECORD_NOT_FOUND

INVENTORY_INSUFFICIENT_STOCK

INVENTORY_RESERVATION_INVALID_STATE

ORDER_NOT_FOUND

ORDER_INVALID_STATE

PLATFORM_API_ERROR

SYNC_JOB_FAILED
```

后续业务模块继续扩展。

---

# 17. Global Exception Filter

建立：

```text
common/filters/global-exception.filter.ts
```

负责：

- Domain Error
- Validation Error
- HttpException
- Database Error
- Unknown Error

统一转换成 API Error。

未知错误：

不得把：

```text
SQL
Stack Trace
Secret
```

直接返回前端。

---

# 18. Domain Error Base Class

建议：

```typescript
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
```

后续：

```text
InsufficientStockError
```

继承。

---

# 19. Request ID

每一个HTTP请求生成：

```text
requestId
```

优先接受反向代理提供的：

```text
X-Request-ID
```

不存在则：

生成UUID。

Response Header：

```text
X-Request-ID
```

也返回。

---

# 20. Async Context

推荐利用：

```text
AsyncLocalStorage
```

保存：

```text
requestId
userId
```

后续 Service 写日志时：

不需要每层手动传：

```text
requestId
```

---

# 21. Logger

建议使用：

```text
Pino
```

配合 NestJS。

开发：

Pretty Log。

生产：

JSON Log。

例如：

```json
{
  "level": "info",
  "requestId": "...",
  "userId": "...",
  "storeId": "...",
  "message": "order sync started"
}
```

---

# 22. 日志禁止内容

严禁日志输出：

- 平台 API Secret
- Password
- Token
- 完整买家隐私信息
- 数据库密码

需要统一：

```text
redact
```

---

# 23. PostgreSQL

Docker服务：

```text
postgres
```

开发：

一个数据库：

```text
wcies_dev
```

测试：

```text
wcies_test
```

生产：

独立数据库。

---

# 24. TypeORM DataSource

统一定义：

```text
apps/api/src/database/datasource.ts
```

Migration工具：

和Nest Runtime：

使用同一数据库配置来源。

避免：

应用能连接

Migration连接失败。

---

# 25. synchronize禁止

统一：

```typescript
synchronize: false
```

所有环境原则上均使用Migration。

开发阶段也不建议依赖：

```text
synchronize=true
```

否则 AI 修改 Entity 后可能悄悄改变数据库结构。

---

# 26. Migration目录

统一：

```text
database/migrations/
```

数据库结构变化必须：

```text
Entity
+
Migration
```

同步修改。

---

# 27. Migration命令

需要提供：

```text
migration:create

migration:generate

migration:run

migration:revert

migration:show
```

开发文档明确写入：

README。

---

# 28. 初始Migration

Sprint 0可以只创建：

```text
system_health_check
```

或者一个极小基础表测试Migration机制。

不需要提前创建全部业务表。

Sprint 1正式建立：

Product / SKU / Warehouse / Inventory。

---

# 29. Redis

Docker：

```text
redis
```

主要负责：

- BullMQ
- Cache
- Distributed Lock
- Rate Limit辅助

第一阶段不要把Redis当：

核心数据库。

任何关键业务数据必须：

最终落PostgreSQL。

---

# 30. BullMQ

安装：

```text
BullMQ
Nest BullMQ integration
```

Sprint 0建立：

```text
wcies.test
```

测试队列。

Job：

```json
{
  "message": "hello"
}
```

Worker成功消费：

打印结构化日志。

---

# 31. Worker入口

建立：

```text
apps/api/src/worker.ts
```

与：

```text
main.ts
```

分离。

运行：

```text
API Process

Worker Process
```

---

# 32. WorkerModule

```text
workers/
├── worker.module.ts
└── test.processor.ts
```

Sprint 0只验证：

Queue正常。

Sprint 1以后逐渐增加：

```text
order-sync
inventory-sync
tracking-sync
...
```

---

# 33. BullMQ基础规范

所有 Job 必须包含：

```text
jobName
jobId
createdAt
```

业务任务未来增加：

```text
storeId
platform
syncJobId
```

---

# 34. Job Retry默认策略

建议公共默认：

```text
attempts: 3
```

Backoff：

```text
exponential
```

平台429：

以后允许Adapter读取：

```text
Retry-After
```

覆盖默认策略。

---

# 35. BullMQ失败

Job失败：

必须：

- 保存日志
- 保留failed job
- 可人工重试

未来结合：

```text
system_exception
```

创建异常。

---

# 36. 对象存储

本地开发推荐：

```text
MinIO
```

提供 S3 API。

生产未来可以：

- MinIO
- Cloudflare R2
- AWS S3
- OSS
- COS

业务层只依赖：

```text
ObjectStorageService
```

---

# 37. ObjectStorageService

统一接口：

```text
upload()

delete()

getSignedUrl()

exists()
```

业务模块禁止直接调用：

```text
MinIO SDK
```

---

# 38. Bucket规划

初期可以：

```text
wcies
```

一个bucket。

通过object key区分：

```text
products/

labels/

imports/

exports/

returns/
```

例如：

```text
products/sku-xxx/xxx.webp

labels/order-xxx/label.pdf
```

---

# 39. Signed URL

文件默认：

**私有。**

需要浏览：

通过：

```text
Signed URL
```

临时访问。

不要把：

物流面单

采购文件

退货图片

全部做成公开URL。

---

# 40. Health Module

提供：

```text
GET /health
```

返回：

```json
{
  "status": "ok"
}
```

---

# 41. Readiness

建议：

```text
GET /health/ready
```

检查：

- PostgreSQL
- Redis

对象存储：

可按需检查。

---

# 42. Liveness

```text
GET /health/live
```

只判断：

API进程活着。

不要因为第三方OZON API挂了：

把ERP自己判断为：

Dead。

---

# 43. Swagger

路径：

```text
/api/docs
```

自动生成：

OpenAPI JSON：

```text
/api/docs-json
```

---

# 44. Swagger要求

所有业务接口后续必须：

- 描述
- Request DTO
- Response DTO
- Error
- Tag

清晰。

OpenAPI后续用于：

生成：

```text
packages/api-client
```

---

# 45. API Client Generator

Sprint 0 建立：

```text
scripts/generate-api-client.ts
```

或采用成熟：

OpenAPI Generator / Orval

从：

```text
openapi.json
```

生成：

TypeScript API Client。

---

# 46. packages/api-client

第一阶段可以只有：

```text
healthApi
```

验证：

前端使用生成Client：

访问：

```text
GET /health
```

成功。

---

# 47. packages/platform-contracts

Sprint 0创建：

```text
platform-adapter.interface.ts
```

以及基础统一类型。

暂时不写OZON实现。

主要目的是冻结：

平台集成边界。

---

# 48. 最小PlatformAdapter契约

Sprint 0可以先定义：

```typescript
export interface PlatformAdapter {
  readonly platformCode: string;

  validateCredential(
    context: PlatformCredentialContext,
  ): Promise<void>;
}
```

之后随着Sprint增加能力。

不要 Sprint 0 一次写几十个空方法。

---

# 49. 配置系统

使用：

```text
@nestjs/config
```

所有环境配置必须：

集中校验。

---

# 50. ENV Schema

启动时校验：

```text
NODE_ENV

PORT

DATABASE_URL

REDIS_URL

JWT_SECRET

CREDENTIAL_ENCRYPTION_KEY

S3_ENDPOINT

S3_ACCESS_KEY

S3_SECRET_KEY

S3_BUCKET
```

缺失：

应用启动失败。

不要：

运行到一半才发现环境变量没有配置。

---

# 51. 环境文件

仓库：

```text
.env.example
```

提交。

实际：

```text
.env
.env.production
```

不提交。

---

# 52. `.env.example`

只包含：

```text
变量名
+
示例
+
注释
```

不能包含：

真实凭证。

---

# 53. Credential Encryption Service

Sprint 0建议直接建立：

```text
CredentialEncryptionService
```

采用：

```text
AES-256-GCM
```

输入：

```text
plain text
```

输出至少包括：

```text
cipherText
iv
authTag
```

---

# 54. 加密测试

必须验证：

```text
encrypt
↓
decrypt
↓
得到原值
```

错误Key：

必须：

失败。

---

# 55. Authentication

Sprint 0不需要做复杂RBAC。

但建议至少建立：

```text
AuthModule
```

并实现：

```text
管理员登录
```

如果需要进一步降低首阶段开发量：

也可以在Sprint 0后半完成。

---

# 56. Auth策略

内部ERP建议：

```text
Email/Username
+
Password
```

JWT：

Access Token

或者安全Cookie Session。

对于目前内部员工系统：

两者都可以。

建议：

**HttpOnly Cookie Session / Token**

优先于：

LocalStorage永久保存JWT。

---

# 57. Password

密码：

```text
Argon2
```

Hash。

禁止：

明文

或：

可逆加密。

---

# 58. 用户初始模型

Sprint 0：

```text
users
```

至少：

```text
id
username
password_hash
status
created_at
```

目前权限暂不复杂。

预留：

```text
role
```

即可。

---

# 59. CORS

开发：

只允许本地Web地址。

生产：

只允许ERP域名。

不要：

```text
origin: *
```

带认证Cookie。

---

# 60. Security Headers

建议：

```text
helmet
```

NestJS启用。

---

# 61. Rate Limit

登录接口：

必须限流。

Webhook：

以后按：

平台特性

单独控制。

普通ERP内部API：

暂时不需要严格限流。

---

# 62. ESLint

统一根配置。

重点规则：

```text
typescript strict

no-floating-promises

no-misused-promises

no-unused-vars

consistent-type-imports
```

核心模块：

禁止：

```text
any
```

除非：

明确有注释说明原因。

---

# 63. Prettier

统一：

- 引号
- 行宽
- 尾逗号
- 缩进

AI输出代码必须自动格式化。

避免：

不同 Coding Session：

不同代码格式。

---

# 64. Architecture Check

创建：

```text
scripts/check-architecture.ts
```

Sprint 0至少检查：

### Rule 1

Controller不得：

import Repository。

### Rule 2

Web不得：

import API Entity。

### Rule 3

integration不得：

import inventory repository。

### Rule 4

业务模块不得跨模块直接：

import另一个模块的repository目录。

---

# 65. 后续增加的架构规则

Sprint 1加入：

```text
除inventory模块外禁止更新InventoryBalance
```

可以通过：

AST / import规则

先覆盖大部分风险。

---

# 66. ESLint Boundary

如果配置方便：

可以使用：

```text
eslint-plugin-boundaries
```

或：

自定义 import restriction。

如果配置过重：

先使用：

```text
no-restricted-imports
```

即可。

---

# 67. Husky

建立：

```text
pre-commit
```

执行：

```text
lint-staged

architecture check
```

不要每次commit都执行全部E2E。

否则过慢。

---

# 68. lint-staged

只检查：

本次修改文件。

例如：

```text
eslint --fix
prettier --write
```

---

# 69. pre-push

可以执行：

```text
typecheck
unit test
```

如果影响单人开发效率：

也可以交给CI执行。

---

# 70. CI

`.github/workflows/ci.yml`

基本流程：

```text
Checkout

↓

Setup Node / pnpm

↓

pnpm install --frozen-lockfile

↓

lint

↓

typecheck

↓

check:arch

↓

unit tests

↓

build
```

---

# 71. Integration Test CI

Sprint 0可先建立基础：

PostgreSQL service。

以后 Sprint 1开始：

库存集成测试加入CI。

---

# 72. Test Framework

前后端统一推荐：

```text
Vitest
```

NestJS如果部分生成代码默认Jest：

可以统一换Vitest，

也可以暂时：

后端Jest

前端Vitest。

考虑单程序员：

我更建议统一测试体验。

---

# 73. 测试分类

统一命名：

```text
*.spec.ts
```

模块单元测试：

靠近源码。

Integration：

```text
tests/integration
```

E2E：

```text
tests/e2e
```

---

# 74. Docker Compose

开发基础设施：

```yaml
services:
  postgres:
  redis:
  minio:
```

可选：

```text
minio-init
```

用于创建Bucket。

---

# 75. PostgreSQL Volume

开发环境使用：

Named Volume。

例如：

```text
postgres_data
```

避免：

docker compose down

数据库就丢失。

---

# 76. Redis Volume

开发可以不持久。

生产：

建议开启适当持久化。

---

# 77. MinIO Volume

使用：

```text
minio_data
```

---

# 78. Docker Network

统一：

```text
wcies-network
```

容器内部：

使用服务名访问：

```text
postgres:5432

redis:6379

minio:9000
```

---

# 79. 生产 Docker

后续生产：

```text
reverse-proxy

web

api

worker

postgres

redis

object-storage
```

Sprint 0只需保证：

开发Compose工作。

---

# 80. Nginx / Caddy

现在暂不需要最终决定。

开发：

Vite直接运行。

生产部署时：

再选择：

Caddy

或：

Nginx。

---

# 81. README

根README至少必须写：

### 环境要求

```text
Node
pnpm
Docker
```

### 首次启动

```text
cp .env.example .env

pnpm install

docker compose up -d

pnpm db:migrate

pnpm dev
```

### URL

```text
Web
API
Swagger
MinIO Console
```

---

# 82. docs 初始化

Sprint 0创建：

```text
docs/architecture/overview.md

docs/architecture/dependency-rules.md

docs/business-rules/inventory.md

docs/business-rules/orders.md

docs/integrations/ozon.md
```

可以先写：

骨架 + 当前已经确认的规则。

---

# 83. Inventory Rules文档第一版

必须至少包含：

```text
On Hand

Reserved

Picked

Available

Safety Stock
```

并写明：

```text
Available =
OnHand - Reserved - Picked - SafetyStock
```

以及：

> 没有库存记录 ≠ 库存为0。

---

# 84. AGENTS.md

Sprint 0必须完成第一版。

建议：

```markdown
# WCIES AI Coding Rules

## Before coding

1. Read relevant docs/business-rules/*
2. Read module README if present
3. Do not invent business rules
4. Follow existing patterns

## Hard architecture rules

1. Inventory changes only through InventoryService.
2. Every inventory mutation creates InventoryTransaction.
3. Controllers cannot access repositories directly.
4. Platform adapters cannot mutate business entities directly.
5. External events must be idempotent.
6. TypeORM entities are never API response DTOs.
7. Store-scoped platform data must contain storeId.
8. Database schema changes require migration.
9. Do not use synchronize=true.
10. Never expose secrets.

## Vibe Coding

Before changing architecture:
- explain why
- update architecture docs
- do not silently refactor module boundaries
```

---

# 85. Vibe Coding Task模板

建议放：

```text
docs/vibe-task-template.md
```

内容：

```text
Task:

Goal:

Allowed directories:

Required reading:

Inputs:

Expected behavior:

Business rules:

Transaction requirements:

Errors:

Tests:

Forbidden:
```

---

# 86. Seed

建立：

```text
scripts/seed-dev-data.ts
```

Sprint 0可以创建：

管理员账号。

未来增加：

测试Platform / Store。

---

# 87. Reset Dev DB

提供：

```text
scripts/reset-dev-db.ts
```

仅允许：

```text
NODE_ENV=development
```

执行。

生产必须拒绝。

---

# 88. scripts安全规则

任何：

```text
reset
delete all
truncate
```

类型脚本：

必须检测环境。

避免：

AI在生产环境误运行。

---

# 89. Database Backup

Sprint 0暂不需要自动备份系统。

但README生产部署章节必须预留：

```text
PostgreSQL Backup
```

要求。

进入试运行前必须补齐。

---

# 90. Observability基础

Sprint 0至少提供：

```text
structured logs
health endpoint
request id
```

暂时不需要：

Prometheus

Grafana

OpenTelemetry完整体系。

后续再引入。

---

# 91. API Version

从第一天：

```text
/api/v1
```

避免未来接口变化：

无法版本化。

---

# 92. Date规则

API日期时间：

统一：

```text
ISO 8601
```

例如：

```text
2026-09-07T10:30:00Z
```

数据库：

UTC。

Web：

根据用户时区显示。

---

# 93. Decimal规则

数据库：

```text
NUMERIC
```

金额和库存数量不能使用：

```text
float
```

API：

根据字段契约决定：

string

或：

number。

财务高精度字段推荐：

API使用字符串形式避免JS精度问题。

---

# 94. UUID

内部实体统一：

```text
UUID
```

禁止前端自行生成：

系统业务编号。

业务编号由后端统一产生。

---

# 95. Business Number Service

可以预留：

```text
BusinessNumberService
```

用于：

```text
SO
PO
TR
PK
```

等编号。

Sprint 0不必完整实现。

---

# 96. 时间任务

不要使用：

```text
setInterval
```

直接在业务Service里运行同步。

未来统一通过：

```text
Scheduler
→
BullMQ
```

---

# 97. Cron

Sprint 0可以测试：

Nest Scheduler

每分钟创建一个：

测试Job。

验证：

```text
Scheduler
↓
BullMQ
↓
Worker
```

整个链路正常。

测试完成后：

可以关闭测试Cron。

---

# 98. Sprint 0任务拆解

建议按以下顺序执行。

## S0-01 Repository

- 创建Git仓库
- 初始化pnpm workspace
- 创建基础目录
- README
- gitignore

---

## S0-02 TypeScript

- Base tsconfig
- Strict Mode
- shared config

---

## S0-03 Web

- Vite
- React
- Ant Design
- Router
- TanStack Query
- AppLayout

---

## S0-04 API

- NestJS
- `/api/v1`
- Config
- Validation
- Swagger

---

## S0-05 PostgreSQL

- Docker PostgreSQL
- TypeORM
- DataSource
- Migration机制

---

## S0-06 Error System

- DomainError
- GlobalExceptionFilter
- Error Response

---

## S0-07 Logging

- Pino
- Request ID
- Async Context
- Secret redact

---

## S0-08 Redis

- Redis连接
- health check

---

## S0-09 BullMQ

- Queue
- Worker
- Test Job
- Retry

---

## S0-10 Object Storage

- MinIO
- S3 client
- ObjectStorageService
- 上传/下载测试

---

## S0-11 Auth

- User
- Admin Login
- Password Hash
- HttpOnly authentication

---

## S0-12 API Client

- OpenAPI export
- API client generation
- Web调用 health API

---

## S0-13 Engineering Rules

- ESLint
- Prettier
- Husky
- lint-staged
- check-architecture

---

## S0-14 Testing

- Unit test
- API test
- DB connection test
- Queue test

---

## S0-15 CI

- lint
- typecheck
- test
- build
- architecture check

---

## S0-16 Documentation

- AGENTS.md
- Architecture rules
- Inventory rules
- Vibe task template

---

# 99. Sprint 0不做

明确禁止扩范围到：

- SKU CRUD
- 实际库存功能
- OZON API
- 订单同步
- 采购
- 财务
- 物流

Sprint 0只做：

**工程骨架。**

---

# 100. Sprint 0验收清单

以下全部通过才算 Sprint 0 完成。

### Repository

- [ ] pnpm workspace正常
- [ ] web/API能够分别启动
- [ ] 根脚本正常

### Web

- [ ] React运行
- [ ] Ant Design运行
- [ ] Router运行
- [ ] TanStack Query运行
- [ ] API client调用成功

### API

- [ ] NestJS启动
- [ ] `/api/v1`
- [ ] ValidationPipe
- [ ] Error Filter
- [ ] Swagger

### Database

- [ ] PostgreSQL启动
- [ ] TypeORM连接
- [ ] Migration执行
- [ ] Migration rollback

### Redis

- [ ] Redis连接
- [ ] readiness检测

### Queue

- [ ] BullMQ入队
- [ ] Worker消费
- [ ] retry工作

### Storage

- [ ] MinIO启动
- [ ] Bucket存在
- [ ] 上传文件
- [ ] Signed URL读取

### Security

- [ ] ENV校验
- [ ] Credential加密测试
- [ ] Password Hash
- [ ] Secret不进入日志

### Logging

- [ ] Request ID
- [ ] JSON Log
- [ ] API错误带requestId

### Engineering

- [ ] ESLint
- [ ] Prettier
- [ ] Architecture Check
- [ ] Husky
- [ ] CI

### Documentation

- [ ] README
- [ ] AGENTS.md
- [ ] Architecture Rule
- [ ] Inventory Rule
- [ ] Vibe Task Template

---

# 101. Sprint 0最终冒烟测试

启动：

```text
docker compose up -d
```

然后：

```text
pnpm install

pnpm db:migrate

pnpm dev
```

验证：

```text
Browser
↓
WCIES Web
↓
调用API
↓
GET /api/v1/health
↓
NestJS
↓
PostgreSQL / Redis Ready
```

然后：

前端触发：

```text
Test Queue
```

流程：

```text
Web
↓
API
↓
BullMQ
↓
Redis
↓
Worker
↓
Log
```

再上传：

```text
test.jpg
```

流程：

```text
Web
↓
API
↓
ObjectStorageService
↓
MinIO
↓
Signed URL
↓
Web可读取
```

三个链路全部通过：

Sprint 0工程基础通过。

---

# 102. Sprint 0完成后的正式状态

此时系统虽然还没有真正ERP业务，但已经拥有：

```text
Web
API
Database
Cache
Queue
Worker
Storage
Auth
OpenAPI
Logging
Error Handling
Migration
Testing
CI
Architecture Rules
AI Coding Rules
```

因此下一步可以安全进入：

# Sprint 1

**商品主数据 + 仓库主数据 + SKU基础体系**

具体包括：

```text
Product

SKU

Barcode

SKU Image

Warehouse

Warehouse Bin

Platform

Store

Store Warehouse Binding

Listing

Platform SKU Mapping
```

Sprint 1结束后，系统应第一次具备可以录入真实公司商品、SKU、仓库、货架以及11个店铺映射关系的能力。