# WCIES Finance Business Rules（Sprint 10，2026-09-17 冻结）

> 本文档定义 WCIES 财务领域的业务事实、状态与合法变化。所有涉及财务的代码
> 修改，必须以本文档为准。
>
> 规则来源：用户 2026-09-17 指示「完成 WCIES 2.0 全部作业，补齐缺失页面与
> 功能，实现集仓库、订单、商品、售后、财务于一体的完整 ERP」（路线图
> Sprint 12「财务（成本、对账）」与 Sprint 13「退款对账」合并提前实施）、
> AGENTS.md §58（金额 NUMERIC）/§60（JSONB 不承载财务金额）、
> docs/business-rules/purchase.md §4.4（移动加权平均成本）、
> returns.md §1（退款事实仅展示，本 Sprint 落地为可登记的财务支出）。

---

# 1. 核心原则：单据事实 + 派生汇总

```text
财务流水（FinanceTransaction）  → 钱动了的事实（不可变，只追加）
平台回款（FinancePayout）        → 平台打款批次（确认后自动生成流水）
订单结算（OrderSettlement）      → 单笔订单的收入/成本快照（生成时点冻结）
采购应付                        → 派生值：PO 行金额 − 已付款流水（不落库）
```

- 财务流水是唯一资金事实源；**流水不可修改、不可删除**，错账用反向流水冲正
  （`reversedByVoucherNo` 引用，方向相反、类别相同）。
- 采购付款状态（UNPAID / PARTIAL / PAID）是**派生值**，由应付金额与付款流水
  实时计算，不作为第二事实源落库（同 Available 原则，AGENTS §13）。
- 平台佣金/平台打款明细等**平台财务 API 本期不接入**（未经规范核实，
  AGENTS §88）；平台侧金额一律以人工登记 + 订单原始金额为准。

# 2. 订单金额事实（前置改造）

平台订单行金额是收入的基础事实，必须结构化存储（AGENTS §60）：

- `order_items` 新增 `unit_price numeric(18,4) NULL`、
  `total_price numeric(18,4) NULL`（= unit_price × quantity，落库时计算）。
- 来源：平台原始数据（OZON posting `products[].price`，规范已核实的字段，
  docs/integrations/ozon.md）。mapper 透传 `unitPrice`，ingestion 落库。
- 价格缺失（平台未给）→ 两列 NULL，**不得臆造为 0**。
- 订单币种沿用 `orders.currency`（平台事实）。
- 存量订单由回填脚本 `scripts/backfill-order-prices.ts` 从 `raw_data`
  一次性提取；提取不到保持 NULL。

# 3. 财务流水（FinanceTransaction）

## 3.1 数据要素

```text
finance_transactions:
  voucher_no        业务编号 FV%06d（集中式序号表，作用域 finance_voucher）
  direction         INCOME（收入）/ EXPENSE（支出）
  category          业务类别（见 3.2）
  amount            numeric(18,4) CHECK (amount > 0)，恒为正数，方向看 direction
  currency          varchar(10) NOT NULL DEFAULT 'CNY'
  occurred_at       timestamptz 业务发生时间（登记时可指定，默认当前）
  store_id          关联店铺（可空）
  supplier_id       关联供应商（可空，采购付款必填见 3.3）
  order_id          关联订单（可空，销售收入/退款必填见 3.3）
  purchase_order_id 关联采购单（可空，采购付款必填见 3.3）
  payout_id         关联回款单（可空，回款确认自动生成时写入）
  reversed_by       冲正对方流水号（可空；冲正对双方互指）
  remark / created_by / created_at / updated_at
```

## 3.2 类别（typed const，新增即业务规则变更）

| category | direction 约束 | 说明 |
|---|---|---|
| SALE_INCOME | INCOME | 销售收入（回款确认自动生成 / 人工登记） |
| SALE_REFUND | EXPENSE | 订单退款支出（关联订单） |
| PURCHASE_PAYMENT | EXPENSE | 采购付款（关联供应商+采购单） |
| SUPPLIER_REFUND | INCOME | 供应商退款/退货收款 |
| PLATFORM_FEE | EXPENSE | 平台费用（佣金、服务费） |
| LOGISTICS_FEE | EXPENSE | 物流费用 |
| OTHER_INCOME | INCOME | 其他收入 |
| OTHER_EXPENSE | EXPENSE | 其他支出 |

登记时校验 direction 与类别的合法组合；非法组合直接 422。

## 3.3 关联约束（登记时校验）

- PURCHASE_PAYMENT：`supplier_id` 与 `purchase_order_id` 必填。
- SALE_INCOME / SALE_REFUND：`order_id` 必填（人工登记销售收入必须挂单；
  无订单汇总收入用 OTHER_INCOME）。
- 金额不得超过对应采购单未付余额（PURCHASE_PAYMENT，防超付）。

## 3.4 不可变与冲正

- 已创建流水**禁止 UPDATE / DELETE**（API 不提供；架构检查脚本约束）。
- 冲正 = 创建一笔方向相反、类别相同、金额相同的流水，双方 `reversed_by`
  互指；被冲正流水在汇总中按「净额=0」处理（即两笔都不计入净额）。

# 4. 平台回款（FinancePayout）

## 4.1 数据要素

```text
finance_payouts:
  payout_no     业务编号 PY%06d（作用域 finance_payout）
  store_id      必填
  period_start / period_end  对账期间（start ≤ end）
  amount        numeric(18,4) > 0，平台实际打款金额
  currency      默认 CNY
  status        DRAFT → CONFIRMED；DRAFT → CANCELLED
  remark / created_by / created_at / updated_at
```

## 4.2 状态机（冻结）

```text
DRAFT → CONFIRMED（确认回款：事务内自动生成一笔 SALE_INCOME 流水，
                    payout_id 指向本单；幂等——重复确认不重复生成）
DRAFT → CANCELLED（仅 DRAFT 可取消；确认后不可逆，错账走冲正）
```

- CONFIRMED 与流水生成在同一数据库事务；流水 `idempotencyKey`
  = `FINANCE_PAYOUT:<payoutId>`（语义约束，防重复）。
- 对账辅助：确认前展示该店铺该期间「订单应计收入合计」（已结算订单收入
  之和）与打款金额的差异，供人工判断，不做自动阻断。

# 5. 订单结算（OrderSettlement）

## 5.1 定位与生成条件

- 结算是**已发货订单**的收入/成本/毛利快照，生成时点冻结成本，此后 SKU
  成本变动不影响已生成结算。
- 生成条件：订单 `erpStatus ∈ {SHIPPED, PARTIALLY_SHIPPED}`。未发货订单
  无结算；取消订单无结算。
- 唯一键：`UNIQUE(order_id)`——一单一结算，重复生成幂等返回已有结算。
- 触发方式：手动（单笔 / 批量「生成全部缺失」），本期不自动挂接发货事件。

## 5.2 数据要素

```text
order_settlements:
  order_id          UNIQUE
  currency          订单币种
  revenue_total     numeric(18,4)（= Σ 行收入；价格缺失的行计 0 并标记）
  product_cost_total numeric(18,4)（= Σ 行成本；成本未知的行计 0 并标记）
  shipping_fee      numeric(18,4) NOT NULL DEFAULT 0（登记时人工可改）
  other_fee         numeric(18,4) NOT NULL DEFAULT 0（人工可改）
  profit            numeric(18,4)（= revenue − product_cost − shipping − other；
                    仅当订单币种 = 成本币种（CNY）时计算，否则 NULL）
  has_missing_price bool（存在无价格行）
  has_missing_cost  bool（存在无成本行）
  generated_by / generated_at / updated_at

order_settlement_items:
  settlement_id, order_item_id, sku_id
  quantity        numeric(18,3)
  unit_price      numeric(18,4) NULL（快照自订单行）
  revenue         numeric(18,4)（unit_price × quantity；无价计 0）
  unit_cost       numeric(18,4) NULL（快照自 SKU.moving_average_cost）
  cost            numeric(18,4)（unit_cost × quantity；无成本计 0）
```

## 5.3 计算规则

1. 收入 = Σ（订单行 unit_price × quantity）；unit_price NULL 的行收入计 0，
   `has_missing_price = true`（缺价事实可见，不臆造）。
2. 成本 = Σ（SKU 移动加权平均成本 × quantity）；成本 NULL 计 0，
   `has_missing_cost = true`。
3. 毛利：订单币种与 CNY 一致才计算；不一致只展示收入与成本，`profit NULL`
   （禁止跨币种直接相减）。
4. 已生成结算允许改 `shipping_fee / other_fee`（重算 profit），行快照不可改。
5. 重新生成（对已有结算）：行快照不变，仅补算金额合计（幂等）。

# 6. 采购应付（派生，不落库）

```text
应付金额（payable）    = Σ（PO 行 quantity × unit_cost），unit_cost NULL 的行不计
已付金额（paid）       = Σ（PURCHASE_PAYMENT 流水 且 purchase_order_id = PO）
未付余额（unpaid）     = payable − paid
付款状态               payable = 0 → NOTHING_TO_PAY
                       paid = 0 → UNPAID
                       0 < paid < payable → PARTIAL
                       paid ≥ payable → PAID
超付（paid > payable） → OVERPAID（允许登记，展示为风险色；防超付校验只针对
                       「本次付款后累计超过 payable + 容差 0」）
```

- 采购单无金额行（unit_cost 全空）→ payable = 0，状态 NOTHING_TO_PAY，
  页面提示「采购单未登记成本」。
- 已取消采购单禁止再登记付款。

# 7. 汇总报表（只读派生）

- `GET /finance/summary`：期间内收入/支出净额（按流水，剔除被冲正对）、
  已结算毛利合计、待付采购款合计、已确认回款合计。全部由上述事实派生，
  不引入第二事实源。
- 期间筛选：`from / to`（occurred_at / generated_at 口径分别注明）。

# 8. 编号与幂等

| 单据 | 编号 | 作用域 | 幂等键 |
|---|---|---|---|
| 财务流水 | FV%06d | finance_voucher | —（追加型，无天然幂等键） |
| 平台回款 | PY%06d | finance_payout | 确认生成流水用 `FINANCE_PAYOUT:<id>` |
| 订单结算 | —（挂订单） | — | `UNIQUE(order_id)` |

# 9. 禁止事项

1. 禁止修改/删除任何财务流水（错账冲正）。
2. 禁止用 FLOAT/DOUBLE 存金额（AGENTS §58）；前端展示用字符串直显。
3. 禁止在 finance 模块外直接写 `finance_transactions`（回款自动流水在
   finance 模块内完成）。
4. 禁止接入未核实的平台财务 API（AGENTS §88）。
5. 禁止把付款状态/应付金额作为列落库（派生原则）。
