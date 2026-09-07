# OZON 集成笔记

> 状态：**未开始**。Sprint 0 明确禁止接入真实 OZON API（任务书 §42/§44）。
>
> 本文件目前只登记工程侧占位约定。实现前必须依据**当前官方文档与真实响应**补充（AGENTS.md §87 / §88：不猜平台 API）。

## 工程约定（Sprint 0 已就位）

- 所有 OZON 访问必须通过 `PlatformAdapter` 实现（契约见 `packages/platform-contracts`）。
- Adapter / Client / Mapper 三层分离（AGENTS.md §33）。
- 凭证以 AES-256-GCM 加密存储（`CredentialEncryptionService` 已就位）。
- 平台同步按 `Store + SyncType` 隔离；Cursor、SyncJob、幂等规则在 Sync Sprint 落地。

## 实现前必须补充的事实（校验日期留空）

| 项 | 状态 |
|---|---|
| 认证方式（Client-Id / Api-Key header 约定） | 未验证 |
| 订单列表端点与分页参数 | 未验证 |
| 库存推送端点与限流 | 未验证 |
| Webhook 事件格式与验签 | 未验证 |
| 状态枚举 → ERP 状态映射表 | 未验证 |
| 仓库（FBO/FBS）映射 | 未验证 |
| Rate Limit 实测值 | 未验证 |

> 以上任何一项不得凭记忆写入生产 Adapter。
