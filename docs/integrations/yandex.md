# Yandex Market 集成方案（Read-First 调研）

> 状态：**已实现（2026-09-18，read-first 范围）**——`apps/api/src/modules/integration/yandex/`（client/adapter/mapper/cursors/module + 契约测试 + 仓库目录服务）与 webhook 链 `POST /api/v1/webhooks/yandex/stores/:storeCode`（IP 白名单 + PING 秒回 + 定向回读）。
> 未实现（按 §8 T0 结论）：FBY 平台仓自动化（手动录入）、全量类目树、历史订单补录（30 天前）。状态×substatus 映射表待 T0 用真实样本校准。
> T0 冒烟脚本：`scripts/yandex-t0-smoke.ts`（只读，需 dev 库配置 ACTIVE YANDEX MAIN_API 凭证；多 campaign 令牌凭证需带 campaignId）。
>
> 事实来源：Yandex Market Partner API 官方文档 `https://yandex.ru/dev/market/partner-api/doc/en/`（各方法页以官方 markdown 源直接核对，含 llms.txt 索引）——**验证日期 2026-09-18**。未核实项显式标注，不进入生产假设（AGENTS.md §88）。

## 1. 认证（已验证）

- **推荐：`Api-Key: <token>` 请求头**。卖家在 Market 卖家后台直接创建（无 OAuth 流程）、**永久有效**、可按方法组配置访问权限、覆盖柜面（business）下全部店铺。
- 旧 OAuth2（`Authorization` 头，1 年期）已标注过时，不建议。
- 凭证 payload 形态：`{ "apiKey": "<token>", "campaignId"?: "<id>" }`。
- 两个关键 ID（均在路径参数中）：`businessId` = 柜面（business）ID；`campaignId` = 店铺（campaign）ID。**`GET /v2/campaigns` 一次返回该 token 可访问的全部店铺**（含两类 ID）→ 天然的 validateCredential 调用。
  - **T0 校准（2026-09-18 live）**：真实响应里 businessId 是**嵌套对象** `business: {id, name}`，不是平铺的 `businessId`；每行还有 `clientId` / `placementType`（FBS/FBY）/ `apiAvailability`。
  - **注意编号混淆**：卖家后台「API 通知」店铺下拉里显示的 `partnerId`（如 216881164）是另一套编号，**不出现在 API 响应中**——凭证 campaignId 必须用 API 返回的 `campaigns[].id`（如 149159324）。
- Base URL：`https://api.partner.market.yandex.ru`。

## 2. 限流（已验证）

- **全局并发上限 4 个同时请求**（按 campaignId/businessId 归属计量）。
- 资源级长窗口限额：按方法页标注（如订单类 `10 000 req/hour`、类目树 `50 req/hour`、退货 `5 000 req/hour`、offer-mappings `100 req/min` 无订阅 / `600` Medium）。
- **超限返回 HTTP `420 Enhance Your Calm`**（不是 429！client 的错误归一化必须把 420 映射为 PLATFORM_RATE_LIMITED）；响应头 `X-RateLimit-Resource-Limit/-Until/-Remaining`；2xx 与 4xx 扣减额度，5xx 不扣。
- 请求体上限 **512 KB**（超出 400）。
- 错误体：`{ status: 'OK'|'ERROR', errors: [{code, message}] }`；401/403 为凭证/权限错误。

## 3. 订单（已验证）

- **主接口：`POST /v1/businesses/{businessId}/orders`**（柜面级，聚合柜面下全部店铺）。v2 campaign 级 `GET /v2/campaigns/{campaignId}/orders` 已宣布废弃（2027-01 起不稳定、2027-04 停用）——**新代码必须直接用 business 级**。
- 请求：query `limit`（≤50，无默认值）+ `pageToken`；body `dates{creationDateFrom/To ≤30 天, updateDateFrom/To}`、`statuses[]`、`programTypes[]`（FBY/FBS/DBS/EXPRESS/LAAS）、`orderIds[]`（≤50，可做定向回读）等（数组过滤 1–50 个）。
- 响应 `orders[]`（≤50/页，`paging.nextPageToken` 游标）：`orderId, campaignId, programType（=履约方式事实）, externalOrderId, status, substatus, creationDate, updateDate, prices, buyerType, items[]{id, offerId（=卖家 SKU 标识）, offerName, count, prices, instances[]{cis,uin,...}, itemStatuses}, delivery{type, dates, shipment{shipmentDate}, tracks, deliveryPartnerType}`。
- `status` 枚举：`PLACING, RESERVED, UNPAID, PROCESSING, DELIVERY, PICKUP, DELIVERED, CANCELLED, PENDING, PARTIALLY_RETURNED, RETURNED, UNKNOWN`；substatus 含 `STARTED/READY_TO_SHIP/SHIPPED`（PROCESSING 下）与取消原因族。
- **30 天边界**：已送达/已取消超过 30 天的订单不再从该接口返回 → 历史补录用 `POST /v2/campaigns/{campaignId}/stats/orders`（对齐 OZON 的「3 个月前走归档」限制）。
- 买家信息：仅 DBS 模式返回 `buyer`；电话需单独接口（本期不接）。
- 限流：`10 000 req/hour`（business orders）。

## 4. Webhook / 推送（已验证）——与 OZON 链路高度同构

- **订阅方式：卖家后台 UI 配置**（设置 → «API 和模块» → «API 通知»），不是 API 订阅。填写回调 URL（必须 HTTPS + CA 证书）+ 选择事件类型 + 柜面/店铺范围。
- **回调**：`POST <你的URL>`，body `application/json`，`notificationType` 枚举 17 种：`PING, ORDER_CREATED, ORDER_CANCELLED, ORDER_STATUS_UPDATED, ORDER_RETURN_CREATED, ORDER_CANCELLATION_REQUEST, ORDER_RETURN_STATUS_UPDATED, ORDER_UPDATED, ...`（评价/聊天/争议类为柜面级）。订单类 payload 含 `campaignId, orderId, items[]{offerId,count}, status, substatus, updatedAt, createdAt` 等。
- **应答**：`200` + `{ version, name, time }`（name=集成名 1–100 字符，time=UTC ISO8601）——**与 OZON 的应答格式 `{version,name,time}` 同构**（OZON: version '2.0'）。PING 校验必须在 **1 秒**内应答（否则启用失败）；常规通知超时 **10 秒**；无效通知回 `400`（type: UNKNOWN/WRONG_EVENT_FORMAT/DUPLICATED_EVENT），自身故障回 `500`。
- **重试**：超时/非 400 失败 → 暂停后续通知并重试（第 1 小时每分钟 → 第 1 天每 15 分钟 → 之后每小时）；**连续 14 天不可达则解除集成需手工重连**——因此回调入口必须「快速返回 + 异步处理」，且轮询兜底不可省。
- 安全：无签名；官方建议按来源 IP 段白名单校验：`5.45.207.0/25, 141.8.142.0/25, 5.255.253.0/25`。
- 映射到现有链路：新增 `POST /api/v1/webhooks/yandex/stores/:storeCode`（PING 应答 + 其余事件存 `external_raw_events` + 入队 + `fetchOrdersByPlatformIds` 定向回读 `orderIds`）——与 OZON 链路逐环节对应。

## 4b. 买家侧：聊天 / 评价 / 提问（2026-11-02 核对 + 实测）

**推送类型**（`notificationType`，官方 push-notifications 文档 18 种；买家侧 7 种）：

```text
CHAT_CREATED            {businessId, chatId, createdAt}
CHAT_MESSAGE_SENT       {businessId, chatId, messageId, sentAt}
CHAT_ARBITRAGE_STARTED  {businessId, chatId, startedAt}
CHAT_ARBITRAGE_FINISHED {businessId, chatId, finishedAt}
GOODS_FEEDBACK_CREATED  {businessId, feedbackId, createdAt, publishedAt}
GOODS_FEEDBACK_COMMENT_CREATED
QUESTION_CREATED（另有 QUESTION_ANSWER_CREATED / QUESTION_COMMENT_CREATED）
```

载荷只有 id + 时间戳 → WCIES 一律当「去拉一次」的触发器，回读下列接口取事实。
接收器复用现有 `POST /api/v1/webhooks/yandex/stores/:storeCode`（IP 白名单 +
`{version,name,time}` 应答），**不需要新建入口**；只需在柜面「API 通知」勾选这些
类型（柜面操作，不是平台写接口）。

| 能力 | 端点 | 关键事实（实测/规范） |
|---|---|---|
| 会话列表 | `POST /v2/businesses/{businessId}/chats?limit=` | **limit 上限 20**（50 会 400 `Parameter limit must be less than or equal to 20`）；`type=CHAT|ARBITRAGE`；`status=WAITING_FOR_PARTNER` 即「等我们回复」；`chatId` 是 **int64** |
| 会话消息 | `POST /v2/businesses/{businessId}/chats/history?chat_id=&limit=` | body `{messageIdFrom}` 增量（int64）；消息 `{messageId, createdAt, sender: PARTNER|CUSTOMER|MARKET|SUPPORT, message, payload[]}` |
| 评价 | `POST /v2/businesses/{businessId}/goods-feedback?limit=` | body `{dateTimeFrom, dateTimeTo}`（≤6 个月）；`ratingValues` 是**整数数组 1-5**（不是字符串）；`reactionStatus=NEED_REACTION` 可只看未反应；返回 `result.feedbacks[]`（`feedbackId/createdAt/needReaction/author/description{advantages,disadvantages,comment}/statistics{rating,commentsCount}`） |
| 提问 | `POST /v1/businesses/{businessId}/goods-questions?limit=` | body `{dateFrom, dateTo}` 是**日期**且窗口 ≤1 个月；`result.questions[]`（`questionIdentifiers{id,offerId}`、`text`、`createdAt`）；答案在独立接口 |
| 退货 | `GET /v2/campaigns/{campaignId}/returns?limit=` | **信封是 `{status, result:{returns, paging}}`**——2026-11-02 修掉了「读顶层 returns」的 bug（此前每次同步都报 `returns array missing`，退货提醒空跑） |

`businessId` 在 `/v2/campaigns` 里是 `campaign.business.id`（嵌套，不是平铺 `businessId`）。

映射约定（`yandex.mapper.ts`）：`CUSTOMER` → IN、`PARTNER` → OUT、`MARKET/SUPPORT` → SYSTEM；
`WAITING_FOR_PARTNER` 映射为 `unreadCount=1`（Yandex 没有未读数字段）；评价正文由
comment/advantages/disadvantages 拼装，`parentSku` 取 `identifiers.offerId`。

WCIES 侧：轮询兜底（聊天 10 分钟 / 评价 30 分钟 / 提问 10 分钟 / 退货 15 分钟）+
推送触发；评价只提醒 1-3 星，4-5 星只落库。

## 5. 商品 / Listing（已验证）

- `POST /v2/businesses/{businessId}/offer-mappings`：query `limit`（1–100，默认 50）+ `pageToken`；body `offerIds[]`（≤100，指定时不允许分页参数）、`cardStatuses[]`（`HAS_CARD_*`/`NO_CARD_*` 枚举）、`archived` 等。
- `result.offerMappings[]`：
  - `offer`：`offerId`（=卖家 SKU 标识，255 字符内）、`name`、`marketCategoryId`、`pictures`、`vendor`、`barcodes`、`weightDimensions{length,width,height(cm),weight(kg)}`、`cardStatus`、**`campaigns[]{campaignId, status}`（`PUBLISHED/CHECKING/DISABLED_BY_PARTNER/REJECTED_BY_MARKET/CREATING_CARD/NO_CARD/NO_STOCKS/ARCHIVED/READY_FOR_PUBLICATION` = 上下架/发布状态事实）、`sellingPrograms[]{sellingProgram: FBY|FBS|DBS|EXPRESS|LAAS, status: FINE|REJECT}`（= 履约模式事实）**、`archived`。
  - `mapping`：`marketSku`（=平台 SKU ID，供内部 SKU 映射）、`marketCategoryName`。
- 限流：100 req/min（无订阅）。
- 商品图 = `pictures` 自带（无需独立图片接口）；规格 = `weightDimensions` 自带（无需独立增强同步）。
- **尺寸重量预填（2026-10-05 已实现）**：listing 同步把 `offer.weightDimensions` 规范化为变体
  `platform_listing_skus.raw_data.product_attributes`（`dimension_unit:'cm'` + `depth/width/height`、
  `weight_unit:'kg'` + `weight`；Yandex `length` = 包裹长边 → OZON 风格 `depth` 键）。
  单位依据 = 仓库内官方 OpenAPI `OfferWeightDimensionsDTO`（cm/kg）。建档并映射弹窗经
  onboard-context 读取预填；全有全无（三维不齐只保留重量），非正数视为缺失。
  变体行 raw_data 由 listing 同步整体刷新，product_attributes 每次随同步自愈，无需增强同步。
- **订单行商品图（2026-09-28，已实现）**：Yandex business-orders 行内没有 `marketSku`（见 §8.3），
  无法走 OZON 式 `fetchProductImages(platformSkuId)` 链路。改为纯 DB 反查：订单行 `seller_sku`（=offerId）
  → 本店铺 `platform_listing_skus` → Listing `raw_data.offer.pictures[]`（vendored 官方规范
  `GetOfferMappingDTO.offer.pictures`：**纯 URL 字符串数组，第一条即主图**；未核实到买家照片类接口，
  Partner API 不存在普通订单照片端点）。同一 offerId 挂多条链接时取最新 Listing 先到先得；
  发起零平台 API 调用。代码：`yandex.mapper.extractYandexOfferImageUrl` +
  `OrderSyncService.resolveYandexImages`。

### 5b. 商品页公开 URL（2026-10-22 实测修正）

**唯一可靠来源 = offer-mappings 的 `showcaseUrls[].showcaseUrl`**（官方 OpenAPI
`GetOfferMappingDTO.showcaseUrls`，`{showcaseType, showcaseUrl}`）。listing 同步把它
写入 `platform_listings.url`，订单页「打开商品链接」优先用这个值。

格式形如：

```text
https://market.yandex.ru/card/slug/5817028070?businessId=193261685
```

三点实测结论（都在真实店铺上验证过）：

1. **路径里的 `slug` 是占位段**，填什么都路由（`card/x/<id>` 一样打开），
   所以不要费劲复刻俄文转写。
2. **`marketSku` 不是公开页面 id**。曾按「slug + marketSku」拼链接：多数卡片能开，
   但部分卡片直接 404（实证：`marketSku=6087881269` 的 MCHOSE 卡片，
   平台给的 showcaseUrl 是 `5817028070`，用 marketSku 拼的地址 404）。
3. `marketModelId` 同样不可用于拼链接（实测 404）。

因此代码里 **不再拼 Yandex 卡片地址**：`listing.url` 为空时退回 Market 搜索页
（`search?text=<商品名>`），保证永远可点。缺标题才返回 null 并提示，不猜（§88）。

### 5d. 运单号与面单（2026-10-22 建档，2026-10-23 用真实面单校正）

**FBS 没有独立的承运商运单号。** 买家面单（卖家后台与 API 拿到的是同一份）上只有两个号：

| 面单字段 | 值 | 含义 |
|---|---|---|
| номер заказа | 63259683777 | 订单号 |
| номер грузоместа | 63259683777-1 | 货位号（`boxesLayout[].barcode`），= `<订单号>-<箱号>` |

官方 spec 里 `OrderTrackDTO` 明确标注「Информация о трек-номере посылки **(DBS)**」，
`OrderShipmentDTO.tracks` 也写「仅 DBS」——FBS 订单实测 113 单全为空。
承运商名（如 GTA-GUOO COMBI）来自 `deliveryServiceId`，不是运单号。

因此 `mapOrderToOrder` 的取值顺序是 **DBS `tracks[].trackCode` 优先，否则用货位号
`boxesLayout[].barcode`**（多箱取第一箱）。落库字段仍是 `orders.platform_tracking_no`，
值形如 `63259683777-1`，与面单完全对应。此前只有手工点「获取运单号」才读一次，
轮询/webhook 从不刷新；现在每次同步都会收敛（null 不覆盖已有值）。

- **面单**：`GET /v2/campaigns/{campaignId}/orders/{orderId}/delivery/labels`
  **逐单**，返回 1 页 PDF，实测 **212×283pt ≈ 75×100mm 竖版**——与卖家后台打印的
  面单逐字一致（2026-10-23 用订单 63259683777 比对截图确认）。
  `format` 参数（A9_HORIZONTALLY / A9 / A7）在该账号上**返回同一份文件**，
  即尺寸由账号/店铺配置决定，代码里继续传 A9_HORIZONTALLY 但不依赖它。
- 没有同步批量接口。
- 面单在 `READY_TO_SHIP` 后即可取，适配器声明 `labelReadyAfterPrepare=true`，组包成功
  即入队预取。
- 批量能力只有异步报表 `POST /v2/reports/documents/labels/generate`
  （`{businessId, orderIds[] ≤1000, sortingType}` → 返回报表 id，需轮询状态再下载），
  **尚未实现**；当前批量打印走逐单取单。

### 5c. 订单行图片的时序（2026-10-22）

图片只能从 listing（`offer.pictures`）来，所以 **listing 必须先于订单存在**。
新店铺常见「先摄入订单、后跑 listing 同步」——那批历史订单不会再被订单同步的
增量窗口捞到，`platform_image_url` 会永久为空。因此 listing 同步完成后
（`ListingSyncProcessor`）会立即对本店铺做一次订单行图片回补
（`OrderSyncService.enrichPlatformImages`，异常自吞不影响同步结果）。

## 6. 其余能力（对齐 OZON 范围的逐项核对）

| OZON 能力 | Yandex 对应物 | 状态 |
|---|---|---|
| 凭证验证 pingCredential | `GET /v2/campaigns`（返回 token 可访问的店铺全集） | 已验证 |
| Listing 同步 | `/v2/businesses/{businessId}/offer-mappings` pageToken 分页 | 已验证 |
| 订单同步 | `POST /v1/businesses/{businessId}/orders`（pageToken + 30 天窗） | 已验证 |
| 订单定向回读 | 同接口 body `orderIds[]`（≤50） | 已验证 |
| webhook | 后台 UI 配置 + 17 事件 + PING/10s/应答 {version,name,time} | 已验证 |
| 退货同步 | `GET /v2/campaigns/{campaignId}/returns`（limit≤100，pageToken，refundStatus/shipmentStatus 枚举完整，items[].marketSku/shopSku） | 已验证 |
| 商品图片/增强 | offer-mappings 自带 pictures/weightDimensions/characteristics 等价物 | 已验证（无需独立接口） |
| 类目树 | `POST /v2/categories/tree`（整树一次返回 `{id,name,children}`；**官方已标弃用倾向**）；替代：offer-mappings 自带 `marketCategoryId/Name`（按商品自带，无需全树） | 已验证（建议：首发不做全树同步，走 offer 自带类目） |
| 平台仓库列表 | `GET /v2/businesses/{businessId}/warehouses`（**覆盖 FBS/DBS/Express 卖家侧仓；FBY 平台仓未在返回结构中出现**） | 已验证 + **缺口**（见 §8） |
| **发货流程平台写** | **官方 OpenAPI 已核对并落盘（2026-09-18，见 §9 与 docs/yandex-partner-api-openapi.json）**：`PUT /v2/campaigns/{id}/orders/{orderId}/status` → `PROCESSING/READY_TO_SHIP`；面单 `GET …/orders/{orderId}/delivery/labels` 直接回 PDF 二进制 | **已实现（2026-09-18，T0 待实测）**：`prepareShipment`=先读后写（仅 `STARTED`→`READY_TO_SHIP`；平台已推进的子状态不回写）；`fetchShippingLabel`=A9_HORIZONTALLY(58×40) PDF，未生成映射为“面单未就绪” |

## 7. 代码级落地点（复用 OZON 骨架）

1. `packages/platform-contracts`：`PLATFORM_CODES` 对齐 DB 种子 `['OZON','WB','YANDEX']`（同 WB 方案 §7.1），适配器 `platformCode = 'YANDEX'`。
2. 新增 `apps/api/src/modules/integration/yandex/`：
   - `yandex.client.ts`：`Api-Key` 头、单域名、**420 → PLATFORM_RATE_LIMITED**（OZON 是 429）、4 并发全局闸（client 内信号量，与每 store 限流并存）、错误体 `{status,errors[]}` 归一化。
   - `yandex.adapter.ts`：`validateCredential` = `GET /v2/campaigns`；`fetchListings` = offer-mappings pageToken；`fetchOrders` = business orders（游标 kind：`YX_PAGE_TOKEN` + 30 天窗口 `YX_ORDER_WINDOW{from,to,pageToken}`；`updateDate` 增量）；`fetchOrdersByPlatformIds` = body `orderIds[]`；`processWebhook` = 事件映射（ORDER_CREATED/ORDER_STATUS_UPDATED/ORDER_CANCELLED/ORDER_UPDATED → 定向回读；RETURN_* → 退货事实）；`fetchReturns` = getReturns 游标。
   - `yandex.mapper.ts`：status→PLATFORM_ORDER_STAGES（`PROCESSING→AWAITING_SHIPMENT`（substatus SHIPPED→按发货事实）、`DELIVERY/PICKUP→IN_TRANSIT`、`DELIVERED→DELIVERED`、`CANCELLED→CANCELLED`；映射表在 T0 用真实 status×substatus 样本校准）；`programType` FBY→`YANDEX_FBY`、FBS/DBS→`YANDEX_FBS`（fulfillmentMode 枚举已有）；`items[].offerId`→offerId/sellerSku、`mapping.marketSku`→platformSkuId（需 offer-mappings 反查一次建立 orderId→marketSku 素材，T0 决定缓存策略）。
   - `types/cursors.ts` + `yandex.module.ts`（registry.register）。
3. **发货写能力（2026-09-18 已实现）**：`yandex.client.ts` 传输层增 **raw 字节模式**（`PUT` 加入 method 联合）+ `updateOrderStatus`/`orderLabels`；新 `yandex-shipment.service.ts`（先读后写、`YX_ORDER_NOT_PREPARABLE`、`LABEL_FORMAT=A9_HORIZONTALLY`）；`yandex.adapter.ts` 实现 `prepareShipment`/`fetchShippingLabel`（经 `resolveIdentityForContext` 拿 campaignId）；凭证解析抽到 `yandex-auth.ts`（避免 adapter↔service 循环，同 OZON）。
4. Webhook：新增 `ozon-webhook.controller` 同款 `POST /api/v1/webhooks/yandex/stores/:storeCode`——PING 1 秒内回 `{version:'1.0.0', name:'WCIES', time}`；订单类事件 → raw events → 定向回读（body orderIds）；IP 白名单校验（三段）；轮询调度器保持为兜底（14 天不可达解除集成的风险要求 webhook 故障可观测）。
4. 平台仓库：`PlatformWarehouseQueryService` 按 platformCode 分发；Yandex 返回 FBS/DBS 卖家侧仓（fulfillmentMode `YANDEX_FBS`）。**FBY 仓不在数据源中**（见 §8）。
5. 前端：`PLATFORM_CREDENTIAL_SPECS` YANDEX 行去掉「尚未接入」；凭证 payload 单 `apiKey`（needsClientId=false 已兼容）。

## 8. 缺口与 T0 验证清单（实现前用真实 Api-Key 冒烟）

| # | 事项 | 性质 | 备选/处理 |
|---|---|---|---|
| 1 | **FBY 平台仓列表**：warehouses 接口未包含 FBY 仓 | 数据源缺口 | 首发仅支持 YANDEX_FBS 仓绑定；FBY 用手动录入平台仓 ID（绑定模型已支持 remark_name）+ 人工确认；后续验证 `POST /v2/businesses/{businessId}/warehouses`（paged 版，带 outgoing/offices 字段）是否含 FBY |
| 2 | 状态映射表校准：`PROCESSING×substatus` 与阶段锚点字段需真实样本 | 精度 | T0 拉真实订单样本回填映射表（OZON 同款流程） |
| 3 | orderItems 的 platformSkuId：business orders 行内无 `marketSku`，需以 `offerId` 反查 offer-mappings 的 `mapping.marketSku` | 设计决策 | T0 验证反查成本；或 listing 同步先行建立 offerId→marketSku 映射缓存（推荐，与 OZON 的 offer_id→sku 素材同构） |
| 4 | 30 天前历史订单 | 接口限制 | 需要历史补录时用 `POST /v2/campaigns/{campaignId}/stats/orders`（首发不做，与 OZON 归档限制同级别的已知边界） |
| 5 | `v2/categories/tree` 弃用倾向 | 技术风险 | 首发不做全树类目同步（商品自带 marketCategoryId/Name 已满足展示） |
| 6 | webhook 事件 `ORDER_CREATED` payload 示例文档笔误（示例 notificationType 均为 PING 占位） | 文档噪声 | T0 用真实回调样本确认各事件 payload 实形 |

### 8.1 发货流程 T0 项（§9 实现/实测前）

1. 对已处于 `READY_TO_SHIP` 的订单重复 `PUT …/status` 的返回（幂等性）。
2. `delivery/labels` 对未备货完成订单的真实报错（映射“面单未就绪”）。
3. `format` 缺省（A7）与 A4 的实际排版。
4. FBS 订单在 `PROCESSING/STARTED` 前置状态下直接写 `READY_TO_SHIP` 是否被 400 拒绝。

## 9. 发货流程平台写能力（2026-09-18 官方 OpenAPI 核对；未实现）

> 事实来源：Yandex 官方 OpenAPI 规范仓库
> `github.com/yandex-market/yandex-market-partner-api`（commit `8b32780df5`，2026-09-18），
> 已打包成单文件落盘 **`docs/yandex-partner-api-openapi.json`**（1.24 MB，
> 159 路径 / 849 schemas，外部 $ref 全部内联为 `#/components/...`，可直接 grep）。
>
> ⚠ 本节是**规范核对**，尚未对真实账号执行（AGENTS.md §92）。

### 9.1 基础（与现有实现一致）

- Base：`https://api.partner.market.yandex.ru`
- 鉴权：`Api-Key` 请求头（securitySchemes 同时列出 OAuth，我们用 Api-Key）
- 该组方法限流：`x-resource-limit-config` = **10000 次 / 1 小时**（none 与 medium 档相同）

### 9.2 状态回写（“组包/发货”）

**`PUT /v2/campaigns/{campaignId}/orders/{orderId}/status`**（operationId
`updateOrderStatus`；tags `orders, fbs, dbs, laas, express`）

```json
{ "order": { "status": "PROCESSING", "substatus": "READY_TO_SHIP" } }
```

- body = `UpdateOrderStatusRequest`：必填 `order.status`
  （`OrderStatusType`），可选 `order.substatus`（`OrderSubstatusType`）、
  `order.delivery`（`OrderStatusChangeDeliveryDTO`）。
- 规范明确列出的允许迁移（DBS 语义，tags 含 fbs）：
  1. `PROCESSING/STARTED` → **`PROCESSING/READY_TO_SHIP`**（已确认并备货完成，可发货）
  2. `PROCESSING/STARTED` → `CANCELLED/SHOP_FAILED`（确认了但无法履约）
  3. `PROCESSING/READY_TO_SHIP` → `CANCELLED/SHOP_FAILED`（备货后发现无法履约）
- 完整状态模型见规范链接的概念页 `dbs-order-status-model.md`。
- **没有**“标记已送达”之类把订单推到 `DELIVERY/DELIVERED` 的卖家写接口——
  那些状态由平台物流事实产生，我们继续按只读事实同步（§3）。
- 响应：200 返回 `UpdateOrderStatusResponse`（更新后的订单信息）；错误
  400/401/403/404/**420（限流）**/500，与现有错误归一化一致（§2）。

### 9.3 面单

**`GET /v2/campaigns/{campaignId}/orders/{orderId}/delivery/labels`**
（operationId `generateOrderLabels`；tags `order-labels, fbs, dbs, express`）

- 可选 query `format` = `PageFormatType`：`A9_HORIZONTALLY`（58×40mm 无边距）、
  `A9`、`A7`（**缺省值**）、`A4`。
- **200 直接返回 `application/pdf` 二进制**（schema `string format: binary`）——
  与 OZON 面单“规范自相矛盾”不同，这里规范就是干净的二进制下载。
- 另有 **`GET …/delivery/labels/data`**（`getOrderLabelsData`）返回 JSON 的
  标签数据，供自行排版打印；以及按箱的
  `GET /v2/campaigns/{campaignId}/orders/{orderId}/delivery/shipments/{shipmentId}/boxes/{boxId}/label`。
- 若要在面单上显示外部订单号，先调
  `POST /v2/campaigns/{campaignId}/orders/{orderId}/external-id`。

### 9.4 其他相关（本次不实现，仅登记）

| 端点 | 说明 |
|---|---|
| `POST /v2/campaigns/{campaignId}/orders/{orderId}/delivery/track` | **传跟踪号**（`setOrderDeliveryTrackCode`，DBS 自送场景） |
| `POST /v2/campaigns/{campaignId}/orders/{orderId}/identifiers/status` | `getOrderIdentifiersStatus`，标记校验码状态（**读语义的 POST**） |
| `PUT /v2/campaigns/{campaignId}/shipments/{shipmentId}/status` 相关 | FBS **供应单（отгрузка）** 流程：`/first-mile/shipments` 家族（`…/act`、`…/confirm`、`…/pallet-labels`、`…/transportation-waybill`）——Yandex 的“发货”也可按**批量供应单**走，与 WB 类似；按单走 9.2 即可满足我们的流程 |

### 9.5 与 WCIES 契约的映射（已实现 2026-09-18）

- `prepareShipment(orderId)` → `PUT …/orders/{orderId}/status`
  `{order:{status:"PROCESSING", substatus:"READY_TO_SHIP"}}`；实现按“先读后写”：
  仅 `PROCESSING/STARTED` 才写；已在 `READY_TO_SHIP`、平台已推进的子状态
  （SHIPPED/PACKAGING…）或后续物流阶段一律 `alreadyPrepared` 不写；
  CANCELLED/PENDING/UNPAID 等显式报错（`YX_ORDER_NOT_PREPARABLE`）。
- `fetchShippingLabel(orderId)` → `GET …/delivery/labels?format=A9_HORIZONTALLY`
  （58×40mm，与 WB 贴纸同尺寸，热敏打印机通用；换纸张只改
  `yandex-shipment.service.ts` 的 `LABEL_FORMAT` 一个常量），二进制 PDF 直接落对象存储；
  平台未生成时（400/404/409）映射为“面单未就绪”。
- FBY（平台仓）订单本就不进拣货（`isExternalFulfillmentMode`），不调用写接口。

## 订单金额（2026-11-07 修正：prices 各项之和）

**用户口径（2026-11-07，取代 2026-10-24 的 payment+cashback）**：
`order_items.unit_price` = `prices` 下**所有金额项之和**——`payment`、`cashback`、
`subsidy`、`delivery` 等凡是 `{value, currencyId}` 形状的字段都计入；`vat`
这类非对象字段忽略；一个金额项都没有时为 `null`（不猜）。

```text
payment 387.61 + subsidy 129.14 + cashback 3.26 = 520.01
```

- 实现：按「分」累加避免浮点误差（`yxGoodsAmount`），`total_price = unit_price × quantity`；
- 迁移 `20261107_001` 已按 `raw_data.prices` 重算全部存量 Yandex 明细；
- `orders.currency` 取金额项的 `currencyId`（payment 优先，其次 cashback/subsidy），
  `RUR` 归一化成 `RUB`；`payment` 缺失也能从其它金额项取币种；
- 金额单位是店铺币种，不做汇率换算（显示原币；最近采购价恒为 CNY）。
