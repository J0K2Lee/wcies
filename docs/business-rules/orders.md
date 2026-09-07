# WCIES Order Business Rules（骨架）

> 状态：**待补充**。订单业务自 Sprint 2 起实现；本文件在实现前必须先由业务确认并填充规则，遵循"先文档、后代码"（AGENTS.md §84 / §86）。
>
> 本骨架仅列出 AGENTS.md 中已冻结的订单级约束，未新增任何业务规则。

## 已冻结的全局约束（摘自 AGENTS.md，非本文件新增）

1. 订单唯一键：`store_id + platform_order_id`（§35）。
2. Order 1:N OrderItem；订单行拥有独立履约状态（PENDING / RESERVED / BACKORDERED / PICKED / SHIPPED / RELEASED）（§36）。
3. Order 与 Shipment / Package 严格分离（§37）。
4. `platformStatus` 与 `erpStatus` 分离；ERP 状态迁移必须经状态机服务（§38）。
5. 重要状态迁移必须保留历史（Order Status History）（§39）。
6. 新订单映射 SKU 后尝试锁库存：足额 → RESERVED；不足 → BACKORDERED + 异常，禁止自动取消平台订单（§40）。
7. Reserved 取消可释放库存；Picked 取消必须创建 Interception Task，禁止直接恢复可售库存（§41 / §42）。

## 待 Sprint 2 前确认并补充

- [ ] ERP 订单状态机全集与合法迁移表
- [ ] 订单同步批次与游标规则（承接 Sync 规则 §43–§46）
- [ ] 拆单 / 合并发货规则
- [ ] 取消类型的完整分类（客户取消 / 平台取消 / 超时取消）
- [ ] Interception Task 生命周期
