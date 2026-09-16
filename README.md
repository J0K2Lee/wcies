# WCIES

跨境电商综合管理系统（Cross-border E-commerce Integrated Management System）。

当前阶段：**Sprint 10 已交付 —— 财务 / 调拨 / 补货建议**（见
`docs/WCIES_下一阶段规划_Sprint_10_财务调拨与补齐.md`）。业务域已覆盖：
商品 / SKU / 平台映射、库存（余额/流水/占用/安全库存）、采购与收货、订单、
拣货、发货、拦截、退货退款、异常、同步（OZON 轮询 + Webhook）、通知、
**财务（流水/回款/结算/应付）**、**调拨**、**补货建议**。

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

### 备选：全 Docker 开发（前后端都进容器，保留热重载）

`pnpm docker:up` 只启动基础设施（postgres / redis / minio）。如果希望 API 与 Web 也全部跑在容器里：

```bash
pnpm docker:dev    # 等价于 docker compose --profile dev up -d
```

将启动 5 个服务：postgres / redis / minio / **api-dev(:3000)** / **web-dev(:5173)**。

- **热重载**：编辑 `apps/web/src` 或 `apps/api/src` 下的代码，容器内自动重编译。Windows 挂载目录收不到文件事件，容器内已内置轮询监听，无需额外配置。
- **packages/\* 下的共享包变更**（shared / platform-contracts / api-client）：容器不监听这些目录，改动后重启容器生效：`docker compose restart api-dev web-dev`。
- **迁移与种子数据**在容器内执行（自动指向 compose 网络内的服务）：

  ```bash
  docker compose exec api-dev pnpm db:migrate
  docker compose exec api-dev pnpm seed:dev
  ```

- 首次启动需要数分钟：dev 镜像的构建**不联网**，依赖在容器首次运行时安装进专属数据卷（一次性，之后随卷保留），日常启动只需数秒。依赖目录全部由数据卷承载，容器永远不会改写宿主机的 `node_modules`。
- **改了依赖**（package.json / pnpm-lock.yaml）或 Dockerfile 后：`pnpm docker:dev:rebuild`（重建镜像、重灌依赖卷并重启）。
- **镜像源说明**：Docker 构建与容器内安装固定走 `registry.npmmirror.com`（本机代理 DNS 会把 registry.npmjs.org 解析成仅宿主机可路由的假地址，容器内不可达）。宿主机侧的 pnpm 安装不受影响。
- Worker（BullMQ）暂不进容器：两个 watch 进程会争用同一编译产物。需要时在宿主机运行 `pnpm dev:worker`。
- `api-dev` 与宿主机 `pnpm dev` 的 API 都占用 3000 端口，**不要同时运行**。集成测试固定使用 3101–3112 端口，与容器互不冲突。
- **混合模式**（Web 在容器、API 在宿主机，例如需要真实平台联调时）：`.env` 加 `VITE_PROXY_TARGET=http://host.docker.internal:3000`，然后 `docker compose --profile dev up -d web-dev`。
- 回到宿主机开发模式：`pnpm docker:down` 后照常 `pnpm dev`。

### 故障排查

- **镜像构建报 `ECONNREFUSED` / `ENETUNREACH`**：宿主机代理 DNS 偶发把 registry 域名解析成不可路由的假地址（构建期无法像运行时那样固定公共 DNS，取决于代理行为，重试通常即可）。重跑 `pnpm docker:dev:rebuild`；彻底解决需在代理软件中将 Docker 网段纳入 TUN/直连规则。
- **容器内 API 访问外部平台**（OZON 等真实 API 联调）：容器流量不经过宿主机代理，直连可能不通。需要真实平台联调时改用混合模式（API 留宿主机）。
- dev 目标的镜像构建**不需要网络**（依赖安装在容器首次启动时进行）；若首次启动停留在安装阶段属正常，`docker compose logs -f api-dev` 可看进度。
- 容器内 API 的 nest watch 编译产物在 `apps/api/dist-docker`（与宿主机的 `dist` 和集成测试互不踩踏）；`pnpm test:integration` 会先自行构建宿主机 `dist`。

## 局域网访问（手机 / 其他电脑）

Web 与 API 的端口发布在宿主机所有网卡上，局域网设备可直接访问：

| 服务 | 地址 |
|---|---|
| Web | `http://<宿主机内网IP>:5173`（例：http://192.168.1.12:5173） |
| API / Swagger | `http://<宿主机内网IP>:3000/api/docs` |

注意事项：

1. **防火墙**：首次从其他设备连接时，Windows 防火墙弹窗请选择「允许」（对应 Docker Desktop 后端进程，专用网络）。
2. **图片与面单**：登录和页面操作开箱即用（前端 API 调用走同源代理）。要让其他设备也能显示 **SKU 图片和面单**，需把根 `.env` 的 `S3_ENDPOINT` 改为 `http://<宿主机内网IP>:9000` 并重启 API（容器模式 `docker compose restart api-dev`；宿主机模式重启 `pnpm dev`）——图片签名 URL 基于该地址生成。
3. **安全**：开发环境使用弱口令，仅供局域网内部使用，勿暴露公网。

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

财务模块（Sprint 10）：`finance_transactions`（追加型流水，冲正成对）、
`finance_payouts`（平台回款，确认即生成收入流水）、`order_settlements`
（订单收入/成本/毛利快照，成本冻结于生成时点）；采购应付为派生值不落库。
调拨模块：`transfer_orders/lines`，确认时单事务双段移库（TRANSFER_OUT/IN）。
业务规则见 `docs/business-rules/finance.md` 与 `transfer.md`。

## 开发纪律

见 [AGENTS.md](./AGENTS.md)（硬性规则）。关键约束：

- Schema 只能通过 Migration 变更（`synchronize = false` 全环境生效）
- 所有库存变化必须经过 Inventory 模块并写流水（自 Sprint 起严格执行）
- Controller 不 import Repository；模块间只通过公开 Service 交互
- 业务状态禁止 magic string，统一枚举 / 常量
- 密钥不入库不入 Git；`.env` 不提交
