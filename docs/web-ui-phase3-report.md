# Web 前端 Phase 3 UI 一致性修复报告

- 任务书：`WCIES_2.0_Web_前端_Phase_3_UI_一致性修复任务书.md`（基线 commit `dfc5ffd`）
- 规范：`docs/UI组件规范_V1.md`
- 完成日期：2026-09-16
- 提交序列（8 个）：

| Commit | 内容 |
| --- | --- |
| `e761ae2` | T1 design-system 组件与 META 表（feat(web-ui)） |
| `f8e8420` | T4 库存/仓库作业页（refactor(web-ui)） |
| `9473248` | T5 采购/主数据页（refactor(web-ui)） |
| `4b2ac77` | T2 商品域页 + G9 共享快建（refactor(web-ui)） |
| `2b22c61` | T3 订单/退货/异常页（refactor(web-ui)） |
| `1ff55cc` | T6 壳层/系统页（refactor(web-ui)） |
| `7af48c9` | T7 清理（内联 SectionTitle、token 收尾）（refactor(web-ui)） |
| （本次） | T8 回归 + 报告（fix(web-ui)：StatusSwitch 确认气泡、按钮双字空格） |

## 1. 硬性方向落地（R1–R4）

### R1 行内操作与右栏重复 → 移除行内，收敛右栏
- 全部主表操作列移除：Inventory / Reservations / Orders / PurchaseOrders / PurchaseReceipts / Suppliers / Warehouses / Bins / Stores / StoreBindings / Listings / Interceptions / Notifications（任务书附录 A 清单全覆盖）。
- 行为通过右栏操作区 / Drawer extra / 详情页头部承载；Listings 变体子表统一为 ActionMenu 下拉。

### R2 右栏结构标准化（概要 → 风险 → 关联操作 → 操作区）
- 所有注册右栏的页面统一：概要（编码+名称+状态徽标）→ 基本信息/风险区 → 操作按钮区。
- 库存占用、订单风险动作（取消、标记外部履约、去建档、重试）进入右栏；同步失败最近列表带 `/stores` 深链。

### R3 大选项集筛选可搜索
- **SKU 页分类 Cascader `showSearch`（最高优先）**：`apps/web/src/pages/skus/SkusPage.tsx`，8k 节点树支持输入过滤，placeholder「分类」；实测输入「键盘」过滤出 6 条命中路径并高亮（截图 `verify_skus_category_cascader_searching.png`）。
- Products 分类 Cascader 同步支持搜索（placeholder「分类（任意层级，含子树）」）；Stores 平台下拉 `showSearch`；Listings 平台受控 + 允许清除 + 搜索框第一位（aria-label）。

### R4 启用/停用唯一入口 = 右栏 StatusSwitch
- 新组件 `design-system/components/StatusSwitch.tsx`：停用弹一步 Popconfirm（danger 停用按钮），启用直发。
- 落地页面：Products、Suppliers、Warehouses、Stores；行内/表格启停全部移除。
- **T8 回归发现并修复**：受控 Popconfirm 在点击子元素 Switch 时被 antd 自动打开，导致「启用直发」后仍弹出『确认停用』气泡、点取消后状态却已变化。修复为 `onOpenChange` 仅响应关闭（`7af48c9` 之后的 T8 commit），实测停用确认、取消生效、状态不变。

## 2. 横切修复（G1–G10）

| 项 | 结果 |
| --- | --- |
| G1 hex 清零 | 全部页面颜色改引用 `design-system/tokens.ts`；T7 复扫收尾（Listings `#888`、Receipts `#d48806`→warning、AppLayout `#FAFBFC/#FFFFFF` 等） |
| G2 时间统一 | 列表 `RelativeTime`（相对时间）、详情 `fmtDateTime`（`YYYY-MM-DD HH:mm`）；规则统一写入 tokens |
| G3 状态徽标集中 | `StatusBadge.tsx` 新增 10 张 META 表（IMPORT/INTERCEPTION/SHIPMENT/PACKAGE/RESERVATION/TRANSACTION_TYPE/RETURN_BATCH/RETURN_CONDITION/NOTIFICATION_STATUS/NOTIFICATION_TYPE），旧 `*_LABEL` 从 META 派生 |
| G4 删除确认分级 | L0 直发 / L1 Popconfirm / L2 `DeleteConfirmModal`+danger 确认键；主实体删除全部 L2（Products/Warehouses/Listings/采购取消等），实测商品删除弹『确认删除该商品？』+ 影响说明 + 强删勾选 |
| G5 主表操作列 | 同 R1，全部移除 |
| G6 行交互 | 单击=选中（右栏即时更新）、双击=打开详情 Drawer；表格内 StatusBadge `showDot={false}`；实测通过 |
| G7 筛选受控 | 平台/类型/状态筛选写 URL（`focus`/`type`/页签参数）；Listings 清除筛选清空全部 |
| G8 术语统一 | 「新建店铺」「启用」等统一；`SkuCreateModal`「SKU 已创建」；**中英混用清除见 §2.1** |
| G9 共享提取 | `BinBatchCreateModal`（Warehouses/Bins 共享）、`QuickCreateModals`（Brand/Category 快建，Products zIndex 1100、Listings 1200） |
| G10 结构补齐 | Shipments/Interceptions/Reservations/Transactions 等 8 页整页重构对齐规范；App.tsx 补 `*` 404（EmptyState+返回首页）；规范 §2 KPI/右栏重复在 6 页去重 |

另：`providers.tsx` ConfigProvider `button={{ autoInsertSpace: false }}`——antd 对双字按钮自动插空格（「登 录」）关闭；`global.css` 补 `.wcies-entry-tile:hover`；`typography.monoFamily` token 落地（RawDataBlock/单号等宽）。

### 2.1 中英混用清除（用户复验跟进，2026-09-16）

任务书 G8 原案允许表头保留 `On Hand/Safety/Available` 英文术语；用户复验明确要求消除中英混用，按「用户明确确认优先」全量中文化：

- 库存术语：`On Hand`→在库、`Reserved`→已占用、`Picked`→已拣货、`Safety`→安全库存、`Available`→可售、`IN_STOCK/OUT_OF_STOCK 记录`→有可售/无可售库存记录（InventoryPage 右栏/表头/InfoGrid、SkusPage 右栏、ReservationsPage 操作说明、InterceptionDetailPage 提示、ShipmentDetailPage 确认文案）。
- `Listing`→商品链接：SkusPage / ListingsPage / PlatformMappingsPage / StoresPage 全部计数、按钮、弹窗、描述（含 emptyTitle「暂无商品链接」）；「新建/删除/建档」等动作文案同步。
- 状态枚举不再直接当标签：`订单行已 RESERVED`→已占用、`保持 BACKORDERED`→保持缺货、`订单转入 SHIPPED`→已发货、`移除（RESERVED）（PICKED）（BACKORDERED）` 括号注解、`RELEASED` 注解。
- 系统自有字段中文化：`SKU Code`→SKU 编码、`Platform Product ID`→平台商品 ID、`Store ID`→店铺 ID、`Job ID`→任务 ID、`Payload Hash`→载荷哈希、`Raw Data`→原始数据、`MAIN_API 凭证`→主 API 凭证、`Bin × 数量`→库位 × 数量、`SELLABLE/DEFECTIVE` 说明→合格/不合格、`STAGING`→暂存位、KPI `aux`（OPEN/RESOLVED/IGNORED/MAPPED/UNMAPPED/SUCCESS）→中文。
- 保留（经判定为平台事实/通用术语，非混用）：平台字段原文（Offer ID、Seller SKU、Seller ID、Client ID、API Key、平台 SKU）、状态原文 hint（StatusBadge `hint={status}`）、履约语义（FBS/FBW/FBY）、技术缩写（SKU、SN、ID、API、URL、JSON、Excel、Webhook、PDF/PNG/JPEG）、货币与语言代码（CNY、RUB、ZH_HANS）。
- SKU 右栏新增「规格」区：显示重量（`weightG` 列表 API 已返回，此前仅详情 Drawer 可见）。

验证：typecheck / eslint / build / check:architecture / vitest(19) 全绿；dev 实测 SKU 右栏「在库/已占用/可售 + 规格·重量 1200 g + 1 个商品链接」、SKU映射页「共 1324 个商品链接」「未映射总数 1320 个商品链接」、映射总览 KPI 与同步中心 KPI 全中文（截图 `verify_skus_rail_cn_terms_weight.png`、`verify_listings_cn_terms.png`）。

## 3. 截图回归（`gui-redesign-phase3-screenshots/`，本地留存，仓库 .gitignore 既定忽略 `gui-*-screenshots/`）

- 1920×1080：25 个页面各 1 张（`1920x1080_<page>.png`，page 覆盖 dashboard/products/skus/listings/platform-mappings/inventory/inventory-transactions/inventory-reservations/orders/purchase-orders/purchase-receipts/suppliers/warehouses/bins/stores/store-bindings/sync/exceptions/interceptions/returns/picking/shipments/import/notifications/system）+ 选中态 `1920x1080_products_selected.png` + Drawer `1920x1080_products_drawer.png`。
- 1366×768：同 25 页各 1 张（`1366x768_<page>.png`）+ 选中态 + `1366x768_products_rail_overlay.png`（≤1366 右栏 overlay 行为验证，任务书 §17）。
- 专项验证图：`verify_skus_category_cascader_searching.png`（R3 搜索过滤生效）、`verify_products_statusswitch_disable_confirm.png`（停用确认气泡）。
- 共 59 张。抽查（视觉模型 + 人工）结论：窄档无布局破碎/溢出/重叠，overlay 右栏内容完整且不挤压表格。

## 4. 手工清单抽查结果（dev 环境，admin）

| 检查点 | 结果 |
| --- | --- |
| 单击行选中 → 右栏更新 | ✅ products 实测，概要/基本信息/StatusSwitch/操作区即时切换 |
| 双击行 → 详情 Drawer | ✅ products 实测（Drawer 760 档） |
| StatusSwitch 停用确认 | ✅ 弹『确认停用该商品？』，取消后状态不变；启用方向直发不再误弹气泡（本次修复） |
| 删除 L2 | ✅ DeleteConfirmModal：影响说明 + 强删勾选 + danger 确认 |
| 操作列移除后右栏可执行 | ✅ 各页操作均在右栏/Drawer/详情页可达 |
| 1366 档右栏 overlay | ✅ 不挤压表格，内容完整 |
| 登录/HMR/路由 | ✅ dev 容器 bind-mount 热更新生效，全部页面可访问 |
| 数据说明 | 抽查过程通过正规 UI 将测试商品 PN000004 由「草稿」启用（dev 测试数据，可接受） |

## 5. 验证结果

- `pnpm lint`（全仓 eslint）：✅ 0 错误
- `tsc --noEmit`（web）：✅
- `npx tsx scripts/check-architecture.ts`：✅ 5 规则通过
- `pnpm build`（web，tsc+vite）：✅ 763ms（chunk >500kB 警告为既有状态，非本任务引入）
- `vitest run phase3.spec.tsx`：✅ 19/19

## 6. 遗留项 / 豁免

| 项 | 说明 | 处置 |
| --- | --- | --- |
| OZON 退货平台状态/退款状态无枚举 | `ozon.mapper.ts mapRfbsReturn` 逐字存储平台俄语原文，属平台事实数据，不可穷举映射 | neutral 徽标 + 原文 + RailHint 说明（规范允许原文展示） |
| 库存流水页无 keyword 搜索 | API 仅支持 `skuId` 精确查询，无 keyword 参数；禁止改后端 | 跳过搜索框；按 SKU 精确筛选可用 |
| 通知中心无 keyword 搜索 | API 不支持 | 跳过；类型/状态筛选 + URL 参数可用 |
| PurchaseReceipts 未知条码 footer 顺序 | 实现已符合规范（主按钮右侧） | 无需改动（任务书原文的误判项） |
| 截图目录不入库 | 仓库 `.gitignore` 既定忽略 `gui-*-screenshots/`（与 Phase 1/2 一致） | 本地留存，本报告索引 |

## 7. 范围与纪律声明

- 未修改任何业务逻辑、API 调用语义、状态机、后端代码；未新增依赖；未新增顶级目录/路由结构（404 为任务书明确豁免项）。
- 每处改动对应任务书 T1–T8 / G1–G10 / R1–R4 条目；规范与业务冲突处以规范原文 + 平台事实数据为准（见豁免表）。
