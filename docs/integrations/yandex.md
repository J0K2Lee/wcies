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

## 5. 商品 / Listing（已验证）

- `POST /v2/businesses/{businessId}/offer-mappings`：query `limit`（1–100，默认 50）+ `pageToken`；body `offerIds[]`（≤100，指定时不允许分页参数）、`cardStatuses[]`（`HAS_CARD_*`/`NO_CARD_*` 枚举）、`archived` 等。
- `result.offerMappings[]`：
  - `offer`：`offerId`（=卖家 SKU 标识，255 字符内）、`name`、`marketCategoryId`、`pictures`、`vendor`、`barcodes`、`weightDimensions{length,width,height(cm),weight(kg)}`、`cardStatus`、**`campaigns[]{campaignId, status}`（`PUBLISHED/CHECKING/DISABLED_BY_PARTNER/REJECTED_BY_MARKET/CREATING_CARD/NO_CARD/NO_STOCKS/ARCHIVED/READY_FOR_PUBLICATION` = 上下架/发布状态事实）、`sellingPrograms[]{sellingProgram: FBY|FBS|DBS|EXPRESS|LAAS, status: FINE|REJECT}`（= 履约模式事实）**、`archived`。
  - `mapping`：`marketSku`（=平台 SKU ID，供内部 SKU 映射）、`marketCategoryName`。
- 限流：100 req/min（无订阅）。
- 商品图 = `pictures` 自带（无需独立图片接口）；规格 = `weightDimensions` 自带（无需独立增强同步）。

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
| **发货流程平台写**（2026-09-18：OZON 已实现组包 `prepareShipment` + 面单 `fetchShippingLabel`，契约与前端能力位已就位） | **缺口：仓库内无经核实的写接口事实**。本文档只覆盖读侧：`status` 词表、`substatus`（`PROCESSING` 下含 `STARTED/READY_TO_SHIP/SHIPPED`）与 `delivery.tracks` 都是**订单响应里的读字段**；`ORDER_STATUS_UPDATED` 是**平台推给我们**的入站事件，不是我们回写平台 | **T0 待验证 / 待用户提供官方文档**。需要：(1) 订单状态回写端点（方法 + 路径 + 请求体 + 错误码，Yandex 侧通常形如 `campaigns/orders/status/update`，**但仓库内无此事实，不得按记忆实现**，§88）；(2) 面单/标签获取端点与响应形态；(3) 回写允许的前置状态。拿到后按同一可选方法契约补齐，不动订单核心、不改前端 |

## 7. 代码级落地点（复用 OZON 骨架）

1. `packages/platform-contracts`：`PLATFORM_CODES` 对齐 DB 种子 `['OZON','WB','YANDEX']`（同 WB 方案 §7.1），适配器 `platformCode = 'YANDEX'`。
2. 新增 `apps/api/src/modules/integration/yandex/`：
   - `yandex.client.ts`：`Api-Key` 头、单域名、**420 → PLATFORM_RATE_LIMITED**（OZON 是 429）、4 并发全局闸（client 内信号量，与每 store 限流并存）、错误体 `{status,errors[]}` 归一化。
   - `yandex.adapter.ts`：`validateCredential` = `GET /v2/campaigns`；`fetchListings` = offer-mappings pageToken；`fetchOrders` = business orders（游标 kind：`YX_PAGE_TOKEN` + 30 天窗口 `YX_ORDER_WINDOW{from,to,pageToken}`；`updateDate` 增量）；`fetchOrdersByPlatformIds` = body `orderIds[]`；`processWebhook` = 事件映射（ORDER_CREATED/ORDER_STATUS_UPDATED/ORDER_CANCELLED/ORDER_UPDATED → 定向回读；RETURN_* → 退货事实）；`fetchReturns` = getReturns 游标。
   - `yandex.mapper.ts`：status→PLATFORM_ORDER_STAGES（`PROCESSING→AWAITING_SHIPMENT`（substatus SHIPPED→按发货事实）、`DELIVERY/PICKUP→IN_TRANSIT`、`DELIVERED→DELIVERED`、`CANCELLED→CANCELLED`；映射表在 T0 用真实 status×substatus 样本校准）；`programType` FBY→`YANDEX_FBY`、FBS/DBS→`YANDEX_FBS`（fulfillmentMode 枚举已有）；`items[].offerId`→offerId/sellerSku、`mapping.marketSku`→platformSkuId（需 offer-mappings 反查一次建立 orderId→marketSku 素材，T0 决定缓存策略）。
   - `types/cursors.ts` + `yandex.module.ts`（registry.register）。
3. Webhook：新增 `ozon-webhook.controller` 同款 `POST /api/v1/webhooks/yandex/stores/:storeCode`——PING 1 秒内回 `{version:'1.0.0', name:'WCIES', time}`；订单类事件 → raw events → 定向回读（body orderIds）；IP 白名单校验（三段）；轮询调度器保持为兜底（14 天不可达解除集成的风险要求 webhook 故障可观测）。
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
