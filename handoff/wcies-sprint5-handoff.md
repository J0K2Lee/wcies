# WCIES Sprint 5 — Handoff（接手文档）

> 写于 2026-09-09，Sprint 5 执行至 GUI 验收阶段（约 95% 完成）。
> 任务书：`E:\WCIES-2.0\WCIES_Agent_Task_—_Sprint_5_Platform_Integration_Foundation_+_OZON.md` + `E:\WCIES-2.0\WCIES_Sprint_5_任务书修订说明.md`（修订说明优先）。

## 1. 当前状态总览

| 项 | 状态 |
|---|---|
| S5-P0 OpenAPI Response Schema 修复 + check:openapi | ✅ 已提交（9253ce3） |
| Platform Contract / Integration / OzonClient/Mapper/Adapter / SyncModule | ✅ 已提交（2c54c27） |
| Sync bug 修复（single-flight 索引、claimRunning 返回形状、webhook 入队）+ 15 场景集成测试 | ✅ 已提交（2584cee） |
| 前端（Sync Center / Store 同步 Tab / UNMAPPED 映射 / 订单 syncSource） | ✅ 已提交（4d5edd7） |
| docs（ozon.md 真实化 / orders.md / master-data.md） | ✅ 已提交（3b8b1cc，amend 过） |
| 空库 Migration 验证 | ✅ DROP wcies_test 后整套 132/132 通过 |
| **GUI 验收（任务书 §64 共 14 项）** | ⏸ **进行中，发现 1 个前端 Bug 阻塞（见 §3）** |
| 全量回归终版 + 清理 + 最终报告（§65） | ❌ 未做 |

测试基线（修订说明 §7 要求不得低于）：Unit **105 passed**、Integration **132 passed**（均已验证）。

## 2. Git 状态

- 分支 `main`，最近 5 个提交：`3b8b1cc`(docs) → `4d5edd7`(web+api UI) → `2584cee`(sync fixes+tests) → `2c54c27`(sync engine) → `9253ce3`(openapi fix)。
- **无远程**（git remote 为空），历史中真实 API Key 从未入库（已做过全历史 grep 验证 + amend 清理）；公开 Client ID 出现在两个中间提交的测试 fixture 里（无敏感性，可留）。
- 未跟踪文件中这些**不要动**（修订说明 §9）：Sprint 3/4/5 任务书 md、`docs/ozon test info.txt`（真实凭证）、`docs/ozon-seller-openapi.json`、`gui-test-screenshots/`、`handoff/`、`show-me-wcies-sprint1.html`。
- 需要清理的临时文件：`E:\WCIES-2.0\.gui-mock-ozon.mjs`（GUI mock 服务器，验收后删除）。

## 3. 🔴 刚发现的阻塞 Bug（GUI 验收 T2 起被卡）

**现象**：店铺详情抽屉里所有带路径参数的查询全部 500，浏览器 console 显示请求打到了字面量占位符 URL：

```
GET /api/v1/stores/%7Bid%7D                    (即 {id})
GET /api/v1/stores/%7BstoreId%7D/credentials
GET /api/v1/stores/%7BstoreId%7D/warehouse-bindings
GET /api/v1/sync/stores/%7BstoreId%7D/overview
```

**根因**：`apps/web/src/api/hooks.ts` 的 `useApiQuery(path, params, queryKey, pathParams?, enabled?)` 需要第 4 参做 `{xxx}` 替换，但 `apps/web/src/pages/stores/StoresPage.tsx` 里的抽屉查询**都没传 pathParams**（Sprint 1 起就存在的问题，本次同步 Tab 沿用了同样写法）。写操作（apiPost）是显式传 pathParams 的，所以凭证保存成功（列表「已配置」可见）而抽屉表格一直「暂无数据」。

**修复方式**（StoresPage 4 处 + 同步检查 ListingsPage 的 `/api/v1/listings/{id}` 详情查询是否同样缺参）：

```ts
// 现在（错）：
const detail = useApiQuery<StoreRow>('/api/v1/stores/{id}', {}, ['store-detail', drawerId]);
// 改成：
const detail = useApiQuery<StoreRow>('/api/v1/stores/{id}', {}, ['store-detail', drawerId],
  { id: drawerId ?? '' }, drawerId !== null);
```

涉及：`/api/v1/stores/{id}`、`/api/v1/stores/{storeId}/credentials`、`/api/v1/stores/{storeId}/warehouse-bindings`、`/api/v1/sync/stores/{storeId}/overview`（我新加的）。改完 `pnpm lint && pnpm --filter @wcies/web exec tsc -p tsconfig.json --noEmit`，再继续验收。

## 4. GUI 验收进度（任务书 §64 的 14 项）

已完成/部分：
- ✅ 店铺创建（S5GUI / Sprint5 GUI验收店，OZON 平台）
- ✅ 凭证保存（clientId=3636793 + apiKey=gui-mock-key——**这是本地 mock 的 key，非真实**；真实凭证在 `docs/ozon test info.txt`，不要写进任何代码/文档/git）
- ❌ 验证连接 / 凭证状态显示 —— 被 §3 Bug 阻塞
- 其余 12 项未开始：手动 Listing 同步、Sync Job 实时状态、UNMAPPED 显示、人工 Mapping、手动订单同步、订单进入系统、Mapping Failed 异常、Backorder、重复同步不重复建单、店铺隔离、Sync 错误查看（以上大多已被集成测试覆盖，GUI 只需走查）

**测试环境（当前应仍在跑，如断了按此重启）**：
- mock OZON：`node E:\WCIES-2.0\.gui-mock-ozon.mjs`（监听 127.0.0.1:19001；返回 3 个 listing：GUI-DEMO-1/2/3 + 3 个 FBS posting：GUI-ORDER-1001/1002/1003）
- API：`cd E:\WCIES-2.0\apps/api && OZON_API_BASE_URL=http://127.0.0.1:19001 PORT=3000 node dist/main.js`（连 dev 库 wcies_dev）
- Worker：同 env `node dist/worker.js`（同步任务靠它执行，必须起）
- Web：`cd apps/web && npx vite --port 5173`（代理 /api → 3000）
- 登录：admin / `.env` 里的 ADMIN_PASSWORD
- 已备数据：仓库 GUI-WH（bin A01-01）、SKU001347（有货 20，id `fac5d2bb-e6e7-4b18-9894-ea312f36a828`）、SKU001348（无货）——订单验收时把 GUI-DEMO-1 映射到 SKU001347（正常单）、GUI-DEMO-2 映射后不备货（backorder）、GUI-DEMO-3 不映射（mapping failed）。
- 验收要点：mock 无限流；重复同步 GUI-ORDER-1001 应显示 skipped；GUI 截图存 `gui-test-screenshots/`。
- 结束后清理：`.gui-mock-ozon.mjs` 删除、杀掉所有 node dist 进程（曾出现僵尸 worker 用旧 dist 消费队列导致诡异失败，排查前先 `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 杀干净 + 清 redis db8/11 的 `bull:wcies.*` key）。

## 5. 剩余工作清单（按顺序）

1. 修 §3 pathParams Bug（StoresPage + 检查 ListingsPage/OrdersPage 同类）→ lint/typecheck/build。
2. 继续/重跑 GUI 验收 14 项，截图存档。
3. 最终回归（§63）：`pnpm lint && pnpm typecheck && pnpm check:arch && pnpm test && pnpm test:integration && pnpm build`，外加 `pnpm openapi:export && pnpm check:openapi`（确认无 diff：openapi.json 与 api-client 已是最新提交）。
4. 清理：删 `.gui-mock-ozon.mjs`；杀 GUI 相关 node 进程；确认 `git status` 干净（不含不该提交的未跟踪文件）。
5. 写最终报告（§65 的 24 节结构，直接按任务书章节写；Real OZON Smoke Test 一节写 **NOT RUN**——需用户批准，不得自行执行）。

## 6. 本会话踩过的坑（避免重蹈）

- **Git Bash heredoc 里含反引号的 Python 脚本会被 shell 吃掉**：批量改文件一律写到 `%TEMP%\xxx.py` 再 `python` 执行（本会话已留多个 fix*.py 可参考写法）。
- **Bash 工具 cwd 不持久**：每条命令自带的 `cd` 只在该命令内有效；曾因 cwd 在 apps/api 里跑错 tsc 位置导致"构建没生效"假象。
- TypeORM 两个坑已写进 `docs/integrations/ozon.md` §8：`TableIndex({unique,where})` 静默丢 UNIQUE（migration 已改 raw SQL）；`query()` 对 `UPDATE...RETURNING` 返回 `[rows, rowCount]` 二元组。
- 集成测试端口冲突会造成"意外打到真实 OZON"（曾有 403 Invalid Api-Key 真实响应）；已加 `NODE_ENV=test` 下 OzonClientFactory 拒绝默认真实 URL 的保护，sync spec 现用独立端口 3116 + redis db 11。
- BullMQ jobId 不能含 `:`（曾致 dispatch 500）。
- Windows 下 `python` 用 `E:\...` 路径，bash 用 `/e/...`，混用会 FileNotFound。

## 7. 关键参考（不复述内容）

- 架构/模块细节：提交信息 + `docs/integrations/ozon.md`（含字段映射表、webhook 三层身份、env 变量表）
- 业务规则变更：`docs/business-rules/orders.md` §7 末尾（平台同步摄入）、`docs/business-rules/master-data.md` §8（UNMAPPED 模型）
- 同步引擎设计要点都在 `apps/api/src/modules/sync/` 各文件头注释与 `packages/platform-contracts/src/index.ts`
- CI 已加 openapi 契约守卫步骤（`.github/workflows/ci.yml`）

## 8. Suggested skills

- `browser-use:web-gui-tester` —— 继续 GUI 验收时先加载（本会话已加载过一次，规则：纯黑盒、截图留证、环境准备与正式测试分开声明）。
- 无需其他技能；如需重构建议可考虑 `mattpocock-skills:code-review`（对 sync 模块）。

## 9. 敏感信息备忘（已脱敏）

真实 OZON 凭证只在本地 `docs/ozon test info.txt`，**绝不**入 git/日志/文档/代码。GUI/测试用的是 mock 值（clientId 3636793 为公开卖家 ID，无敏感性；apiKey `gui-mock-key` 为本地 mock 专用）。ADMIN_PASSWORD 在 `.env`，勿写入交接物。
