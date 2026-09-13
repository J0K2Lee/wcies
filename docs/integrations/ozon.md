# OZON 集成笔记（Sprint 5 Read-First）

> 状态：**Sprint 5 已实现**（Read-only：Credential Validation + Fetch Listings + Fetch Orders + Webhook）。
>
> 事实来源：
> 1. 官方 Seller API OpenAPI 规范 `docs/ozon-seller-openapi.json`（版本 2.1，用户提供，2026-09-09）；
> 2. 官方文档站点 docs.ozon.ru（Push notifications 章节；站点有 antibot，内容经搜索缓存与开源客户端实现交叉验证）；
> 3. 真实 API 冒烟测试：**尚未执行**（需用户批准，见「Smoke Test」章节）。
>
> 未验证项一律明确标注，不得进入生产假设。

## 验证日期

| 项 | 验证方式 | 日期 |
|---|---|---|
| Endpoint / Request / Response 字段 | 官方 OpenAPI 规范 json 逐字段核对 | 2026-09-09 |
| Webhook 事件类型与消息结构 | 官方规范（/v1/notification/* 枚举）+ 开源客户端结构（diphantxm/ozon-api-client）交叉 | 2026-09-09 |
| Webhook 订阅类型完整清单（14 种）、各事件 payload、push 模型状态词表、`{version,name,time}` 应答格式 | 官方规范 v2.1 内嵌文档段逐项核对（`notification.v1.*` 枚举 + 描述文本）；**真实投递未验证**（从未配置真实 webhook） | 2026-09-13 |
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
| `products[].sku` | `order_items.platform_sku_id` + `platform_product_id`（String(OZON sku)） |
| `products[].offer_id` | `order_items.offer_id`（→ ListingResolver 以 store+offer_id/platform_sku_id 解析内部 SKU） |
| `products[].quantity` | `order_items.quantity`（整数 → String） |
| `products[].currency_code` | `orders.currency`（取第一行） |
| （整体） | `orders.raw_data`（完整 posting 原文）+ 每行 `order_items.raw_data` |

- `fulfillmentMode` 固定 `FBS`（本 Sprint 只接 FBS 订单；FBO/FBP 未来 Sprint）。
- 订单取消/状态回写：**本 Sprint 不做**（Read-first，§4 禁止写操作）。

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

  （每店铺一个 URL 段；本机开发需公网可达，如内网穿透。）

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

### 6.4 ⚠️ 响应格式存在文档冲突（未定论，待真实订阅时验证）

- 现实现与本文旧版：`{"result": true}`（来自 docs.ozon.ru 传统 Webhook API 章节）。
- 规范 v2.1 push-notification 文档段：成功应答 **`{version, name, time}`**，错误为
  4xx/5xx `{error:{code,message,details}}`；且 `/v1/notification/check` 的错误枚举含
  `WRONG_RESULT_FIELD`、`WRONG_RESULT_TIME_FIELD`——**暗示新体系会校验应答体形状**。
- 两处冲突未在真实环境验证（我们从未配置过真实 webhook）。HTTP 200 + 任意 body 大概率
  可被旧体系接受；但若经新版 beta 方法配置并用 `/check` 验证，`{result:true}` 可能被判
  `WRONG_RESULT_FIELD`。**接入前必须实测一次**，以实测结果为准修订本节与控制器。

## 7. 平台 ID 语义（关键）

| ID | 含义 | WCIES 用法 |
|---|---|---|
| `product_id` | OZON 商品（页）ID | listing 主键维度 (store, product_id) |
| `sku` | OZON SKU（商品实体）ID | `platform_listing_skus.platform_sku_id`；订单行反查键 |
| `offer_id` | 卖家自定义货号（可改） | 辅助标识；人工对账用 |
| `order_id` / `order_number` | OZON 订单（可拆多个 posting） | 仅存于 raw_data，**不**作唯一键 |
| `posting_number` | 发货单号（履约单位，稳定） | `orders.platform_order_id` 业务唯一键 |
| `seller_id` | 卖家账号 ID = Client-Id | Webhook 身份校验 |

## 8. 类目树与商品属性 API（Sprint 8.5 冒烟已验证，尚未接入同步）

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
  `description_category_id`、`type_id`、`primary_image`、`images[]`、`barcode`、`attributes[]`。
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

## 9. 已知限制 / 坑

1. `ON CONFLICT` 部分唯一索引 + TypeORM `TableIndex({unique,where})` 会**静默丢 UNIQUE**（本 Sprint 踩过，已改 raw SQL；见 20260911_002/004）。
2. pg 驱动 `UPDATE ... RETURNING` 经 TypeORM `query()` 返回 `[rows, rowCount]` 二元组（与 INSERT 不同），判断行数必须归一化。
3. `/v3/product/list` 无 has_more —— 必须用「页满 + last_id 变化」推断；last_id 不变时务必停止，否则死循环。
4. Webhook 无签名 + 仅店铺级 URL：绝不能在 webhook 请求内做写操作；一切事实以 API 回读为准。
5. OZON 文档站点 antibot 较强，抓取验证需搜索缓存/开源实现交叉核对，禁止凭记忆写字段。
6. FBO/FBP 订单、价格/库存推送、平台发货写操作：本 Sprint 明确禁止（Read-first）。

## 10. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OZON_API_BASE_URL` | `https://api-seller.ozon.ru` | 集成测试指向本地 mock server |
| `OZON_TIMEOUT_MS` | 30000 | 单请求超时 |
| `OZON_MAX_RETRIES` | 3 | 可重试错误的最大重试次数 |
| `OZON_MIN_REQUEST_INTERVAL_MS` | 110 | 每店铺最小请求间隔（限流） |
| `ORDER_SYNC_INTERVAL_SECONDS` | 0（关） | 订单轮询频率（≥60s；需店铺 settings.sync.orderSyncEnabled） |
| `LISTING_SYNC_INTERVAL_SECONDS` | 0（关） | Listing 同步频率（≥300s；需店铺 opt-in） |

## 11. Real Smoke Test

**已执行（2026-09-09，单店 OZON-SMOKE1，只读）** —— 范围：Credential Validation + Fetch Listings + Fetch Orders + Manual Listing/Order Sync + 同窗口幂等复测。未执行任何平台写操作、未开启轮询、未配置 Webhook。

结论摘要：

- 凭证 VALID；Listing 1324 个（7 页 ×200 游标分页，`last_id` 行为符合预期）；订单 3 张（7 天窗口，`has_next=false`）。
- **发现并修正 1 处真实响应差异**：`/v3/product/info/list` 顶层 `items`、无 `result` 包裹（§2 已更新）；另采集到 `ratelimit-remaining` 响应头与 `x-o3-trace-id` trace 头（§4/§5）。
- 同窗口重复订单同步：0 重复创建、0 重复 Reservation、0 新增 InventoryTransaction（3 skipped）。
- 全量报告：`handoff/ozon-smoke-test-report-2026-09-09.md`。

进入单店 Scheduled Polling 试运行需用户另行批准。
