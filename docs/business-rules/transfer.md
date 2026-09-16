# WCIES Transfer（调拨）Business Rules（Sprint 10，2026-09-17 冻结）

> 本文档定义 WCIES 仓库间调拨领域的业务事实、状态与合法变化。所有涉及调拨
> 的代码修改，必须以本文档为准。
>
> 规则来源：用户 2026-09-17 指示「补齐缺失功能，完整 ERP 体验」（路线图
> Sprint 11「调拨」提前实施）、AGENTS.md §10/§17（库存唯一入口 + 事务）、
> inventory.md（余额/流水/占用规则）、CONTEXT.md（库位术语）。

---

# 1. 核心原则：一张单据，一个事务，两段库存事实

```text
调拨单（TransferOrder）      → 业务意图（可登记、可取消）
TRANSFER_OUT 库存事件        → 源库位扣减（On Hand 减少）
TRANSFER_IN 库存事件         → 目标库位增加（On Hand 增加）
```

- 出库与入库在**同一个数据库事务**内完成（确认即整体移库）：
  任一段失败全部回滚，不存在「货已出、账未入」的中间态。
- **在途库存不建模**：本期调拨是瞬时完成的账实移动（事务提交即完成）。
  物理在途 tracking 属后续范围（需独立在途条件/库位设计，不得擅加）。
- 调拨只动 `SELLABLE` 库存；占用（reserved/picked）不迁移——有占用的
  数量本来就不允许被调走（见 §4 校验）。

# 2. 数据要素

```text
transfer_orders:
  transfer_no        业务编号 TRF%06d（集中式序号表，作用域 transfer_order）
  from_warehouse_id  源仓库（必填，≠ 目标仓库）
  to_warehouse_id    目标仓库（必填）
  status             状态机（见 §3）
  remark / created_by / created_at / updated_at

transfer_order_lines:
  transfer_id        所属调拨单
  sku_id             内部 SKU（必填）
  quantity           numeric(18,3) CHECK (quantity > 0)
  from_bin_id        源库位（可空 = 源仓虚拟 DEFAULT 库位）
  to_bin_id          目标库位（可空 = 目标仓虚拟 DEFAULT 库位）
  out_event_no / in_event_no  库存事件回写（确认后填写）
  remark
```

# 3. 状态机（冻结）

```text
DRAFT → CONFIRMED（确认调拨：逐行执行 TRANSFER_OUT + TRANSFER_IN，
                    全部成功才提交；不可逆）
DRAFT → CANCELLED（仅 DRAFT；未碰任何库存）
```

- `DRAFT`：登记意图，可增删行、可取消。
- `CONFIRMED`：库存已事实移动。此后发现错误 → 反向再开一张调拨单，
  禁止「修改已确认单据」。
- 没有「部分确认」：任一行库存不足，整单确认失败（422 指明缺货行），
  库存保持原状。

# 4. 确认校验（事务内，逐行）

1. 单据状态必须 DRAFT。
2. 源/目标仓库不同；仓库与库位归属有效（复用 inventory 维度解析）。
3. 源库位 `SELLABLE` 余额 ≥ 行数量；**可售口径**（On Hand − Reserved −
   Picked）不足即拒绝——被订单占住的库存不得调走（AGENTS §11/§16）。
4. 行数量 > 0；SKU 必须存在且非 INACTIVE。

# 5. 库存事件与幂等

- 出段：`eventType = TRANSFER_OUT`，`referenceType = TRANSFER`，
  `referenceId = 调拨行 id`，幂等键 `TRANSFER_OUT:<lineId>`。
- 入段：`eventType = TRANSFER_IN`，`referenceType = TRANSFER`，
  `referenceId = 行 id`，幂等键 `TRANSFER_IN:<lineId>`。
- 两段各产生一事件两流水行（源余额行 / 目标余额行），余额版本号随行推进
  （inventory.md 乐观锁不变）。
- SN 管理商品：**本期不支持调拨**（拒绝并提示）——哪个序列号随单移动是
  单元级决策，未指定 SN 的调拨无法保证账实一致；开放需先设计 SN 选择
  交互，属后续范围。

# 6. 与其他模块的关系

- 调拨不产生采购、财务事实（无金额）；成本随 SKU 移动加权平均自然保持
  （同一 SKU 全仓共享成本，purchase.md §4.4）。
- 调拨单确认后操作日志记录 `TRANSFER_ORDER` 实体的 CONFIRM 动作与各行
  库存变化摘要（提交后 best-effort）。
