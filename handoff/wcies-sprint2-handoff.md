# WCIES Sprint 2 — Inventory Core 交接文档（Handoff）

> 生成时间：2026-09-08 晚（会话中断于前端浏览器验证阶段）
> 下一会话焦点：完成 Web 浏览器验证 → 全量最终验证 → 按切片 git 提交 → 撰写 16 节最终报告

## 1. 任务与权威文件（先读）

- 任务书（唯一范围来源）：`E:\WCIES-2.0\WCIES_Agent_Task_—_Sprint_2_Inventory_Core.md`
- 项目纪律：`E:\WCIES-2.0\AGENTS.md`（硬规则，勿违反）
- 业务规则：`E:\WCIES-2.0\docs\business-rules\inventory.md`（已新增 §60 "Sprint 2 实现约定"，代码已与文档对齐）
- 依赖规则：`E:\WCIES-2.0\docs\architecture\dependency-rules.md`（Rule 3 已升级）

**Sprint 2 完成即停止，不得开始 Sprint 3。**

## 2. 当前状态总览

后端 100% 实现完毕且全绿；前端 3 页面已完成并通过 typecheck/lint；浏览器验证进行到一半（卡在初始化表单的仓库下拉）。**尚未 git commit（工作区全部为未提交改动）**。

### 已完成清单

| 模块 | 内容 | 状态 |
|---|---|---|
| 数量策略 | `apps/api/src/common/utils/quantity.ts`（毫单位 bigint，NUMERIC(18,3) 字符串化）+ spec | ✅ |
| Migration | `database/migrations/20260908_017..023_*.ts` 共 7 个（balances/safety/reservations/lines/events/transactions/indexes），已对 dev 库执行 | ✅ |
| 实体/枚举/错误 | `apps/api/src/modules/inventory/{entities,enums,errors}/` | ✅ |
| Repository | balance（FOR UPDATE 逐行锁定按 bin_code 序）、reservation（header+lines）、transaction（Event+Lines）、safety | ✅ |
| Services | inventory（initialize/receive）、adjustment、movement（moveBin）、safety、reservation（reserve/release/pick/unpick/ship）、query | ✅ |
| Controller | `inventory.controller.ts` 三个 Controller；initialize/receive/adjust 走 AdminGuard | ✅ |
| 架构检查 | `scripts/check-architecture.ts` Rule 3 已改为解析相对路径 | ✅ |
| Import | `initial-inventory-import.handler.ts` + ImportHandler 接口增加 ImportRowContext（jobId+rowNumber），幂等键 `INITIAL_INVENTORY:<jobId>:<row>` | ✅ |
| OpenAPI | 已 `pnpm openapi:export` + `pnpm api-client:generate`（openapi.json 与 schema.d.ts 已更新） | ✅ |
| 前端 | `apps/web/src/pages/inventory/{InventoryPage,InventoryTransactionsPage,ReservationsPage}.tsx` + 路由/菜单（库存组）+ hooks 扩展（apiPut、useApiQuery 支持 pathParams/enabled） | ✅ |
| 文档 | inventory.md §10 总表补 MOVE_BIN 行；新增 §60 实现约定 | ✅ |

### 质量门（全部通过，改动后需重跑）

- `pnpm lint` ✅（0 error）
- `pnpm typecheck` ✅（api + web）
- `pnpm check:arch` ✅
- `pnpm --filter @wcies/api test` ✅ 46 passed
- 集成测试（真实 PG）：
  - `tests/integration/inventory.integration.spec.ts` ✅ 19/19（并发最后一件、100 并发、幂等 x10、全生命周期、moveBin、调整防负、回滚、NO_RECORD vs ZERO、Safety 公式、多 Bin、死锁、§85 验收、5000 行性能 <500ms）
  - `tests/integration/inventory-import.integration.spec.ts` ✅ 5/5（模板校验、worker 导入、行级幂等重放、DEFAULT 虚拟库位、有库位仓拒绝无 bin 初始化）

## 3. 浏览器验证进行到的位置（中断点）

环境：`pnpm dev` 后台运行中 —— API `http://localhost:3000`，Web `http://localhost:5173`。管理员账号 admin，密码在 `.env`（ADMIN_PASSWORD）。Playwright MCP 已登录并在 `/inventory` 页。

已验证：
- ✅ 库存列表渲染、分页（403 页）、关键词搜索 VK87-BLK
- ✅ VK87-BLK @ SZ01-A01-01 显示 On Hand 7 / Reserved 0 / Picked 0 / Safety 2 / 可售 5（§85 验收终态正确）
- ✅ 详情 Drawer：汇总 + 仓库/库位明细 + Reservation + 库存流水 Tab（流水含 INITIAL_STOCK/RESERVE/PICK/SHIP/MANUAL_ADJUSTMENT 全链路）
- ⏳ 库存初始化 Modal 已打开，SKU 已选 VK87-BLU；**仓库下拉只显示 2 个 PERF 测试仓，看不到 SZ01**

### 当前待修问题（下一步第一件事）

仓库下拉数据源是 `useApiQuery('/api/v1/warehouses', {page:1, pageSize:100})`，列表按 createdAt DESC 排序——集成测试跑出的几十个 `ITXXXX-PERF` 仓把 seed 里的 SZ01（更早创建）挤出了第一页。
修复建议（任选）：
1. 该下拉 pageSize 提到 200+（简单）；或
2. 后端 warehouses 列表支持服务端搜索时用 `showSearch + onSearch`（更正规）。
顺带：`InventoryPage` 里 SKU 搜索选择框已用 `filterOption={false} + onSearch` 模式，可参照。

### 浏览器验证剩余项（任务 §80）

1. 修完仓库下拉后：完成初始化提交（VK87-BLU @ SZ01 某库位，量自定）→ 表格出现新行
2. 行内"安全库存"按钮：编辑并保存，确认 Safety 列变化、On Hand 不变
3. 行内"调整"按钮：+N 成功；再试超量 -N 应报错（409 错误信息 toast）
4. 行内"移位"或顶部"库内移位"：A→B 成功后两行数量变化
5. `/inventory/reservations` 页：列表 + 对某 ACTIVE 预约执行 拣货→出库（或释放），状态流转正确
6. `/inventory/transactions` 页：筛选类型/仓库，列表展示正常
7. （可选）导入中心 INITIAL_INVENTORY 模板 UI 冒烟——注意 ImportPage 的类型下拉 `IMPORT_TYPES` 常量在 `apps/web/src/pages/import/ImportPage.tsx`，**尚未加入 INITIAL_INVENTORY 选项**（容易遗漏的收尾项）

控制台现存 2 类无害告警：antd v6 的 `Space direction` / `Drawer width` 弃用警告（Sprint 1 页面同样存在，可不处理）。

## 4. 剩余工作（按顺序）

1. **修复仓库下拉**（见上）→ 完成上述 7 项浏览器验证
2. **ImportPage 增加 INITIAL_INVENTORY 选项**（一行改动）
3. **全量最终验证**（任务 §92）：
   - `pnpm lint && pnpm typecheck && pnpm check:arch`
   - `pnpm test`（全部 unit）
   - `pnpm test:integration`（全部 13 个 spec 一起跑，注意会再注入 PERF 数据）
   - `pnpm build`
4. **空库 Migration 验证**（任务 §93）：临时库（如 `wcies_blank`）跑 `DATABASE_URL=... pnpm db:migrate`，然后 `pnpm seed:dev && pnpm seed:sprint1`，全部成功即可（可 docker exec psql 建库）
5. **git 提交**（任务 §90 建议切片；当前全部未提交）：
   - 建议顺序：balance+safety 模型 / event+transaction 账本 / 初始化+调整 / 预约引擎 / 生命周期 / moveBin / import / arch+docs / openapi+client / web UI / 测试
   - 提交信息用 conventional commits；`.zcode/` 与两份任务书 md **不要提交**（与之前一致保持 untracked）
6. **最终报告**：按任务书 §95 的 16 节格式输出在会话中（含数据模型说明：采用了 Event+Lines、Reservation Header+Lines——任务 §18/§26 要求报告说明；pick 为整笔全量 API、行级 picked_qty 已预留——§32 要求说明边界）

## 5. 关键技术决策与坑（已解决，勿回退）

1. **连接池自死锁**：QueryRunner 事务持连接期间，绝不能经 DataSource 共享池再发查询（buildDtoWithCodes/operationLog/排序查 bin_code 都会踩）。现行纪律：事务内只用 runner 连接（`findLinesTx`、`sortLinesByBinCodeOnRunner`、`findEventByIdempotencyKeyTx`），commit/release 之后再做事后查询与 OperationLog。
2. **getRawAndEntities 的 ORDER BY 必须用实体属性**（如 `b.skuId`），用 raw join 别名（`sku.sku_code`）会触发 TypeORM 内部 databaseName undefined 崩溃。
3. **lockOrCreate 用 `INSERT ... ON CONFLICT DO NOTHING`**：普通 INSERT 撞唯一约束会中止整个 PG 事务（"current transaction is aborted"），catch 里补查救不回来。
4. **`createQueryRunner()` 是同步的**，不要 await（lint 已拦截）。
5. **唯一约束错误在 `error.driverError` 里**，`isUniqueViolation/isUniqueViolationOn` 已解包。
6. Reservation lines 显式 insert（OneToMany 无 cascade 时 save 不会落 lines）。
7. 并发幂等三重防护：锁前预查 → **拿到行锁后事务内复查** → 唯一约束兜底 + 回放。
8. `QueryRunner.query` 无泛型，用 `as unknown as Array<T>` 断言。
9. 前端 `useApiQuery` 返回归一化 `{data, meta}` 包装（data 里才是业务数据），路径参数走第 4 参、第 5 参 enabled。
10. Windows Git Bash 环境；杀进程用 `netstat -ano | grep :PORT` 找 PID + `taskkill //F //PID <pid>`（双斜杠）。

## 6. 环境备忘

- 基础设施（docker compose，已 up）：PG `localhost:5432/wcies_dev`（用户 wcies）、Redis `:6379`、MinIO `:9000`
- dev 服务器：`pnpm dev` 后台运行（API:3000 / Web:5173）；如端口冲突先查 netstat 再杀
- 集成测试每个文件独立端口（3101-3111）；Redis db 5/7/8/9 分散使用
- DB 里有测试残留（`IT*-PERF` 仓、`PERF-*` SKU、每 run 追加 ~5000 balance 行）——属预期，勿清理生产式数据；VK87-BLK 的 §85 场景由测试自行重置
- Playwright MCP 浏览器保持登录态（admin）；密码读 `.env` 的 ADMIN_PASSWORD（勿写入任何提交内容）

## 7. 建议技能（Suggested skills）

- `browser-use:web-gui-tester`（或控制浏览器技能）— 继续第 3 节的 GUI 验证，纯黑盒点选 + 截图确认
- `mattpocock-skills:implement` — 按第 4 节顺序收尾（改动小而明确，规格即本文档）
- `mattpocock-skills:code-review` — 提交前对全部 diff 做一次 Standards/Spec 双轴自查（可选）

## 8. 红线提醒（AGENTS.md 摘要）

- 不重构 Sprint 1 已验收功能；只改本 Sprint 必要文件
- 库存只经 Inventory 模块 Service；流水/事件无删除 API；不引入平台词汇进 Inventory Core（§82 搜索应为 0）
- 禁止新依赖（未引入任何新包）；状态枚举不得自行新增
- 提交前跑 lint/typecheck/arch；涉及库存核心必须 integration 通过
