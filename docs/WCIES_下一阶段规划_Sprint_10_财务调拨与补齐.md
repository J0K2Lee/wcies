# WCIES Sprint 10 规划 —— 财务、调拨与 ERP 补齐（2026-09-17）

> 状态：**已实施**（本文档为实施依据与验收记录）。
> 规则来源：用户 2026-09-17 指示「完成 WCIES 2.0 全部作业，自主补齐缺失的
> 页面与功能，以完整 ERP 体验为最终目标，实现集仓库、订单、商品、售后、
> 财务于一体的综合化电商管理系统」。路线图 Sprint 10（补货建议）、
> Sprint 11（调拨）、Sprint 12（财务）合并为本次交付。

---

# 1. 范围（T1–T6）

| # | 任务 | 内容 |
|---|---|---|
| T1 | 订单金额事实 | `order_items` 增加 unit_price/total_price；契约扩展 `PlatformOrderItemRaw.unitPrice`；OZON mapper 透传 posting `products[].price`；ingestion 落库；存量回填脚本 |
| T2 | Finance 模块 | 财务流水（追加+冲正）、平台回款（DRAFT→CONFIRMED 自动流水）、订单结算（快照成本/收入/毛利）、采购应付（派生）、汇总报表；规则见 `docs/business-rules/finance.md` |
| T3 | Transfer 模块 | 仓库间调拨单（DRAFT→CONFIRMED 单事务双段库存）；库存新增 TRANSFER_OUT/TRANSFER_IN 事件与原语；规则见 `docs/business-rules/transfer.md` |
| T4 | 补货建议 | 按近 30 天已发货销速 + 可售库存推导建议采购清单，一键预填采购单 |
| T5 | Web 财务中心 | 财务总览 / 收支流水 / 平台回款 / 订单结算 / 采购应付 五页 + 一级菜单「财务」 |
| T6 | Web 调拨与补货 | 调拨单页（库存域）；库存页补货建议入口 |

# 2. 明确不做

1. 平台财务 API（OZON 佣金/交易明细）——未经规范核实（AGENTS §88）。
2. 在途库存建模（调拨为瞬时事务，transfer.md §1）。
3. 渠道库存推送 / Allocator（仍留待专项确认，Sprint 9 规划 §6.2 不变）。
4. WB / Yandex 适配器（平台 API 事实未核实；平台主数据/店铺已支持 WB、YANDEX）。
5. 发票、税务、多币种折算（汇率无事实源）。

# 3. 迁移计划

- `20260917_001`：order_items 金额列（T1）
- `20260917_002`：finance 表三张 + 序号作用域（T2）
- `20260917_003`：transfer 表两张 + 序号作用域（T3）

# 4. 验收基线

在 Sprint 9 基线之上：lint / typecheck / check:arch / 单测 / 集成测试 / build
全部通过；`scripts/backfill-order-prices.ts` 幂等可重跑；浏览器冒烟覆盖
财务五页与调拨页核心路径。
