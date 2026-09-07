# WCIES Agent Task
## Sprint 0 — 工程初始化与开发骨架搭建

### 任务目标

为 WCIES 跨境电商综合管理系统建立可长期开发的工程基础。

本任务只完成：

**工程骨架、基础设施、开发规范与验证链路。**

不得提前开发：

- Product / SKU业务
- Inventory业务
- Order业务
- OZON / WB / Yandex真实API
- 采购
- 调拨
- 财务
- 物流

Sprint 0 完成后，项目应达到：

> 可以安全开始 Sprint 1 商品、SKU、仓库等业务开发。

---

# 一、开始任务前必须执行

开始编码前，先阅读：

```text
AGENTS.md
```

并检查：

```text
docs/
```

目录下已有的架构和业务规则文档。

如果存在：

```text
docs/business-rules/inventory.md
```

必须阅读，但本 Sprint 不实现库存业务。

如果已有项目代码：

先分析现有结构，不得直接覆盖或重建。

---

# 二、技术栈

必须使用当前已经确定的技术栈：

## Frontend

```text
TypeScript
React
Vite
Ant Design
React Router
TanStack Query
```

Zustand：

仅在确有需要时使用。

---

## Backend

```text
TypeScript
Node.js 24 LTS
NestJS
TypeORM
REST API
OpenAPI / Swagger
```

---

## Data / Infrastructure

```text
PostgreSQL
Redis
BullMQ
S3-compatible Object Storage
Docker Compose
pnpm Monorepo
```

本地对象存储使用：

```text
MinIO
```

---

# 三、禁止自行改变技术栈

不得自行改成：

```text
Next.js
Prisma
FastAPI
Spring Boot
MongoDB
GraphQL
Nx
Turborepo
Kubernetes
Microservices
```

不得升级或新增非必要依赖。

确实需要新增依赖时：

先说明：

1. 当前已有工具为什么无法完成；
2. 要增加什么依赖；
3. 用于解决什么问题。

---

# 四、目标 Monorepo 结构

建立：

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
│   └── platform-contracts/
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
├── scripts/
│
├── tests/
│   ├── integration/
│   └── e2e/
│
├── .github/
│   └── workflows/
│
├── AGENTS.md
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

如现有仓库已有合理目录：

允许在不违反架构规则的情况下适配，

不要为了完全匹配目录图而进行无意义重构。

---

# 五、任务 S0-01：pnpm Monorepo

完成：

```text
pnpm workspace
```

内部包统一命名：

```text
@wcies/*
```

至少：

```text
@wcies/web
@wcies/api
@wcies/shared
@wcies/api-client
@wcies/platform-contracts
```

根目录提供统一命令：

```text
dev
dev:web
dev:api

build

lint
typecheck
test

check:arch

db:migrate
db:rollback

docker:up
docker:down
```

---

# 六、任务 S0-02：TypeScript

建立统一：

```text
tsconfig.base.json
```

要求：

```text
strict = true
strictNullChecks = true
noImplicitAny = true
noUncheckedIndexedAccess = true
```

不得为了消除错误关闭 strict。

---

# 七、任务 S0-03：React Web

初始化：

```text
apps/web
```

必须集成：

```text
React
Vite
TypeScript
Ant Design
React Router
TanStack Query
```

初始页面只需要：

```text
/login
/
/health-test
```

`/`

显示简单：

```text
WCIES
```

即可。

不要开发真实Dashboard。

---

# 八、Web Provider

建立统一：

```text
AppProviders
```

负责：

- QueryClient
- Router
- Ant Design ConfigProvider
- Error Boundary

不要让各页面重复初始化Provider。

---

# 九、任务 S0-04：NestJS API

初始化：

```text
apps/api
```

统一API前缀：

```text
/api/v1
```

建立：

```text
main.ts
app.module.ts
```

并接入：

- Config
- ValidationPipe
- Global Exception Filter
- Logger
- Swagger
- CORS
- Helmet
- Graceful Shutdown

---

# 十、Validation

全局启用：

```typescript
ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
})
```

所有外部HTTP输入：

必须DTO验证。

---

# 十一、API统一Response

成功：

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
    "total": 0
  }
}
```

失败：

```json
{
  "success": false,
  "error": {
    "code": "COMMON_ERROR_CODE",
    "message": "错误信息",
    "details": {}
  },
  "requestId": "..."
}
```

不要自行创造多套Response格式。

---

# 十二、Domain Error基础体系

建立：

```text
DomainError
```

以及：

```text
GlobalExceptionFilter
```

至少能够统一处理：

- DTO Validation
- HttpException
- DomainError
- Database Error
- Unknown Error

未知错误：

禁止把：

- SQL
- Stack Trace
- Secret

直接返回前端。

---

# 十三、任务 S0-05：PostgreSQL + TypeORM

Docker启动：

```text
PostgreSQL
```

配置：

```text
TypeORM
```

必须：

```text
synchronize = false
```

数据库Schema只允许通过：

```text
Migration
```

维护。

建立：

```text
apps/api/src/database/datasource.ts
```

和：

```text
database/migrations/
```

---

# 十四、Migration能力

必须提供并验证：

```text
migration:create
migration:generate
migration:run
migration:revert
migration:show
```

Sprint 0 可以只创建极小测试表或基础系统表验证Migration。

不要提前建立所有ERP业务表。

---

# 十五、任务 S0-06：Redis

Docker启动：

```text
Redis
```

NestJS能够连接。

Redis第一阶段只用于：

- Queue
- Cache预留
- Distributed Lock预留

不得存放唯一关键业务事实。

---

# 十六、任务 S0-07：BullMQ

配置：

```text
BullMQ
```

建立测试Queue：

```text
wcies.test
```

建立Worker：

```text
apps/api/src/worker.ts
```

API和Worker：

必须可以作为两个独立进程运行。

---

# 十七、BullMQ测试链路

建立：

```text
POST /api/v1/dev/test-job
```

仅 Development 环境开放。

流程：

```text
API
↓
BullMQ
↓
Redis
↓
Worker
↓
Structured Log
```

必须成功。

Production环境：

该测试接口必须不可用。

---

# 十八、任务 S0-08：Object Storage

本地使用：

```text
MinIO
```

建立统一：

```text
ObjectStorageService
```

接口至少：

```text
upload()
delete()
getSignedUrl()
exists()
```

其他业务模块以后只能调用：

```text
ObjectStorageService
```

不得直接调用MinIO SDK。

---

# 十九、Object Storage测试

Development环境建立最小测试接口或自动化测试：

上传一个测试文件。

验证：

```text
upload
↓
MinIO
↓
Signed URL
↓
读取成功
```

文件Bucket默认：

Private。

---

# 二十、任务 S0-09：配置系统

使用：

```text
@nestjs/config
```

应用启动时必须校验关键ENV。

至少：

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

缺少必要配置：

应用必须启动失败。

---

# 二十一、.env

提交：

```text
.env.example
```

不得提交：

```text
.env
.env.production
```

`.env.example`：

禁止包含真实API Key或Secret。

---

# 二十二、任务 S0-10：Credential Encryption

建立：

```text
CredentialEncryptionService
```

使用：

```text
AES-256-GCM
```

提供：

```text
encrypt()
decrypt()
```

并增加测试：

```text
plain
↓
encrypt
↓
decrypt
↓
plain
```

错误密钥：

解密必须失败。

---

# 二十三、任务 S0-11：Logging

使用结构化Logger。

推荐：

```text
Pino
```

如果仓库已有等效成熟Logger：

可继续使用。

日志至少支持：

```text
requestId
userId
storeId
platform
jobId
```

按上下文增加。

---

# 二十四、日志安全

必须Redact：

- Password
- JWT
- Authorization Header
- API Key
- Secret
- Credential Payload

禁止输出完整敏感买家信息。

---

# 二十五、Request ID

每个请求必须拥有：

```text
requestId
```

规则：

优先读取：

```text
X-Request-ID
```

不存在：

后端生成UUID。

Response返回：

```text
X-Request-ID
```

Error Response也包含：

```text
requestId
```

---

# 二十六、Async Context

推荐：

```text
AsyncLocalStorage
```

保存Request Context。

避免：

requestId需要层层手工传递。

---

# 二十七、任务 S0-12：Health Check

建立：

```text
GET /health/live
GET /health/ready
```

Liveness：

只判断API自身。

Readiness：

至少检查：

```text
PostgreSQL
Redis
```

第三方平台API失败：

不得导致WCIES自身Liveness失败。

---

# 二十八、任务 S0-13：Swagger / OpenAPI

Swagger：

```text
/api/docs
```

OpenAPI JSON：

```text
/api/docs-json
```

必须能够正常生成。

所有后续业务接口：

都必须以Swagger可描述为前提。

---

# 二十九、任务 S0-14：API Client

建立：

```text
packages/api-client
```

从OpenAPI自动生成：

TypeScript API Client。

可使用成熟生成工具，

但如需要新增依赖：

先说明。

前端：

使用生成Client调用Health接口。

禁止到处手写fetch。

---

# 三十、任务 S0-15：platform-contracts

建立：

```text
packages/platform-contracts
```

Sprint 0 只建立最小：

```typescript
export interface PlatformAdapter {
  readonly platformCode: string;

  validateCredential(
    context: PlatformCredentialContext,
  ): Promise<void>;
}
```

以及必要基础类型。

不要提前实现真实：

OZON
WB
Yandex

Adapter。

---

# 三十一、任务 S0-16：Auth基础

建立最小：

```text
AuthModule
User
```

支持：

```text
username/email
password
```

密码：

必须使用安全Password Hash，

推荐：

```text
Argon2
```

不得明文或可逆保存密码。

认证：

优先：

```text
HttpOnly Cookie
```

或合理的HttpOnly Token方案。

不得把长期认证Secret直接存LocalStorage。

---

# 三十二、管理员Seed

Development环境提供：

管理员Seed。

真实密码：

不要写进Git。

可以从ENV读取。

---

# 三十三、任务 S0-17：ESLint / Prettier

统一配置：

```text
ESLint
Prettier
```

至少启用：

```text
no-floating-promises
no-misused-promises
no-unused-vars
consistent-type-imports
```

核心业务：

禁止随意使用：

```text
any
```

---

# 三十四、Architecture Check

建立：

```text
scripts/check-architecture.ts
```

Sprint 0至少检查：

### Rule 1

Controller不得直接import Repository。

### Rule 2

Web不得import Backend Entity。

### Rule 3

Integration不得import Inventory Repository。

### Rule 4

业务模块不得直接import其他模块内部Repository。

检查失败：

命令返回非0。

---

# 三十五、Husky

配置：

```text
Husky
lint-staged
```

pre-commit至少：

```text
lint-staged
check:arch
```

避免每次Commit跑完整E2E。

---

# 三十六、任务 S0-18：Tests

测试体系至少可以运行：

```text
unit
integration
```

Sprint 0必须存在：

- Config测试
- Encryption测试
- Health测试
- Database connection测试
- BullMQ测试
- ObjectStorage测试

不要为了测试通过把真实错误catch掉。

---

# 三十七、任务 S0-19：Docker Compose

Development Docker Compose至少：

```text
postgres
redis
minio
```

可以增加：

```text
minio-init
```

自动建立Bucket。

Web/API开发时：

优先本机pnpm运行，

便于热更新。

---

# 三十八、任务 S0-20：CI

建立CI流程：

```text
install
↓
lint
↓
typecheck
↓
check:arch
↓
unit test
↓
build
```

不得要求生产Credential才能跑CI。

---

# 三十九、README

必须包含：

## Environment

```text
Node
pnpm
Docker
```

## First Start

类似：

```bash
cp .env.example .env

pnpm install

docker compose up -d

pnpm db:migrate

pnpm dev
```

## Services

注明：

- Web
- API
- Swagger
- MinIO Console

---

# 四十、文档初始化

检查并建立：

```text
docs/architecture/overview.md
docs/architecture/dependency-rules.md

docs/business-rules/inventory.md
docs/business-rules/orders.md

docs/integrations/ozon.md
```

已有内容：

不要覆盖。

只补充Sprint 0真正需要的工程说明。

---

# 四十一、AGENTS.md

使用当前根目录：

```text
AGENTS.md
```

作为硬性规范。

不得擅自：

删减

或：

重新解释

其中库存、平台、生产环境等规则。

如果发现：

AGENTS.md

与当前代码结构存在冲突：

报告冲突。

不要静默绕开。

---

# 四十二、安全限制

本Sprint：

不得执行任何：

真实平台API写操作。

不得连接：

真实OZON/WB/Yandex店铺。

不得：

Push Inventory。

不得：

修改生产数据。

---

# 四十三、生产环境限制

除非任务明确要求：

本任务只能处理：

Development环境。

禁止：

- Production Deployment
- Production Migration
- Production Reset
- Production Credential

如果发现仓库当前连接生产DB：

立即停止危险操作并报告。

---

# 四十四、禁止事项

本任务明确禁止：

1. 开始Product业务开发；
2. 开始Inventory业务开发；
3. 开始Order业务开发；
4. 接真实OZON API；
5. 接真实WB API；
6. 接真实Yandex API；
7. 创建几十个未来空模块；
8. 引入微服务；
9. 引入Kafka；
10. 引入GraphQL；
11. 使用`synchronize=true`；
12. 将Secret提交Git；
13. 删除已有业务文档；
14. 大规模重构无关代码；
15. 为了让测试通过而降低TypeScript strict规则。

---

# 四十五、执行原则

请按：

```text
小步提交
+
垂直验证
```

完成。

不要一次生成整个工程后再统一调试。

建议顺序：

```text
Repository
↓
TypeScript
↓
Web
↓
API
↓
PostgreSQL
↓
Error Handling
↓
Logging
↓
Redis
↓
BullMQ
↓
Storage
↓
Auth
↓
OpenAPI Client
↓
Engineering Rules
↓
Tests
↓
CI
↓
Documentation
```

---

# 四十六、每个阶段完成后

先运行相关：

```text
lint
typecheck
test
```

再继续下一阶段。

如果出现基础架构错误：

优先修复。

不要用临时Hack绕开后继续开发。

---

# 四十七、最终验收

Sprint 0完成后必须能够执行：

```bash
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

然后验证：

## Web → API

```text
WCIES Web
↓
GET Health
↓
NestJS
↓
成功
```

## API → PostgreSQL

Readiness：

PostgreSQL正常。

## API → Redis

Readiness：

Redis正常。

## API → BullMQ → Worker

Test Job：

成功消费。

## API → MinIO

测试文件：

上传

+

Signed URL读取成功。

---

# 四十八、最终质量检查

完成任务前请执行：

```text
pnpm lint
pnpm typecheck
pnpm check:arch
pnpm test
pnpm build
```

如果任何命令失败：

不要声明任务完成。

---

# 四十九、最终报告格式

任务完成后，不要只回复：

```text
Done
```

请输出：

## 1. 完成内容

列出实际完成项。

## 2. 创建/修改文件

列出主要文件和目录。

## 3. 架构决策

仅列出任务过程中确实产生的新决策。

不得重复已有架构。

## 4. 验证结果

报告：

```text
lint
typecheck
architecture check
tests
build
```

结果。

## 5. 未完成项

如果有：

明确说明。

## 6. 风险/问题

发现任何：

- 架构冲突
- 环境风险
- 依赖问题
- 文档冲突

必须说明。

## 7. 下一步

Sprint 0通过后：

下一步应为：

```text
Sprint 1
商品主数据
+
SKU
+
平台/店铺
+
仓库/库位
+
Listing Mapping
```

不要自行开始 Sprint 1。

---

# 五十、完成定义

只有以下条件全部满足：

```text
Web工作
API工作
PostgreSQL工作
Migration工作
Redis工作
BullMQ工作
Worker工作
Object Storage工作
OpenAPI工作
API Client工作
基础Auth工作
Logging工作
RequestId工作
Architecture Check工作
Tests工作
CI工作
AGENTS.md被遵守
```

才可以将：

**WCIES Sprint 0**

标记为完成。