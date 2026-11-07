# WCIES 通知系统（2026-10-26 订阅化改造）

> 一句话：**站内事件流是共享的事实，推送是按人订阅的**。业务模块只发事件，
> 通知模块决定「谁、走哪条通道」（AGENTS §52）。

## 1. 三层模型

```
业务模块 ──notifyXxx()──► 事件（notifications，全局可见，不受订阅影响）
                               │
                               └─ 解析订阅（notification_subscriptions）
                                     ├─ 条件匹配（AND + 候选集合）
                                     └─ 通道绑定（user_channel_bindings）
                                           └─ 投递（notification_deliveries）→ 飞书私聊 / 群卡片
```

| 表 | 回答的问题 |
|---|---|
| `notifications` | 发生了什么（事件本体，站内事件流） |
| `notification_reads` | 我看过没有（每人每事件一行，没有行 = 未读） |
| `user_channel_bindings` | 我的飞书 open_id / 邮箱是什么 |
| `notification_subscriptions` | 我想收哪些（用户 × 通道 × 事件 × 条件） |
| `notification_deliveries` | 这次推送发出去没有（状态/重试/错误） |

**默认全不订阅**（用户指示 2026-10-26）：不建规则就不会收到任何推送；
站内通知中心始终记录全部事件。

## 2. 订阅语义（刻意保持简单）

> **级别不是订阅条件**（2026-11-02 修正）：每个事件的级别是固定的（买家消息
> WARN、退货状态 INFO…），把「级别」当过滤条件只能恒真或恒假——用户选了不匹配
> 的级别，订阅看起来保存成功却永远不触发（实测：wbs 订阅买家消息时带了
> `level=INFO`，一条投递都没产生）。因此：匹配时忽略 `level`、接口不再接受
> `level`、UI 不再展示；存量条件由迁移 `20261102_003` 清理。

- 一行规则 = 一个用户 × 一个通道 × 一个事件 × 一组条件；
- 条件 = **所有键 AND**；每个键的值是候选集合，payload 字段命中任一即满足；
- 规则里有、payload 没提供的字段 → 视为不匹配（宁可少发，不误发）；
- 可过滤字段由**事件目录**声明（`apps/api/src/modules/notification/events/notification-events.ts`），
  订阅 UI 只展示这些字段；不提供 OR 树、否定规则与脚本；
- 字段的取值形式（用户要求 2026-10-26）：`level` / `storeId` / `warehouseCode`
  一律**多选**（选项来自真实档案：店铺显示 `编码 名称`、仓库显示 `编码 名称`），
  其余字段（`skuCode`、`interceptionNo` 等）保持文本框、逗号分隔；
  切换事件后只提交当前事件声明过的条件（不会把上一个事件的隐藏条件带过去）；
- 同人同通道同事件只投递一次（多条规则取并集）；飞书群每条事件只发一次；
- 事件级去重：同 `(type, dedupeKey)` 30 分钟内只记一条（例如同一拦截任务反复失败）。

## 2b. 飞书卡片可读性（2026-11-02 用户要求）

- **店铺**：写「编码 + 名称（平台）」，如 `ON-002 OZON 香港店（OZON）`——编码保留
  （运营对编码敏感），名称让不认识编码的人也看得懂。
- **关联订单**：买家消息卡片显示平台订单号；本轮新增消息没有带订单号时回查该
  会话历史（平台通常只在会话开头那条上带 `context.order_number`，实测 39/262）。
- **商品主图**：用关联订单的首个 `order_items.platform_image_url`，先上传到飞书
  换 `image_key` 再渲染 `img` 元素（飞书卡片不认外链）；上传失败或订单未入库时
  卡片照常发送、只是没有图。同一 URL 缓存 6 小时。
- **正文尽量显示完全**：买家消息正文上限 1500 字且**保留换行**（OZON 单条消息
  本身最长 1000 字，正常不会被截断）；评价/提问/退货仍按 200 字摘要。

## 3. 通道

| 通道 | 机制 | 前置条件 |
|---|---|---|
| `SYSTEM` | 事件行本身（站内） | 无 |
| `FEISHU_DM` | 应用机器人私聊（`im/v1/messages?receive_id_type=open_id`） | 飞书**企业自建应用**（app_id/secret + 机器人 + `im:message:send_as_bot`）；用户已绑定 open_id |
| `FEISHU_GROUP` | 自定义机器人 webhook | `FEISHU_WEBHOOK_URL` 已配置 |

实现事实（2026-10-26 联调）：

- 应用凭证当前来自 `.env` 的 `APP_ID` / `APP_SECRET`（**仅测试**，后续改为系统设置项并加密存储）；
- 飞书卡片使用 **schema 2.0**：**不支持 `tag: "action"`**，按钮必须放在
  `column_set > column > elements`，否则返回 `230099 / 200861 unsupported tag action`；
- `open_id` 按应用隔离（`ou_…`），换应用需重新绑定；
- 卡片目前只放「去处理」**链接按钮**（跳站内页面）。"确认/忽略"回调按钮需要
  `card.action.trigger` 事件订阅 + 公网回调 + 签名/解密，留待第二步。

## 4. 未读

- 未读 = 事件存在且当前用户没有 `notification_reads` 行；
- 铃铛显示未读数；通知中心行内有未读圆点与「标为已读」，头部有「全部已读」；
- 已读是**每人独立**的，不影响别人。
- 界面上**不显示**事件自身的状态（站内行恒为 `SENT`，能看到即已送达）；
  只有**当前用户自己**的推送失败时，铃铛与通知中心才显示「推送失败」（可重试）。

## 5. 可靠性

- 事件写库与业务事务解耦：通知失败只记日志，绝不影响取消/拦截等业务动作（§51）；
- 投递在 BullMQ（`wcies.notification`）异步执行，3 次指数退避；
- 投递状态落在 `notification_deliveries`：`PENDING → SENT / FAILED`，失败可在通知中心重试；
- 入队失败立即把投递行置 FAILED（不留 PENDING 墓碑）；
- processor 同时注册在 API 进程与独立 worker（开发环境没有 worker 容器）。

## 6. 事件目录

当前只登记系统真实存在的两类拦截事件（用户指示：目录暂不扩充，有需求再提）：

| 事件 | 级别 | 可过滤字段 | 去重键 |
|---|---|---|---|
| `ORDER_INTERCEPTION_REQUIRED` | WARN | storeId / warehouseCode / skuCode / level | `interception:<id>` |
| `ORDER_INTERCEPTION_FAILED` | HIGH | 同上 + interceptionNo | `interception:<id>:failed` |
| `STORE_CREDENTIAL_EXPIRING` | WARN | storeId / platform / credentialType | `credential:<id>:<YYYY-MM-DD>` |
| `STORE_CREDENTIAL_EXPIRED` | HIGH | 同上 | 同上（过期后每天一条，直到换绑） |
| `STORE_WEBHOOK_PAUSED` | HIGH | storeId / platform | `webhook:<storeId>:PAUSED:<YYYY-MM-DD>` |
| `STORE_WEBHOOK_UNHEALTHY` | WARN | storeId / platform | `webhook:<storeId>:UNHEALTHY:<YYYY-MM-DD>` |
| `BUYER_MESSAGE_RECEIVED` | WARN | storeId / platform | `chat:<storeId>:<chatId>:<lastMessageId>` |
| `REVIEW_CREATED` | WARN | storeId / platform | `review:<storeId>:<reviewId>` |
| `RETURN_REQUESTED` | WARN | storeId / platform | `return:<storeId>:<returnNo>:created` |
| `RETURN_STATE_CHANGED` | INFO | storeId / platform | `return:<storeId>:<returnNo>:<state>` |
| `BUYER_QUESTION_RECEIVED` | WARN | storeId / platform / skuCode | `question:<storeId>:<questionId>` |
| `PICKING_ORDER_CANCELLED` | WARN | storeId / orderNo | `picking-cancel:<storeId>:<orderNo>` |
| `STORE_WEBHOOK_SILENT` | WARN | storeId / platform | `webhook:<storeId>:SILENT` |

`PICKING_ORDER_CANCELLED`（2026-11-03）：拣货进行中订单被取消时通知仓库——
内容含店铺、订单号、撤出的未拣行数/件数、已拣待拦截件数，跳转
`/warehouse-ops?tab=picking`。口径见 `orders.md` §8「拣货中取消」。
关联对象是订单 UUID（`notifications.reference_id` 为 uuid 列，不能放订单号）。

后两条来自推送订阅巡检（2026-10-27，用户确认「暂停要进异常中心」）：
平台会在连续投递失败后**自动暂停整个订阅**，而暂停等于「订单状态不再更新」，
必须让人当天就知道。对应异常类型 `WEBHOOK_PAUSED`(HIGH) / `WEBHOOK_UNHEALTHY`
(MEDIUM)，恢复健康后自动 RESOLVE。

判定口径：`PAUSED` 只看平台返回的 `enable`；`UNHEALTHY` 只看**本机公网自检**
（把平台的探测请求 POST 回自己的回调地址，要求 200 + `{version,name,time}`）。
平台 `notification/check` 的 `errors` 是滚动窗口，修复接收端后仍会残留旧错误，
不参与判定，只写进原因与详情。

## 6.1 告警节流与类型筛选（2026-11-03）

**巡检类告警只在「状态进入」时推送一次。** Webhook 订阅巡检每 6 小时跑一轮，
同一个未恢复的问题不得重复通知：`WebhookHealthService.enforce()` 先查异常中心
是否已有同 (类型, 店铺) 的 OPEN 行，只有首次创建时才发通知。此前依赖 30 分钟
去重键兜底，实际变成每个店铺每半小时刷一条（ON-006/008/009 一天内数十条），
通知中心被同一条订阅告警淹没。

- 暂停 `WEBHOOK_PAUSED` / 体检异常 `WEBHOOK_UNHEALTHY` 互斥：状态切换时关闭
  另一类异常；恢复健康只自动关闭异常，不额外发「已恢复」通知（异常中心可见）。
- 副作用的可见性由**异常中心**承担（一店一类型一条 OPEN），通知只负责「第一次」。

**通知中心的类型筛选由事件目录驱动**：`GET /api/v1/notifications/event-catalog`
返回的类型/文案直接生成下拉选项，新增事件不再需要改前端（此前写死「需要拦截 /
拦截失败」两项，其它事件无法筛选）。

**可用性预警与静默看门狗（2026-11-07）**：除 `enable=false`（已被暂停）外，
巡检还监控两件事——① 平台 `availability_status` 到 YELLOW/RED（说明平台已在
记账投递失败，随时会暂停）→ `WEBHOOK_UNHEALTHY`；② 订阅 enabled 但 24 小时
没有任何入站推送（含 PING）→ `WEBHOOK_SILENT`（新异常类型，MEDIUM），对应通知
`STORE_WEBHOOK_SILENT`。后者覆盖「链路已断但平台还没停」的窗口（10-30/10-31
实证：OZON 的 PING 与事件同时消失两天）。

**体检判定口径**（沿用 2026-10-27 决策）：只认本机公网自检（`{}` 探测回自己的
回调入口，要求 200 + `{version,name,time}`）；平台 `notification/check` 的
`errors` 是滚动窗口累计值，修复接收端后仍会残留旧错误，不参与判定，只写进
原因/详情。当前 8 家 OZON 店自检均为 200 正常，残留错误仅是窗口历史。

**订阅被暂停的处理**：平台连续投递失败会 `enable=false`。入口修好后在店铺详情
「事件订阅」点「订阅/对齐」即可把 `enable` 恢复为 true（真实平台写操作，需确认）；
恢复后下一轮巡检自动关闭 `WEBHOOK_PAUSED`。

新增事件只需在事件目录登记（级别、可过滤字段、卡片布局、跳转路径），
订阅与投递逻辑无需改动——订阅接口的白名单 `NOTIFICATION_TYPES` **从目录派生**
（2026-11-02 修复：此前是手写的四个事件，新事件只在目录里，导致「新增订阅」直接
400；现在两边同源，登记即可订阅）。

**买家侧提醒（2026-11-02）的聚合口径**：

- 买家消息**按会话聚合**——一次轮询里同一会话新增 N 条只推一张卡，正文取
  最后一条，去重键带最后一条消息 id；首次接入某店铺时只回填历史未读、不发
  提醒（否则订阅瞬间会收到几十张卡）。
- 评价**只推 1-3 星**（4-5 星只落库）；OZON 评价 API 需要卖家付费订阅，
  无权限的店铺不产事件（见 `docs/integrations/ozon.md` §6.8）。
- 退货新建与状态变化各推一次，同一退货单同一状态只推一次；**首次同步某店铺时
  只回填、不推送**（否则历史退货会在订阅瞬间变成几十张卡）。
- 提问（`BUYER_QUESTION_RECEIVED`）覆盖 WB 与 Yandex：**WB 没有聊天 API**，提问
  就是那边最主要的买家触达渠道；已回复的提问不提醒（没有待办），只落库。
- 四类事件都只带 `storeId` / `platform` 两个可过滤字段；卡片正文会截断到
  约 200 字，买家消息正文不进日志（AGENTS §67）。

## 7. 接口

```
GET    /notifications                    列表（含 isRead / deliveryStatus / unreadTotal）
GET    /notifications/unread-count       未读数（铃铛）
POST   /notifications/:id/read           单条已读
POST   /notifications/read-all           全部已读
GET    /notifications/event-catalog      可订阅事件目录
GET    /notifications/subscriptions      我的订阅
POST   /notifications/subscriptions      新增订阅
PATCH  /notifications/subscriptions/:id  改条件 / 启停
DELETE /notifications/subscriptions/:id  删除
GET    /notifications/channels           我的通道绑定
POST   /notifications/channels           绑定 open_id / 邮箱
POST   /notifications/:id/retry          重试失败的推送
```

## 8. API Key 到期提醒（2026-10-26 用户需求）

- 平台可能强制 Key 过期，绑定凭证时**必须声明**「到期日」或「长期有效」，否则 422
  （`CREDENTIAL_VALIDITY_INVALID`）；
- 存量凭证按用户指示回填：OZON / WB = 绑定时间 + 90 天；Yandex = 长期；
- 扫描（`CredentialExpiryService`，调度 tick 内每日一次）对「到期前 7 天内」的 ACTIVE
  凭证发布 `STORE_CREDENTIAL_EXPIRING`，已过期的发布 `STORE_CREDENTIAL_EXPIRED`
  （HIGH），直到换绑；
- 「每天一条」由去重键 `credential:<id>:<日期>` 保证，多进程/重启不会重复；
- 通知发送给**订阅了该事件**的人；默认全不订阅，因此需要各自开启；
- 未声明有效期（历史/异常数据）的凭证不参与扫描，店铺页面提示「未声明」补全。
