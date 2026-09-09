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
| Webhook 无签名机制 | 官方文档与所有已知开源实现均无验签 API | 2026-09-09 |
| 真实凭证实测 | **未验证**（待用户批准 Smoke Test） | - |

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

Request：`{offer_id: string[]}`；Response：`{result:{items:[{id, name, offer_id, sku:int64, is_archived, is_autoarchived,...}]}}`。
用于补充 `name`（标题）与 `sku`（OZON SKU id）。每批 100（保守值；官方上限未在本规范中找到明确数字，**未验证**）。

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
- WCIES 策略（OzonClient，位于 Integration 层）：
  - **按店铺隔离**的最小请求间隔（`OZON_MIN_REQUEST_INTERVAL_MS`，默认 110ms ≈ 9 req/s/store）；店铺 A 触发限流不影响店铺 B。
  - HTTP 429 → `PLATFORM_RATE_LIMITED`，尊重 `Retry-After`（秒数或 HTTP-date），指数退避上限 60s。
- 真实配额待 Smoke Test 后回填。

## 5. 重试与错误归一化

| 场景 | 归一化 code | 重试 |
|---|---|---|
| 401/403 | `PLATFORM_AUTH_ERROR` | 否（凭证问题） |
| 429 | `PLATFORM_RATE_LIMITED` | 是（Retry-After 优先） |
| 5xx | `PLATFORM_API_ERROR` | 是（指数退避 500ms→15s，最多 `OZON_MAX_RETRIES` 默认 3） |
| 超时（默认 30s）/ 网络错误 | `PLATFORM_TIMEOUT` / `PLATFORM_NETWORK_ERROR` | 是 |
| 400/其他 4xx | `PLATFORM_API_ERROR` | 否（确定性错误） |
| 200 但响应非法 | `PLATFORM_BAD_RESPONSE` | 否 |

错误对象保存：HTTP status、`x-request-id`（如有）、endpoint 名、storeId、消息（脱敏）。**绝不**包含 Client-Id/Api-Key/Authorization。

## 6. Webhook 能力（官方确认支持，已实现）

- 配置入口：OZON 卖家后台（Settings → Push notifications）或 `POST /v1/notification/set {types:[...], url}`。
- WCIES 接收地址（配置到 OZON 后台的 URL）：

  ```text
  POST {PUBLIC_BASE}/api/v1/webhooks/ozon/stores/{storeCode}
  ```

  （每店铺一个 URL 段；本机开发需公网可达，如内网穿透。）

- 事件类型（官方枚举）：`TYPE_NEW_POSTING`、`TYPE_POSTING_CANCELLED`、`TYPE_STATE_CHANGED`、`TYPE_STOCKS_CHANGED`、`TYPE_CREATE/UPDATE/CREATE_OR_UPDATE_ITEM`、聊天类、`TYPE_PING`。
- **消息体**：`{message_type, ...事件字段}`；NEW_POSTING 只带 `posting_number + products[{sku,quantity}] + seller_id + warehouse_id + in_process_at` —— **不含订单完整事实**。
- **无签名机制**（官方无验签 API）。WCIES 的身份保障三层：
  1. URL 内 storeCode 与店铺一一对应；
  2. `payload.seller_id` 必须等于该店铺凭证 `clientId`，不匹配 → raw event `REJECTED`（仍回 200 防重试风暴）；
  3. Webhook 仅是提示：处理器用已认证 API 回读 posting 原文后才入库。
- 幂等：无事件 ID → 按 `(store, sha256(canonical payload))` 去重（`external_raw_events` 唯一索引）。
- 期望响应：`{"result": true}`（非 WCIES envelope；非 2xx OZON 会重试）。
- 处理流：校验形状 → 存 raw event（PENDING）→ 入 `wcies.webhook` 队列 → 立即 200。HTTP 请求内**不**建单、**不**锁库存、**不**调用平台 API。

## 7. 平台 ID 语义（关键）

| ID | 含义 | WCIES 用法 |
|---|---|---|
| `product_id` | OZON 商品（页）ID | listing 主键维度 (store, product_id) |
| `sku` | OZON SKU（商品实体）ID | `platform_listing_skus.platform_sku_id`；订单行反查键 |
| `offer_id` | 卖家自定义货号（可改） | 辅助标识；人工对账用 |
| `order_id` / `order_number` | OZON 订单（可拆多个 posting） | 仅存于 raw_data，**不**作唯一键 |
| `posting_number` | 发货单号（履约单位，稳定） | `orders.platform_order_id` 业务唯一键 |
| `seller_id` | 卖家账号 ID = Client-Id | Webhook 身份校验 |

## 8. 已知限制 / 坑

1. `ON CONFLICT` 部分唯一索引 + TypeORM `TableIndex({unique,where})` 会**静默丢 UNIQUE**（本 Sprint 踩过，已改 raw SQL；见 20260911_002/004）。
2. pg 驱动 `UPDATE ... RETURNING` 经 TypeORM `query()` 返回 `[rows, rowCount]` 二元组（与 INSERT 不同），判断行数必须归一化。
3. `/v3/product/list` 无 has_more —— 必须用「页满 + last_id 变化」推断；last_id 不变时务必停止，否则死循环。
4. Webhook 无签名 + 仅店铺级 URL：绝不能在 webhook 请求内做写操作；一切事实以 API 回读为准。
5. OZON 文档站点 antibot 较强，抓取验证需搜索缓存/开源实现交叉核对，禁止凭记忆写字段。
6. FBO/FBP 订单、价格/库存推送、平台发货写操作：本 Sprint 明确禁止（Read-first）。

## 9. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OZON_API_BASE_URL` | `https://api-seller.ozon.ru` | 集成测试指向本地 mock server |
| `OZON_TIMEOUT_MS` | 30000 | 单请求超时 |
| `OZON_MAX_RETRIES` | 3 | 可重试错误的最大重试次数 |
| `OZON_MIN_REQUEST_INTERVAL_MS` | 110 | 每店铺最小请求间隔（限流） |
| `ORDER_SYNC_INTERVAL_SECONDS` | 0（关） | 订单轮询频率（≥60s；需店铺 settings.sync.orderSyncEnabled） |
| `LISTING_SYNC_INTERVAL_SECONDS` | 0（关） | Listing 同步频率（≥300s；需店铺 opt-in） |

## 10. Real Smoke Test

**未执行（NOT RUN）** —— 按任务书 §55/§56，须在自动化测试全部通过后由用户明确批准，且仅限 1 个店铺的 Credential Validation + Fetch Listings + Fetch Orders 只读验证。测试凭证见本地文件 `docs/ozon test info.txt`（未入库）。
