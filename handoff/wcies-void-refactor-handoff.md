# Handoff — WCIES shipment/package 物理删除 → 可审计 VOIDED 改造（进行中）

工作区：`E:\WCIES-2.0`（Windows / Git Bash）。前置上下文见仓库内
`WCIES_Agent_Task_—_Sprint_4_Shipment_&_Interception.md`、`AGENTS.md`、
`docs/business-rules/orders.md`（§15A）。本改造是 Sprint 4 完成后的用户追加需求，
方案已经用户批准（含 4 点修订 + 2 点执行注意，原文在会话记录中，要点如下）。

## 用户批准的方案要点（必须遵守）

1. `shipment_items` / `package_items` / `package_item_serials` 一律 **VOIDED 替代删除**，
   行永久保留作审计历史；**所有业务计算只统计 ACTIVE**。
2. 审计字段：`status`、`voided_at`、`voided_by`（**uuid，FK → users.id**，稳定身份）、
   `voided_by_name`（显示名快照）、`void_reason`、`void_source_type`、`void_source_id`。
   `package_item_serials` 仅 `status/voided_at/voided_by`。
3. `void_source_id` 为**多态引用，不建 FK**；`void_source_type ∈ {ORDER_INTERCEPTION, MANUAL}`
   与来源存在性由 **Service 层校验**（已实现 `assertVoidSource`）。
4. `shipment_items` 只保留一个部分唯一索引
   `uq_shipment_items_order_item_active ON (order_item_id) WHERE status='ACTIVE'`；
   复合唯一已删除，`idx_shipment_items_shipment` 为普通索引。
   `package_items` 的 `(package_id, order_item_id)` 也改为部分唯一
   `uq_package_items_package_order_item_active`；
   `package_item_serials` 改为 `uq_package_item_serials_serial_active (serial_number) WHERE ACTIVE`。
5. **迁移必须显式回填** `UPDATE … SET status='ACTIVE'` 后才建 CHECK/部分唯一
   （不能只靠 DEFAULT 隐式完成）。
6. docs 语义（用户原话要点）：`shipment_item.status = ACTIVE` 表示“仍是 Shipment 的
   有效组成部分、未被作废”，**不表示“尚未发货”**——Shipment 已 SHIPPED 后其有效
   shipment_items 保持 ACTIVE 是正确状态；`package_item.ACTIVE` 同理。需写入
   `docs/business-rules/orders.md`（§15A + §9 拦截回库改为“作废 + 回库，不得物理删除”）。
7. 必须新增 **Repository/Database 级回归测试**：旧 VOIDED + 新 ACTIVE 可共存，
   第三条同 OrderItem 的 ACTIVE 被唯一约束拒绝（不发明新业务入口）。
8. 拦截回库、Package 重算、Inventory returnPickedStockInTx、Reservation RELEASED、
   OrderItem RELEASED、Interception 状态必须保持**同一事务**（现有结构未破坏）。

## 已完成（工作区未提交）

新文件：
- `database/migrations/20260910_010_extend_shipment_items_void.ts`（完整：审计列+回填+CHECK+FK users+删两旧唯一+部分唯一+普通索引）
- `database/migrations/20260910_011_extend_package_items_void.ts`（完整：package_items 同套 + 复合唯一改部分唯一；serials 加 status/voided_at/voided_by + 串行号部分唯一）

已修改：
- `shipment/enums/shipment.constants.ts`：SHIPMENT_ITEM_STATUSES / PACKAGE_ITEM_STATUSES /
  PACKAGE_ITEM_SERIAL_STATUSES / VOID_SOURCE_TYPES（含类型导出）。
- 三个实体重写：`shipment-item.entity.ts`、`package-item.entity.ts`、
  `package-item-serial.entity.ts`（新列 + 部分唯一 `@Index(..., { where: "status = 'ACTIVE'" })`，
  与迁移 SQL 的 where 表达式一致）。
- `shipment/repositories/shipment.repository.ts`：insertWithItems 显式 ACTIVE；
  findItemsByShipmentId(/Tx) 过滤 ACTIVE；新增 findAllItemsByShipmentId；
  findLiveShipmentOfOrderItem 加 `si.status='ACTIVE'`；`removeShipmentItem` 已替换为
  `voidShipmentItem(manager, {orderItemId, operator, reason?, sourceType, sourceId?})`
  （UPDATE … WHERE status='ACTIVE'，返回 affected）；listWithAggregates 的 items_total
  加 `si.status = :activeItem`（参数 SHIPMENT_ITEM_STATUSES[0]）。
- `shipment/repositories/package.repository.ts`：`removeItemsForOrderItemTx` 已替换为
  `voidItemsForOrderItemTx(manager, input)`（VOID package_items + 同步 VOID
  package_item_serials；emptied = 无 ACTIVE 行）；findItems / findSerialsOfPackage /
  findSerialsOfShipmentItem(+pis.status) / packedTotalsByShipmentTx(+pi.status) /
  countSerialsOfItemTx 全部 ACTIVE 过滤。
- `shipment/services/packing.service.ts`：getPackageWorkbench 两处裸 SQL 加 ACTIVE 过滤。
- `shipment/services/shipment.service.ts`：getDetail 增 `voidedItems`（含审计字段），
  items 仅 ACTIVE；`handleInterceptionReturnInTx(runner, input{orderItemId, operator,
  reason?, sourceType, sourceId?})` + 私有 `assertVoidSource`；调用点改为
  voidItemsForOrderItemTx / voidShipmentItem。**⚠ 已知未完成：errors 导入块
  （文件 14-18 行）缺 `ShipmentVoidSourceInvalidError`** —— 这是当前仅剩的 2 个
  tsc 错误来源（559/564 行）。
- `shipment/errors/shipment.errors.ts`：新增 `ShipmentVoidSourceInvalidError`
  （code `SHIPMENT_VOID_SOURCE_INVALID`，422）。
- `shipment/dto/shipment.dto.ts`：ShipmentItemDto 增 status/voidedAt/voidedBy/
  voidedByName/voidReason/voidSourceType/voidSourceId；ShipmentDetailDto 增 `voidedItems`。
- `interception/services/interception.service.ts`：returnToStock 内调用已改为传
  `{ orderItemId, operator, reason:'拦截回库：该行已取消并实体回库',
  sourceType:'ORDER_INTERCEPTION', sourceId: id }`。

## 立即要做的下一步

1. `shipment.service.ts` 错误导入块加 `ShipmentVoidSourceInvalidError`，然后
   `pnpm --filter @wcies/api exec tsc --noEmit -p tsconfig.json` 清零。
2. `grep -rn "removeShipmentItem\|removeItemsForOrderItemTx" apps/api tests` 确认无残留引用。
3. 前端 `apps/web/src/pages/shipments/ShipmentDetailPage.tsx`：
   - 主表「待发商品 (N)」天然只显示 ACTIVE（API 已过滤），补本地类型
     `voidedItems` 与 item 可选审计字段；
   - 新增**默认折叠**卡片「已作废 / 历史记录 (N)」：每行 SKU、原数量、VOIDED 标签、
     作废原因、作废时间、作废人（voidedByName）、对应 Interception
     （`voidSourceType==='ORDER_INTERCEPTION'` 时链到 `/interceptions/{voidSourceId}`）；
   - 进度条仍按 items（ACTIVE）计算，voidedItems 不计入。
4. 新增 `tests/integration/shipment-item-void.integration.spec.ts`（Repository 级）：
   - 模式参考 `tests/integration/picking-ship-atomicity.integration.spec.ts`
     （spawn API + `createRequire(resolve(import.meta.dirname,'../../apps/api/package.json'))`
     加载 dist 的 `ShipmentRepository`/实体；API fixture 用 `ApiClient`（sprint1.helpers））；
   - 步骤：HTTP 建 SKU/订单/拣货 → `POST /api/v1/shipments` 得到 ACTIVE 行 →
     直接调 repo `voidShipmentItem` → 用 DataSource repo 再插入同 order_item 的
     ACTIVE 行（成功）→ 第三次插入期望 PG `23505`（constraint
     `uq_shipment_items_order_item_active`）→ `findAllItemsByShipmentId` 断言
     1 VOIDED + 1 ACTIVE 共存。
5. 更新 `tests/integration/shipment.interception.integration.spec.ts`：
   - 回库后 `detail.voidedItems` 含 1 条且 `status==='VOIDED'`、
     `voidSourceType==='ORDER_INTERCEPTION'`、`voidSourceId===interceptionId`；
     `items` 不再含该 SKU；shipment 仍 CANCELLED（§75）；
   - 多行 §76 场景后追加：重新打包剩余 ACTIVE 行 → Seal → Ship 成功（只按 ACTIVE 扣库存）；
   - SN 场景：回库后 serial VOIDED、SN IN_STOCK，**再次装箱同一 SN 不报唯一冲突**；
   - 重复回库被状态机拒绝、无第二条 VOIDED。
   注意该文件已有 `barcodeBySku` / `interceptionDetail()` / `pickedOrderFixture()`
   辅助；bin 条码形如 `${PREFIX}-SWH-A01-01`；`client.patch` 可用。
6. `docs/business-rules/orders.md`：§15A 增 ACTIVE/VOIDED 生命周期与语义
   （严格按上面第 6 条用户措辞）、部分唯一约束、“业务计算只统计 ACTIVE”；
   §9 拦截回库改为“作废 + 回库，不得物理删除”。修正实体/迁移内旧注释
   （实体注释已更新，检查是否还有 “row is deleted” 残留）。

## 验证清单（全绿才算完成）

```bash
pnpm db:migrate                      # dev 库（迁移 010/011）
docker exec wcies-postgres psql -U wcies -d postgres -c "DROP DATABASE wcies_test"
docker exec wcies-postgres psql -U wcies -d postgres -c "CREATE DATABASE wcies_test OWNER wcies"
pnpm exec tsx scripts/ensure-test-db.ts   # 空库迁移验证（psql 不在 PATH，用 docker exec）
pnpm build && pnpm typecheck && pnpm lint && pnpm check:arch && pnpm test
pnpm test:integration                # 基线 73 单元 + 115 集成须全绿 + 新增用例
pnpm openapi:export && pnpm api-client:generate && pnpm --filter @wcies/api-client build
```

GUI 抽查（dev：`pnpm --filter @wcies/api dev` + `pnpm --filter @wcies/web dev`，
登录凭据在 `.env`）：拦截回库后 `/shipments/:id` 折叠区可见「已作废 / 历史记录」及
Interception 链接。截图存 `gui-test-screenshots/`。

提交（lint-staged+prettier 钩子会自动格式化，commit 后需复验）：
建议分批 `feat(api): void audit lifecycle…` / `feat(web): …` /
`test: …` / `chore(openapi): …`。

## 环境备忘

- docker（wcies-postgres/redis/minio）在跑；dev 服务器已停（端口 3000/5173）。
  API 手动启动需带 `.env` 等价环境变量（参考 tests/integration/setup.ts 默认值；
  集成测试密码默认 `integration-test-password`，dev 密码见 `.env`，勿写入任何文档）。
- 全局没有 `tsx`/`psql`，用 `pnpm exec tsx` / `docker exec wcies-postgres psql`。
- Git：main 分支，Sprint 4 已提交 4 个（16af74c/d837425/aea2614/b5a7046）；
  本次 VOID 改造全部在工作区未提交。
- 基线：73 单元 + 115 集成 + GUI 14/14（截图在 `gui-test-screenshots/sprint4/`）。

## 风险提示

- TypeORM `@Index(where)` 与迁移 SQL 的 where 字符串必须一致（`status = 'ACTIVE'`）。
- 迁移 010/011 尚未在任何库执行过；若 down/up 有笔误会先在空库暴露。
- prettier 钩子可能重排新文件，commit 后重跑 typecheck/lint。
