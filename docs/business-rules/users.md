# 用户与账号安全（User Management）

> 2026-10-05 引入。多用户支持：管理员添加用户（邮箱验证激活）、用户通过已验证邮箱
> 自助修改登录密码与登录邮箱。
>
> 关联代码：`apps/api/src/modules/auth/`（services / controllers / entities）、
> `apps/api/src/infrastructure/email/`（SMTP 传输）。
> 迁移：`database/migrations/20261005_002_user_email_verification.ts`。

## 1. 角色与状态

- 角色（不变）：`ADMIN` / `OPERATOR`。用户管理全部写接口仅 ADMIN（AdminGuard）。
- 用户状态新增 `PENDING_VERIFICATION`：

```text
ACTIVE                  可正常登录
PENDING_VERIFICATION    管理员创建、邮箱未验证：不能登录
DISABLED                停用：不能登录
```

状态迁移规则：

- 管理员创建用户 → `PENDING_VERIFICATION`（无初始密码，仅随机占位哈希）。
- 邀请链接确认 → `ACTIVE`（同时设置初始密码 + 标记邮箱已验证）。这是唯一激活路径。
- 管理员停用任何账号（含待验证账号）→ `DISABLED`；不能停用自己。
- 管理员启用：邮箱已验证 → `ACTIVE`；未验证 → 回到 `PENDING_VERIFICATION`。

存量账号（2026-10-05 迁移前已存在且带邮箱）在迁移中一次性回填为已验证，
可立即使用邮箱自助流程；其假邮箱（如 admin@wcies.local）收不到信时，
应通过「修改登录邮箱」流程换成真实邮箱。

## 2. 邮箱验证令牌（email_verification_tokens）

三种用途（purpose），互不通用：

| purpose | 触发 | 发往 | TTL | 前端落地页 |
|---|---|---|---|---|
| INVITE | 管理员创建用户 / 重发邀请 | 账号邮箱 | 48h | `/invite` |
| PASSWORD_CHANGE | 用户发起改密 | 当前已验证邮箱 | 30min | `/reset-password` |
| EMAIL_CHANGE | 用户发起改邮箱 | **新**邮箱 | 1h | `/change-email/confirm` |

安全属性：

- 令牌 = 32 字节随机数（hex 64 位出现在邮件链接中），库内只存 SHA-256 哈希。
- 单次使用：确认时 `UPDATE ... WHERE consumed_at IS NULL`，并发竞争只有一个成功。
- 同一用户同一用途重发时，旧令牌全部作废（只有最新链接有效）。
- 发送冷却：同一用户同一用途 60 秒内只能发一封（Redis key
  `auth:email:cooldown:{userId}:{purpose}`）。
- 确认端点为 `@Public`：令牌即凭证，允许在无会话的设备上从邮件链接打开。

## 3. 流程

### 3.1 管理员添加用户（POST /api/v1/users）

1. 校验用户名/邮箱唯一（预检 + 23505 竞争兜底）。
2. 创建 `PENDING_VERIFICATION` 用户（无可用密码）。
3. 同步发送邀请邮件；**发送失败不回滚用户**，响应返回 `inviteSent:false`
   + 原因，管理员可稍后「重发邀请」。创建/停用/启用/重发均写操作日志。

### 3.2 邀请确认（POST /api/v1/auth/verify-email/confirm）

令牌有效且账号未停用 → 一次原子 UPDATE：设置密码哈希、
`password_changed_at`、`email_verified_at`、`status=ACTIVE`。

### 3.3 修改登录密码（通过已验证邮箱）

1. 发起（登录态）：要求当前邮箱已验证，否则 `USER_EMAIL_NOT_VERIFIED`。
   向该邮箱发送 30 分钟一次性重置链接。
2. 确认（@Public，令牌凭证）：设置新密码并刷新 `password_changed_at`。
3. **会话失效**：`JwtAuthGuard` 拒绝 `iat` 早于 `password_changed_at`
   的 JWT（+1 秒容差），即修改前签发的所有 Cookie 立即失效。

### 3.3.1 会话有效期与滑动续期（2026-10-05）

- 会话 = JWT Cookie（`wcies_session`），有效期 `JWT_EXPIRES_IN`
  （默认 **7 天**，`.env` 可调）。
- **滑动续期**：`JwtAuthGuard` 在请求完全认证通过后（用户存在、ACTIVE、
  未被改密吊销）调用 `AuthService.renewIfAging`——令牌签发时间（`iat`）
  距今 **≥24 小时**即重签一个完整窗口的新令牌并重置 Cookie。效果：
  - 当天有使用 → 失效时间重置为「最后次续期 + 7 天」，日常使用永不掉线；
  - 连续闲置超过 7 天 → 过期，需重新登录；
  - 每客户端每天至多重签一次，不会每请求都签名。
- 改密吊销不受续期影响：续期产生的新令牌 `iat` 晚于 `password_changed_at`，
  旧令牌在续期前就已因轮换检查失效。

### 3.4 修改登录邮箱（通过已验证邮箱）

三重证明，缺一不可：

1. 当前邮箱已验证（账号有可信联系渠道）；
2. 当前登录密码正确（账号控制权，`USER_INVALID_CURRENT_PASSWORD`）；
3. 新邮箱收到确认链接（新邮箱控制权）。

确认时把 email 换为新地址并即时标记已验证；确认时若地址已被抢占
（唯一约束竞争）返回 `USER_EMAIL_IN_USE`。JWT 载荷不含邮箱，无需重签。

## 4. 邮件基础设施

- `infrastructure/email/EmailService` 是唯一 SMTP 出口（nodemailer，飞书 SMTP）。
- **同步发送**（不进 BullMQ）：dev 栈没有独立 worker 进程；验证邮件是交互式
  事务邮件，调用方需要立刻得到成功/失败反馈。单封失败向上抛
  `EMAIL_DELIVERY_FAILED`（502）。
- 配置（均可空 = 未配置，运行时报 `EMAIL_NOT_CONFIGURED` 503）：

```text
SMTP_HOST / SMTP_PORT(465=SSL, 587=STARTTLS) / SMTP_USER(=发件邮箱)
SMTP_PASSWORD(IMAP/SMTP 密码) / SMTP_FROM_NAME
WEB_BASE_URL(邮件内链接指向的前端地址，默认 http://localhost:5173)
```

- 飞书限制：200 封/100 秒、单发件人 400 封/日。当前量级（人数级）远低于限制，
  仅以每用户每用途 60 秒冷却做滥用防护。
- 密钥只进 `.env`（gitignored）；`.env.example` 仅模板。日志不落邮件正文。

## 5. 错误码

| code | HTTP | 场景 |
|---|---|---|
| USER_NOT_FOUND | 404 | 目标用户不存在 |
| USER_USERNAME_EXISTS | 409 | 用户名已被使用 |
| USER_EMAIL_IN_USE | 409 | 邮箱已被其他账号使用 |
| USER_CANNOT_DISABLE_SELF | 409 | 停用自己 |
| USER_EMAIL_NOT_VERIFIED | 409 | 邮箱未验证即发起自助流程 |
| USER_INVALID_CURRENT_PASSWORD | 403 | 改邮箱时密码错误 |
| USER_EMAIL_UNCHANGED | 400 | 新邮箱与当前相同 |
| USER_DISABLED | 403 | 已停用账号尝试确认令牌 |
| USER_EMAIL_TOKEN_INVALID | 400 | 令牌不存在/用途错/过期/已用 |
| USER_EMAIL_SEND_COOLDOWN | 429 | 发送冷却中 |
| USER_INVITE_NOT_RESENDABLE | 409 | 不可重发（已验证/非待验证/发送失败原因） |
| EMAIL_NOT_CONFIGURED | 503 | SMTP 未配置 |
| EMAIL_DELIVERY_FAILED | 502 | SMTP 发送失败 |

## 6. 测试

- 单元：`email-verification.service.spec.ts`（哈希/单次/过期/冷却）、
  `user-admin.service.spec.ts`（创建/重发/状态机/自我停用）、
  `account.service.spec.ts`（三流程全分支）。
- 手工验收（2026-10-05，dev）：邀请确认→登录→改密→旧会话 401→新密码登录、
  OPERATOR 403、令牌重用 409，全部通过。

## 7. 已知边界（待用户决策）

- 无用户删除接口（只有停用）——删除涉及外键追溯，需单独设计。
- 角色创建后不可改（改角色=权限变更，建议后续配操作日志单独做）。
- 忘记密码（未登录发起）未开放：当前仅登录态发起，避免向未验证邮箱投递。
