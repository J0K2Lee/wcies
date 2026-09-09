# WCIES Sprint 5 最终报告 — Platform Integration Foundation + OZON

> 完成日期：2026-09-09。按任务书 §65 的 24 节结构输出。
> 任务书：`WCIES_Agent_Task_—_Sprint_5_Platform_Integration_Foundation_+_OZON.md`；修订说明优先于原任务书。

## 1. P0 Audit Fix

按修订说明 §1，`shipment_items` 物理删除 → 可审计 VOIDED 的改造在 Sprint 5 开始前已完成（c158565 / c68f8a0 / 4bdc7e8）。Sprint 5 未重做该功能，OZON 集成也未暴露出需要修改该领域的 bug。migration 20260910_010/011 未改动。

Sprint 5 实际的 P0 是修订说明 §2-§6 的 **OpenAPI Response Schema 技术债修复**（提交 9253ce3）：

- 修复前：`ShipmentEnvelopeDto` 导出后 `properties = {}`，`ShipmentDetailDto` 不进 `components.schemas`，api-client 生成物无法反映 Response 契约。
- 修复方式：统一 Swagger envelope 装饰器（`@ApiOkEnvelope` / `@ApiOkPagedEnvelope` + `@ApiExtraModels` + `getSchemaPath`），Controller → Response DTO → OpenAPI → `components.schemas` → `@wcies/api-client` 全链路贯通。
- 自动化守卫：`scripts/check-openapi.ts`（`pnpm check:openapi`）断言核心 DTO 存在且非空、所有 2xx response 的 `$ref` 可解析；已接入 CI（`.github/workflows/ci.yml`）。当前：137 schemas / 142 documented 2xx responses / 15 required DTOs verified。

## 2. Platform Contract

`packages/platform-contracts/src/index.ts` 定义所有平台统一契约（AGENTS.md §32：一切外部平台经 PlatformAdapter）：

- `PLATFORM_CODES = ['OZON', 'WILDBERRIES', 'YANDEX_MARKET']`
- `PlatformCredentialContext` / `StoreContext`：同步**永远 store-scoped**（§27/§43），凭证为已解密值且 adapter 禁止记录日志。
- `PaginatedResult<T>`：`items + nextCursor(不透明) + hasMore` —— 分页游标语义由 adapter 各自解释，sync 层不感知平台细节。
- `PLATFORM_ERROR_CODES`：6 类归一化平台错误（AUTH / RATE_LIMITED / TIMEOUT / BAD_RESPONSE / API / NETWORK）。
- 契约**刻意不含写操作**（推库存/价格/发货）——Read-first 范围约束。
- AdapterRegistry：平台代码 → adapter 解析；WB/Yandex 尚无实现（未来 Sprint）。

## 3. OzonClient

`apps/api/src/modules/integration/ozon/ozon.client.ts`（HTTP/Auth/重试/限流全部收敛在 Client，不进业务层）：

- **Auth**：每请求 `Client-Id` + `Api-Key` header（从 StoreContext 凭证取得）。
- **限流**：按店铺隔离的最小请求间隔（`OZON_MIN_REQUEST_INTERVAL_MS` 默认 110ms ≈ 9 req/s/store）；店铺 A 限流不影响店铺 B。
- **重试**：429 → `PLATFORM_RATE_LIMITED`，尊重 `Retry-After`；5xx/超时/网络错误指数退避（500ms→15s，上限 `OZON_MAX_RETRIES`=3）；401/403、确定性 4xx、形状非法（`PLATFORM_BAD_RESPONSE`）不重试。
- **错误归一化**：所有错误对象带 HTTP status、`x-request-id`、endpoint、storeId、脱敏消息；**绝不**含 Client-Id/Api-Key/Authorization。
- 测试环境保护：`NODE_ENV=test` 下 OzonClientFactory 拒绝默认真实 URL（防止测试意外打到真实 OZON，本会话曾出现 403 真实响应后加的守卫）。

## 4. OzonAdapter

`ozon.adapter.ts` 实现统一平台能力：`validateCredential()`、`fetchListings(cursor)`、`fetchOrders(window)`、`getOrderDetail(posting_number)`（webhook 回读目标）。Adapter 只做编排，HTTP 细节在 Client、DTO 转换在 Mapper。契约测试 `ozon-adapter.contract.spec.ts` 覆盖标准返回类型/分页/错误归一化（§80 共同契约测试）。

## 5. Mapper

OZON → WCIES 主要字段映射（完整表在 `docs/integrations/ozon.md` §2/§3）：

| OZON | WCIES |
|---|---|
| `product_id` | `platform_listings.platform_product_id`（listing 主键维度 store+product_id） |
| `info.name` / `info.sku` | `platform_listings.title` / `platform_listing_skus.platform_sku_id` |
| `offer_id` | `platform_listing_skus.offer_id`（人工对账辅助） |
| `posting_number` | `orders.platform_order_id`（**业务唯一键 store+posting_number**；OZON order_id 可拆多 posting，仅存 raw_data） |
| `status` | `orders.platform_status`（平台事实原样保存，与 erpStatus 分离 §38） |
| `in_process_at` | `orders.ordered_at` |
| `products[].offer_id/sku` | `order_items.offer_id/platform_sku_id`（→ ListingResolver store-scoped 反查） |
| 原始 item/posting | `raw_data` JSONB 双留存（§34） |

## 6. Sync Engine

`apps/api/src/modules/sync/`：

- **Store+SyncType 隔离**（§43）：任务、游标、凭证、错误全部按 `(storeId, syncType)` 独立；队列 `wcies.order-sync` / `wcies.listing-sync` 分离。
- **Single Flight 双重保护**（§45）：DB 先建受守卫的 SyncJob 行（claimRunning 唯一性 + 部分唯一索引），再入 BullMQ；重复 dispatch 抛 `SyncAlreadyRunningError`。10 并发 dispatch 只产生 1 个 active job（集成测试验证）。
- **Cursor**（§46）：`sync_cursors` 按 store+syncType 保存窗口游标；失败不推进，恢复时重走窗口不丢单（page-2 失败场景有集成测试）。
- **HTTP 202 快速返回**（§50）：Controller 只 dispatch，不阻塞等平台。
- 定时调度：`ORDER_SYNC_INTERVAL_SECONDS` / `LISTING_SYNC_INTERVAL_SECONDS` 默认 0（关），且需店铺 settings.sync 逐店 opt-in（分阶段上线策略）。

## 7. Listing Sync

`listing-sync.service.ts`：`/v3/product/list`（last_id 游标，页满+last_id 变化推断翻页）+ `/v3/product/info/list`（批量补 name/sku）。产出：

- 平台事实层：listing + listing_skus（UNMAPPED 状态，20260911_001 扩展 mapping state）。
- **人工映射不被覆盖**：同步只 upsert 平台事实字段，`MAPPED` 行的 skuId 绑定保持不动（offer_id 改名场景有集成测试：SYNOFFER 改名后映射仍存活）。
- 单条失败不阻塞批次。

## 8. Order Sync

`order-sync.service.ts`：`/v3/posting/fbs/list` 窗口拉取（since=上次游标，to=now）→ `OrderIngestionService` 复用（**不新写订单逻辑**，与手工订单同一条 ingestion 路径）：

- 行级处理（§36）：resolver 失败 → 行 `FAILED` + `ORDER_SKU_MAPPING_FAILED`（HIGH）；库存不足 → 行 `BACKORDERED` + `ORDER_OUT_OF_STOCK`（MEDIUM）；单行异常不阻塞批次，job 仍 SUCCESS。
- 库存预留走 InventoryService.reserveStock（幂等键 `ORDER_RESERVE:<orderItemId>`），不绕过库存核心。
- `orders.sync_source`（20260911_006）标记来源：SCHEDULED_POLL / WEBHOOK / MANUAL。

## 9. Webhook

官方能力（已验证）：`POST /v1/notification/set` 配置；`TYPE_NEW_POSTING` 等事件；**消息体不带完整订单事实，且无签名机制**。

最终实现（`ozon-webhook.controller.ts`）：

- URL：`POST /api/v1/webhooks/ozon/stores/{storeCode}`（每店一段）。
- 身份三层：URL storeCode ↔ 店铺；`payload.seller_id` 必须等于凭证 clientId（不符 → raw event REJECTED，仍回 200 防重试风暴）；**webhook 仅是提示，处理器用已认证 API 回读 posting 原文后才入库**。
- HTTP 请求内只做：形状校验 → 存 raw event(PENDING) → 入 `wcies.webhook` 队列 → 立即返回 `{"result": true}`（OZON 期望格式，非 WCIES envelope）。不建单、不锁库存、不调平台（§47）。
- `external_raw_events` 全量可审计（platform/store/eventType/payload/status/时间戳）。

## 10. Idempotency

三层（§49）：

- **外部事件幂等**：webhook 无事件 ID → `(store, sha256(canonical payload))` 唯一索引去重。
- **业务实体幂等**：`store_id + platform_order_id` 唯一约束；重复 poll 直接 skip（job 计 skipped）。
- **库存动作幂等**：`ORDER_RESERVE:<orderItemId>` / `ORDER_RELEASE:<orderItemId>`。

**Poll/Webhook 竞态**（重点）：两条路径最终都收敛到同一 ingestion 事务 + 同一幂等键 + 同一唯一约束——集成测试模拟 webhook 与 poll 同时到达同一订单，结果恰好 1 单 1 reservation。

## 11. Credential Security

- AES 加密存储（`credential-encryption.service`），前端永不回显明文（列表只显示 configured 布尔）。
- API Response 不返回密文；日志/错误对象禁止输出 Client-Id/Api-Key/Authorization（有专门集成测试：响应体、sync job、raw event 全扫描不含 API key）。
- 操作日志记录凭证变更动作但不记录 secret 内容。
- GUI 验收使用本地 mock 凭证（`gui-mock-key`）；真实凭证仅存于不入库的本地文件。

## 12. API

新增/扩展端点（全部有 OpenAPI 契约 + api-client 类型）：

- `POST /api/v1/sync/orders` / `POST /api/v1/sync/listings`（202 dispatch）
- `GET /api/v1/sync/jobs`（分页+过滤）/ `GET /api/v1/sync/jobs/:id`
- `GET /api/v1/sync/stores/:storeId/overview`（凭证状态/最近同步/连续失败）
- `GET /api/v1/sync/events`（webhook 原始事件审计）
- `POST /api/v1/webhooks/ozon/stores/:storeCode`
- `POST /api/v1/stores/:storeId/credentials/:id/validate`
- UNMAPPED 映射：`POST /api/v1/listings/skus/:id/mapping`（人工绑定内部 SKU）

## 13. Frontend

- **同步中心**（`/sync`）：店铺选择手动同步、任务列表（状态/成功/跳过/失败/耗时/错误列+展开详情）、Webhook 事件审计 tab。
- **店铺详情抽屉**新增「同步」tab：凭证状态、最后订单/Listing 同步、连续失败次数、手动同步按钮。
- **Listing 页**：UNMAPPED 显示 + 「人工映射」对话框（选择内部 SKU 绑定）。
- **订单页**：syncSource 列 + 订单行级异常（ORDER_SKU_MAPPING_FAILED / ORDER_OUT_OF_STOCK）与「重新尝试分配」恢复操作。

**本会话 GUI 验收暴露并修复的前端缺陷**（提交 da2742e）：12 处模板路径查询漏传 pathParams（请求打到字面量 `{id}` URL）；5 处单对象查询未按 `{ data }` 解包（店铺同步 tab 曾因此崩溃）；店仓绑定创建把 storeId 混入 body 被 DTO 白名单拒绝。

## 14. Tests

| 套件 | 结果 | 基线（修订说明 §7） |
|---|---|---|
| Unit | **105 passed** | 73（↑32，不低于基线） |
| Integration | **133 passed**（132 基线 + 本会话新增 1） | 117（↑16） |

集成测试覆盖（`tests/integration/sync.integration.spec.ts` 16 场景）：凭证验证 VALID/INVALID、listing 同步 + 人工映射存活、订单正常摄入+预留、重复 poll 幂等、webhook+poll 竞态、错误 seller_id 拒绝、mapping failure、backorder、HTTP 失败游标不推进并恢复、page-2 失败窗口保持、畸形响应归一化、10 并发单飞、**店铺隔离**、同平台单号双店独立、凭证泄露扫描，以及本会话新增的 **jobs list 分页回归**（raw join + skip/take 曾 500 的缺陷）。

空库验证：DROP `wcies_test` 后 migration 全量重建 → seed → 整套 integration 通过。

## 15. GUI Acceptance

任务书 §64 全部 14 项通过（2026-09-09，本地 mock OZON，截图存 `gui-test-screenshots/`）：

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | Store Credential 状态可见 | ✅ | t1_credential_status.png |
| 2 | Credential Validate 操作 | ✅ 打 mock 后「已连接」 | t2_validate_connection.png |
| 3 | Manual Listing Sync | ✅ 3 listings SUCCESS 228ms | （t4 截图含 job 行） |
| 4 | Sync Job 实时状态 | ✅ | t4_sync_job_status.png |
| 5 | Listing 同步结果 | ✅ 900001-3 入库 | t5_t6_listing_unmapped.png |
| 6 | UNMAPPED SKU 显示 | ✅ | t5_t6_listing_unmapped.png |
| 7 | 人工完成 Mapping | ✅ GUI-DEMO-1→SKU001347 MAPPED | t7_manual_mapping_done.png |
| 8 | Manual Order Sync | ✅ 3/0/0 | t8_order_sync_job.png |
| 9 | 正常订单进入 Order 系统 | ✅ RESERVED + bin 分配 + READY_TO_PICK | t9_order_reserved.png |
| 10 | Mapping Failed 进异常 | ✅ ORDER_SKU_MAPPING_FAILED | t10_mapping_failed_exception.png |
| 11 | Backorder 正常 | ✅ 行 BACKORDERED + ORDER_OUT_OF_STOCK | t11_backorder_out_of_stock.png |
| 12 | 重复同步不重复建单 | ✅ 复同步 1 新单 + 3 skipped | （t13_t14 截图含 1/3/0 行） |
| 13 | 一个 Store 失败不影响另一个 | ✅ S4GUI FAILED / S5GUI 不受影响 | t13_t14_store_isolation_error_visible.png |
| 14 | Sync 错误可查看 | ✅ 错误列显示 SYNC_PROCESSOR_ERROR | t13_t14_store_isolation_error_visible.png |

验收中发现并当场修复的缺陷（均记入 §13/§14）：pathParams 缺失、envelope 解包错配、sync jobs 500、绑定 body 多余字段。另确认一次环境准备缺失（店铺未绑仓库 → 订单行 ORDER_INVALID_STATE），属设计正确的异常路径，补绑定后经「重新尝试分配」恢复——顺带验证了恢复入口。

## 16. Real OZON Smoke Test

**NOT RUN** — 未获用户批准，不得自行执行（修订说明 §10）。自动化 mock/fixture 测试已全部通过，满足申请 smoke test 的前置条件。

## 17. Migration

Sprint 5 新增 6 个 migration（均已空库重建验证，未进共享/生产）：

- `20260911_001` listing 映射状态扩展（UNMAPPED 模型）
- `20260911_002` sync_jobs（含 single-flight 部分唯一索引，raw SQL——TypeORM `TableIndex({unique,where})` 会静默丢 UNIQUE）
- `20260911_003` sync_cursors
- `20260911_004` external_raw_events（含 payload hash 唯一索引，raw SQL）
- `20260911_005` 凭证验证字段扩展
- `20260911_006` orders.sync_source

未修改 20260910_010/011（修订说明 §8）。

## 18. Architecture Check

`pnpm check:arch` 通过（5 条规则：Controller 不 import Repository、Web 不 import 后端 Entity、Integration 不 import Inventory Repository、跨模块不 import 内部实现、无越界依赖）。Sync 模块未绕过 InventoryService（预留走公开接口），平台调用只在 Integration 层。CI 已含 check:arch + openapi 契约守卫。

## 19. docs/integrations/ozon.md 更新内容

从占位变为真实笔记（验证日期、来源标注）：Credential 结构与验证方式、Listing/订单 API 能力与分页语义、限流策略、重试与 6 类错误归一化表、Webhook 官方能力与三层身份设计、平台 ID 语义表（product_id/sku/offer_id/posting_number/seller_id）、8 条已知坑（含 TypeORM 两个坑）、环境变量表。全部来源于官方文档或真实验证，未验证项明确标注。

## 20. 新增决策

1. `posting_number`（非 order_id）作为订单业务唯一键的平台维度——posting 才是履约单位。
2. Webhook 无签名 → 只作提示，事实以已认证 API 回读为准；seller_id 校验 + URL 店铺段三层身份。
3. 人工映射优先于同步事实：同步永不覆盖 MAPPED 绑定。
4. 定时同步默认关闭 + 店铺级 opt-in（分阶段上线）。
5. 分页一律 `PaginatedResult` 不透明游标，平台差异封闭在 adapter。
6. `NODE_ENV=test` 下 OzonClientFactory 拒绝真实 OZON URL。

## 21. 未完成项

- Real OZON Read-only Smoke Test（待用户批准）。
- WB / Yandex Market adapter（明确未来 Sprint）。
- 平台写操作（推库存/价格/发货/取消）——Read-first 范围外。
- 自动调度默认关闭，需生产环境变量 + 店铺 opt-in 后才生效。
- Sync jobs 的 `storeCode/storeName/platformCode` 通过 raw join 返回（本会话修复其分页缺陷并补回归测试）。

## 22. 风险

- OZON 真实限流配额未验证（文档未给数字）；smoke test 后需回填 `OZON_MIN_REQUEST_INTERVAL_MS`。
- 窗口大小（初始 7 天）未经验证是否受平台限制。
- Webhook 依赖公网可达 URL；本机开发需内网穿透。
- OZON API 属易变外部依赖：实现以官方文档 + 真实响应为准，字段变更需更新 ozon.md。
- 前端遗留 antd 弃用警告（Space direction / Drawer width / useForm 未挂载），非业务错误，未在本次范围处理。

## 23. Git Commits

Sprint 5 全部提交（无远程仓库，历史已做密钥泄露复查）：

- `9253ce3` fix(openapi): truthfully describe response DTO contracts via envelope decorators
- `2c54c27` feat(sync,integration): OZON read-first sync engine (adapter/client/mapper + sync core)
- `2584cee` fix(sync): single-flight/webhook/index bugs + full sync integration suite
- `4d5edd7` feat(web,api): sync center, store sync tab, UNMAPPED mapping UI, order sync source
- `3b8b1cc` docs(ozon,master-data,orders): verified OZON integration facts + Sprint 5 sync rules
- `da2742e` fix(web,api): templated-path query params + envelope unwrap; sync job list pagination（本会话，GUI 验收修复 + jobs list 回归测试）

## 24. 下一步

**Sprint 5 到此停止。** 未经用户决策不实现：OZON 库存推送、价格写入、平台发货写操作、WB Adapter、Yandex Adapter。

建议的用户决策点：

1. 批准 Real OZON Read-only Smoke Test（验证真实凭证、真实 listing/订单拉取、真实限流表现）。
2. 是否开启某店铺的定时订单轮询试点（env + settings.sync opt-in）。
3. 下一 Sprint 范围（WB adapter / 库存推送 Allocator / FBO 订单）。
