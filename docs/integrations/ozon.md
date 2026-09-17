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

### 字段映射（Mapper）

| OZON | WCIES |
|---|---|
| `product_id` | `platform_listings.platform_product_id`（String） |
| `info.name` | `platform_listings.title` |
| `info.sku` | `platform_listing_skus.platform_sku_id`（String） |
| `offer_id` | `platform_listing_skus.offer_id` |
| `is_archived / is_autoarchived / archived` | `platform_listing_skus.status` + listing `platform_status`（ARCHIVED/LISTED 事实字符串） |
| 完整原始 item | `raw_data`（两份：product_list_item + product_info） |

## 3. 订单 API 能力（已实现）

### POST /v3/posting/fbs/list

Request：

```json
{
  "dir": "ASC",
  "filter": { "since": "ISO-UTC", "to": "ISO-UTC" },
  "offset": 0, "limit": 200,
  "with": {}
}
```

Response：`{result:{has_next: boolean, postings:[...]}}`。

- **必须**携带 `filter.since/to`（UTC，格式 `YYYY-MM-DDTHH:mm:ssZ`）；窗口大小上限官方文档未给出硬限制（**未验证**，WCIES 初始 7 天，此后增量）。
- 分页：`offset` 递增 + `has_next`；页内最大 1000。
- `in_process_at` = 订单开始处理时间（订单创建时刻），是窗口过滤字段。

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
| `cancelled` | `CANCELLED` | null |

**未归类（→ null，仅记录，不猜）**：`arbitration`、`client_arbitration`、
`not_accepted`（任务书 §8 待确认项 3）；`awaiting_verification`（"created"）、
`cancelled_from_split_pending`（拆单取消）——后两个是 2026-09-15 规范复核时
发现任务书词表未覆盖的规范值，同样保守置 null 待业务归类。

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
