# Wildberries 集成方案（Read-First 调研）

> 状态：**已实现（2026-09-18，read-first 范围）**——`apps/api/src/modules/integration/wildberries/`（client/adapter/mapper/cursors/module + 契约测试），注册于 `PlatformAdapterRegistry`。
> 实现范围 = 凭证验证 / Listing 同步（cards/list 游标）/ 订单同步（v3 + statistics 双源状态机）；webhook、订单定向回读、退货拉取按 §5/§8 结论**未实现**（规格未核实，T0 后补）。映射表歧义值（`postponed_delivery` 等）置 null 待 T0 校准。
> T0 冒烟脚本：`scripts/wb-t0-smoke.ts`（只读，需 dev 库配置 ACTIVE WB MAIN_API 凭证）。
>
> 事实来源与验证日期：
> 1. WB 官方文档中文镜像 `dev.wildberries.cn`（官方站，可直接访问；俄文主站 `dev.wildberries.ru` 有反爬，WebFetch 返回 498）——**验证日期 2026-09-18**；
> 2. 官方知识库（`dev.wildberries.ru/en/knowledge-base/*`，经搜索摘要核实，页面本身被反爬拦截）；
> 3. 未核实项全部显式标注「T0 待验证」，不得进入生产假设（AGENTS.md §88）。

## 1. 认证（已验证）

- 请求头 `Authorization: <token>`（无 Client ID 概念，**单 token 模式**）。
- Token 为 JWT（RFC 7519），**自创建起 180 天有效**——到期必须到卖家后台换发；凭证管理需要到期提醒（见 §6 缺口）。
- 四种类型：Personal(acc=3)/Service(acc=4)/Base(acc=1)/Test(acc=2)，卖家后台创建；Test token 仅沙箱可用。
- **新授权方案（官方文章 25.09.2025，"Transition to New API Request Authorization"）**：
  - `X-Client-Secret`（Service Secret，联系 business-solutions@rwb.ru 获取，180 天有效可重发）**只针对解决方案目录（Business Solutions Catalog）里的云服务**——用于标识「哪个服务在替卖家访问」；
  - **on-premise 豁免（对 WCIES 关键）**："a ready-made corporate solution as an on-premise version deployed on seller's servers" 视为卖家自有集成，**无需 service secret，应使用卖家 Personal Token**；
  - Personal Token = 自有集成（含 on-premise）专用，覆盖全部数据类别，禁止用于云服务；Base Token 面向基础类别集成，**部分新数据类别不可用**；Service Token 面向目录云服务（JWT payload `for: asid:{ServiceID}`，只对签发的服务有效）。
- 凭证 payload 形态：`{ "apiKey": "<JWT>" }`（单字段，无 clientId）。
- 错误码：`401` token 过期/错误/缺失；`403` 权限类别不符或方法被封；`429` 限流（响应头 `X-Ratelimit-Retry`/`-Limit`/`-Reset`/`-Remaining`）；**Marketplace 模块 4XX 一律按 10 次请求计费限流额度**。
- 建议的凭证验证调用（validateCredential）：common 域 `GET https://common-api.wildberries.cn/api/v1/seller-info`（限流 1 req/min，返回卖家信息）；各域 `GET /ping` 是无鉴权存活探针，不能用于凭证验证。

## 2. 模块分域（已验证）

WB API 按**模块分域名**（与 OZON 单域名不同，client 需支持多 base URL）：

| 模块 | 域名 | 用途 |
|---|---|---|
| Statistics | statistics-api.wildberries(.cn) | 订单/销售统计报表（DBW 买断口径） |
| Marketplace | marketplace-api.wildberries(.cn) | FBS/DBS 组装任务（作业订单）、供应单、卖家仓 |
| Content | content-api.wildberries(.cn) | 商品卡、类目（subjects） |
| Prices & Discounts | discounts-prices-api.wildberries(.cn) | 价格/折扣（写操作，本期不接） |
| Returns | returns-api.wildberries(.cn) | 买家退货（**规格未核实，T0**） |
| Analytics / Finance / Documents / Feedbacks / Common | 各自域名 | 报表/财务/文档/评价/费率（本期不接） |

限流模型：按模块令牌桶（Period / Limit / Interval / Burst），例：Marketplace 订单类 300 req/min、interval 200ms、burst 20；Content 卡片列表 100 req/min、600ms、burst 5；Statistics 订单 **1 req/min**、销售 **1 req/min**（是全 API 最严的组）。

## 3. 订单（已验证）——两套口径，必须双源归一

### 3a. FBS/DBS 作业订单（Marketplace，履约事实源）

- `GET /api/v3/orders`：`limit` 1–1000；`next` 游标（**首次传 0**，后续取响应 `next`）；`dateFrom`/`dateTo` Unix 秒（UTC），**单请求 ≤30 天**；默认回看 30 天。3 个月前的订单走 `GET /api/marketplace/v3/fbs/orders/archive`（按 year/month 分页）。
- 订单字段（原文 JSON 名）：`id, orderUid, rid, article, skus[], nmId, chrtId, price, finalPrice, salePrice, currencyCode, warehouseId, officeId, createdAt, ddate, sellerDate, deliveryType, cargoType, comment, address{fullAddress}, isZeroOrder, supplyId`。
- 状态机：`supplierStatus`: new / confirm / complete / cancel（卖家侧）；`wbStatus`: waiting / sorted / sold / canceled / canceled_by_client / declined_by_client / defect / ready_for_pickup / postponed_delivery / accepted_by_carrier / sent_to_carrier / canceled_by_carrier（平台侧事实）。
- 状态批量读取：`POST /api/v3/orders/status`（body `orders[]` ≤1000）。
- 限流：订单/供应单/面单 300 req/min（200ms、burst 20；4XX×10）。

### 3b. DBW(FBO)/买断统计（Statistics，报表口径）

- `GET /api/v1/supplier/orders`：**仅 `dateFrom`（必填，RFC3339 莫斯科时间 UTC+3）+ `flag`**（flag=0 按 `lastChangeDate ≥ dateFrom` 增量，上限 8 万行，用最后一行 `lastChangeDate` 作为下一次 `dateFrom`；空数组=取完；**没有 dateTo**）。数据 30 分钟刷新、保留 90 天、1 行 = 1 订单 = 1 件。
- 字段：`date, lastChangeDate, warehouseName, warehouseType, countryName, oblastOkrugName, regionName, supplierArticle, nmId, barcode, category, subject, brand, techSize, incomeID, isSupply, isRealization, totalPrice, discountPercent, spp, finishedPrice, priceWithDisc, isCancel, cancelDate, sticker, gNumber, srid`（`srid` = 订单行唯一标识）。
- 销售与退货行：`GET /api/v1/supplier/sales`（同参数；含 `saleID`、`paymentSaleAmount`、`forPay`；退货行语义）。
- 限流：**1 req/min**（Personal/Service），这是最严限流组，调度器要按此设计轮询预算。

### 3c. 与 OZON 订单模型的映射

| WCIES 字段 | FBS/DBS（marketplace v3） | DBW（statistics orders） |
|---|---|---|
| platformOrderId | `id`（组装任务 id） | `srid` |
| platformSkuId | `skus[]`（条码数组，对应 listing `sizes[].skus[]`） | `barcode`（单值） |
| offerId/sellerSku | `article`（= vendorCode） | `supplierArticle` |
| 数量 | 1 行 = 1 件 | 1 行 = 1 件 |
| 单价 | `salePrice`/`finalPrice`（ finance 事实） | `finishedPrice`/`priceWithDisc` |
| platformStatus | `wbStatus` | `isCancel` + `lastChangeDate`（弱事实） |
| 仓库 | `warehouseId` | `warehouseName` |
| 时间锚点 | `createdAt`/`sellerDate` | `date` |

**重大结构差异（与 OZON 相比）**：OZON 的订单接口一套覆盖全部履约模式；WB 的 FBO(DBW) 订单只出现在统计报表（30 分钟延迟、90 天保留、单边游标），没有作业级状态机。订单同步必须双源合并：FBS/DBS 用 v3 作业订单，DBW 用 statistics（成本高、限流 1/min → 低频轮询）。

**统计流水不是「只有 DBW」（2026-10-23 修复的真实 bug）**：

1. `/api/v1/supplier/orders` 返回**全部订单**，包括卖家仓（FBS/DBS）的单。此前 mapper 一律按
   `FBW` 落库，同一张单于是出现两条记录——`<数字 id> / FBS`（v3 源）与 `<srid> / FBW`
   （统计源），后者还被当成平台履约（外部履约）。实测 WS-001：33 单里有 13 张重复。
2. 判定口径：`warehouseType` 为 `Склад продавца`（卖家仓）→ `FBS`；其余保持 `FBW`
   （WB 这里是俄文自由文本，没有稳定枚举，只做单向判定、不猜未知值）。
3. **去重键**：统计行的 `srid` 恰好等于 v3 行里的 `rid`。`PlatformOrderRaw.dedupeByRawField`
   让适配器声明「订单 raw_data 中该字段等于本值即同一张单」；同步服务每页批量查一次
   `orders.raw_data->>'rid'`，命中即跳过（计入 skippedCount），不再重复建单。
4. 存量重复由 `apps/api/scripts/cancel-wb-duplicate-orders-2026-10-23.ts` 取消（dry-run
   默认，`--apply` 才写，执行前快照到 `.workbuddy/backup/`）。只取消后摄入的那条，
   v3 记录是权威数据。

## 4. 商品卡 / Listing（已验证）

- `POST https://content-api.wildberries.cn/content/v2/get/cards/list`——**T0 校准（2026-09-18 live，与早期文档记录有出入，以此为准）**：
  - **首页必须带 `limit`**（2026-10-22 修正）：`{"settings":{"cursor":{"limit":100}}}`。
    早前按「首页就是 `{"settings": {}}`」实现，WB 那时只回 **10 条**，而适配器的
    「短页即结束」规则把它当最后一页 —— WS-001 真实 418 张卡片只同步到 10 张，
    订单行全部找不到商品链接、拿不到图。`cursor.updatedAt` 仍是 **RFC3339 时间字符串**，
    传数字会 `400 Time.UnmarshalJSON`，所以首页只给 `limit`、不给 updatedAt/nmID；
    翻页把响应 cursor 原样回传：`{"settings":{"cursor":{"updatedAt":"…","nmID":123,"limit":100}}}`；
    filter/sort 可整体省略；
  - **响应是顶层 `{cards, cursor}`，没有 `{data, error, errorText}` 信封**（client 的 content 域解封装仅在响应带 `error:true` 键时触发，二者兼容）；
  - `sizes[].skus` 条码是**字符串**数组（如 `"2056942167514"`）；
  - **limit ≤100/页**；翻页终止：短页（<limit）或 cursor 无前进；响应含 `cursor.total`
    （注意它是**本页条数**，不是总数）；**回收站卡片不出现在结果中**。
- `cards[]` 字段：`nmID, imtID, nmUUID, subjectID, subjectName, vendorCode, brand, title, description, photos{big,c246x328,c516x688,square,tm}, video, dimensions{length,width,height,weightBrutto}, characteristics[{id,name,value}], sizes[{chrtID,techSize,skus[]}], tags[], createdAt, updatedAt`。
- 响应封装：`{data, error(bool), errorText, additionalErrors}`——**HTTP 200 内可能藏业务错误**，client 必须解封装（与 OZON 直接返回数据不同）。
- 限流：100 req/min、600ms、burst 5。
- 归档/回收站：`POST /content/v2/get/cards/trash`（cursor trashedAt+nmID；30 天后物理删除）。
- 商品图 = `photos`（卡内自带，无需 OZON 式二次 image 接口）。
- **订单行补图（2026-10-22，已实现）**：`Adapter.fetchProductImages` 仍不实现
  （官方没有按条码取图的端点）。改为纯 DB 反查：订单行 `platform_sku_id`（**条码**，
  见决策 0016）→ `platform_listing_skus.platform_sku_id` → Listing
  `raw_data.photos[0]`，按 `c516x688 → big → square → hq → c246x328 → tm` 依次取第一段
  可用直链（`wb.mapper.extractWbCardImageUrl`），零平台调用。用条码而不是 vendorCode：
  卖家会改商品货号，条码是平台事实。代码：`OrderSyncService.resolveWbImages`。
  前置条件同 Yandex —— **listing 必须先于订单存在**；listing 同步完成后会自动回补
  （`ListingSyncProcessor`）。
- **dimensions 单位（2026-10-05，经搜索索引核对官方 dev.wildberries.ru changelog/论坛帖）**：
  `length/width/height` 为**毫米**，`weightBrutto` 为**千克**（毛重，如 0.15 = 150g）。
  ⚠ .ru 直连被反爬、本地无 content OpenAPI 副本，未能直接读到官方原文——T0 拿到真实卡片
  按量级复核（衣物 300mm/0.65kg 量级为正确；若表现为 30/0.65 则是 cm，需改换算）。
- **尺寸重量预填（2026-10-05 已实现，同日）**：listing 同步把卡片级 `dimensions` 规范化为每个
  尺寸变体行 `platform_listing_skus.raw_data.product_attributes`（`dimension_unit:'mm'` +
  `depth/width/height`、`weight_unit:'kg'` + `weight`；WB `length` = 包裹长边 → OZON 风格
  `depth` 键）。建档并映射弹窗经 onboard-context 读取预填；全有全无（三维不齐只保留重量），
  非正数视为缺失。WB 不走 OZON 式增强同步（卡片数据自带），product_attributes 每次随
  listing 同步自愈。

## 5. Webhook / 推送（部分验证）

- **官方已提供 webhooks**：知识库《WB API Webhooks》（"subscribe and receive an HTTP request when an event happens"）与 FAQ（"you provide a URL, and the WB API sends an HTTP request to it"）；官方生产建议 = **webhook + TTL 兜底轮询**。
- **未核实（.ru 反爬、.cn 镜像 404）→ T0 待验证**：订阅管理端点（创建/删除/列表）、事件类型枚举（是否含订单创建/状态变化）、payload 结构（有无签名/事件 id）、应答格式、重试策略、可用模块范围。
- 结论：首发**不实现 WB webhook**，与 OZON 相同的「轮询调度器（订单/商品同步开关 + 间隔）」为主链路；webhook 链路待 T0 后按 OZON 同款（raw events → 定向回读）补挂。

## 6. 其余能力（对齐 OZON 范围的逐项核对）

| OZON 能力 | WB 对应物 | 状态 |
|---|---|---|
| 凭证验证 pingCredential | common 域 `GET /api/v1/seller-info` | 端点已验证，返回字段 T0 冒烟确认 |
| Listing 同步 | `/content/v2/get/cards/list` 游标分页 | 已验证 |
| 订单同步 | v3 作业订单 + statistics 双源 | 已验证（口径差异见 §3） |
| 订单定向回读 | v3 `id` 本身在列表返回全量；`POST /api/v3/orders/status` 补状态 | 已验证 |
| 退货同步 | returns 域 `returns-api.wildberries.cn`（端点规格未见官方页面）；替代：statistics `sales` 退货行 | **T0 待验证** |
| 商品图片 | 卡片 `photos` 自带 | 已验证（无需独立接口） |
| 类目树 | content `GET /content/v2/object/parent/all`（父类目）+ 子类目接口构树 | 端点已验证，树形聚合逻辑 T0 冒烟 |
| 商品属性增强 | 卡片 `characteristics[]` 自带（无需独立增强同步） | 已验证 |
| 平台仓库列表 | `GET /api/v3/warehouses` 是**卖家 FBS 自建仓 CRUD**，不是 WB 平台仓；唯一的历史候选 supplies-api `/api/v1/warehouses`（.ru 与 .cn 同样）已被平台**整体禁用**——实测 404 "This method is temporarily disabled"，官方 release-notes id=570 说明：2026-08-15 起「形成供应信息 / 供应费率」类 API 全部停用 | **缺口已定论（官方下线，非未找到）**：WB_FBW 绑定走手动录入平台仓 ID + 备注名（绑定弹窗已支持手动录入）；平台若重新开放该 API 可自动接入 |
| webhook | **已验证 + 已实现（2026-09-18）**：官方 webhooks-api 文档核对，见 §5b | 已实现 |
| **发货流程平台写** | **官方 swagger 已核对并落盘（2026-09-18，见 §9 与 docs/wb-orders-fbs-openapi.yaml）**：发货写操作按**供应单**走——建供应单 → 加订单（→`confirm`）→ 供应单转交付（→`complete`）；面单 `POST /api/v3/orders/stickers`（仅 `confirm`/`complete` 可取，JSON 内 base64） | **已实现（2026-09-18，T0 待实测）**：`prepareShipment`=建专属供应单(WCIES-<订单号>)+加单（→`confirm`，先读后写保证幂等，不调 deliver——`complete` 由平台收货扫码产生）；`fetchShippingLabel`=58×40 png 贴纸。映射经用户确认，见 §9.4 |

## 5b. Webhook（已验证 2026-09-18，官方文档核对；已实现）

- **订阅方式与 OZON/Yandex 不同：通过 API 创建**（webhooks-api.wildberries.ru），不是卖家后台 UI。鉴权 = seller token（Authorization）+ **WCIES 服务密钥**（`X-Client-Secret`，解决方案目录注册获得，env `WB_WEBHOOKS_SERVICE_SECRET`）；token 类别必须匹配事件类别。
- **⚠ 实测门槛（2026-09-18 live，优先于下述文档描述）**：webhook API 对 token **类型**有硬门槛——
  - Personal（个人令牌）→ `403 "only service tokens are allowed"`；
  - **Base（基础令牌，「用于手动集成」tab 创建）→ 同样 403**（文档称 "A Service or Base token"，与实测不符，以实测为准）；
  - 唯一出路是**服务令牌**：只能在「为目录中的服务创建」tab 里、针对已入驻解决方案目录的服务创建——即**自部署单租户系统必须先把 WCIES 注册为 WB 解决方案目录的开发者/服务**（大概率需要独联体主体）。X-Client-Secret 校验层在 token 类型之后，实测未能到达。
  - **与新授权方案文章互相印证**：webhook API 本就是目录云服务的事件通道（"available to all services from the Catalog"），on-premise 系统没有服务身份（asid），不在其设计对象内——403 行为与文章模型一致。
  - **结论：WB webhook 对当前自部署场景搁置**；数据链路用轮询（LISTING/ORDER_SYNC）。接收链路代码保留待命：将来若把 WCIES 注册进目录（联系 business-solutions@rwb.ru，需评估主体资质）拿到服务令牌 + 服务密钥，订阅三步即可启用；或以任何其它方式创建订阅后，把投递 secret 配到店铺 WEBHOOK 凭证即可接收。
  - **主凭证类型建议：Personal**——按官方模型，on-premise 自有集成应使用 Personal Token（全类别 + 明确豁免 service secret）；Base Token 有限制（部分新数据类别不可用，且目录服务场景下要求签名 secret，存在未来扩大执行的风险）。
  - Base 令牌本身对常规卖家 API 完全可用（seller-info / content / statistics 均接受，凭证验证 VALID），替换主凭证无副作用。
- **当前事件目录（无订单事件！）**：`report_generation_complete`（contentanalytics）、`card_creation_error`、`card_changed`（content）、`feedback_updated`（questionsandfeedback）。最新列表走 `GET /api/v1/event-scopes`。订单同步的兜底仍是轮询。
- **投递格式**：`{sellerId, requestId, events[]}`，单请求最多 100 个事件；每个事件 `{id, time, test, type, scope, idempotencyKey, payload}`。幂等去重键 = `idempotencyKey`。
- **真实性验证 = webhook secret**：创建 webhook 的响应中**仅此一次**返回 secret，之后不可查询（只能轮换）。WB 投递时把它放进 `Authorization` 头，接收方做比对（无签名、无 IP 白名单机制）。
- **应答**：10 秒内 HTTP 200 即送达；否则按 10s→15min 递增重试，超限事件删除，长期失败 webhook 可能被停用。
- **管理端点**：POST/GET/PUT/DELETE `/api/v1/webhooks`、`{id}/secret/refresh`、`/check`（URL 可达性）、`{id}/test/send`（`test:true` 事件探活）、events/deliveries/history 查询；全 API 共限 **1 req/s**。

### 实现落点（2026-09-18）

- 订阅管理：`sync/services/wb-webhook.service.ts` —— `POST/GET/DELETE /api/v1/stores/:storeId/webhooks/wb/subscription`；创建时 secret 加密落库为店铺 **WEBHOOK 凭证**（新增凭证类型，§28 预留），操作日志只记元数据（§29）；幂等（同 URL 已订阅直接返回）；secret 丢失/同 URL 多条一律 `WB_WEBHOOK_STATE_ERROR` 转人工，绝不盲删。
- 入站接收：`POST /api/v1/webhooks/wb/stores/:storeCode`（`wb-webhook.controller.ts`）—— Authorization 头与 WEBHOOK 凭证 secret 时序安全比对（不匹配 401，投递失败在 WB delivery 日志可见）；信封经 adapter `processWebhook` 解析，**逐事件**落 `external_raw_events`（externalEventId = idempotencyKey ?? id），`test:true` 落 SKIPPED 不入队；其余与 OZON 链路同构（入 BullMQ，10 秒预算内秒回）。
- 事件处理：`card_changed → ITEM_CHANGED`、其余（含未来新类型）→ `UNKNOWN`；处理器对二者的既有行为即「记录事实不动作」，与 OZON ITEM_CHANGED 一致。
- 已知边界：创建响应 secret 字段名未在文档中写明（实现按 /secret/i 键扫描，T0 校准）；当前目录无订单事件，webhook 不驱动订单同步。

## 7. 代码级落地点（复用 OZON 骨架）

1. `packages/platform-contracts`：`PLATFORM_CODES` 当前为 `['OZON','WILDBERRIES','YANDEX_MARKET']`，而 DB 种子/平台常量是 `['OZON','WB','YANDEX']`。**决策项**：将 contracts 枚举改为 `['OZON','WB','YANDEX']` 对齐 DB（改动面最小，仅类型 union），WB 适配器 `platformCode = 'WB'`。
2. 新增 `apps/api/src/modules/integration/wildberries/`：`wb.client.ts`（多域 base URL + Authorization 头 + 429/X-Ratelimit 退避 + **content 域 200 错误解封装** + Marketplace 4XX×10 的保守节流）、`wb.adapter.ts`（7 个 contract 方法；fetchOrders 双游标 kind：`WB_FBS_NEXT` / `WB_STATS_LAST_CHANGE_DATE`）、`wb.mapper.ts`（wbStatus→PLATFORM_ORDER_STAGES；supplierStatus 取消→platformCancelled；FBS→fulfillmentMode `WB_FBS`、DBW→`WB_FBW`）、`types/cursors.ts`、`wb.module.ts`（registry.register）。
3. Sync：`SYNC_TYPES` 复用 LISTING_SYNC/ORDER_SYNC（store+syncType 游标天然隔离平台）；轮询间隔受 statistics 1 req/min 约束。
4. 平台仓库查询端口：`PlatformWarehouseQueryService` 当前对非 OZON 抛 `PLATFORM_WAREHOUSE_QUERY_UNSUPPORTED`——WB 接入时改为按 platformCode 分发；数据源缺口期间返回空列表 + 前端手动录入模式。
5. 前端：`PLATFORM_CREDENTIAL_SPECS` WB 行去掉「尚未接入」措辞；凭证 payload 单 `apiKey`（前端已按 needsClientId=false 处理，天然兼容）。
6. **发货写能力（2026-09-18 已实现）**：`wb.client.ts` 增 `v3OrderStatuses`/`v3CreateSupply`/`v3AddOrdersToSupply`/`v3OrderStickers`（method 联合类型补 PATCH）；新 `wb-shipment.service.ts`（§9.4 幂等与状态机；`WB_ORDER_NOT_PREPARABLE`）；`wb.adapter.ts` 实现 `prepareShipment`/`fetchShippingLabel`（可选能力 → 前端能力位自动点亮）。

## 8. T0 验证清单（实现前用真实 token 冒烟，模式同 `scripts/ozon-t0-smoke.ts`）

1. `GET /api/v1/seller-info` 返回结构（凭证验证）。
2. `/content/v2/get/cards/list` 真实响应：cursor 回传行为、skus 与条码关系、分页终止条件。
3. `/api/v3/orders`：next 游标起始/终止语义、30 天窗边界、wbStatus 实际值集。
4. `/api/v1/supplier/orders`：lastChangeDate 游标行为、时区表现（UTC+3）、8 万行分页实测。
5. ~~WB webhooks：订阅端点/事件枚举/payload/签名~~（已核实并实现，见 §5b）；剩余校准项：**创建响应 secret 字段名**、真实投递样例、`GET /api/v1/event-scopes` 最新事件目录、订单类事件是否上线。
6. returns 域真实端点与规格。
7. WB_FBW 平台仓数据源（有无可列平台仓的接口）。
8. **发货流程写操作（§9，需用户授权后实测，AGENTS §92）**：① `POST /api/v3/supplies` 创建供应单的真实响应；② 加单后订单状态是否立刻变 `confirm`；③ `shipping-method` 未设置时 deliver 是否如规范所说返回 409；④ `POST /api/v3/orders/stickers` 真实响应（file 的 base64 与格式）；⑤ deliver 后订单是否变 `complete`；⑥ 对已处于目标状态的订单重复提交的行为（幂等性）。

## 9. 发货流程平台写能力（2026-09-18 官方 swagger 核对；未实现）

> 事实来源：官方 swagger `dev.wildberries.ru/en/swagger/orders-fbs` 的原始规范，
> 已整份落盘 **`docs/wb-orders-fbs-openapi.yaml`**（openapi 3.0.1，title "FBS Orders"，
> version "order"，252 KB，2026-09-18 抓取）。该站有 antibot（HTTP 498 + JS 质询），
> 纯 curl 拿不到；抓取方式见 §9.4。
>
> ⚠ 本节是**规范核对**，尚未对真实账号执行（AGENTS.md §92）。

### 9.1 与发货相关的端点全集（Base：`https://marketplace-api.wildberries.ru`；沙箱 `…-sandbox.…`）

| 方法 | 端点 | 作用 |
|---|---|---|
| GET | `/api/v3/orders/new` | 新组货订单 |
| GET | `/api/v3/orders` | 组货订单（近 3 个月；`dateFrom/dateTo` Unix 秒，单次 ≤30 天，`next` 游标） |
| POST | `/api/v3/orders/status` | **读**状态（body `{orders:[int64]}` ≤1000） |
| PATCH | `/api/v3/orders/{orderId}/cancel` | 取消组货订单（100 req/min、600ms、burst 20） |
| POST | `/api/v3/orders/stickers` | **面单贴纸**（≤100/次，`type=svg/zplv/zplh/png`，`width=58/40`，`height=40/30`） |
| POST | `/api/v3/orders/stickers/cross-border` | **跨境面单（PDF）**（≤100/次，body `{orders:[int64]}`）：返回 `status`（`ready`/`awaitingTrackNumber`）+ **`parcelId`（运单号）** + base64 PDF。仅 `confirm`/`complete` 有贴纸 |
| POST | `/api/v3/supplies` | **创建供应单**（body `{name}`，返回 `{id:"WB-GI-1234567"}`） |
| PATCH | `/api/marketplace/v3/supplies/{supplyId}/orders` | **把订单加入供应单**（≤100/次）→ 订单进入 `confirm` |
| PATCH | `/api/v3/supplies/{supplyId}/deliver` | **供应单转“已交付”** → 全部订单进入 `complete`，供应单关闭 |
| GET | `/api/v3/supplies/{supplyId}` | 供应单详情 |
| GET | `/api/v3/supplies/{supplyId}/barcode` | 供应单 QR 码 |
| PATCH | `/api/marketplace/v3/fbs/supplies/shipping-method` | 设置配送方式/发货日期/发货点（俄→俄**必填**，否则 deliver 返回 409） |
| PATCH | `/api/marketplace/v3/fbs/supplies/waybill` | 电子运单号（仅 `shippingType:"transportCompany"` 时可用） |
| GET | `/api/v3/supplies/{supplyId}/trbx` / POST / DELETE | 供应单装箱单位（trbx） |
| POST | `/api/v3/supplies/{supplyId}/trbx/stickers` | 供应单装箱 QR 贴纸 |

鉴权：`HeaderApiKey`（即现有 client 的 Authorization token），与 §1 一致。
限流（FBS 组货订单/供应单/通行证/自动退回这一组）：**300 req/min、200ms 间隔、burst 20；
一个 4XX 计 10 次**。沙箱内所有 Marketplace 方法合计 **1 req/s**。

### 9.1a 面单取用（2026-10-22 实测改造）

真实店铺（跨境，仓库「Пекин」）实测：

- **两个贴纸端点都能出单**：通用端点给 PNG（`PNG` 头），跨境端点给 PDF（`%PDF-1.7`）；
- 跨境端点额外给 `status` 与 `parcelId`（如 `WBCNRUGUBCJ2000ZAD`）——**这是 WB 运单号的唯一来源**
  （订单列表、statistics 行都不返回运单号）；
- 8/8 张 `confirm` 单跨境贴纸 `status=ready`；`new` 单两个端点都没有贴纸（不在供应单里）。

因此取单逻辑改为 **跨境优先、通用兜底**：

1. 先调 `/orders/stickers/cross-border`（一次 ≤100 单）；
2. 条目 `status=ready` → 直接作为面单（PDF），`parcelId` 回填订单 `platform_tracking_no`
   与已建发货单快照；
3. `status=awaitingTrackNumber` → 视为「面单未就绪」，**不降级**（通用贴纸属于另一套流程）；
4. 跨境接口 4xx 或空结果（非跨境电商）→ 降级到通用 PNG 贴纸，并在取单时**转成单页 PDF**
   （58×40mm），让批量打印的合并链路只处理 PDF。

批量：`fetchShippingLabels` 按 ≤100 单一次请求（适配器自报 `labelBatchLimit=100`），
只返回已就绪的单；未就绪的不出现在结果里（调用方按「平台尚未生成」处理）。

预取：WB 一入供应单就有贴纸，适配器声明 `labelReadyAfterPrepare=true`，组包成功后
立即入队预取，不再等「运单号出现」。

### 9.2 发货状态机：**供应单驱动**，卖家不能单独“发货”一张订单

`supplierStatus`（卖家侧，**只能由卖家动作改变**）：

| 状态 | 含义 | 如何到达 |
|---|---|---|
| `new` | 新订单 | （平台生成） |
| `confirm` | **组货中**（WB fbs 配送） | 把订单加入供应单（`PATCH …/supplies/{id}/orders`） |
| `complete` | **配送中**（WB fbs 与 wbgo） | 供应单转交付（`PATCH /api/v3/supplies/{supplyId}/deliver`） |
| `cancel` | 卖家取消 | `PATCH /api/v3/orders/{orderId}/cancel` |
| `cancel_carrier` | 承运商取消（**仅跨境**） | 承运商改变 |

`wbStatus`（平台侧事实，与 §3 一致）：`waiting / sorted / sold / canceled /
canceled_by_client / declined_by_client / defect / ready_for_pickup /
postponed_delivery / accepted_by_carrier / sent_to_carrier / canceled_by_carrier`。

`PATCH /api/v3/orders/{orderId}/cancel` 的 409 示例名：`StatusMismatch`、
`StatusChangeNotAllowed`；`isCancellable` 字段（`POST /api/v3/orders/status` 返回）
指示能否取消。

### 9.3 面单（贴纸）

`POST /api/v3/orders/stickers?type=png&width=58&height=40`
body `{orders:[int64]}`（≤100），响应：

```json
{ "stickers": [{ "orderId": 5346346, "partA": "231648", "partB": "9753",
                 "barcode": "!uKEtQZVx", "file": "<base64>" }] }
```

- `file` = 所请求格式的 **base64**（JSON 内，不是二进制流）。
- **只有 `confirm` / `complete` 状态能取贴纸**——即必须先加入供应单。
- 需要报关单号的商品，未填报关单号时取不到贴纸。
- 供应单整体另有 QR：`GET /api/v3/supplies/{supplyId}/barcode`；装箱单位贴纸
  `POST /api/v3/supplies/{supplyId}/trbx/stickers`。

### 9.4 与 WCIES 契约的映射（用户已确认 2026-09-18，已实现）

我们 `prepareShipment(orderId)` 是**按订单**的，而 WB 的写操作是**按供应单**的。
**已确认并实现：每张订单自动建一个专属供应单**（`POST /api/v3/supplies`，
名字 `WCIES-<platformOrderId>`）→ 加单（→`confirm`）→ 之后才可取贴纸。

实现要点（`wb-shipment.service.ts`）：

- **幂等靠先读后写**：`POST /api/v3/orders/status` 读到 `confirm`/`complete` 时**完全不写**
  （供应单名字不用于去重——WB 总是新建，重复名字不会复用）；
- **不调 `deliver`**：那会让平台把订单标成“配送中”，而货还在我们仓里。
  `complete` 事实来自 WB 收货扫码，经常规订单同步回流（与 OZON“一次组包就够”同一原则）；
- `cancel`/`cancel_carrier` 与未核实状态一律显式报错（`WB_ORDER_NOT_PREPARABLE`），不猜；
- 订单号必须为数字（v3 组货订单 id 为 int64），否则报错不转换（§89）。

其他前置：deliver 要求①供应单内至少一张订单②所有订单必填的标识（如 УИН/报关单号）
已填并通过校验③俄→俄供应单必须已设置 shipping-method，否则 409。
**这三条都要在 T0 实测**，不能只按规范假设。

### 9.5 抓取方式（ antibot ）

`dev.wildberries.ru` 对非浏览器请求返回 **HTTP 498** + JS 质询（自家 wbaas antibot），
curl 直接被拒。可行做法：真浏览器打开 `/en/swagger/orders-fbs` 过质询后，从页面
RSC payload 取得规范地址 `/api/swagger/yaml/en/03-orders-fbs.yaml`，再把浏览器会话的
`x_wbaas_token` Cookie 复制给 curl 即可直取。规范文件随本仓库落盘，一般无需重抓。
