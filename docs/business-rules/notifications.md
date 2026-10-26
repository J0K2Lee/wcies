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
