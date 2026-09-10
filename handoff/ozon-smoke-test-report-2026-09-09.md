# OZON Read-only Smoke Test 报告（2026-09-09）

> 执行依据：用户批准的「单店 OZON Read-only Smoke Test」。
> 范围严格限定为只读验证：**未执行任何 OZON 写操作**（无推库存 / 改价 / 改商品 / 取消订单 / 确认发货 / 修改订单状态），**未开启 Scheduled Polling**，**未配置 / 未注册 Webhook**。
> 报告人：ZCode（AI Agent）。所有真实凭证只存在于本地 `docs/ozon test info.txt`，本报告与任何日志均不含密钥。

---

## 1. 测试 Store

| 项 | 值 |
|---|---|
| store_code | `OZON-SMOKE1`（本次测试专用新建，不与 dev 库历史测试店混用） |
| name | OZON Smoke Test Store |
| platform | OZON |
| Client-Id | `363***3`（已脱敏；唯一一组真实凭证，即 1 个店铺） |
| Api-Key | **不在本报告出现**（本地文件运行时读取，AES-256-GCM 加密入库） |
| credential_type | MAIN_API（credential_id `d8a8d4ab…`） |
| store_id (uuid) | `fdfc3eed-9b4f-4e89-9d05-49f8598c2a0f` |

测试环境：本地开发环境（`NODE_ENV=development`，Docker：wcies-postgres / wcies-redis / wcies-minio，API :3000，BullMQ worker 独立进程）。`OZON_API_BASE_URL` 未设置 → development 默认指向真实 `https://api-seller.ozon.ru`；`ORDER_SYNC_INTERVAL_SECONDS` / `LISTING_SYNC_INTERVAL_SECONDS` 均默认 0（关）。

## 2. 日志安全确认（测试前 + 测试后双重验证）

- 代码审计：OzonClient 秘密只进请求头（`Client-Id` / `Api-Key`），错误消息构造不回显请求头；integration 模块无任何 logger 调用；sync 模块日志均为结构化字段（storeId/syncType/jobId）。
- 实证：冒烟全程 API + worker 进程日志（共约 2 个日志文件）中检索真实 Api-Key 与 `api-key`/`authorization` 字样，**0 次命中**。

## 3. Credential Validation 结果

| 项 | 结果 |
|---|---|
| 触发方式 | `POST /api/v1/stores/:id/credentials/:credId/validate`（服务端解密后走 adapter 只读 ping：`POST /v3/product/list {filter:{visibility:'ALL'}, limit:1}`） |
| 结果 | **VALID**（2026-09-09T12:17:47Z） |
| DB 回写 | `last_validated_at` / `last_validation_status='VALID'` 正常更新 |

## 4. Listing 实际结果

直连探测（临时脚本，仓库外运行）+ Manual Listing Sync（走 BullMQ 全链路）双轨验证：

| 项 | 实际值 |
|---|---|
| 分页方式 | `last_id` 游标（上一页返回值原样回传），无 has_more 标志 |
| 单页数量 | limit=200，实际每页 200（第 7 页 124 → 页不满即末页，与代码推断规则一致） |
| 页数 / 总数 | 7 页 / **1324** 个 listing |
| product_id | number 类型，如 `3094300628` |
| offer_id | string，含 CJK / `【】` / 下划线等字符均可正常返回与匹配，如 `VTEC-10234`、`13139-荒卡货柜【4166颗粒】_ob_WNzz2` |
| title/name | product/list 不含 name；经 `/v3/product/info/list` 补充成功，1324/1324 有标题（俄文为主） |
| OZON sku | info 返回 number 型 `sku`（如 `3132057926`）→ `platform_listing_skus.platform_sku_id`，1324/1324 填充 |
| MAPPED / UNMAPPED | **0 / 1324**（真实店铺尚未做人工映射，符合预期；同步不覆盖 MAPPED 的规则未受考验——无预先映射） |
| raw_data | listing 存两份：`product_list_item` + `product_info`（实测单条 ~3.4KB JSONB，`jsonb_object_keys` 验证两份键齐全） |
| Manual Sync 结果 | job `dab81bce…` **SUCCESS，successCount=1324，failed=0，skipped=0**，耗时 ~40s（含 21 次 OZON 请求） |
| 完成后游标 | `sync_cursors.cursor_data` 清空（全量枚举结束，下次全量重扫）——正确终态 |
| 落库核对 | `platform_listings`=1324（唯一键 store+product_id），`platform_listing_skus`=1324，状态 ACTIVE |

## 5. Order 实际结果

| 项 | 实际值 |
|---|---|
| 窗口 | 初始 catch-up：7 天（`since=2026-09-02T12:28Z`，`to=2026-09-09T12:28Z`，UTC ISO，无毫秒） |
| 总数 | **3 张 posting**（FBS），`has_next=false`，1 页取完 |
| posting_number | `0104777780-0121-1` / `0182131676-0021-1` / `18877524-0326-1` → `orders.platform_order_id`（业务唯一键 store+posting_number） |
| status（platform_status 原样保存） | `delivering` ×1、`awaiting_deliver` ×2（事实字符串，未映射成 ERP 状态——分离规则成立） |
| in_process_at | `2026-09-02T20:30:13Z` 等 → `orders.ordered_at`（TIMESTAMPTZ，UTC） ✔ |
| products 数量 | 3 单各 1 行 |
| offer_id / sku | 订单行 `offer_id`（如 `JT-GAME ULTRAM`）与 OZON `sku`（number，如 `3290318878`）均正确落 `order_items.platform_sku_id` / `offer_id`；quantity=1（number→String） |
| currency | `currency_code=CNY`（取第一行）→ `orders.currency` |
| raw_data | 完整保存：3 单均含 `posting_number`、`financial_data`、`customer`、`barcodes` 等全部 40+ 平台字段（单条 ~2.8KB JSONB）；order_items.raw_data 非空 |
| NormalizedOrderInput 映射 | platformOrderId=posting_number ✔、platformStatus 原样 ✔、fulfillmentMode=FBS ✔、orderedAt=in_process_at ✔、currency ✔、items（platformSkuId/offerId/quantity/rawData）✔ |
| sync_source | `POLLING`（手动触发走轮询通道）✔ |
| ERP 状态 | 3 单均 `EXCEPTION`（原因见 §9），**未因映射失败取消或丢弃任何平台订单** ✔ |

## 6. Pagination / Cursor 真实行为（非 Mock 结论）

| API | 真实行为 | 与文档/实现一致性 |
|---|---|---|
| `/v3/product/list` | `last_id` 为 base64 串（如 `WzM0MTQ2…`）；无 has_more；页满 + last_id 变化 = 还有下一页；末页 124<200 停止；**实测连续翻页 7 次无重复无遗漏（总数 1324 与落库数一致）** | ✔ 与 ozon.md §2 / adapter 实现一致 |
| `/v3/posting/fbs/list` | `{result:{postings, has_next}}`；offset 分页；`has_next=false` 结束 | ✔ 一致 |
| 游标持久化 | 窗口跑完后 `OZON_ORDER_RESUME{windowEnd}` 正确写入 `sync_cursors`；重跑新窗口 = windowEnd−60s 重叠 | ✔ 一致 |
| 游标重置行为 | 删除游标后下次同步回到初始 7 天 catch-up 窗口（本次幂等复测即用此路径） | ✔ 一致 |

## 7. Rate Limit 实际观察

| 项 | 观察值 |
|---|---|
| HTTP status | 全程 **全部 200**，未触发 429/401/403/5xx |
| `ratelimit-remaining` 头 | **存在**：`/v3/product/info/list` 连续 14 批后观察到 `9`；`/v3/posting/fbs/list` 观察到 `49`（疑似按方法独立配额桶）；未见 `ratelimit-limit` 总量头 |
| `Retry-After` | 未出现（无 429） |
| 请求耗时 | 首请求 ~2.1s（TLS 冷启动），其后 0.3–1.1s/次 |
| trace 头 | **`x-o3-trace-id`**（不是 `x-request-id`/`req-id`） |
| 其他 | 响应含 `set-cookie: abt_data=…`（antot 追踪 cookie，客户端未理会，无影响）；`content-encoding: br` |

结论：客户端默认 110ms/请求（≈9 req/s）间隔在真实环境安全，本次共 ~25 次连续请求零限流。

## 8. Mock 与真实响应差异（已按规则停止扩大 → 修正 → 回归）

| # | 差异 | 影响 | 处置 |
|---|---|---|---|
| 1 | **`/v3/product/info/list` 响应无 `result` 包裹**：真实为顶层 `{items:[…]}`；WCIES 类型/fixtures 按 `{result:{items}}` 实现，导致真实调用时补充明细读空（title/sku 全 null） | 高（listing 数据退化，影响订单行 platform_sku_id 解析的可用性） | **已修正**：`api.types.ts`（`OzonProductInfoListResponse` 顶层 items）、`ozon.adapter.ts`（`fetchProductInfos` 读取路径）、`tests/integration/sync.integration.spec.ts` + `ozon-adapter.contract.spec.ts`（fixture 与响应体路由）。官方 schema `v3GetProductInfoListResponse` 交叉确认顶层 items。修正后单测/集成全绿，Manual Sync 实测 1324/1324 全部带 title+sku |
| 2 | trace 头为 `x-o3-trace-id`，非 `x-request-id`/`req-id` | 低（错误对象采集不到平台请求 id） | **已修正**：`ozon.client.ts` 三个头依次回退采集 |
| 3 | `/v3/product/list` item 实际含 `sku`、`has_fbo_stocks`、`has_fbs_stocks`、`quants` 等官方规范未列字段 | 低（真实超集；类型有 `[key: string]: unknown` 且 mapper 不依赖未验证字段） | 不改代码；已记入 ozon.md |
| 4 | 其余（posting/list 结构、字段类型、product/list 分页、错误语义） | — | 与 fixtures/ozon.md 一致，无差异 |

修正后回归：OZON 模块单测 **32/32**、sync 集成 **16/16**、API 全量单测 **105/105**、`typecheck` ✅、`lint` ✅、`check:arch` ✅。

## 9. 数据库落库结果 + 幂等复测

幂等复测方法：删除 `ORDER_SYNC` 游标 → 下一次手动同步回到同一初始 7 天窗口 → 重跑。

| 计数项 | 首次同步后 | 幂等复测后 | 结论 |
|---|---|---|---|
| orders（本店） | 3 | **3** | 无重复 ✔ |
| order_items | 3 | **3** | 无重复 ✔ |
| inventory_reservations（本店） | 0 | **0** | 无重复 ✔ |
| inventory_transactions（全库） | 824 | **824** | 零新增库存事件 ✔ |
| system_exceptions | 6+3=9 | **9** | 异常也未重复创建 ✔ |
| 第二次 sync job 结果 | — | **SUCCESS，success=0 / failed=0 / skipped=3** | 业务实体幂等（store+platform_order_id）生效 ✔ |

注：第二次同步 0 次创建 Reservation / 0 条 InventoryTransaction 的前提是首扫就未创建（见 §10 映射失败路径），因此「重复 Reservation/重复库存事件」实际验证的是**整条 ingest 幂等链路**（订单存在即整体 skip），与 Sprint 5 设计一致。Reservation/库存事件的重复防护本身由集成测试（mock）覆盖：`ORDER_RESERVE:<orderItemId>` 幂等键场景 133 项集成基线全绿。

## 10. Mapping Failed / Backorder 情况

- 3 张订单的全部订单行均无法解析 Internal SKU（本店 1324 个 listing 全部 UNMAPPED）→ 每行生成 1 条 **`ORDER_SKU_MAPPING_FAILED`**（HIGH / OPEN / reference_type=ORDER_ITEM，异常号 EXC00000007–09），订单 `erp_status=EXCEPTION`。
- 行为完全符合 AGENTS.md §54（平台订单 SKU 无法映射 = 严重异常；不得静默跳过或取消订单）与 §22（无映射→无 Reservation→不产生超卖；本次无 BACKORDERED 案例，因无任何可分配库存映射，属设计内路径）。
- 单行失败未阻塞整批同步（3 单全部入库、job SUCCESS）✔。

## 11. 需要修正的代码 / 文档（均已完成）

1. `apps/api/src/modules/integration/ozon/types/api.types.ts` — info/list 响应形状（真实+官方 schema 双确认）。
2. `apps/api/src/modules/integration/ozon/ozon.adapter.ts` — `fetchProductInfos` 读取路径。
3. `apps/api/src/modules/integration/ozon/ozon.client.ts` — trace 头采集回退（`x-o3-trace-id` 优先）。
4. `tests/integration/sync.integration.spec.ts`、`apps/api/src/modules/integration/ozon/ozon-adapter.contract.spec.ts` — fixtures 与响应路由改为真实形状（含注释标注验证日期）。
5. `docs/integrations/ozon.md` — §2 响应形状更正、§4 真实限流观察回填、§5 trace 头、验证日期表、§10 状态 NOT RUN → 已执行+结论摘要。

以上改动均未触碰业务规则、状态机与 Inventory Core；无 Migration 需求（纯读取路径修正）。

## 12. 是否建议进入单店 Scheduled Polling 试运行

**建议：可以试运行，但先做人工映射。** 理由与前提：

- 技术面就绪：凭证 VALID；全量/增量游标行为符合预期；同窗口幂等（skip）验证通过；限流余量充足（~9 req/s 未触发 429，且平台返回 `ratelimit-remaining` 可观测）；错误路径（映射失败）按设计入异常中心，不阻塞批次。
- 业务面前提：当前 1324 个 listing 全部 UNMAPPED、3 张真实订单已挂 MAPPING FAILED 异常。**若现在开轮询，新订单会持续堆积同类异常**。建议顺序：
  1. 先在 UNMAPPED 页对真实 offer 完成人工映射（至少覆盖在售 SKU）；
  2. 再对该店铺设置 `settings.sync.orderSyncEnabled=true` + 短间隔（如 300s）试运行数小时；
  3. 观察 SyncJob 成功率、异常增量、`ratelimit-remaining` 消耗后，再决定是否常态化。
- 试运行仍需用户明确批准后开启（本次未开启任何轮询）。

## 13. 证据留存

- 原始 API 响应（脱敏留存于仓库外临时目录）：`%TEMP%\ozon-smoke\`（product-list-p1..7 / product-info-b1..14 / posting-list-p1，含完整响应头）。
- 探测脚本：`%TEMP%\ozon-smoke\probe.cjs`（运行时读本地凭证文件，不打印密钥）。
- DB 状态：`OZON-SMOKE1` 店铺数据保留在 dev 库（1324 listing + 3 订单 + 3 异常），可复现核查；如需清理请用户指示。
- 未跟踪文件：本报告 + `docs/integrations/ozon.md` 修改待用户决定是否提交（连同代码修正共 5 文件 + 1 文档）。
