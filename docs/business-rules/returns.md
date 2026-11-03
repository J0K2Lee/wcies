# WCIES Return / Refund Business Rules（双轴任务 T5，2026-09-15 冻结）

> 本文档定义 WCIES 退货/退款领域的业务事实、状态与合法变化。所有涉及退货的代码
> 修改，必须以本文档为准。
>
> 规则来源：双轴任务书 §3 T5（用户 2026-09-15 指示「本次整模块做」，路线图
> Sprint 12 前移）、`docs/会议纪要.md`（退货批次对单难点 / 退货临时仓隔离 /
> 库存联动）、AGENTS.md 冻结约束、OZON v3 英文规范（退货端点 2026-09-15 核对）。

---

# 1. 核心原则：三个正交事实

```text
平台退货记录（PlatformReturn） → 平台说了什么？（只读事实，raw_data 留存）
退货批次（ReturnBatch/Item）   → 实物做了什么？（作业单据，驱动库存回流）
退款状态（refund state）       → 平台退了多少钱？（平台事实，本期仅展示）
```

- 平台退货记录由同步拉取，**只读**；永不直接驱动库存（平台说退了 ≠ 货到了）。
- 退货批次是唯一能产生库存回流的单据；实物**经检验后**才入账。
- 退款金额/状态本期不做财务对账（路线图 Sprint 13）；禁止在退货模块发明
  财务写操作。

# 2. 平台退货记录（PlatformReturn）

## 2.1 数据来源（OZON，规范核对 2026-09-15）

| 端点 | 用途 | 本期 |
|---|---|---|
| `POST /v2/returns/rfbs/list` | rFBS（=卖家 FBS）退货单，带 `return_number` / `return_id` / `posting_number` / `order_number` / `state{state, money_return_state_name}` / `product{sku,offer_id,price}` / `created_at` | ✅ 已接入（手动触发同步） |
| `POST /v1/returns/list` | FBS/FBO 统一退货（旧接口，`exemplars[]`/`visual`/`place`） | 记录事实，暂不接入 |

字段映射在 OZON mapper 内消化；`raw_data` 原文留存（AGENTS §34）。

## 2.2 唯一性与关联

- 业务唯一键：`UNIQUE(store_id, platform_return_id)`（`platform_return_id` 取
  `return_number`；同店允许不同退货单）。
- `posting_number` 非空时自动按 `(storeId, posting_number)` 关联订单
  （store scoped，AGENTS §26/§35 同源规则）。
- **关联失败（平台单号在 WCIES 无订单）→ 创建 `RETURN_ORDER_NOT_FOUND`**
  （severity=HIGH，reference=PLATFORM_RETURN）；后续人工补关联或确认后解决。
- 重复同步 upsert 幂等：字段不变零写入；状态/退款状态变化更新事实。

## 2.3 定时轮询与退货提醒（2026-11-02）

平台退货记录此前只有手动同步入口（`POST /api/v1/returns/platform/sync`），
从没定时跑过。现在由 buyer-feedback 的 5 分钟 tick 按店铺节流：

- **每 15 分钟**拉一次，窗口 = 最近 7 天（`createdFrom`），只拉声明了
  `adapter.returnAlertsEnabled` 的平台（OZON + Yandex；WB 的 claims 条目结构
  未验证，暂不参与）。Yandex 的信封 bug（读顶层 `returns`）已于 2026-11-02
  修复为 `result.returns`，修好前它每次同步都报 `returns array missing`；
- 新建退货单 → 通知 `RETURN_REQUESTED`；状态变化 → `RETURN_STATE_CHANGED`
  （同一退货单同一状态只推一次）；
- **定时轮询不产生 `RETURN_ORDER_NOT_FOUND` 异常**
  （`raiseUnlinkable: false`）——提醒只负责告知"有新退货"，历史退货的关联
  问题仍由人工同步暴露，避免一上线就刷一批异常；
- **首次同步（该店还没有任何退货记录）只回填、不推送**；
- 轮询不写库存：退货入库仍由退货批次的检验动作决定（§3）。

# 3. 退货批次（ReturnBatch）

## 3.1 数据要素

```text
return_batches:
  batch_no        业务编号 RT%06d（集中式序号表，作用域 return_batch）
  warehouse_id    收货仓库（推荐专用退货仓/临时仓；任意仓合法——隔离靠
                  库存 condition，不靠仓库类型，AGENTS §30 多仓共享不受影响）
  status          状态机（见 3.2）
  source_note     货源说明（如「Amol 仓 9-15 批次」）
  remark / created_by / created_at / updated_at

return_batch_items:
  batch_id            所属批次
  platform_return_id  关联平台退货记录（可空 → 人工登记行）
  sku_id              内部 SKU（必填；人工行扫码/选择录入）
  quantity            实收数量（> 0）
  condition           检验结论 SELLABLE / DEFECTIVE / LOST（初始 PENDING）
  bin_id              回库目标库位（检验时指定；空 → 该仓 STAGING 兜底）
  remark
```

## 3.2 批次状态机（冻结）

```text
DRAFT → RECEIVED → COMPLETED
   └─→ CANCELLED（仅 DRAFT：实物未到、未入账）
```

- `DRAFT`：登记批次与预期行（可从平台退货记录一键生成，也可人工录入）。
- `RECEIVED`：实物已到退货仓并清点。**不可逆**；此后行内容不可增删。
- `COMPLETED`：全部行检验处置完毕（每行 condition 已定且库存动作已执行）。
  自动迁移，无人工动作。

## 3.3 行检验与处置（condition）

```text
PENDING → SELLABLE   检验合格：receiveStockInTx(condition=SELLABLE)
PENDING → DEFECTIVE  质量问题：receiveStockInTx(condition=DEFECTIVE)
                      （隔离库存：不计可售，AGENTS §11 三层口径）
PENDING → LOST       实物缺失/丢失：不入账，零库存动作
```

- 检验结论**一次性写定**（不可改判）；判错走库存调整流程（inventory.md），
  不在退货模块重开。
- 库存动作必须经 `InventoryService`（AGENTS §10）；引用类型
  `RETURN_RECEIPT`、`referenceId = batchItemId`、幂等键
  `RETURN_RECEIPT:<batchItemId>`；事件类型复用 `RECEIVE`（与
  `PURCHASE_RECEIPT` 同模式，靠引用类型对账来源）。
- `bin_id` 为空时自动落到该仓库 `STAGING` 库位（与拦截回库同兜底规则，
  orders.md §9.5）；已扫码库位严格校验归属。
- 检验前实物在退货临时区（系统外暂存）：**不产生任何库存流水**——
  与采购草稿同理，「平台说退了/货在路上」都不是库存事实。

## 3.4 批次对单策略（会议纪要核心难点）

> 「退货通常以批次形式返回，无法准确对应到原始订单。」

- 批次是**实物单位**，允许混单（一批货来自多个订单/多个平台退货记录）。
- 对账锚点是**平台退货记录**，不是批次：每条 `platform_returns` 记录期望
  恰好被一条批次行关联；未关联的记录留在「待收货」列表提醒，不阻塞作业。
- 人工行（无 platform_return_id）不参与对单——直退/无法溯源的货，记录
  SKU 与数量即可（会议纪要：「货回来了但不知来自哪单」的兜底）。

## 3.5 差异异常（RETURN_DIFFERENCE）

批次行 condition 落定为 `DEFECTIVE` / `LOST` 且该行关联平台退货记录时，
创建 `RETURN_DIFFERENCE`（severity=MEDIUM，reference=RETURN_BATCH_ITEM）：
平台已退款/待退款但实物不合格或缺失，需人工索赔/申诉。(type, reference)
OPEN 去重；不自动解决。

## 3.6 作业入口与界面口径（2026-11-03）

退货回库的完整路径（此前入口埋得太深，运营反馈「没有处理流程、无法回库」）：

```text
作业中心 → 退货
├─ 平台退货记录（只读事实）
│    选中一条 → 右栏「用此记录建退货批次」（自动带入 SKU 与数量）
└─ 退货批次
     新建 → 明细（平台记录行自动解析 SKU / 人工行按编码或名称搜索选择内部 SKU）
     ↓ 创建后直接打开批次详情（DRAFT）
     选中该批次 → 右栏「确认收货」（DRAFT → RECEIVED，行锁定）
     ↓
     批次详情 → 行内「合格回库 / 不合格 / 缺失」→ 库存回流
```

- **草稿不能检验**：必须先确认收货（明细区有提示），这是 §3.2 状态机的要求，
  不是 UI 限制。
- **人工行必须选内部 SKU**：弹窗内提供按 `sku_code` / 名称搜索的选择器；
  平台记录行由后端按店铺解析平台 SKU（§24/§26 同源规则）。
- **回库库位可见**：检验后明细显示 `binCode`（显式库位或 STAGING 兜底），
  运营可据此核对库存流水。
- 平台退货记录只读，不因建批次而改状态；对账锚点是记录与批次行的关联
  （§3.4）。

**列表能力（2026-11-03，用户反馈「全是订单号、列表太长、无法搜索」）：**

| 页签 | 搜索 | 筛选 | 批量 |
|---|---|---|---|
| 平台退货记录 | 退货单号 / 平台订单号 / Offer ID / 平台 SKU | 店铺、入批状态（待入批次 / 已入批次） | 勾选多条 → 一个批次一次带入（已入批次的记录禁选） |
| 退货批次 | 批次号 / 平台退货单号 / 内部 SKU 编码 | 批次状态 | 勾选草稿 → 批量确认收货（逐张推进，失败单列） |

- 平台退货记录行显示**商品明细**：内部 SKU 编码 + 名称 + Offer（按店铺解析
  平台 SKU，未映射标红提示），以及「已入批次」列（已入批次号 / 待入批次标签）。
- 退货批次行显示**待处理行数**（检验结论仍为 PENDING 的行），用来快速定位
  「还需要回库处理」的批次。
- 组件复用：`FilterBar` + `DataTable(rowSelection)` + `ActionIsland`（与采购页
  同款底部浮岛），不另造交互。

---

# 4. 退款口径与财务边界

- 平台退货记录的退款状态（`money_return_state_name` 等）与金额均为**平台
  事实展示**；WCIES 本期不产生任何退款写操作、不对账（Sprint 13）。
- 买家退款的资金流由平台处理；WCIES 的成本回归（退货商品成本还原、
  平均成本影响）属于未来成本模块范围，本期不做。

# 5. 与 PICKED 取消拦截（interception）的分工

```text
interception（orders.md §9）：货未离开 WCIES 仓库（PICKED 未出库）→ 仓内拦截找回
returns（本文档）：货已交平台物流/买家 → 平台退货记录 + 实物批次回流
```

- `ORDER_CANCELLED_AFTER_SHIP`（双轴 T4）是**订单侧提示异常**：已发货单被
  平台取消，指向退货流程；该异常人工处理（本期不自动关联/解决——平台退货
  记录到达并建批次后由人工 RESOLVE）。
- 两条路径互斥：SHIPPED 行禁止仓内拦截（orders.md §8），拦截任务禁止对
  已出库货物执行（`INTERCEPTION_NOT_ALLOWED_AFTER_SHIPMENT`）。

# 6. 异常类型

| 类型 | 触发 | severity | reference | 解决 |
|---|---|---|---|---|
| `RETURN_ORDER_NOT_FOUND` | 平台退货记录无法关联订单 | HIGH | PLATFORM_RETURN | 人工补关联/确认后 |
| `RETURN_DIFFERENCE` | 检验 DEFECTIVE/LOST 且行关联平台记录 | MEDIUM | RETURN_BATCH_ITEM | 索赔/申诉后人工 |

# 7. 幂等与并发

1. 平台退货 upsert：`UNIQUE(store_id, platform_return_id)` DB 兜底；
   字段不变零写入。
2. 库存回流幂等键 `RETURN_RECEIPT:<batchItemId>`（库存事件唯一约束兜底）；
   行 condition 一次性写定，重复检验调用直接拒绝（非法状态迁移）。
3. 批次 `RECEIVED` 后行不可增删（状态检查）；并发确认由状态检查 + 单事务
   保证。

# 8. 通知

- 批次收货确认、差异异常创建时记录操作日志（OperationLog）；
- 差异异常进入异常中心（统一通知面）；本期不直接调用 FEISHU
  （AGENTS §52：业务模块不直接发外部通知，异常中心/通知模块决定渠道）。

# 9. 修改本文档的条件

- 新增/删除批次或行状态、检验结论取值；
- 改变库存回流路径 / condition 语义 / 幂等键；
- 改变对单策略或差异判定；
- 接入新平台退货端点（v1/returns/list 等）或退货平台写操作
  （`/v1/returns/rfbs/action/set` 需专项确认，AGENTS §92）。

不得先写代码，再让文档适配代码。
