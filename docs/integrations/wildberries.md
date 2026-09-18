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

## 4. 商品卡 / Listing（已验证）

- `POST https://content-api.wildberries.cn/content/v2/get/cards/list`——**T0 校准（2026-09-18 live，与早期文档记录有出入，以此为准）**：
  - 首页请求就是 `{"settings": {}}`（**不带 cursor 字段**；cursor.updatedAt 是 **RFC3339 时间字符串**，传数字会 `400 Time.UnmarshalJSON`）；翻页把响应 cursor 原样回传：`{"settings":{"cursor":{"updatedAt":"…","nmID":123,"limit":100}}}`；filter/sort 可整体省略；
  - **响应是顶层 `{cards, cursor}`，没有 `{data, error, errorText}` 信封**（client 的 content 域解封装仅在响应带 `error:true` 键时触发，二者兼容）；
  - `sizes[].skus` 条码是**字符串**数组（如 `"2056942167514"`）；
  - **limit ≤100/页**；翻页终止：短页（<limit）或 cursor 无前进；响应含 `cursor.total`；**回收站卡片不出现在结果中**。
- `cards[]` 字段：`nmID, imtID, nmUUID, subjectID, subjectName, vendorCode, brand, title, description, photos{big,c246x328,c516x688,square,tm}, video, dimensions{length,width,height,weightBrutto}, characteristics[{id,name,value}], sizes[{chrtID,techSize,skus[]}], tags[], createdAt, updatedAt`。
- 响应封装：`{data, error(bool), errorText, additionalErrors}`——**HTTP 200 内可能藏业务错误**，client 必须解封装（与 OZON 直接返回数据不同）。
- 限流：100 req/min、600ms、burst 5。
- 归档/回收站：`POST /content/v2/get/cards/trash`（cursor trashedAt+nmID；30 天后物理删除）。
- 商品图 = `photos`（卡内自带，无需 OZON 式二次 image 接口）。

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
| 平台仓库列表 | `GET /api/v3/warehouses` 是**卖家 FBS 自建仓 CRUD**，不是 WB 平台仓；WB_FBW 平台仓的数据源接口未确认 | **缺口 → T0**（临时替代：手动录入平台仓 ID + 备注名，绑定模型已支持 remark_name） |
| webhook | **已验证 + 已实现（2026-09-18）**：官方 webhooks-api 文档核对，见 §5b | 已实现 |

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

## 8. T0 验证清单（实现前用真实 token 冒烟，模式同 `scripts/ozon-t0-smoke.ts`）

1. `GET /api/v1/seller-info` 返回结构（凭证验证）。
2. `/content/v2/get/cards/list` 真实响应：cursor 回传行为、skus 与条码关系、分页终止条件。
3. `/api/v3/orders`：next 游标起始/终止语义、30 天窗边界、wbStatus 实际值集。
4. `/api/v1/supplier/orders`：lastChangeDate 游标行为、时区表现（UTC+3）、8 万行分页实测。
5. ~~WB webhooks：订阅端点/事件枚举/payload/签名~~（已核实并实现，见 §5b）；剩余校准项：**创建响应 secret 字段名**、真实投递样例、`GET /api/v1/event-scopes` 最新事件目录、订单类事件是否上线。
6. returns 域真实端点与规格。
7. WB_FBW 平台仓数据源（有无可列平台仓的接口）。
