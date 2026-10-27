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

后两条来自推送订阅巡检（2026-10-27，用户确认「暂停要进异常中心」）：
平台会在连续投递失败后**自动暂停整个订阅**，而暂停等于「订单状态不再更新」，
必须让人当天就知道。对应异常类型 `WEBHOOK_PAUSED`(HIGH) / `WEBHOOK_UNHEALTHY`
(MEDIUM)，恢复健康后自动 RESOLVE。

判定口径：`PAUSED` 只看平台返回的 `enable`；`UNHEALTHY` 只看**本机公网自检**
（把平台的探测请求 POST 回自己的回调地址，要求 200 + `{version,name,time}`）。
平台 `notification/check` 的 `errors` 是滚动窗口，修复接收端后仍会残留旧错误，
不参与判定，只写进原因与详情。

新增事件只需在事件目录登记（级别、可过滤字段、卡片布局、跳转路径），
订阅与投递逻辑无需改动。

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
