# WB / Yandex Market 接入落地方案（总览）

> 配套文档：`wildberries.md`、`yandex.md`（各平台 API 事实 + 逐项核对 + T0 清单）。
> 基准：OZON 当前实现范围（见下）——本方案目标是**与 OZON 能力面一致的一次性交付**。
> 调研日期 2026-09-18；**同日交付完成（P0-P5 全部落地，见文末交付记录）**。

## 0. 核实结论

提示语属实：`PlatformAdapterRegistry` 仅注册 OZON 适配器，`apps/api/src/modules/integration/` 下只有 `ozon/`，`docs/integrations/` 只有 ozon 文档。`PlatformWarehouseQueryService` 对非 OZON 抛 `PLATFORM_WAREHOUSE_QUERY_UNSUPPORTED`；类目树/商品增强同步对非 OZON 抛错。

## 1. 对齐基准：OZON 当前能力面（严格只读）

| 能力 | 现状 |
|---|---|
| 凭证（MAIN_API，AES-256-GCM，显式验证） | ✅ |
| Listing 同步（全量游标走 + 映射行 upsert，人工映射不被覆盖） | ✅ |
| 订单同步（窗口游标 + ingestOne 幂等 + 平台事实对比更新 + 事实回读轮转） | ✅ |
| Webhook（raw events → 入队 → 定向回读；应答 {version,name,time}） | ✅（手动在卖家后台配置订阅） |
| 退货同步（手动触发，只读事实） | ✅ |
| 平台仓库目录查询（实时三端点聚合） | ✅ |
| 类目树 / 商品属性增强（平台参考数据） | ✅（OZON-only 硬编码） |
| 渠道库存推送 / 价格写 / 订单写操作 | ❌ 全平台均未实现（contract 明确排除，属后续 Sprint） |

## 2. 公共地基（一次改动，两平台共用）

1. **平台码对齐**：`packages/platform-contracts` 的 `PLATFORM_CODES`（现 `['OZON','WILDBERRIES','YANDEX_MARKET']`）改为与 DB 种子/平台常量一致的 `['OZON','WB','YANDEX']`；新增适配器 `platformCode = 'WB' | 'YANDEX'`（仅类型 union 变更，运行时无影响）。
2. **Client 骨架**：复制 `ozon.client.ts` 的模式（纯类 + factory + env 覆盖 + 每店铺限流 + 401/403 不重试 + 指数退避）。平台差异：
   - WB：多模块域名（statistics/content/marketplace/common/returns 各自 base URL）；`Authorization` 头；429 读 `X-Ratelimit-Retry`；**content 域 HTTP 200 内 `{error,errorText}` 解封装**；Marketplace 4XX 按限流额度 ×10 的保守节流。
   - Yandex：`Api-Key` 头；**420 → PLATFORM_RATE_LIMITED**（不是 429）；全局 4 并发信号量；错误体 `{status,errors[]}`。
3. **平台分发改造**：`PlatformWarehouseQueryService`、`CategoryTreeSyncService`、`ProductEnrichmentSyncService` 从「非 OZON 抛错」改为按 `platformCode` 分发（无对应能力时保持显式 unsupported 错误）。
4. **同步机制零改动**：SyncJob 单飞（store+syncType 部分唯一索引）、sync_cursors（store+syncType 隔离）、调度器按店铺开关轮询、失败告警——全部平台无关，直接复用。
5. **前端零改动或微改**：同步中心/店铺同步开关平台无关；`PLATFORM_CREDENTIAL_SPECS` 去掉「尚未接入」措辞；凭证 payload 两平台均为单 `apiKey`（`needsClientId: false` 已兼容）；Seller ID 仅 OZON 的联动已就绪。

## 3. 交付切分（建议顺序）

| 阶段 | 内容 | 对应 OZON 基准 |
|---|---|---|
| **T0** | 两平台真实凭据只读冒烟（各 docs 的 T0 清单：凭证验证、订单游标实测、状态样本、webhook/退货/仓库待验证项） | scripts/ozon-t0-smoke.ts 同款 |
| **P1（每平台）** | client + adapter + mapper + cursors + module 注册；validateCredential；fetchListings；fetchOrders（含状态映射表）；T0 校准映射 | Sprint 5 等价 |
| **P2（每平台）** | LISTING_SYNC / ORDER_SYNC 接入（SyncJob + 游标 + 调度器 + 失败告警）；同步中心/店铺开关即生效 | 双轴订单事实链路 |
| **P3（每平台）** | webhook 链：Yandex = 后台配置 + `/webhooks/yandex/stores/:storeCode`（PING 1 秒应答 `{version:'1.0.0',name:'WCIES',time}`，IP 白名单三段，事件→raw events→orderIds 定向回读）；WB = 待 T0（存在 webhook，细节未核实），首发以轮询为主链路 | webhook 链 |
| **P4（每平台）** | 退货同步（YX: getReturns 完整可用；WB: 待 T0，降级用 statistics sales 退货行）；平台仓库目录（YX: FBS/DBS 卖家侧仓；WB: 缺数据源）；类目（YX: 首发不做全树，商品自带类目；WB: object/parent/all 构树，低优先级） | 退货/仓库/类目 |
| **P5** | 集成测试（契约测试同款：游标、幂等、错误归一、映射表）+ 文档收尾 | §76/§80 |

## 4. 结构性差异（必须有心理预期，非阻塞）

1. **WB 订单双口径**：FBS/DBS 用 marketplace `/api/v3/orders`（作业状态机 wbStatus），FBO(DBW) 只有 statistics 报表（30 分钟延迟、90 天保留、`lastChangeDate` 单边游标、**1 req/min 严限流**）。订单同步需双源合并、低频轮询 DBW 源。
2. **Yandex 履约方式是订单自带事实**（`programType` FBY/FBS/DBS），落 `orders.fulfillmentMode` 后自动获得「FBO/FBP 外部履约不阻塞」行为（YANDEX_FBY 已在 `isExternalFulfillmentMode` 的 FBY 令牌内）。WB 同理：FBS→`WB_FBS`（内部履约）、DBW 买断→`WB_FBW`（外部履约）。
3. **Yandex 无签名 webhook**：按官方建议用来源 IP 段白名单（`5.45.207.0/25, 141.8.142.0/25, 5.255.253.0/25`）+ HTTPS 强制；14 天回调不可达会解除集成 → webhook 健康必须进监控/异常中心。
4. **平台仓库数据源缺口**：WB_FBW 无已验证的平台仓列表接口；Yandex FBY 仓不在 warehouses 返回中。两处的临时口径一致：**该类绑定走手动录入平台仓库 ID + 备注名**（绑定模型与操作日志已支持），T0/后续验证新接口后补自动化。

## 5. 明确不在本方案范围（与 OZON 一致的边界）

渠道库存推送 / Allocator、价格与促销写操作、订单改状态/发货写操作、财务报表拉取、评价与聊天——OZON 也未实现，属后续独立 Sprint；本方案不引入。

## 6. 交付记录（2026-09-18）

| 阶段 | 结果 |
|---|---|
| P0 | `PLATFORM_CODES` 对齐 `['OZON','WB','YANDEX']`（contracts） |
| P1-WB | `modules/integration/wildberries/`：四域 client（content 域 200 解封装、marketplace 4XX ×10 惩罚、statistics 1 req/min 车道）+ 双源订单游标状态机 + mapper（wbStatus 阶段表、FBS/DBS→WB_FBS、DBW→WB_FBW、条码→platformSkuId、article→sellerSku）+ module 注册 |
| P1-YX | `modules/integration/yandex/`：client（420→RATE_LIMITED、全局 4 并发信号量、Api-Key）+ campaign 身份解析（单 campaign 隐式 / 多 campaign 凭证显式 campaignId）+ business orders 窗口机 + offer-mappings / returns / webhook 事件映射 + module 注册 |
| P2 | 零改动复用：SyncJob 单飞、sync_cursors 隔离、调度器按店铺开关、失败告警均为平台无关；LISTING_SYNC/ORDER_SYNC 即刻生效 |
| P3 | Yandex webhook 链全量落地（见 yandex.md 状态头）；WB 按结论不实现 webhook，轮询为主链路 |
| P4 | 平台分发：仓库目录 OZON/YANDEX 接入、WB 显式 `PLATFORM_CAPABILITY_UNSUPPORTED`；类目树/属性增强保持 OZON-only（Yandex/WB 商品自带数据）；Yandex 退货拉取接入（`fetchReturns`） |
| P5 | 共享契约测试套件 `integration/adapter.contract.ts`（OZON/WB/YANDEX 三平台同套断言）+ mapper/client/adapter 单测；T0 脚本 `scripts/wb-t0-smoke.ts`、`scripts/yandex-t0-smoke.ts`；`.env.example` 补平台客户端覆盖项 |

**待 T0 后跟进**（真实凭据冒烟校准，见各平台文档 §8）：WB webhook / 定向回读 / 退货 / 平台仓数据源；Yandex 状态×substatus 样本校准、FBY 仓接口、分页参数大小写实测；WB `postponed_delivery` 等歧义状态归类。
