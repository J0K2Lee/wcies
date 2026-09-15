# OZON Webhook 内网穿透方案

> 状态：**开发环境已落地并端到端验证通过**。公网回调地址可用于配置 OZON 后台。
>
> 关联：`docs/integrations/ozon.md` §6（Webhook 能力）。
>
> 适用范围：**开发环境联调**。生产环境禁止使用穿透（AGENTS.md §90/§91）。

---

## 0. 落地状态速览

| 项 | 状态 | 证据 |
|---|---|---|
| Cloudflare 隧道 `wcies-dev` | ✅ | `9274ae8c-1c6e-461a-897a-7168bf40107f`（config_src=local） |
| DNS CNAME `ozon-hook.wulaoula.cn` | ✅ | record id `6684b3aac7fb93f246f5ed3a57d3f536`，proxied；解析到 104.21.32.228 / 172.67.156.82 |
| cloudflared 容器 | ✅ | 4 条连接注册成功（lax01/05/09），QUIC；自检 7 项全 PASS |
| ingress 路径白名单 | ✅ | `docker/cloudflared/config.yml`（⚠ `path` 是正则，见 §5.1） |
| 源站连通：容器 → 宿主:3000 → API | ✅ | `/health` 返回 200 |
| **公网 E2E：白名单放行** | ✅ | `POST https://ozon-hook.wulaoula.cn/api/v1/webhooks/ozon/stores/ON-001` → HTTP 200，落 `external_raw_events` → 入队 → worker 处理完成（SKIPPED） |
| **平台侧地址校验** | ⚠️→✅ | 后台「添加地址」实测报 `WRONG_RESULT_TIME_FIELD`，暴露应答体格式错误；已修正为 `{version,name,time}` 并通过本地/公网复验（见 §6.0） |
| **公网 E2E：其余路径拦截** | ✅ | `/health`、`/api/v1/health` 均 404 且**响应体为空**（cloudflared 兜底，未到达 API） |
| `PUBLIC_BASE_URL` 配置 | ✅ | https-only；Joi 三断言实测（http 拒 / https 过 / 缺省可选） |
| **手机访问 Web:`wcies.wulaoula.cn`** | ✅ | record `b3a93a77…`;Vite `allowedHosts` 显式放行;首页/代理/登录端点实测通过(见 §5.6) |

**正式回调地址**：

```text
POST https://ozon-hook.wulaoula.cn/api/v1/webhooks/ozon/stores/{storeCode}
```

### 验证记录（2026-09-14）

用真实店铺码 `ON-001` 从公网发起两次合成请求（非 OZON 真实投递），
两次都走完了 **HTTPS → Cloudflare → 隧道 → API → 落库 → 队列 → worker** 全链路：

| 请求体 | eventType | 落库结果 |
|---|---|---|
| `{"message_type":"BOGUS_TYPE"}` | `UNKNOWN` | `external_raw_events.status = SKIPPED` |
| `{"message_type":"TYPE_PING","time":"..."}` | `PING` | `external_raw_events.status = SKIPPED` |

副产物：dev 库 `external_raw_events` 留下这 2 行（真实投递痕迹，未删除）。

排查中确认的一个实测事实：**`mapWebhookPayload` 对未知 `message_type` 不抛错**，
而是归类为 `UNKNOWN` 并正常落库、回 200（只有「非对象」或「缺 `message_type`」才抛
`PLATFORM_BAD_RESPONSE` → 4xx）。这与控制器注释一致，也是 TYPE_PING 能安静落库的原因。

> 踩坑记录：Cloudflare token 权限修改后**不是立即生效**。改成「区域.DNS + 所有区域」后
> 前 ~2 分钟 DNS 端点仍返回 403 `Authentication error`，~4 分钟后同一请求成功。
> 判断"权限没给"之前先多等几分钟，别急着改配置。

---

## 1. 现状：接收端已就绪，缺的是公网入口

已实现（无需重做）：

| 项 | 位置 |
|---|---|
| HTTP 入口 | `apps/api/src/modules/sync/controllers/ozon-webhook.controller.ts`（`@Public()`） |
| 完整路径 | `POST /api/v1/webhooks/ozon/stores/:storeCode`（全局前缀 `api/v1`，`main.ts:32`） |
| 落库 + 入队 | `WebhookIngestService.ingestOzon()`（形状校验 → `external_raw_events` 去重落库 → BullMQ → 立即 200） |
| 身份校验 | URL 段 `storeCode` + `payload.seller_id === credential.clientId`（无签名机制） |
| 本地重放 | `apps/api/scripts/replay-webhook-event.ts`（无需公网 IP） |

**唯一缺口**：`{PUBLIC_BASE}` —— OZON 只能往公网 URL 推送，本机/内网 IP 不可用。
（本方案已在配置层补上 `PUBLIC_BASE_URL`。）

**正式回调地址**：

```text
POST https://ozon-hook.wulaoula.cn/api/v1/webhooks/ozon/stores/{storeCode}
```

---

## 2. 约束推导（从代码与已验证事实推出，不是通用清单）

| # | 约束 | 为什么（依据） |
|---|---|---|
| C1 | **域名必须长期稳定** | OZON 后台 / `/v1/notification/set` 存的是完整 URL。域名一变就要重新配置店铺，多店铺成本 ×N。免费随机域名（每次重启就变）不可接受。 |
| C2 | **必须 HTTPS，且证书需公网可信** | 公网回调场景；自签证书不可用。**是否强制 HTTPS 未实测**（见 §6 待验证）。 |
| C3 | **只放行 webhook 路径** | 端点无签名且 `@Public()`。若把 3000 端口整口暴露，等于把 dev API 全量（含其它 `/api/v1/*`）放上公网。 |
| C4 | **需要常驻可用** | `TYPE_PING` 是平台周期性连通性探测（无需订阅、不可关闭），掉线可能被平台判定异常。 |
| C5 | **请求体必须原样透传** | 落库即 `payload`，幂等键是 `sha256(canonical payload)`；代理层不能改写/截断 body。 |
| C6 | **应答体必须符合平台模板** | 平台现场校验应答体形状，`{result:true}` 被判 `WRONG_RESULT_TIME_FIELD`（2026-09-14 实测，见 §6.0）。正确模板是 `{version,name,time}`。 |
| C7 | **严格环境隔离** | 隧道端点只指向 dev API，绝不指向生产（AGENTS.md §90）。 |
| C8 | **不引入新 npm 依赖** | 穿透走容器镜像，不改 `package.json`（AGENTS.md §73）。 |

> C1 + C3 是两条硬约束，直接筛掉"随机域名"和"整端口映射"两类常见做法。

---

## 3. 选型

选定 **Cloudflare Tunnel + 自有域名**（`wulaoula.cn` 已托管在 Cloudflare）。

| 方案 | 固定域名 | HTTPS | 路径级收敛 | 请求检查 | 成本 |
|---|---|---|---|---|---|
| **Cloudflare Tunnel（本方案）** | ✅ 免费 | ✅ 边缘签发 | ✅ ingress + 兜底 404 | ❌ | 0 |
| ngrok | 付费固定域；免费随机 | ✅ | 新版 Traffic Policy | ✅ **Inspector** | 免费/付费 |
| frp + 自建 VPS | ✅ | 需 Caddy/Nginx | ✅ Nginx 白名单 | ❌ | VPS 月费 |
| natapp / cpolar | ✅ 付费固定 | ✅ | 基本无 | 部分有 | ~¥10–30/月 |

- 随机域名的 ngrok 免费版不满足 C1，**仅可作为一次性抓包取证工具**（见 §6 步骤 5）。
- 明确不推荐：路由器端口映射 + DDNS（违反 C3，且家庭宽带 80/443 多被封）；
  把穿透当生产方案（开发机非 7×24，`TYPE_PING` 掉线有风险）。
  长期应在常驻主机上用 Caddy/Nginx（自动 TLS + 路径白名单）反代到正式 API。

---

## 4. 架构

```text
OZON（RU）
  │  HTTPS POST /api/v1/webhooks/ozon/stores/{storeCode}
  ▼
[ozon-hook.wulaoula.cn]              ← 仅该 path 前缀放行，其余 404
  │  TLS 终止 + 路径白名单
  ▼
cloudflared 容器（出站长连接，本机零入站端口）
  │  http://host.docker.internal:3000
  ▼
OzonWebhookController（@Public，无签名）
  │  校验形状 → external_raw_events(PENDING) → enqueue
  ▼
BullMQ wcies.webhook → WebhookProcessService
  │  回读 /v3/posting/fbs/get（已认证 API）后才入库
  ▼
Order / Inventory 标准链
```

**一个域名覆盖所有店铺**：`storeCode` 在路径里，N 个店铺 = N 条 URL、同一主机名。

`service` 指向 `host.docker.internal:3000` 而非 `api-dev:3000`：dev 容器已把 3000
发布到宿主，因此**API 跑在宿主（`pnpm dev:api`）或跑在 dev 容器都能命中**，
两种开发方式都不用改配置。

---

## 5. 已落地的配置

### 5.1 `docker/cloudflared/config.yml`

```yaml
tunnel: 9274ae8c-1c6e-461a-897a-7168bf40107f
credentials-file: /etc/cloudflared/credentials.json

ingress:
  - hostname: ozon-hook.wulaoula.cn
    path: ^/api/v1/webhooks/ozon/.*$
    service: http://host.docker.internal:3000

  # 手机/外部浏览器访问 Web 前端（整站靠登录保护，无路径白名单）
  - hostname: wcies.wulaoula.cn
    service: http://host.docker.internal:5173

  - service: http_status:404
```

> ⚠ **`path` 是正则，不是 glob/前缀**（cloudflared 用 Go regexp 解析，官方文档
> "You can also enter regular expressions for the `path` key"）。写成
> `/api/v1/webhooks/ozon/*` 作为正则等价于 "ozon 后跟零个或多个 `/`"，
> **匹配不到** `/stores/{storeCode}`。这里用 `^/api/v1/webhooks/ozon/.*$`，
> 在「子串搜索」与「整体匹配」两种语义下都成立，不依赖对该匹配方式的猜测
> （§6 步骤 1 会实测确认）。
>
> 匹配顺序从上到下、首条命中即用；未命中任何规则即落到兜底 `http_status:404`
> （catch-all 是**强制**的最后一条），满足 C3。

### 5.2 凭据（不入库）

`docker/cloudflared/credentials.json` 由隧道 token 解码而来
（`{"AccountTag","TunnelID","TunnelSecret"}`），已在 `.gitignore` 排除。

> 创建隧道用的 API token 本身也是敏感信息，存于 `.env`（`CLOUDFLARE_*`，已 gitignore），
> 禁止写入代码、文档或日志（AGENTS.md §29/§67）。

### 5.2b Cloudflare 侧资源（便于重建，不含任何密钥）

| 资源 | 值 |
|---|---|
| API Token | 名称 `WCIESS`；权限：`账户 → Cloudflare Tunnel → 编辑` + `区域 → DNS → 编辑`；资源：1 个账户、所有区域 |
| Tunnel | `wcies-dev` / `9274ae8c-1c6e-461a-897a-7168bf40107f`（config_src=local） |
| DNS | CNAME `ozon-hook.wulaoula.cn` → `<tunnel-id>.cfargotunnel.com`，proxied；record id `6684b3aac7fb93f246f5ed3a57d3f536` |
| Zone | `wulaoula.cn` / `002a2b12c472f0458481f78a81cc937a` |

重建步骤（token 已含上述权限时）：

1. 建隧道：`POST /accounts/{acc}/cfd_tunnel` body `{"name":"wcies-dev","config_src":"local"}`
2. 取凭据：`GET /accounts/{acc}/cfd_tunnel/{id}/token` → base64 解码 → 写
   `docker/cloudflared/credentials.json`（`AccountTag`/`TunnelID`/`TunnelSecret`）
3. 建 CNAME：`POST /zones/{zone}/dns_records`，`content` = `{tunnelId}.cfargotunnel.com`，`proxied: true`
4. `pnpm tunnel:up`

> ⚠ 隧道 id 变了就要同步改 `docker/cloudflared/config.yml` 的 `tunnel:` 与 CNAME 的 target。

### 5.3 compose 服务（默认不启动）

`docker-compose.yml` 的 `tunnel` 服务挂在 `profiles: ['tunnel']`，需显式启用：

```bash
pnpm tunnel:up     # docker compose --profile tunnel up -d tunnel
pnpm tunnel:down   # stop（不删除容器）
```

同时带 `dns: ['223.5.5.5','119.29.29.29']` + `host.docker.internal:host-gateway`，
与 `web-dev`/`api-dev` 一致——宿主代理 DNS 会间歇返回不可路由假 IP，
而 cloudflared 必须解析 Cloudflare 边缘域名才能建连。

### 5.4 `PUBLIC_BASE_URL`

- `env.validation.ts`：`Joi.string().uri({ scheme: ['https'] }).optional()`
  （**只允许 https**；实测 http 被拒、https 通过、缺省可选）
- `configuration.ts`：暴露 `publicBaseUrl`（未设置时为 `null`，**不得回退 localhost**）
- `.env`：`PUBLIC_BASE_URL=https://ozon-hook.wulaoula.cn`

### 5.5 运行纪律

- 隧道**不常开**：日常开发用 `curl` 直投本地 + `replay-webhook-event.ts`；
  只有"接真实 OZON 投递"时才 `pnpm tunnel:up`，缩小暴露窗口。
- 关隧道前先在 OZON 侧 disable 或 `/v1/notification/delete`，避免平台持续重试 /
  把店铺通知标记为异常。
- **订阅 / 删除订阅属于真实平台写操作**（AGENTS.md §92），执行前必须用户明确确认。
- 保存凭据的隧道**禁止**指向生产环境。

### 5.6 第二主机名：手机访问 `wcies.wulaoula.cn`（2026-09-15 落地）

用途：手机/外部浏览器直接访问 Web 前端（扫码作业移动化的基础）。

| 项 | 值 |
|---|---|
| ingress | `wcies.wulaoula.cn` → `host.docker.internal:5173`，**无路径白名单**（整站放行） |
| DNS | CNAME record `b3a93a77a08dd72dea50ae07d1d8f6cc`，proxied |
| Vite 8 Host 头拦截 | `apps/web/vite.config.ts` 已加 `server.allowedHosts: ['wcies.wulaoula.cn']`（显式放行，不用 `true`） |
| 验证 | 首页 200(Vite 页面而非拦截页)、`/health` 经代理 200、登录端点 4xx JSON;ozon-hook 回归通过(webhook 200 / 白名单外 404 空体) |

⚠ **暴露面与 ozon-hook 完全不同**：整个 dev 系统(含全部 `/api/v1/*`)上公网，
唯一门槛是登录；且证书透明日志会让该主机名可被发现。要求：

> 2026-09-15 用户决策：**保留**该主机名——家庭调试便利优先于暴露面收敛。
> 保留当日核查发现 `JWT_SECRET` / `ADMIN_PASSWORD` / `CREDENTIAL_ENCRYPTION_KEY`
> 均仍为示例默认值，整改随后执行（加密密钥重灌需连带凭证重加密，单独处理）。

1. `ADMIN_PASSWORD` 不得是示例默认值；
2. webhook 订阅生效期间隧道必须常开(§5.5),此时该暴露面持续存在——密码强度是主要防线;
3. 需要更强隔离时,可在 Cloudflare Zero Trust 对该主机名加 Access 策略(浏览器侧可跳转授权,程序侧需 service token)。

已知限制:HTTPS 页面中 MinIO 预签名图链是 `http://<局域网>:9000`,手机浏览器按混合内容拦截
→ **手机上商品图不显示**(扫码作业流不受影响)。要在手机看图,需给 MinIO 也加隧道主机名
并把 `S3_ENDPOINT` 换成对应 https 地址(未做)。

附带收益:该主机名是 HTTPS 安全上下文,是将来摄像头扫码(`getUserMedia` 的硬前提)的现成载体。

---

## 6. 验证清单

### 6.0 平台侧地址校验（2026-09-14 实测，已解决）

在卖家后台「设置 → 集成 → Push 通知 → 添加地址」提交

```text
https://ozon-hook.wulaoula.cn/api/v1/webhooks/ozon/stores/ON-001
```

平台**现场发起了连通性检查**并返回：

```text
⚠️ 响应体中的"time"字段无效        WRONG_RESULT_TIME_FIELD
   网址不可用：请修正错误后重新添加
```

这直接给 `docs/integrations/ozon.md` §6.4 的文档冲突定了论：**新版校验存在，
`{"result": true}` 不被接受**，必须回规范模板 `{version, name, time}`。

已修正：`buildPushAck()`（`ozon.mapper.ts`）+ 控制器统一返回该模板，3 个单测覆盖
（模板字段集、无小数秒、UTC），集成测试 `sync.integration.spec.ts` 的断言同步更新。
本地与公网复验：

```json
{"version":"2.0","name":"WCIES","time":"2026-09-14T15:28:10Z"}
```

注意 `time` 的语义是**开始处理该通知的时刻**，不是返回响应体的时刻。

### 6.1 白名单收敛自测（✅ 已完成 2026-09-14）

- webhook 路径送达 API：`POST .../stores/ON-001` → 200（应答体见 §6.0）；
  不存在的 storeCode → API 的 JSON 错误信封 `STORE_NOT_FOUND`（**不是** cloudflared 的 404）。
- `/health`、`/api/v1/health` → 404 **空响应体**（cloudflared 兜底，未触及 API）。
- 判定依据：404 的响应体是否为空 + 是否含 API 的 `requestId` 信封。

### 6.2 剩余步骤

1. ✅ 在 OZON 后台「添加地址」——应答体修正后平台校验通过（2026-09-14）。
2. ✅ 订阅事件类型（2026-09-14，用户操作）：`TYPE_NEW_POSTING`、`TYPE_ORDER_NEW`、
   `TYPE_ORDER_CANCELLED`、`TYPE_ORDER_STATE_CHANGED`、`TYPE_POSTING_CANCELLED`、
   `TYPE_STATE_CHANGED`。订阅规则与首批真实投递见 `docs/integrations/ozon.md` §6.5/§6.6。
3. ⏳ 等真实 `TYPE_NEW_POSTING` / `TYPE_ORDER_*` 样本，回填 `ozon.md` §6.1d
   （尤其 `order_number` 与 posting_number 的关系）。
4. ⏳ 确认平台是否保留 URL query string（决定能否用 `?token=<secret>` 加一层低成本加固）。

> ⚠ 订阅已生效 ⇒ **隧道从现在起必须保持可用**。平台规则（ozon.md §6.5）：
> 单条通知处理超 5 秒、持续报错、或 200 占比不足一半，都会**自动暂停全部通知**；
> 恢复要去后台重新确认 URL。日常要关隧道，先去后台删地址。

### 待验证事实（禁止猜测，未验证不得进生产）

| 项 | 当前状态 |
|---|---|
| 应答体形状 | ✅ 已验证：`{version,name,time}`，平台现场校验（§6.0） |
| HTTPS | ✅ 用 https 通过校验；http 是否被拒未测（配置层已强制 https） |
| 是否保留 URL query string | 未验证（订阅后从真实投递的 path 里看） |
| 超时 / 重试次数与间隔 | 未验证 |
| `TYPE_PING` 周期 | 未验证 |
| OZON（RU）→ Cloudflare → 本机 的实际延迟与稳定性 | 未验证（本机出口观察到 lax 节点） |

---

## 7. 改动清单

- `docker/cloudflared/config.yml`（新增）
- `docker/cloudflared/credentials.json`（本地凭据，gitignore）
- `docker-compose.yml`：`tunnel` 服务（`profiles: ['tunnel']`）
- `apps/api/src/config/env.validation.ts` + `configuration.ts`：`PUBLIC_BASE_URL`
- `.env.example` / `.env`：`PUBLIC_BASE_URL`
- `package.json`：`tunnel:up` / `tunnel:down`
- `.gitignore`：cloudflared 凭据
- `docs/integrations/ozon.md` §6：指针

**未新增任何 npm 依赖**（cloudflared 走容器镜像），符合 AGENTS.md §73。
