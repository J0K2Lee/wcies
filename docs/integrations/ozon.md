# OZON 集成笔记（Sprint 5 Read-First）

> 状态：**Sprint 5 已实现**（Read-only：Credential Validation + Fetch Listings + Fetch Orders + Webhook）。
>
> 事实来源：
> 1. 官方 Seller API OpenAPI 规范 `docs/ozon-seller-openapi.json`（版本 2.1 / 俄文，用户提供，2026-09-09）；
> 2. 官方 Seller API OpenAPI 规范 `docs/ozon-seller-api-eng-version-3.json`（**OpenAPI 3.0.0 / 英文，用户提供，2026-09-14**；
>    比前者多出 2026-08-04 新增的 8 种通知类型文档，Push/Notification 章节以此为准）；
> 3. 官方文档站点 docs.ozon.ru（Push notifications 章节；站点有 antibot，内容经搜索缓存与开源客户端实现交叉验证）；
> 4. 真实 API 冒烟测试：**尚未执行**（需用户批准，见「Smoke Test」章节）。
>
> 未验证项一律明确标注，不得进入生产假设。

## 验证日期

| 项 | 验证方式 | 日期 |
|---|---|---|
| Endpoint / Request / Response 字段 | 官方 OpenAPI 规范 json 逐字段核对 | 2026-09-09 |
| Webhook 事件类型与消息结构 | 官方规范（/v1/notification/* 枚举）+ 开源客户端结构（diphantxm/ozon-api-client）交叉 | 2026-09-09 |
| Webhook 订阅类型完整清单（14 种）、各事件 payload、push 模型状态词表、`{version,name,time}` 应答格式 | 官方规范 v2.1 内嵌文档段逐项核对（`notification.v1.*` 枚举 + 描述文本）；**真实投递未验证**（从未配置真实 webhook） | 2026-09-13 |
| **Webhook 应答体格式（§6.4 冲突定论）** | **真实平台实测**：卖家后台「添加地址」现场校验，旧 `{result:true}` 被判 `WRONG_RESULT_TIME_FIELD`；修正为 `{version,name,time}` 后本地+公网复验通过 | **2026-09-14** |
| `TYPE_PING` 请求体形状 | 同上实测（`{message_type, time}`）；平台周期性发送，无需订阅 | 2026-09-14 |
| 卖家后台可选订阅类型清单（**22 种**，与 §6.1 规范枚举清单不符） | 卖家后台「添加地址」勾选框逐项抄录，见 §6.1b | 2026-09-14 |
| `TYPE_ORDER_*` / `TYPE_FBO_*` 等新增通知的载荷文档 | v3 英文规范逐字段核对（§6.1d）；这批类型 2026-08-04 加入，v2.1 规范未收录 | 2026-09-14 |
| 投递重试与自动停用规则（含 **5 秒处理上限**） | v3 英文规范 push_resending / push_monitoring 章节（§6.5） | 2026-09-14 |
| 首批真实投递（STATE_CHANGED / PING / WRONG_PUSH） | 订阅后 `external_raw_events` 实录（§6.6） | 2026-09-14 |
| 开发环境 webhook 公网入口 | Cloudflare Tunnel 落地 + 全链路 E2E（见 `ozon-webhook-tunnel.md`） | 2026-09-14 |
| Webhook 无签名机制 | 官方文档与所有已知开源实现均无验签 API | 2026-09-09 |
| 真实凭证实测 | 真实 Smoke Test（只读：凭证验证 + Listing + 订单拉取 + 手动同步 + 幂等复测），单店 | 2026-09-09 |
| `/v1/description-category/tree`（ZH_HANS + RU） | 真实 API 冒烟（只读），单店（Sprint 8.5 T0） | 2026-09-14 |
| `/v4/product/info/attributes` | 真实 API 冒烟（只读），单店（Sprint 8.5 T0） | 2026-09-14 |
| **仓库目录三端点**：`/v2/warehouse/list`（is_rfbs 区分 rFBS/FBS）、`/v1/fbp/warehouse/list`（FBP 合作仓）、`/v1/warehouse/ozon/list`（FBO 履约仓，`warehouse_types:["FULL_FILLMENT"]`，实测返回 172 个） | 真实 API 实测（只读）；`/v1/warehouse/list` 已被平台判 obsolete 必须用 v2；`/v1/warehouse/fbo/list` 是按 search 词搜索供给点的接口（search minLength 4，非枚举）不可用作目录；`/v1/warehouse/fbo/seller/list` 实测返回空 | **2026-09-17** |

## 1. Credential 结构

```json
// platform_credentials.payload（AES-256-GCM 加密存储）
{ "clientId": "<OZON Client ID>", "apiKey": "<OZON Api-Key>" }
```

- HTTP Header：`Client-Id` + `Api-Key`（官方规范 servers: `https://api-seller.ozon.ru`，全部 POST + JSON）。
- WCIES 的 `credential.clientId` 即 OZON 后台卖家 ID —— Webhook 身份校验依赖这一点（见 §6）。
- 测试店铺凭证存于 `docs/ozon test info.txt`（仅本地，不入库不入库不入日志）。

### 验证方式

`POST /v3/product/list {filter:{visibility:'ALL'}, limit:1}`（最小只读请求）：

- 200 → `VALID`
- 401/403 → `INVALID`。已观察到的真实错误文案：401 `{code:16, message:'not-found client or api-key'}`、403 `Invalid Api-Key, please check the key and try again`（后者是一次并行集成测试端口冲突导致的意外真实调用所返回——测试用的是假 key，认证即被拒，无任何业务数据被触碰；该事件促成了下述测试环境保护）。
- 其他 → `ERROR`

> 测试环境保护： 下 OzonClientFactory **拒绝**回退到默认真实 URL—— 未显式设置时指向不可路由占位地址，杜绝自动化测试意外触达真实平台。

## 2. Listing API 能力（已实现）

### POST /v3/product/list

Request：`{filter:{visibility:'ALL'}, last_id: string, limit: int(≤1000)}`。
Response：`{result:{last_id: string, items:[{product_id:int64, offer_id:string, archived:boolean,...}]}}`。

- 分页：`last_id` 游标（把上一页返回的 `last_id` 原样回传）；WCIES 每页 200。
- **没有 has_more 标志**：页满（items.length == limit）且 last_id 变化即视为还有下一页。

### POST /v3/product/info/list（批量补充明细）

Request：`{offer_id: string[]}`（也接受 `product_id[]` / `sku[]`）；Response：**`{items:[{id, name, offer_id, sku:int64, is_archived, is_autoarchived,...}]}` —— 顶层 `items`，无 `result` 包裹**（与 product/list、posting/fbs/list 不同；官方 schema `v3GetProductInfoListResponse` + 2026-09-09 真实冒烟双确认。首版实现误加了 `result` 包裹，冒烟测试中发现并已修正）。
用于补充 `name`（标题）与 `sku`（OZON SKU id）。每批 100（保守值；官方上限未在本规范中找到明确数字，**未验证**）。
实测：按 offer_id 精确匹配，1324 个 offer 全部返回；offer_id 含 CJK/特殊字符可正常匹配。

- **订单行按需补链接（2026-10-20）**：同一端点用于定向读取单个变体——优先用
  posting 的 `sku[]`（不可变），无 sku 时才用 `offer_id[]`，一次点击最多一次调用。
  响应仍是顶层 `items`（无 `result` 包裹）。注意 `id` 是 catalog `product_id`，
  与 posting 的 `sku` 是不同命名空间（本地 2775 条 listing 实测 0 冲突），因此
  补建时以 `id` 作为 listing 键、以 `sku` 作为变体键。

#### 未映射订单行图片（T5，验证日期 2026-09-17）

- 依据本地英文规范 `v3GetProductInfoListResponseItem`：`primary_image: string[]`、`images: string[]`。
- 复用现有 client 的同一端点，以订单 `platformSkuId` 作为 `sku[]`（数字）读取，店铺内去重、100/批；不使用 offer_id 猜 SKU 映射。
- 纯 mapper 取 `primary_image[0]`，缺失/空/非法 URL 则取 `images[0]`，仍不可用则 null。只接受无 userinfo 的 HTTP(S) URL，不下载、不抓网页、不探测 CDN。
- 无法安全转换的 int64 SKU 不舍入、不请求，保持无图；响应重复 SKU 或结构错误拒绝猜测匹配。
- 轮询与 webhook 共同在订单摄入提交后做 best-effort 富化，仅处理 `sku_id IS NULL AND platform_image_url IS NULL` 的行。失败/缺图 warn，不影响同步结果；重复摄入可重试缺图。
- 通过 OrderService 公开接口保存平台直链；写入同时校验店铺、仍未映射、仍无图，避免覆盖并发映射或回填。映射后仅展示内部 SKU 主图。
- 订单列表展开/右侧预览复用详情接口的 `imageUrl` / `imageSource`；列表汇总接口没有商品行，不新增重复图片事实。
- 开发历史回填：`scripts/backfill-order-platform-images.ts`，先 build API；默认 dry-run 仍通过真实 adapter 只读取图，输出 candidates/wouldUpdate/updated/failed。必须显式 development/test、localhost/127.0.0.1 的 `wcies_dev`；dry-run 数据库连接额外只读且不启动 worker。`--apply --backup-confirmed` 只在先备份并审查 dry-run 后手工执行，不调用平台写 API。

### 字段映射（Mapper）

**属性增强链式自动触发（2026-10-05，两步合一）**：LISTING_SYNC 成功/PARTIAL 结束后，自动以
`trigger_type = SYSTEM` 派发一次 `PRODUCT_ENRICHMENT_SYNC`（/v4/product/info/attributes 批量拉取
尺寸/重量 → 变体 `raw_data.product_attributes` → 建档预填）。OZON listing 同步一次做完两步，
**无需再手动点「补齐商品属性」**（OZON类目工具里的手动按钮保留为修复路径）。链式仅对
`ENRICHMENT_SUPPORTED_PLATFORMS`（= OZON）派发；派发失败只 warn，不回改已完成的 listing job。
注意 v3 product/info 的 `volume_weight` 是标量（升/千克量级，非结构化尺寸），不可用作预填来源，
v4 仍是尺寸重量唯一来源。

| OZON | WCIES |
|---|---|
| `product_id` | `platform_listings.platform_product_id`（String） |
| `info.name` | `platform_listings.title` |
| `info.sku` | `platform_listing_skus.platform_sku_id`（String） |
| `offer_id` | `platform_listing_skus.offer_id` |
| `is_archived / is_autoarchived / archived` | `platform_listing_skus.status` + listing `platform_status`（ARCHIVED/LISTED 事实字符串） |
| 完整原始 item | `raw_data`（两份：product_list_item + product_info） |

## 3. 订单 API 能力（已实现）

### POST /v4/posting/fbs/list（2026-10-20 迁移）

> **v3 已不可用（实测 2026-10-20）**：`POST /v3/posting/fbs/list` 对本账号持续返回
> `429 {"code":8,"message":"You have reached request rate limit per second"}`，
> `ratelimit-remaining: 0`、`retry-after: 0`；两个店铺（不同 Client-Id）一致，
> 间隔 4 秒的单次调用、20 秒内连打 33 次**全部失败**。同一凭据的
> `POST /v3/posting/fbs/get` 与 `/v3/product/list` 均 200（`remaining: 49`）。
> 换任何请求体/时间窗都一样 → 不是限流频率问题，而是该方法已下线；**v4 正常**。

Request：

```json
{
  "filter": { "since": "ISO-UTC", "to": "ISO-UTC" },
  "limit": 200,
  "cursor": "（可选，上一页返回的不透明游标）"
}
```

Response（顶层，无 `result` 包裹）：

```json
{ "has_next": true, "cursor": "opaque", "postings": [ ... ] }
```

- **必须**携带 `filter.since/to`（UTC）；`dir` / `offset` / `with` 传了会被忽略，
  默认按 `in_process_at` 升序。
- **`limit` 上限 100**（实测 2026-10-20：v4 对 200 返回
  `Request validation error: invalid PostingFbsListRequest.Limit: value must be
  inside range (0, 100]`；v3 时代允许更大值）。适配器 `ORDER_PAGE_SIZE = 100`。
- 分页：把上一页的 `cursor` 原样传回；`has_next=false` 时 `cursor` 为空串。
  **`has_next=true` 但 cursor 为空 = 畸形响应**，适配器直接报错（防原地重读死循环）。
- posting 字段与 v3 一致（`products`、`analytics_data`、`delivering_date` 均保留）。
- `in_process_at` = 订单开始处理时间（订单创建时刻），是窗口过滤字段。
- 旧游标（`OZON_ORDER_WINDOW.offset`）仍被接受：`offset` 被忽略、窗口从头重扫，
  摄取幂等不会重复建单。

### POST /v3/posting/fbs/get（Webhook 目标回读）

Request：`{posting_number: string, with:{}}`；Response：`{result: <posting>}`。

### Posting 关键字段映射（Mapper → NormalizedOrderInput）

| OZON | WCIES |
|---|---|
| `posting_number` | `orders.platform_order_id`（**业务唯一键 store+posting_number**；OZON 一张 order_id 可能拆多个 posting，posting 才是履约单位） |
| `status` | `orders.platform_status`（原样保存事实：awaiting_packaging / awaiting_deliver / delivering / delivered / cancelled …） |
| `in_process_at` | `orders.ordered_at` |
| `products[].sku` | `order_items.platform_sku_id` + `platform_product_id`（String(OZON sku)）——**订单解析的标识**（决策 0016：只认 `platform_sku_id` / `seller_sku`） |
| `products[].offer_id` | `order_items.offer_id`（**平台事实**：入库、展示、导出、关键字搜索；**不参与解析**——offer_id 可被运营在平台侧随时修改，见决策 0016） |
| `products[].quantity` | `order_items.quantity`（整数 → String） |
| `products[].currency_code` | `orders.currency`（取第一行） |
| （整体） | `orders.raw_data`（完整 posting 原文）+ 每行 `order_items.raw_data` |

### 物流渠道映射（T4，2026-09-17 冻结）

`integration_type_flow` 是 `fulfillmentMode`（`orders.fulfillment_mode`）的**唯一事实来源**，
在 OZON Mapper 归一化；订单核心只保存事实，不解释平台履约语义，不修改 ERP 状态或库存。

| `integration_type_flow` 原值 | `fulfillmentMode` |
|---|---|
| `FBP` | `FBP` |
| `ozon` | `FBS` |
| `aggregator` / `non_integrated` / `3pl_tracking` | `RFBS` |
| `hybrid` / `hybrid_aggregator` / 其他未知字符串 | 原样存储，不做本地解释、不转换大小写 |
| 缺失 / null / 空字符串 | null，不猜测 |

- **验证日期 2026-09-17，依据：本地 v3 英文规范 + 生产 183 单 raw_data 实测（aggregator/FBP）**；
  实测 `aggregator` ×146、`FBP` ×31，其余不据此推断。
- `/v3/posting/fbs/list|get` 响应规范及实测均没有 `scheme` 字段；
  `tpl_integration_type` 虽可出现，也不作为回退来源。
- 新摄入订单缺失渠道时保存 null；已摄入订单刷新时输入 undefined/null **保留库内原值**，
  只有非 null 且不同的渠道事实才写入。
- FBO 订单走独立 `/v2/posting/fbo/list`，当前未接入；不能因当前端点名称或其他字段猜测 FBO。
  FBO/FBP 专用端点仍属未来 Sprint，但当前 FBS 端点实际返回的 `FBP` 流事实必须保存。
- 历史回填脚本 `scripts/backfill-order-fulfillment-mode.ts` 与在线 mapper 复用同一映射函数。
  仅扫描 OZON 店铺中含 `integration_type_flow` 且渠道为 null/旧 `FBS` 的订单；
  缺失/空值及相同结果跳过，保留已有事实。默认 dry-run，`--apply` 事务写入；
  必须显式 development/test 且数据库名为 `wcies_dev`，拒绝生产，执行写入前先备份。
  输出总候选数、更新数、预计更新数及跳过数。
- 订单取消/状态回写：**本 Sprint 不做**（Read-first，§4 禁止写操作）。

### 平台阶段映射（双轴任务 T1，2026-09-15 冻结）

`status` → 归一化 `platformStage`（`orders.platform_stage`，平台事实，绝不写
`erp_status`，AGENTS.md §38）。词表与 v3 英文规范 `v3FbsPostingDetail.status`
描述段**逐词核对**（2026-09-15）：

| Seller API `status` | `platformStage` | `platformStageChangedAt` 锚点 |
|---|---|---|
| `awaiting_approve` / `awaiting_packaging` / `awaiting_registration` / `awaiting_deliver` | `AWAITING_SHIPMENT` | null |
| `delivering` / `driver_pickup` / `acceptance_in_progress` | `IN_TRANSIT` | `delivering_date` |
| `delivered` | `DELIVERED` | `fact_delivery_date` |
| `cancelled` / `cancelled_from_split_pending` | `CANCELLED` | null |

`cancelled` 与 `cancelled_from_split_pending`（拆单取消）归一为同一取消事实，
`platformCancelled = true`（2026-10-15 归类，与发货链路
`ozon-shipment.service` 早已采用的口径对齐）。真实样本 `73885080-0016-1`：
`substatus=posting_canceled`、`cancellation_type=client`、无运单号。此前
`cancelled_from_split_pending` 未归类（→ null），导致已取消的发货单被
`POSTING_CANCELLED` webhook 回读后当活跃单摄入、常驻缺货；用户 2026-10-15
bug 报告。共享谓词 `isOzonPostingCancelled` 保证 mapper 与发货链路同口径。

**未归类（→ null，仅记录，不猜）**：`arbitration`、`client_arbitration`、
`not_accepted`（任务书 §8 待确认项 3）；`awaiting_verification`（"created"）
——2026-09-15 规范复核发现的规范值，保守置 null 待业务归类。

⚠ **A8 坑（2026-09-15 规范 schema 逐项核对）**：`/v3/posting/fbs/get` 响应对象
（`v3FbsPostingDetail`，43 属性）**不含** `changed_state_date` /
`last_changed_status_date`——`last_changed_status_date` 只作为 `/v3,/v4
posting/fbs/list` 的请求过滤器存在，`changed_state_date` 只在 webhook 载荷中。
回读路径的阶段时钟锚点只能用 `delivering_date` / `fact_delivery_date`。
另外 `client_delivery_date_end` / `delivery_date_begin/end` 在响应的
**`analytics_data` 嵌套对象**里（不是 posting 顶层）；这些送达日期事实本期仅
随 raw_data 展示，不参与停滞/妥投判定。

## 4. 限流（Rate Limit）

- 官方文档未给出每个方法的精确配额（**未验证**）。
- **真实观察（2026-09-09 Smoke Test，单店）**：
  - 响应携带 **`ratelimit-remaining`** 头（无 `ratelimit-limit` 总量头）；不同方法预算不同——`/v3/product/info/list` 连续 14 批后观察到 `9`，`/v3/posting/fbs/list` 观察到 `49`（疑似按方法独立桶）。
  - 按 ~9 req/秒（客户端 110ms 最小间隔）连续请求 product/list ×7 页 + info/list ×14 批 + posting/list ×1，**全程未触发 429**，未观察到 `Retry-After`。
  - 请求耗时：首请求 ~2.1s（TLS 握手），其后 0.3–1.1s。
- WCIES 策略（OzonClient，位于 Integration 层）：
  - **按店铺隔离**的最小请求间隔（`OZON_MIN_REQUEST_INTERVAL_MS`，默认 110ms ≈ 9 req/s/store）；店铺 A 触发限流不影响店铺 B。
  - HTTP 429 → `PLATFORM_RATE_LIMITED`，尊重 `Retry-After`（秒数或 HTTP-date），指数退避上限 60s。
- 结论：当前 110ms 间隔在真实环境安全；后续如批量拉取可关注 `ratelimit-remaining` 逼近 0 的情况。
- **2026-10-20 重要观察**：`/v3/posting/fbs/list` 的 429 **不是**频率问题（见 §3：
  间隔 4 秒、20 秒 33 次全失败，而 `get`/`product` 正常）——该方法已下线，已迁移到
  `/v4/posting/fbs/list`。教训：**"限流"错误码不能当作调用太快的结论**，需用同凭据
  的其他方法与不同节奏的调用做对照，并优先怀疑方法版本下线。

## 5. 重试与错误归一化

| 场景 | 归一化 code | 重试 |
|---|---|---|
| 401/403 | `PLATFORM_AUTH_ERROR` | 否（凭证问题） |
| 429 | `PLATFORM_RATE_LIMITED` | 是（Retry-After 优先） |
| 5xx | `PLATFORM_API_ERROR` | 是（指数退避 500ms→15s，最多 `OZON_MAX_RETRIES` 默认 3） |
| 超时（默认 30s）/ 网络错误 | `PLATFORM_TIMEOUT` / `PLATFORM_NETWORK_ERROR` | 是 |
| 400/其他 4xx | `PLATFORM_API_ERROR` | 否（确定性错误） |
| 200 但响应非法 | `PLATFORM_BAD_RESPONSE` | 否 |

错误对象保存：HTTP status、trace id（真实 API 返回 **`x-o3-trace-id`**；`x-request-id`/`req-id` 为兼容回退，2026-09-09 实测）、endpoint 名、storeId、消息（脱敏）。**绝不**包含 Client-Id/Api-Key/Authorization。

## 6. Webhook 能力（官方确认支持，已实现）

- 配置入口：OZON 卖家后台（Settings → Push notifications）或
  `POST /v1/notification/set {types:[...], url}`。
  配套管理端点（规范 v2.1 beta 组）：`/v1/notification/list`、`/update`、`/enable`、
  `/delete`、`/check`（对指定 URL 发测试通知并校验连通）、`/v1/notification/push-type/list`
  （列出可用类型）。
- WCIES 接收地址（配置到 OZON 后台的 URL）：

  ```text
  POST {PUBLIC_BASE}/api/v1/webhooks/ozon/stores/{storeCode}
  ```

  （每店铺一个 URL 段；本机开发需公网可达 —— 穿透方案与落地状态见
  [ozon-webhook-tunnel.md](./ozon-webhook-tunnel.md)。开发环境回调地址：
  `https://ozon-hook.wulaoula.cn/api/v1/webhooks/ozon/stores/{storeCode}`，
  公网域名由 `PUBLIC_BASE_URL` 配置提供。）

- **订阅管理已接入系统**（2026-10-09）：店铺页详情抽屉「事件订阅」分节 +
  认证 API `GET/POST/DELETE /api/v1/stores/{storeId}/webhooks/ozon/subscription`
  （`OzonWebhookService`，模式对齐 WB 订阅管理）。实现事实：
  - client 实现 `list` / `set` / `update` / `enable` / `delete` 五个端点
    （spec v2.1 `notification.v1.*` 逐字段核对；set/update/delete/enable 响应
    无 body——client 以 `tolerateEmptyBody` 容忍空响应）；
  - 订阅模型是 **Client-Id 级 URL 列表**：list 返回账户下全部订阅（可能含
    其他系统），服务层只按本店回调 URL 精确匹配操作；
  - 「订阅/对齐」= 无则 `set`、有则 `update`（事件类型收敛为推荐集：
    `TYPE_NEW_POSTING / TYPE_POSTING_CANCELLED / TYPE_STATE_CHANGED /
    TYPE_CREATE_ITEM / TYPE_UPDATE_ITEM`，即接收端 mapper 能分类的集合），
    且订阅处于 `enable=false` 时顺带 `enable` 恢复（对应 §6.5 平台自动暂停）；
  - 退订按 URL 匹配 `delete`，同 URL 多条报 `OZON_WEBHOOK_STATE_ERROR` 转人工；
  - 写操作均记操作日志（`PLATFORM_WEBHOOK` 实体），不落任何密钥。
    首次真实订阅效果待 T0 复核（ON-001 现有订阅是后台人工配的）。
  - **T0 实测（2026-10-12，店铺 ON-003）**：`set` 可能被平台回
    `[3] PING: REQUEST_ERROR` 拒绝 —— 这是 set 时平台的**连通性检查**（向回调
    地址发 PING 探测）网络层失败：访问日志证实探测请求未到达 WCIES（同日
    稍后外部直连同一 URL 得到 200 `{version,name,time}`，隧道/API/应答格式
    均正常）。属瞬时失败，重试即恢复；服务层已把该错误翻译为
    `OZON_WEBHOOK_CONFIG_ERROR`（提示确认回调地址公网可达后重试）。
  - **T0 实测续（2026-10-12）**：重试后 ON-003 订阅成功，平台侧 PING 探测
    到达并落库（`external_raw_events`，推送链路端到端验证通过）。另证实
    **请求/响应形态不对称**：`set`/`update` 的请求体 `types` 是字符串数组，
    但 `list` 响应的 `types` 元素是 `{type, description}` 对象（spec schema
    `NotificationListResponse.Notification.NotificationType`，两字段必填）——
    服务层在 `listSubscriptions` 边界归一化为字符串，视图/DTO 只见字符串。

### 6.1 订阅类型完整清单（规范 v2.1 `notification.v1.*.Type.Enum`，2026-09-13 逐项核对）

订单/发货类（**仅 FBS / rFBS 发货单**会推送）：

| 类型 | 含义 | 消息体关键载荷 |
|---|---|---|
| `TYPE_NEW_POSTING` | 新发货单 | `posting_number`、`products[{sku,offer_id,quantity}]`、`in_process_at`、`warehouse_id`、`shipment_date`、`tracking_number`、`delivery_date_begin/end`、`seller_id` |
| `TYPE_POSTING_SHIPPED` | 发货单进入配送 | 枚举中存在；规范文档段**未给 payload 示例**（仅枚举+描述） |
| `TYPE_POSTING_CANCELLED` | **发货单取消** | `posting_number`、`products[{sku,quantity}]`、`old_state`、`new_state`（如 `posting_canceled`）、`changed_state_date`、**`reason{id,message}`**、`warehouse_id`、`seller_id` |
| `TYPE_STATE_CHANGED` | 发货单状态变化 | `posting_number`、`new_state`、`changed_state_date`、`warehouse_id`、`seller_id` |
| `TYPE_CUTOFF_DATE_CHANGED` | **发货截止时间变化**（对应 `shipment_date`） | `posting_number`、`new_cutoff_date`、`old_cutoff_date`、`warehouse_id`、`seller_id`；**官方标注测试期**，`new_cutoff_date` 可能为空，建议以 `/v3/posting/fbs/get` 回读为准 |
| `TYPE_DELIVERY_DATE_CHANGED` | 送达日期变化 | `posting_number`、`new/old_delivery_date_begin/end`、`warehouse_id`、`seller_id` |

商品/库存类：

| 类型 | 含义 | 消息体关键载荷 |
|---|---|---|
| `TYPE_CREATE_ITEM` / `TYPE_UPDATE_ITEM` / `TYPE_CREATE_OR_UPDATE_ITEM` | 商品创建/更新/两者 | （见规范文档段） |
| `TYPE_STOCKS_CHANGED` | 卖家仓库存量变化 | `items[{product_id, sku, updated_at, stocks[{warehouse_id, present, reserved}]}]`、`seller_id`——渠道库存推送（Allocator）阶段的关键输入 |

聊天类：`TYPE_NEW_MESSAGE` / `TYPE_UPDATE_MESSAGE` / `TYPE_MESSAGE_READ` / `TYPE_CHAT_CLOSED`。

**`TYPE_PING` 不在订阅枚举中**：它是平台在初次接入及此后**周期性**发送的连通性检查
（`{message_type:'TYPE_PING', time}`），无需订阅、不可关闭。

### 6.1b 卖家后台实际可选类型（2026-09-14 实测，22 种）

配置入口「设置 → 集成 → Push 通知 → 添加地址」勾选框的实际清单（按字母序）：

```text
TYPE_CHAT_CLOSED                       聊天已关闭
TYPE_CREATE_ITEM                       商品创建或商品创建错误
TYPE_CREATE_OR_UPDATE_ITEM             商品创建和更新，或在此过程中发生的错误
TYPE_CUTOFF_DATE_CHANGED               货件发运日期更改
TYPE_DELIVERY_DATE_CHANGED             货件配送日期更改
TYPE_DESCRIPTION_CATEGORY_TREE_CHANGED 类目树更改
TYPE_FBO_POSTING_CANCELLED             FBO货件取消
TYPE_FBO_POSTING_DELIVERY_DATE_CHANGED FBO货物送达时间变更
TYPE_FBO_POSTING_NEW                   FBO新货件
TYPE_FBO_POSTING_STATE_CHANGED         FBO货件状态变更
TYPE_FBO_STOCKS_CHANGED                FBO库存变更
TYPE_MESSAGE_READ                      您的消息已被买家或客服阅读
TYPE_NEW_MESSAGE                       新的聊天消息
TYPE_NEW_POSTING                       新的货件
TYPE_ORDER_CANCELLED                   取消订单
TYPE_ORDER_NEW                         新订单
TYPE_ORDER_STATE_CHANGED               订单状态变更
TYPE_POSTING_CANCELLED                 货件取消
TYPE_STATE_CHANGED                     货件状态更改
TYPE_STOCKS_CHANGED                    卖家仓库库存变化
TYPE_UPDATE_ITEM                       商品更新或更新错误
TYPE_UPDATE_MESSAGE                    聊天消息更改
```

> ⚠ **与 §6.1 的规范枚举清单存在差异（2026-09-14 已定论）**：
> - 后台多出的 9 种（`TYPE_ORDER_*` ×3、`TYPE_DESCRIPTION_CATEGORY_TREE_CHANGED`、
>   `TYPE_FBO_*` ×5）是 OZON **2026-08-04 新增**的通知类型（v3 英文规范新闻段），
>   v2.1 俄文规范未收录，故 §6.1 清单里没有。载荷文档见 §6.1d。
> - `TYPE_POSTING_SHIPPED`：后台没有、v3 规范也是 0 次——**§6.1 把它列进去是错的**，
>   订阅时不可选，勿再引用。
> - 后台另有实测出现的 **`TYPE_WRONG_PUSH`**（仅 `{time, message_type}` 两字段），
>   两份规范均为 0 次，无文档；观察到的语义是"此前某次投递/校验失败"的补送标记
>   （见 §6.5），订阅时不出现、无法选择。

### 6.1d 订单级事件载荷（v3 英文规范「New order / Order cancellation / Order status change」）

三种 `TYPE_ORDER_*` 共有的字段：`order_number`（string）、`order_id`（int64）、
**`uuid`（string，唯一事件标识——posting 系列没有这个字段）**、`seller_id`（int64）。
各自的差异字段：

| 类型 | 独有字段 | 示例值 |
|---|---|---|
| `TYPE_ORDER_NEW` | `created_at`（date-time） | `order_number: "24219509-0020-1"` |
| `TYPE_ORDER_CANCELLED` | `cancelled_at`（date-time） | `order_id: 35452597966` |
| `TYPE_ORDER_STATE_CHANGED` | `old_state` / `new_state`（如 `order_in_delivery` → `order_done`）、`updated_at` | — |

与 posting 系列的关键区别（当前事实，未做更多推断）：

1. **不带 `products`、不带 `warehouse_id`、不带发货信息**——订单级事件没有履约明细，
   无法直接驱动入库/库存动作；`TYPE_NEW_POSTING` 才带 `products[]` + `posting_number`。
2. **带 `uuid`**：`TYPE_ORDER_*` 是有事件 ID 的，若未来要处理它们，幂等键可直接用
   `uuid`（posting 系列无事件 ID，只能按 payload 哈希去重）。
3. v3 规范在 `TYPE_ORDER_NEW` 章节附警告：**该通知可能延迟**，
   要及时数据仍应轮询 `POST /v3/posting/fbs/unfulfilled/list`。
4. `order_number` 的样例格式与 posting_number 同形（`24219509-0020-1`），
   它与我们 `orders.platform_order_id`（= posting_number）的关系**未验证**，
   需真实样本比对后再下结论。

> 平台已订阅这三种（2026-09-14，见 §6.6），样本会以 `UNKNOWN` 落进
> `external_raw_events`，届时回填本节。

### 6.1c WCIES 对各类型的实际处理（双轴 T2 起，2026-09-15）

`WebhookProcessService` 对**订单/发货提示类**事件采取动作（定向回读 posting →
`OrderIngestionService` 入库 / `applySyncedPlatformFacts` 事实更新）；其余类型
「记录为事实 → 标记 `SKIPPED`」。回读遇 WCIES 未知单**完整建单**（webhook 本就是
补漏通道，摄入幂等；与 `NEW_POSTING` 同语义）。事件状态分流：产生动作 →
`PROCESSED`，处理异常 → `FAILED`，无动作类型 → `SKIPPED`（payload hash 去重不变）：

| 订阅类型 | 分类 | 当前行为 |
|---|---|---|
| `TYPE_NEW_POSTING` | `NEW_POSTING` | ✅ 定向回读 + 订单入库 → `PROCESSED` |
| `TYPE_POSTING_CANCELLED` | `POSTING_CANCELLED` | ✅ 定向回读 + 事实应用（取消传导）→ `PROCESSED` |
| `TYPE_STATE_CHANGED` | `POSTING_STATE_CHANGED` | ✅ 定向回读 + 事实应用（状态/阶段/时限）→ `PROCESSED` |
| `TYPE_CREATE_ITEM` / `TYPE_UPDATE_ITEM` / `TYPE_CREATE_OR_UPDATE_ITEM` | `ITEM_CHANGED` | 仅落库（Listing 变更走手动同步）→ `SKIPPED` |
| `TYPE_PING` | `PING` | 仅落库 → `SKIPPED` |
| 其余（含 `TYPE_ORDER_*`、`TYPE_FBO_*`） | `UNKNOWN` | 仅落库 → `SKIPPED` |

注意：
- push 词表（§6.2 的 `new_state`）**不写入** `platform_status`，一律以回读的
  Seller API 原文为准；
- webhook 载荷的 `changed_state_date` 仅作为 `platform_status_history` 迁移行的
  平台侧时间溯源（回读响应里没有该字段，§平台阶段映射 A8）；
- `TYPE_ORDER_*` 的 `order_number` 与 posting_number 关系仍未验证（§6.1d），
  继续只落库。

### 6.2 两套状态词表（STATE_CHANGED / CANCELLED 的 `new_state` 用 push 模型，非 Seller API 词表）

规范给出映射表（节选）：

| Seller API `status`（我们 `platform_status` 存的词表） | Push 模型 `new_state` |
|---|---|
| `awaiting_approve` / `awaiting_packaging` | `posting_created` |
| `awaiting_deliver` | `posting_transferring_to_delivery` / `posting_in_carriage` / `posting_not_in_carriage` |
| `delivering` | `posting_on_way_to_city` / `posting_transferred_to_courier_service` / `posting_in_courier_service` / `posting_on_way_to_pickup_point` / `posting_in_pickup_point` |
| `delivered` | `posting_delivered` / `posting_received` |
| `cancelled` | `posting_canceled` |

→ **不得**把 push 词表字符串直接写入 `platform_status`；WCIES 的回读式处理
（用 `/v3/posting/fbs/get` / `fetchOrdersByPlatformIds` 取 Seller API 词表原文）天然规避此坑。

### 6.3 安全与处理约定（不变）

- **消息体**：`{message_type, ...事件字段}`；webhook **不含订单完整事实**（NEW_POSTING
  官方还警告：延迟支付订单 `in_process_at` 可能为空）。
- **无签名机制**（官方无验签 API）。WCIES 的身份保障三层：
  1. URL 内 storeCode 与店铺一一对应；
  2. `payload.seller_id` 必须等于该店铺凭证 `clientId`，不匹配 → raw event `REJECTED`（仍回 200 防重试风暴）；
  3. Webhook 仅是提示：处理器用已认证 API 回读 posting 原文后才入库。
- 幂等：无事件 ID → 按 `(store, sha256(canonical payload))` 去重（`external_raw_events` 唯一索引）。
- 处理流：校验形状 → 存 raw event（PENDING）→ 入 `wcies.webhook` 队列 → 立即 200。HTTP 请求内**不**建单、**不**锁库存、**不**调用平台 API。

### 6.4 ✅ 响应格式（2026-09-14 实测定论，冲突已解决）

**结论：新版校验确实存在，`{result:true}` 已被淘汰，必须回 `{version, name, time}`。**

实测过程：卖家后台「设置 → 集成 → Push 通知 → 添加地址」提交
`https://ozon-hook.wulaoula.cn/api/v1/webhooks/ozon/stores/ON-001`，
平台现场发起连通性检查，返回：

```text
⚠️ 响应体中的"time"字段无效        WRONG_RESULT_TIME_FIELD
   网址不可用：请修正错误后重新添加
```

即当时实现的 `{"result": true}` 被判不合格。规范 v2.1
「Запрос для проверки соединения」章节给出的模板（`docs/ozon-seller-openapi.json`）：

**成功（HTTP 200）**：

```json5
{
  "version": "string",              // Версия приложения — 应用版本
  "name": "string",                 // Название приложения — 应用名称
  "time": "2019-08-24T14:15:22Z"    // 开始处理该通知的时间（UTC date-time）
}
```

**失败（4xx/5xx）**：`{"error": {"code": "ERROR_UNKNOWN", "message": "…", "details": null}}`

两个易错点：

1. **`time` 是「开始处理通知」的时刻**，不是返回响应体的时刻——实现里在处理器入口
   取一次 `startedAt`，而不是出口处 `new Date()`。
2. 分数秒：模板示例无毫秒（`…T14:15:22Z`），实现按此格式去掉 `.000`，
   避免格式校验挑剔。

WCIES 实现：`buildPushAck()`（`apps/api/src/modules/integration/ozon/ozon.mapper.ts`），
控制器 `OzonWebhookController.receive()` 在**所有软成功路径**（ACCEPTED / DUPLICATE /
REJECTED / 未知瞬时错误）统一返回该应答体；`PLATFORM_BAD_RESPONSE`（400）与
`STORE_NOT_FOUND`（404）仍按规范走 4xx。

`TYPE_PING` 的请求体形状也已实测确认：`{"message_type": "TYPE_PING", "time": "…"}`。

> 注：v3 规范内部也是新旧两段并存——`service_response` tag 的描述段仍写 `{"result": true}`，
> 而「Your service response」章节写 `{version, name, time}`。后台现场校验执行的是后者
> （见上），**以实测为准**；读文档时不要被 tag 描述段带偏。

### 6.5 投递重试与自动停用（v3 英文规范 push_resending / push_monitoring 章节，2026-09-14 收录）

- **重试**：投递失败后数秒内重试若干次，间隔逐步增大；达到上限 **10 分钟**后，
  再每 10 分钟补投 5 次。
- **自动暂停**（满足任一条即暂停**全部**通知）：
  1. 服务不可用；
  2. 最近 24 小时内持续返回错误；
  3. 200 响应占比不足一半；
  4. **单条通知处理时间超过 5 秒**。
- **恢复**：需在后台重新确认服务 URL，或调 `/v1/notification/enable`，
  系统在下个检查周期复测。若是 support 侧停用并给出原因，卖家不能自行启用，
  只能删旧 URL、换新 URL 重接。

对 WCIES 的直接约束：

1. **HTTP 入口必须 5 秒内返回**——当前实现（校验形状 → 落库 → 入队 → 200）满足，
   任何慢操作必须留在 worker（§28 的既有约束），这是平台侧的硬性红线而不只是风格。
2. **订阅期间开发机/隧道必须保持可用**。机器关一晚 → 通知被自动暂停 →
   第二天要人工去后台重新确认 URL。要长期停用就先在后台删地址，不要"挂着订阅关隧道"。
3. 平台会补送历史失败事件：实测订阅成功后立刻收到了**当天早些时候失败校验**的
   补送（见 §6.6），幂等去重必须按"同 payload 可能重复到达"设计（已是如此）。

### 6.6 订阅状态与首批真实投递（2026-09-14）

已订阅（卖家后台，店铺 ON-001）：

```text
TYPE_NEW_POSTING / TYPE_ORDER_NEW / TYPE_ORDER_CANCELLED /
TYPE_ORDER_STATE_CHANGED / TYPE_POSTING_CANCELLED / TYPE_STATE_CHANGED
```

订阅后 ~1 小时内的真实到达记录（`external_raw_events`）：

| message_type | 分类 | 处理结果 | 备注 |
|---|---|---|---|
| `TYPE_STATE_CHANGED` | `POSTING_STATE_CHANGED` | SKIPPED | **首条真实业务事件**：`posting_on_way_to_city`，posting `62081919-0389-1`，载荷与 §6.1 文档一致 |
| `TYPE_PING` ×多 | `PING` | SKIPPED | 观察到约每 5–15 分钟一条（混有历史补送，精确周期未定） |
| `TYPE_WRONG_PUSH` ×2 | `UNKNOWN` | SKIPPED | 无文档类型，仅 `{time, message_type}`；time 对应当天早些时候的失败校验，属补送 |

`TYPE_NEW_POSTING` / `TYPE_ORDER_*` 尚无真实样本（等新订单），到达后回填 §6.1d。

## 7. 平台 ID 语义（关键）

| ID | 含义 | WCIES 用法 |
|---|---|---|
| `product_id` | OZON 商品（页）ID | listing 主键维度 (store, product_id) |
| `sku` | OZON SKU（商品实体）ID | `platform_listing_skus.platform_sku_id`；订单行反查键 |
| `offer_id` | 卖家自定义货号（可改） | 辅助标识；人工对账用 |
| `order_id` / `order_number` | OZON 订单（可拆多个 posting） | 仅存于 raw_data，**不**作唯一键 |
| `posting_number` | 发货单号（履约单位，稳定） | `orders.platform_order_id` 业务唯一键 |
| `seller_id` | 卖家账号 ID = Client-Id | Webhook 身份校验 |

## 8. 退货 API（双轴 T5，已接入只读）

### POST /v2/returns/rfbs/list（2026-09-15 规范核对，已实现）

Request：`{filter: {}, last_id: <return_id 游标>, limit}`；Response：`{returns: [...]}`。

- rFBS（=卖家 FBS）退货单，**一单一件**（schema 无数量字段）；
- 关键字段：`return_number`（业务键）、`return_id`（分页游标）、`posting_number`
  （= 我们 `orders.platform_order_id`，订单关联键）、`state{state,
  money_return_state_name}`（退款状态仅展示，returns.md §4）、
  `product{sku, offer_id, price}`、`created_at`；
- **响应无 has_more 标志**：页满即可能还有下一页（同 product/list 模式）；
- 映射 `mapRfbsReturn` 容错：除 `return_number` 外字段缺失→null，不抛错（§49）；
- 落库 `platform_returns`（只读事实，`UNIQUE(store_id, platform_return_id)`），
  永不直接驱动库存——实物经退货批次检验回库（returns.md §1/§3）。

### POST /v1/returns/list（记录事实，暂不接入）

FBS/FBO 统一退货（旧接口）：`id`/`posting_number`/`exemplars[]`（件列表）/
`visual`（外观状态）/`place`（当前位置）/`type`（Cancellation=发货前取消 等）。
规范已确认存在；待真实需求出现再接（AGENTS §88）。

### POST /v1/returns/rfbs/action/set —— **不做**

真实平台写操作（接受/拒绝退货），AGENTS §92 需专项确认，本期明确排除。

## 9. 类目树与商品属性 API（Sprint 8.5 冒烟已验证，尚未接入同步）

### POST /v1/description-category/tree（2026-09-14 真实冒烟）

Request：`{language: "ZH_HANS" | "RU" | "EN" | "TR" | "DEFAULT"}`；Response：`{result: TreeNode[]}`。

- **`ZH_HANS` 官方简体中文直出可用**（人工判读质量正常，例：`儿童用品 > 积木玩具套装 > 积木`）。
- 真实规模：根 26 / 类目共 7933 / type 节点 7365；`disabled` 全树为 0（当前没有禁用节点）。
- **树恰好 3 层**：L1 类目（26）→ L2 类目（542）→ L3 即 type 条目（7365）；
  type 只出现在第 3 层，无第 4 层，故规划中的「层级塌缩」实际为 1:1 直映（L1→一级、L2→二级、type→三级）。
- **type 节点不携带 `description_category_id`**（仅 `type_id`/`type_name`）——复合键
  `(category_id, type_id)` 的 category 部分必须取 type 的**父节点**（L2）的 id。
- 19 个 type_id 出现在多个父类目下（如 971445087 挂在 3 个类目）——复合键精确匹配是必需的，
  仅按 type_id 会歧义。
- ZH_HANS 与 RU 两次拉取的 type 键集完全一致（双语合并可行）。
- 坑：无分页（整树一次返回，~8k 节点）。

### POST /v4/product/info/attributes（2026-09-14 真实冒烟）

Request：`{filter: {product_id[] | offer_id[] | sku[]}, limit ≤ 1000}`（**filter 必填**，缺省 400）。

- ⚠ **真实响应为 `{"result": [<item>...]}`——`result` 直接是数组**，与规范 schema 的
  `result.items` 信封不一致（与 `/v3/product/info/list` 同类的「规范 ≠ 真实」坑，实现按真实结构解析）。
- Item 关键字段（实测）：`id`（=product_id）、`offer_id`、`name`、`height/depth/width` +
  `dimension_unit`（实测 `"mm"`）、`weight` + `weight_unit`（实测 `"g"`）、
  `description_category_id`、`type_id`、`primary_image`、`images[]`、`barcodes[]`、`attributes[]`。
  （更正 2026-09-15：字段名是 **`barcodes` 数组**，早前笔记误记为单数 `barcode`；
  本店 1299 个商品实测**全部为空数组**——卖家从未在 OZON 侧填写条码，
  因此「从平台数据批量取条码」当前没有任何原料，见 §6 平台条码相关讨论。）
- 审核未通过（declined）/ 新建（new）商品同样返回属性数据（4/4 实测）。
- filter 三种 id 形式均可用；字符串/数字 product_id 均被接受。
- 已知限制：未观察到分页游标（result 即全量），按 ≤1000 分批请求即可。

### 存量数据直查（2026-09-14，SQL，零 API）

`platform_listing_skus.raw_data` 是 v3 info 的**扁平对象**（键在顶层，非 `product_info` 子键）：
`primary_image` / `description_category_id` / `type_id` / `color_image` 覆盖 1324/1324（100%），
`images` 数组非空 1317/1324（99.5%）。现有数据中唯一 `(category_id, type_id)` 复合键 22 个、
涉及 14 个类目。
⚠ **图片字段为单元素 JSON 数组**：真实数据中 `primary_image`/`color_image` 形如
`["https://…"]`（规范声明为 string，又一处规范≠真实；T8 走查发现，读取需兼容两种形态）。

## 9b. 仓库目录 API（仓库绑定平台仓库，2026-09-17 实测）

用户指示（2026-09-17）：绑定主体是**物理仓库 ↔ 平台仓库**（不再是店仓绑定，
master-data.md §7）。平台仓库分类与履约模式对应：

| 分类 | 履约模式 | 目录端点 | 关键字段 |
|---|---|---|---|
| 自管仓 | realFBS（OZON_RFBS） | `POST /v2/warehouse/list` | `warehouses[].is_rfbs = true` |
| 自管仓 | FBS（OZON_FBS） | `POST /v2/warehouse/list` | `warehouses[].is_rfbs = false` |
| 半托管 | FBP（OZON_FBP） | `POST /v1/fbp/warehouse/list` | `warehouses[].{id,name,partner_name}` |
| 托管仓 | FBO（OZON_FBO） | `POST /v1/warehouse/ozon/list`，body `{"warehouse_types":["FULL_FILLMENT"]}` | `warehouses[].{warehouse_id,name,is_active}` |

实测备注（2026-09-17，真实凭据只读调用）：

- `/v1/warehouse/list` 返回 `{"code":9,"message":"obsolete method cannot be used"}`——**必须用 v2**。
- `/v2/warehouse/list` 响应 `{warehouses:[{warehouse_id,name,is_rfbs,warehouse_type:"rfbs"|…,status,address_info,…}]}`；`status`：new/created/disabled/blocked/disabled_due_to_limit/error。
- `/v1/fbp/warehouse/list` 返回平台国内合作仓目录（Xingyuan/CEL 等），响应 `{warehouses:[{id,name,partner_name,is_bonded,address_detailing,supply_types}]}`。
- `/v1/warehouse/ozon/list` 是 OZON 自有仓**总目录**（全量 172 个 FULL_FILLMENT 仓，含 inactive）；`warehouse_types` 必填（蛇形命名，缺省 400）。
- `/v1/warehouse/fbo/list` 是「按名称搜索供给点」接口（`search` 必填且 minLength 4），**不能枚举**，不用作 FBO 目录。
- `/v1/warehouse/fbo/seller/list` 实测返回 `{warehouses:[]}`。
- WCIES 侧归一化入口：`GET /api/v1/stores/:storeId/platform-warehouses`
  （实时聚合三个端点，返回 `{platformWarehouseId,name,fulfillmentMode,category,status,address,partnerName,isActive}`）；
  仅 OZON 实现，其它平台返回 `PLATFORM_WAREHOUSE_QUERY_UNSUPPORTED`。

## 9c. 平台写操作：组包与面单（订单发货流程，2026-09-18）

> ⚠ 本节是全仓库**唯一**的真实平台写能力（Read-first 边界在此定向解除，
> 见 `docs/decisions/`）。库存/价格推送仍未接入。
> 两个端点均为规范核对实现，**尚未对真实账号执行**（AGENTS.md §92 需用户显式授权），
> 未验证项逐条标注；测试一律走脚本化传输，永不触达真实平台。

### ① 组包 `POST /v4/posting/fbs/ship`

| 项 | 事实 | 来源 |
|---|---|---|
| 语义 | 「Pack the order」：拆包并把发货单状态改为 `awaiting_deliver` | v3 英文规范 path 定义 |
| 请求 | `{ posting_number, packages:[{ products:[{ product_id, quantity }] }] }` | 规范 `fbsv4FbsPostingShipV4Request` |
| `product_id` | = OZON **SKU**（规范原文「Product identifier in the Ozon system, SKU」） | 规范字段描述 |
| 响应 | `{ result:["<posting_number>"], additional_data:[...] }` | 规范 + 示例 |
| ⚠ 坑 1 | **200 不代表组包成功**；规范要求回读 `/v3/posting/fbs/get` 并检查 `substatus`，`ship_failed` 需重试 | 规范描述段 |
| ⚠ 坑 2 | 状态变更是**异步**的（T0 实测：回读落在 `awaiting_packaging` + `substatus=ship_pending`，见下） | 同上 |
| 幂等 | 已组包的发货单禁止重复提交；`POSTING_ALREADY_SHIPPED` / `HAS_INCORRECT_STATUS` 按**成功**处理 | 规范 Errors 表 |
| 其他错误 | `TRANSITION_IS_NOT_POSSIBLE`、`POSTING_NOT_FOUND`、`POSTING_ALREADY_CANCELLED`、`HAS_INCORRECT_PRODUCT_QUANTITY` | 同上 |

**实测依据（运单号何时出现）**——2026-09-18 对本地库 197 张已同步发货单统计
`raw_data->>'tracking_number'`：

| `platform_status` | 单数 | 有运单号 |
|---|---|---|
| `delivering` | 89 | **89** |
| `awaiting_deliver` | 66 | **66** |
| `awaiting_packaging` | 16 | **0** |
| cancelled / 空 / 其他 | 26 | 1 |

结论：**OZON 只在组包时才分配 `tracking_number`**。因此「获取运单号」必须先调
组包接口——这是业务需求（用户指示）与接口事实互相印证的一处，不是实现选择。
`tracking_number` 是 posting 顶层字段（`v3FbsPosting` / `v3FbsPostingDetail`），
不受 `with` 参数控制。

**实现**（`apps/api/src/modules/integration/ozon/ozon-shipment.service.ts`）：

1. 先读 `/v3/posting/fbs/get`；
2. 已组包（`awaiting_deliver` / `delivering` / `driver_pickup` /
   `acceptance_in_progress` / `delivered`）→ 直接返回 `alreadyPrepared=true`，**不写平台**；
3. 可组包判断优先看 `available_actions`（`ship` / `ship_async`），
   否则只认 `awaiting_packaging`；其余状态（含 `cancelled`）显式报错，**不猜**；
4. 写平台 → **回读**：
   - 已组包 → 返回运单号；
   - **受理但未确认**（`awaiting_packaging` + `substatus=ship_pending`，或
     `available_actions` 含 `ship_async_in_process` / `ship_async_retry`）→
     返回 `assemblyPending=true` 的**成功**结果（2026-10-09 T0 后语义；
     运单号此时不可读，用户再次点击或常规订单同步自然收敛）；
   - `ship_failed` 或写后变 `cancelled` → 抛 `PLATFORM_SHIP_NOT_CONFIRMED`（真失败，进异常中心）；
5. 请求体由**平台回读结果**构造（全部商品装入一个包裹），不用本地行，避免与平台内容不一致。

**T0 实测（2026-10-09，OZON 124 店 / 订单 56089221-0064-1，用户点击「获取运单号」）**：

- `POST /v4/posting/fbs/ship` 以平台回读构造的请求体（全部商品单包裹）正常受理；
- 回读返回 `status=awaiting_packaging`、`substatus=ship_pending`——组包确认
  **异步进行中**，这是正常中间态而非错误（为此把实现从抛 502 改为返回
  `assemblyPending`）；
- 同日真实链路还暴露过一处本地 bug（`requireCapability` 返回解绑方法导致
  `this===undefined` 500，已于当日修复并补回归测试），与平台行为无关。

### ② 面单 `POST /v2/posting/fbs/package-label`

| 项 | 事实 | 来源 |
|---|---|---|
| 语义 | 生成指定发货单的标签 PDF；**仅限 `awaiting_deliver`** | 规范描述段 |
| 请求 | `{ posting_number: string[] }`（描述称 ≤20 个/次，schema 无 maxItems） | 规范 |
| 前置 | 建议组包后 **45–60 秒**再请求 | 规范描述段 |
| ⚠ 坑 | 规范**自相矛盾**：200 声明 `application/pdf`，schema 却是
  `{content_type,file_name,file_content(base64)}` JSON 信封 | 规范 200 段 vs schema |
| 错误 | 至少一个单失败则**全部不生成**；`The next postings aren't ready` = 面单未就绪；
  `INVALID_ARGUMENT` / `label not allowed for delivered postings` = 状态不符 | 规范 Errors 表 |

**实现**：传输层新增**原始字节模式**（`OzonClient.packageLabel`），按实际
`Content-Type` 判定——JSON 信封则 base64 解码，其余按 PDF 字节直通。两种都接，
因此**规范矛盾不影响上线**，但仍需真实测一次确认实际形态（见下）。

**批量取单（2026-10-21）**：`OzonShipmentService.fetchShippingLabels` 把多个
posting 放进**一次**请求（调用方按 20 单切块），平台返回**一个** PDF。实现假定
「一页 = 一单、页序 = 请求顺序」，因此只有 `页数 === 单数` 时才拆页归档；页数
不符或返回不可解析（例如 ZIP）时抛 `PlatformBatchShapeError`，由 sync 层降级为
逐单请求。平台以 4xx 拒绝（全或无）同样降级逐单，把不可取的 posting 隔离出来。
**该「一页一单」假设仍待真实两单验证**（见 T0 第 4 项）——它只影响提速，
不影响正确性。

### 待 T0 实测（拿到用户授权后逐项回填）

1. ~~`/v4/posting/fbs/ship` 真实请求/响应~~ ✅ 2026-10-09 已测（见上：受理正常、
   确认异步、中间态 `ship_pending`）；已组包时的**真实错误文案与 HTTP 状态**仍未遇到；
2. `substatus = ship_failed` 的传播时机（异步组包需多久）——`ship_pending` 中间态
   已实测，失败态未遇到；
3. `integration_type_flow = aggregator`（rFBS，本店 146/183 单）是否同样走本端点组包；
4. `/v2/posting/fbs/package-label` 真实响应体是 PDF 字节还是 JSON base64；
   以及**两单一次请求**的返回是否为「每单一页、页序=请求顺序」（批量取单的
   拆页假设，2026-10-21 新增）；
5. `available_actions` 在真实 `/v3/posting/fbs/get` 响应中是否出现、取值集合。

## 10. 已知限制 / 坑

1. `ON CONFLICT` 部分唯一索引 + TypeORM `TableIndex({unique,where})` 会**静默丢 UNIQUE**（本 Sprint 踩过，已改 raw SQL；见 20260911_002/004）。
2. pg 驱动 `UPDATE ... RETURNING` 经 TypeORM `query()` 返回 `[rows, rowCount]` 二元组（与 INSERT 不同），判断行数必须归一化。
3. `/v3/product/list` 无 has_more —— 必须用「页满 + last_id 变化」推断；last_id 不变时务必停止，否则死循环。
4. Webhook 无签名 + 仅店铺级 URL：绝不能在 webhook 请求内做写操作；一切事实以 API 回读为准。
5. OZON 文档站点 antibot 较强，抓取验证需搜索缓存/开源实现交叉核对，禁止凭记忆写字段。
6. FBO/FBP 专用订单端点、价格/库存推送、平台发货写操作：本 Sprint 不接入（Read-first）；当前 FBS 端点已返回的 `FBP` 渠道事实按 §3 保存。

## 11. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OZON_API_BASE_URL` | `https://api-seller.ozon.ru` | 集成测试指向本地 mock server |
| `OZON_TIMEOUT_MS` | 30000 | 单请求超时 |
| `OZON_MAX_RETRIES` | 3 | 可重试错误的最大重试次数 |
| `OZON_MIN_REQUEST_INTERVAL_MS` | 110 | 每店铺最小请求间隔（限流） |
| `ORDER_SYNC_INTERVAL_SECONDS` | 0（关） | 订单轮询频率（≥60s；需店铺 settings.sync.orderSyncEnabled） |
| `LISTING_SYNC_INTERVAL_SECONDS` | 0（关） | Listing 同步频率（≥300s；需店铺 opt-in） |
| `ORDER_STATE_FALLBACK_HOURS` | 24 | 兜底回读轮转窗口（小时，允许小数；超时未确认的平台事实订单才进入回读候选，双轴 T2） |

## 12. Real Smoke Test

**已执行（2026-09-09，单店 OZON-SMOKE1，只读）** —— 范围：Credential Validation + Fetch Listings + Fetch Orders + Manual Listing/Order Sync + 同窗口幂等复测。未执行任何平台写操作、未开启轮询、未配置 Webhook。

结论摘要：

- 凭证 VALID；Listing 1324 个（7 页 ×200 游标分页，`last_id` 行为符合预期）；订单 3 张（7 天窗口，`has_next=false`）。
- **发现并修正 1 处真实响应差异**：`/v3/product/info/list` 顶层 `items`、无 `result` 包裹（§2 已更新）；另采集到 `ratelimit-remaining` 响应头与 `x-o3-trace-id` trace 头（§4/§5）。
- 同窗口重复订单同步：0 重复创建、0 重复 Reservation、0 新增 InventoryTransaction（3 skipped）。
- 全量报告：`handoff/ozon-smoke-test-report-2026-09-09.md`。

进入单店 Scheduled Polling 试运行需用户另行批准。
