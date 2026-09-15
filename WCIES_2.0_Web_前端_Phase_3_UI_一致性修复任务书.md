# WCIES 2.0 Web Frontend — Phase 3 UI 一致性修复任务书

---

## 1. 任务名称

WCIES 2.0 Web 前端 Phase 3：UI 一致性修复（第二次 UI 修复）。

## 2. 背景与根因

Phase 1 / Phase 2 重构确立了 design-system 与三栏工作台外壳。此后多个功能 Sprint
（7 / 8 / 8.5 / 9 / 退货）由不同 AI 会话并行开发，新页面与局部改动未持续遵守
design-system，造成大量跨模块 UI 不一致：

- 同一动作 2~3 处入口（行内 + 右栏 + 抽屉）；
- 右栏按钮位置随机、功能重复、风格多样；
- 筛选控件有的可搜索有的不可（SKU 页 8k 节点分类树不可搜索）；
- 启用/停用有的显示为徽标、有的藏进行菜单、有的在抽屉，确认行为不一；
- 状态渲染出现 5 种实现（StatusBadge / Tag / Badge / 纯文本 / 手写色表）；
- 删除确认出现 4 种载体（DeleteConfirmModal / Popconfirm / modal.confirm / 无确认）；
- 7 个页面完全脱离 design-system（无 PageHeader / FilterBar / DataTable / 右栏）。

2026-09-16 已完成全部 31 个页面 + 外壳的逐页代码审计（本任务书 §6-§10 即审计结论）。

## 3. 总目标

提高 UI 的**一致性**与**可互动性**。用户确认的四条修复方向（硬性要求）：

```text
R1  行内操作与右栏按钮重复 → 移除行内操作，统一收敛到右侧上下文栏
R2  右栏按钮位置随机、功能重复、风格多样 → 右栏结构标准化
R3  筛选工具栏的类目等大选项集 → 可搜索匹配
R4  启用/停用显示为状态 → 改为切换按钮（右栏 StatusSwitch）
```

## 4. 范围与基线

- 基线 commit：`dfc5ffd`（feat(returns): T5 return/refund module）。
- 范围：`apps/web/src` 全部页面、`design-system`、外壳（AppLayout / GlobalSearch /
  NotificationBell / App 路由）。
- **不在范围**：后端 API、业务规则、数据库、依赖变更（禁止新增依赖）。
- 规范依据：`docs/UI组件规范_V1.md`（唯一 UI 事实规范，执行任何任务前必读）。
  延续 Phase 2 任务书 §80（右栏内容原则）/ §81（用户操作原则）。

## 5. 执行纪律

- 每批任务（T1-T8）单独提交，提交信息前缀 `fix(web-ui)` / `refactor(web-ui)` /
  `feat(web-ui)`。
- 每批完成后运行：`pnpm lint`、`pnpm typecheck`、`pnpm check:arch`、
  `pnpm --filter @wcies/web build`。
- 涉及库存/订单等页面的本任务只改展示层，不得触碰业务状态机与 API 调用语义。
- 行为变化（双击打开详情、操作列移除等）必须在提交说明中列出。

---

## 6. 审计结论摘要

### 6.1 页面规范度矩阵

| 页面 | PageHeader | FilterBar | DataTable | 右栏 | 行操作 | 状态渲染 |
| --- | --- | --- | --- | --- | --- | --- |
| Products | ✓ | ✓ | ✓ | ✓ | ActionMenu | StatusBadge |
| Skus | ✓ | ✓ | ✓ | ✓ | ActionMenu | StatusBadge(dot 不一) |
| Listings | ✓ | ✓(缺清除) | ✓(缺 showTotal) | ✓ | **手写链接** | StatusBadge |
| Orders | ✓ | ✓ | ✓ | ✓ | ActionMenu | StatusBadge |
| Returns | ✓ | ✓ | 裸Table(假分页) | **无** | 手写按钮 | 混合 |
| Exceptions | ✓ | ✓ | ✓ | ✓ | 无操作列 | StatusBadge |
| Interceptions | **无** | **无** | **裸Table** | **无** | primary ghost | **antd Tag** |
| InterceptionDetail | **无** | — | — | — | — | **antd Badge/Steps** |
| Notifications | ✓ | ✓ | ✓ | 概览型 | 单按钮 | StatusBadge |
| Inventory | ✓ | ✓ | ✓ | ✓ | ActionMenu(无primary) | StatusBadge |
| InventoryTransactions | **无** | **无** | **裸Table** | **无** | 无 | **无色 Tag** |
| Reservations | **无** | **无** | **裸Table** | **无** | **手写×4** | **本地色表 Tag** |
| Picking | ✓ | ✓ | ✓ | 无 | **type 条件化按钮** | StatusBadge |
| PickingTaskWork | 工作台 | — | 手写列表 | 手写 aside | — | StatusBadge |
| Shipments | **无** | **无** | **裸Table** | **无** | primary ghost | **本地色表 Tag** |
| ShipmentDetail | **无** | — | 裸小表×3 | — | primary ghost | **Badge 二值化** |
| PackageWork | 工作台(未进 focus) | — | 手写列表 | — | — | Badge 二值化 |
| Import | **无** | **无** | **裸Table** | **无** | 行点击 | 本地色表 Tag |
| PurchaseOrders | ✓ | ✓ | ✓ | ✓(无按钮) | ActionMenu | StatusBadge |
| PurchaseReceipts | ✓(primary×2) | ✓ | ✓ | ✓(无按钮) | ActionMenu | StatusBadge |
| Suppliers | ✓ | ✓ | ✓ | ✓(无按钮) | ActionMenu | StatusBadge |
| Warehouses | ✓ | ✓(顺序反) | ✓ | ✓ | **手写 link** | StatusBadge |
| Bins | **无** | **无** | **裸Table** | **无** | **手写×3** | **Tag** |
| Stores | ✓ | ✓ | ✓ | ✓ | ActionMenu | StatusBadge(文案分裂) |
| StoreBindings | **无** | **无** | **裸Table** | **无** | **手写×3** | **Tag** |
| SyncCenter | ✓ | ✓ | ✓ | ✓ | 无操作列 | SyncStatusBadge |
| System | ✓ | — | — | 概览(与正文重复) | — | StatusBadge |
| PlatformMappings | ✓ | ✓ | ✓ | ✓ | 无操作列 | StatusBadge |
| Dashboard | ✓(裸Link) | — | ✓ | ✓(默认展开) | — | StatusBadge(误用) |

### 6.2 系统性问题 TOP（对应 §7 横切修复）

1. 同动作多入口（R1）：订单"去建档"×3、"重试分配"×3；库存调整/安全库存/移位
   header+行菜单双入口；店铺同步×3；异常"标记解决"×2；同步"重新执行"×2；
   生成收货单×3；/listings 入口×2；创建 SKU×3。
2. 启停无统一模式（R4）：确认行为 4 种（无/Popconfirm/modal.confirm/不一致）、
   入口 4 种（行菜单/抽屉 extra/抽屉底部/行按钮）、文案 2 种（启用/正常）。
3. 删除确认 4 载体：DeleteConfirmModal（商品/SKU/映射/供应商/PO取消）、
   Popconfirm（Listing/仓库/库位/绑定/店铺/条码/图片）、modal.confirm（分类/凭证）、
   直发无确认（收货单抽屉取消草稿）。
4. 筛选不可用（R3）：SKU 页类目 Cascader 无 showSearch；平台/类型 Select
   非受控或无 showSearch；3 页缺"清除筛选"；搜索框位置/aria 不一。
5. 裸 hex 约 20 处；时间格式 4 种；'-'/'—' 混用；中英文混杂（Sync Drawer、
   Interceptions 选项、库存术语）。

---

## 7. 全局横切修复（G1-G10）

> 逐页任务（§9）不重复罗列此处条目，只写页面特有项。

### G1 裸 hex / 裸色清零（改用 tokens）

```text
orders/OrdersPage.tsx:1059-1063      chips 手工 danger 色（→FilterChips）
orders/OrdersPage.tsx:1575           RawData pre 背景 #F8F9FB（→RawDataBlock）
exceptions/ExceptionsPage.tsx:646    上下文数据 pre #F6F7F9（→RawDataBlock）
sync/SyncCenterPage.tsx:864          原始报文 pre #F6F7F9（→RawDataBlock）
interceptions/InterceptionDetailPage.tsx:182,204,273-275,302  扫码反馈/边框/失败色 ×8
shipments/PackageWorkPage.tsx:179,202-215,229,236,256,264     扫码反馈/边框/SN 色 ×7
inventory/InventoryTransactionsPage.tsx:125-128               变更量 #cf1322/#3f8600
purchase/PurchaseReceiptsPage.tsx:1028                         #d48806（→colors.warning）
listings/ListingsPage.tsx:1563                                  #888（→textTertiary）
app/NotificationBell.tsx:180                                    #C4433C/#496F96
import/ImportPage.tsx:250-253                                    'green'/'red'
```

### G2 时间格式统一

- 列表列统一 `RelativeTime`；Drawer/详情统一 `fmtDateTime`（utils/format.ts）。
- 删除：`slice(0,10)`（Products:1019）、`slice(5,10)`（Skus:954）、
  `slice(5,16)`（Picking:142）、`toLocaleString()`（Interceptions:97、
  InterceptionDetail:151,314、Shipments、ShipmentDetail、PackageWork）。

### G3 状态 META 补齐（design-system/StatusBadge.tsx）

新增/补 tone（label + tone + hint），页面本地色表全部删除：

```text
SHIPMENT_STATUS_META        （ShipmentsPage 本地 STATUS_COLORS 删除）
PACKAGE_STATUS_META         （ShipmentDetailPage:84-90 删除）
RESERVATION_STATUS_META     （ReservationsPage:35-41 STATUS_TAG 删除）
IMPORT_STATUS_META          （ImportPage:32-38 STATUS_TAG 删除）
INTERCEPTION_STATUS_META    （InterceptionsPage:22-30 STATUS_COLORS 删除）
RETURN_BATCH_STATUS_META    （ReturnsPage:68-73 保留语义，迁入 DS）
RETURN_CONDITION_META       （ReturnsPage:75-83 迁入 DS）
PLATFORM_RETURN_STATUS_META / REFUND_STATUS_META（纯文本改徽标，退款不再写死 info）
TRANSACTION_TYPE_META       （InventoryTransactionsPage:30-40 TYPE_LABELS 删除，
                             InventoryPage:768 已用 DS LABEL，补 tone）
NOTIFICATION_TYPE_META      （NotificationBell:23-26 + NotificationsPage 合并）
```

### G4 删除/确认迁移

- 主实体删除 → `DeleteConfirmModal`：分类删除（Products:761 modal.confirm）、
  Listing 删除（Listings:1307 Popconfirm）、仓库/库位/绑定/店铺删除（Popconfirm）。
- 子资源行删除（条码/图片/凭证/明细行）→ 统一 `small danger + Popconfirm`
  （一句话后果）；未提交草稿行删除保持 `text + danger` 免确认。
- 取消单据类（取消采购单/取消草稿/取消批次/取消订单）→ `modal.confirm` +
  `okButtonProps={{ danger: true }}`；收货单抽屉"取消草稿"直发（:640）改为同款。
- 停用方向确认统一 Popconfirm（见 G5）；启用直发。

### G5 启用/停用 → 右栏 StatusSwitch（R4）

迁移实体与清理项：

```text
实体          现入口（全部移除）                                  新入口
店铺          行菜单(Stores:771 直发) + 抽屉底部(:1468 直发)      右栏 Switch；rail 文案"正常"→"启用"(:556)
仓库          抽屉 extra Popconfirm(Warehouses:566-595)           右栏 Switch
库位          行按钮(Bins:332-358)                                右栏 Switch（随整页重构）
供应商        行菜单直发(Suppliers:340-356)                       右栏 Switch
店仓绑定      行按钮(StoreBindings:271-289)                       右栏 Switch（随整页重构）
商品          行菜单(Products:1044-1057) + Drawer extra           右栏 Switch
SKU           行菜单(Skus:982-995) + Drawer extra                 右栏 Switch
Listing       Drawer extra(Listings:1280-1306)                    右栏 Switch
品牌/分类     分类管理弹窗内 small 按钮                            弹窗内保留（内嵌管理器例外），
                                                                  统一停用 Popconfirm / 启用直发
平台凭证      凭证表 ActionMenu 停用/启用(Stores:1283-1293)        子资源例外：保留子表操作，确认统一
```

表格列保留 StatusBadge 只读展示（启用=success / 停用=neutral）。

### G6 主表操作列移除（R1）

- 所有管理页主表移除"操作"列与手写行按钮；单击=选中（toggle），双击=打开详情。
- 受影响（现 ActionMenu / 手写行按钮）：Products、Skus、Listings（手写链接）、
  Orders、PurchaseOrders、PurchaseReceipts、Suppliers、Warehouses（link 按钮）、
  Stores、Inventory（4 项菜单）、Reservations（4 按钮随重构）、Bins /
  StoreBindings / Shipments / Interceptions（随整页重构）、Returns（"查看批次"
  与 onRow 重复，移除）、Picking（type 条件化按钮移除）、Notifications（重试
  按钮保留=唯一入口，加 L1 确认）。
- 原"进入作业/工作台"类按钮 → 双击 + 右栏「进入作业」primary。
- Drawer/Modal 内子表允许行内按钮（规范 §4.5），但同动作不得与右栏并存。

### G7 筛选工具栏修复（R3）

- SKU 页类目 Cascader 加 `showSearch`（SkusPage:786-799，8k 节点树，最高优先）。
- 选项 ≥8 或来自 API 的 Select/Cascader 一律 `showSearch`：
  平台（Listings:950、PlatformMappings:262、Stores:848）、异常类型（10 项，
  Exceptions:481）、同步中心类型/状态（选项少可不加）。
- 非受控改受控：平台 Select（Listings:950-963）、各页 Input.Search 的
  `defaultValue`（Products/Skus/Listings/Orders/Stores/PlatformMappings）；
  "清除筛选"后搜索框同步清空。
- 补"清除筛选"（FilterBar actions 槽）：Listings（现缺失）。
- 搜索框统一第一位：Listings:990-999（现最后）。
- 状态筛选选项顺序统一 DRAFT→ACTIVE→INACTIVE：Skus:809-813 与 Products:904-908
  对齐（以生命周期顺序为准）。
- 搜索框统一 `aria-label`（Listings:990 缺失）。
- 店铺 Select 选项 label 统一 `storeCode · name`（Exceptions:515 现为
  `platformCode / storeCode`）。
- 品牌筛选选项：与分类一致，停用品牌加"（停用）"后缀而非过滤
  （Products:845 现不过滤无标注 / Skus:782 现过滤 ACTIVE，统一为带后缀）。

### G8 术语与文案

```text
"类目"→"分类"（内部场景；Skus:788 placeholder 等；OZON 类目工具保留）
"新增SKU"→"新建SKU"；"添加店铺"→"新建店铺"（统一"新建"）
"打开完整详情"/"查看详情"/"详情"/"查看完整订单"→统一"查看详情"
店铺 rail "正常"→"启用"（Stores:556）
'-' → '—'（Listings:1057,1426；Interceptions:90,147）
"SKU已创建"→"SKU 已创建"（SkuCreateModal:59）；"登 录"→"登录"
库存术语统一：表头 On Hand/Safety/Available 保留英文术语，但"Reservation"Tab
→"库存占用"（Inventory:727），Reserved/Picked ↔ 已占用/已拣货 不再混排
（以表头英文术语 + DS 中文说明 tooltip 为准，单页内一致）
```

### G9 重复代码合并

```text
previewBinCodes + 批量创建库位弹窗   Warehouses:97-120,751-832 ≈ Bins:70-93,429-505 → 提取共享
品牌/分类快建弹窗                    Products:1469-1716 ≈ Listings:2035-2282（~400 行重复）→ 提取共享
SectionTitle/Field/InfoField         Warehouses:837-876、Stores:1483-1529、
/DrawerSectionTitle/DrawerField      Exceptions:733-758 → 全部改 InfoGrid 后删除
右栏空闲态提示 span                  各页复制（Products:790 等）→ RailHint
本地 LABEL/色表                      见 G3
```

### G10 结构补齐

- 7 个裸页面补 PageHeader/FilterBar/DataTable/EmptyState/右栏：
  InventoryTransactions、Reservations、Shipments、Bins、StoreBindings、Import、
  Interceptions。
- 详情/工作台页返回导航：InterceptionDetail、ShipmentDetail、PackageWork、
  PickingTaskWork（PageHeader 带返回或面包屑）。
- App.tsx 补 `*` 404 路由（EmptyState + 返回首页）。
- AppLayout focus mode 正则纳入 `/packages/:id`（AppLayout.tsx:156）。
- ImportPage 模板下载按钮跟随 importType 联动（:147-148 现硬编码）。

---

## 8. T1 — Design System 组件补齐

新增组件（放入 `design-system/components/`，导出到 index.ts，附基本渲染测试）：

### 8.1 StatusSwitch

```tsx
interface StatusSwitchProps {
  active: boolean;
  entityName: string;            // 用于确认文案：「确认停用该{entityName}？」
  disableHint?: string;          // Popconfirm 说明，如"停用后不再同步"
  loading?: boolean;
  onChange: (nextActive: boolean) => void;
}
```

渲染：`ContextMetric` 风格一行（label「状态」）+ antd Switch；停用方向包
Popconfirm，启用直发。

### 8.2 FilterChips

```tsx
interface FilterChip { key: string; label: ReactNode; tooltip?: string;
  tone?: 'default' | 'risk'; group?: string }
interface FilterChipsProps { chips: FilterChip[]; value?: string;
  onChange: (key: string | undefined) => void }
```

替代 OrdersPage 手写 chips（:1032-1070）；选中态 primarySoft 底 + primary 字，
risk 类用 danger 系 token。

### 8.3 KpiRow

```tsx
interface KpiRowProps { children: ReactNode } // grid repeat(auto-fit,minmax(210px,1fr))
```

替代 Inventory:412-419、Stores:813-819、Exceptions:446-450、Notifications、
SyncCenter、PlatformMappings 的手写 grid。

### 8.4 RailHint

```tsx
interface RailHintProps { children: ReactNode }
```

右栏空闲态灰色提示（12.5/textTertiary），替代各页手写 span。

### 8.5 RawDataBlock

```tsx
interface RawDataBlockProps { data: unknown; maxHeight?: number }
```

统一 `<pre>` + token 底色 + monospace + 复制按钮（可选），替代 Orders:1570-1578、
Exceptions:643-655、SyncCenter:864 的手写 pre。

### 8.6 META 表

按 G3 清单在 StatusBadge.tsx 补齐（含 hint），删除页面本地实现。

**验收**：新组件有渲染快照/基本断言；`pnpm --filter @wcies/web build` 通过。

---

## 9. T2-T6 — 分域页面修复

> 每页只列"该页特有"项；G1-G10 横切项自动适用。行号为审计时点，执行时以实际为准。

### T2 商品域

**ProductsPage**
1. 移除操作列（ActionMenu）→ 双击详情 + 右栏操作区（查看详情/编辑入口经详情）。
2. 右栏补 StatusSwitch；行菜单/Drawer extra 启停移除（G5）。
3. 停用确认分裂修复（行菜单无确认 :1044 vs Drawer Popconfirm :1310）→ 统一 G5。
4. 分类删除 modal.confirm（:761）→ DeleteConfirmModal。
5. 搜索受控化 + 清除筛选联动（:887 defaultValue）。
6. Drawer extra 按钮统一 small（:1303-1341）；创建时间列 RelativeTime（:1019）。
7. 品牌筛选停用品牌带（停用）后缀（:845）。
8. Drawer「新建SKU」入口保留（子操作），分类管理弹窗启停统一 Popconfirm（:735-759）。

**SkusPage**
1. 类目 Cascader 加 showSearch（:786，**R3 最高优先**）；placeholder"类目"→"分类"。
2. 移除操作列；右栏补 StatusSwitch；「打印条码标签」唯一入口=右栏（:704 与 :996 去重）。
3. 行菜单"编辑"双开行为（:977-980 同时开 Drawer+Modal）废除 → 编辑唯一入口=
   Drawer extra small。
4. 状态列 showDot 统一 false（:946 现已 false，Products 对齐）；状态筛选顺序（:809）。
5. 图片/条码子表删除按钮统一 small danger + Popconfirm（:1322 link 与 :1269 实心统一）。
6. 更新时间列 RelativeTime（:954）。

**ListingsPage**
1. 主表手写行链接（:1098-1117）移除 → 双击详情；UNMAPPED 快捷建档入口 =
   右栏「关联操作」深链（保留 keyword 预填）。
2. Listing 删除 Popconfirm（:1307）→ DeleteConfirmModal；映射删除已是（:1627）。
3. 变体子表统一 ActionMenu（UNMAPPED 行手写 Space :1449-1480 与 MAPPED 行
   :1482-1534 混用→统一）；「人工映射」双形态（primary ghost :1450 vs link :1484）统一。
4. 筛选：平台 Select 受控（:950-963）、补清除筛选、搜索框第一位 + aria-label（:990）。
5. 分页补 showTotal（:1016）；行选中补 `wcies-row-selected`（:1023）；'-'→'—'。
6. Drawer 标题补 StatusBadge、size 720→760（:1269-1274）；#888（:1563）→ token。
7. 右栏补 StatusSwitch（现启停仅 Drawer extra :1280-1306）。
8. 品牌快建 zIndex 统一 1100/1200 层级（:2038 vs Products:1472）；「新增品牌/分类」
   弹窗与 Products 合并共享（G9）。

**PlatformMappingsPage**
1. Header secondary 的 EntityLink 误用（:216-230）→ 移除（/listings 入口去重，
   保留右栏「前往 SKU 映射处理」带 keyword 深链 :193-203）。
2. 平台 Select 加 showSearch（:262）。
3. 「映射类异常」KPI 可点击 → /exceptions（:233-259）。
4. KPI 手写 grid → KpiRow；UNMAPPED 左边框色条样式保留但改 token。

### T3 订单 / 售后 / 异常域

**OrdersPage**
1. 货物状态 chips（:1032-1070）→ FilterChips（含分组分隔、risk tone）。
2. 操作列移除；「查看/查看详情」双菜单项（:1225-1239）随之消灭。
3. 去重：「去建档」×3（rail :643/:671 + 抽屉 :921）→ 唯一 rail 风险区入口；
   「重试映射/重新尝试分配」×3（:651/:700/:926）→ 唯一 rail；抽屉行表按钮移除
   （登记采购 :843-854 为唯一入口保留）。
4. Raw Data pre（:1570-1578）→ RawDataBlock；#F8F9FB 清零。
5. 抽屉子表状态列补 StatusBadge（拣货 :1411、拦截 :1494）。
6. 搜索受控（:982）；「摄入测试订单」primary（:958-962）→ secondary（管理员工具
   不占主操作；页面无 primary 属合法）。
7. 店铺 label `storeCode · name`（:1002）；订单链接深链带 focus。

**ReturnsPage**
1. 整页补结构：Tabs 移入 PageHeader extra（:218-229）；主按钮按页签切换放
   PageHeader primary（平台页签=「同步退货记录」，批次页签=「新建退货批次」），
   移出 FilterBar children（:246-256, :334-345）。
2. 补右栏（批次选中态：EntitySummary + 明细统计 + 操作区「查看详情/确认收货/
   取消批次」）；「查看批次」行按钮（:415-425）移除。
3. 平台退货表假分页（:266-271 current 写死）→ 受控分页。
4. 平台状态纯文本/退款状态写死 info（:297-311）→ StatusBadge + G3 META。
5. 明细 SKU 列显示 UUID（:510）→ 解析为 SKU 编码（现有 SKU 查询 hook，
   未知回退 —）；批次仓库同理（:439 参考 PurchaseReceipts:439 的回退链反向修正）。
6. 抽屉明细行操作三按钮（:541-579）→ 子表规范：合格回库 small primary、
   不合格/缺失 small default（danger 滥用修正），各带 L1 确认。
7. Drawer 底部按钮确认统一（确认收货 L2 danger-ok、取消批次 L2）。

**ExceptionsPage**
1. 「标记解决/忽略」双入口（rail :334-348 + 抽屉 :675-691）→ 唯一 rail 操作区；
   抽屉改只读详情。
2. 关联操作 EntityLink 同步去重（:317-323 vs :663-670）→ 保留 rail。
3. DrawerSectionTitle/DrawerField（:733-758）→ InfoGrid；pre（:643-655）→ RawDataBlock。
4. Tabs 位置（:520 FilterBar 后）→ PageHeader extra。
5. 店铺 label 格式统一（:515）；类型 Select 加 showSearch（:481，10 项）。
6. 店铺筛选写 URL 行为保留，其他筛选对齐写 URL（或全部不写，二选一，推荐全写）。

**InterceptionsPage（整页重构）**
1. 补 PageHeader（「拦截作业」+描述）/ FilterBar（状态 Select 中文 label，:44-55）
   / DataTable + EmptyState / 右栏（实体型：任务概要 + 操作区「查看详情/处理拦截」）。
2. antd Tag 色表（:22-30）→ INTERCEPTION_STATUS_META；时间 toLocaleString（:97）→
   RelativeTime；'-'→'—'（:90）。
3. 「处理拦截」primary ghost 按钮（:100-110）移除 → 双击进入 + 右栏 primary。

**InterceptionDetailPage**
1. 补 PageHeader 返回导航（「拦截任务 {no}」+ 返回列表）。
2. 裸 hex ×8（:182,204,273-275,302）→ tokens；手拼反馈块（:266-280）→ ScanFeedback。
3. 状态 antd Badge（:134-145）→ StatusBadge；Steps 流程保留。
4. 「确认回库」primary+danger 组合（:285-291）→ danger 按钮 + L2 modal.confirm
   （现已是 modal.confirm，仅按钮形态统一）。
5. 「标记失败」Modal okText 定制（:321-338）；时间 toLocaleString（:151,314）→ fmtDateTime。

**NotificationsPage**
1. 「重试」加 L1 Popconfirm；移除无效 stopPropagation（:281）。
2. rail 为概览型（允许）；「重试」为该页唯一行内按钮，保留。
3. 类型 Select 宽度收敛（:163，2 项 200px→120px）。
4. （可选）补关键词搜索——先验证 /notifications API 是否支持 keyword，不支持则跳过。

### T4 库存 / 仓库作业域

**InventoryPage**
1. 移除操作列（ActionMenu 无 primary，:603-647）→ 右栏操作区：
   查看详情(default)/库存调整/安全库存/库内移位（≤5 合规）。
2. header secondary 三按钮（:400-402，与行菜单重复）移除；保留 primary「库存初始化」。
3. 术语统一（G8：Reservation Tab→库存占用 :727；Reserved/Picked 混排）。
4. Drawer Reservation tab 状态列（:745 纯文本）→ StatusBadge（RESERVATION_META）。
5. 危险确认统一：手工库存调整保留 L2（modal.confirm + danger ok）；移位/初始化
   按语义定级（移位 L1）。
6. MetricCard 手写 grid（:412-419）→ KpiRow；Drawer 860→880。

**InventoryTransactionsPage（整页重构）**
1. 补 PageHeader「库存流水」（描述审计不可删）/ FilterBar（搜索第一位补 SKU 关键词？
   现无搜索——补 SKU 编码搜索需 API 支持，验证后决定）/ DataTable + EmptyState +
   showTotal / 概览型右栏（当前筛选计数 RailHint）。
2. TYPE_LABELS（:30-40）→ TRANSACTION_TYPE_META；变更量裸 hex（:125-128）→ token。
3. 与 Inventory Drawer 流水 Tab 的双入口：保留（列表页=全量审计，Drawer=单 SKU
   过滤，语义不同），在页头描述中说明。

**ReservationsPage（整页重构）**
1. 补 PageHeader「库存占用」/ FilterBar / DataTable / 实体型右栏（选中预留：
   概要 + 操作区 拣货/出库/释放/取消拣货，default 非 danger——danger 滥用修正 :204）。
2. STATUS_TAG（:35-41）→ RESERVATION_STATUS_META；手写行按钮（:198-219）移除。
3. 死注释清理（:44-46）；生命周期确认统一 modal.confirm（保留 :90-94 模式）。

**PickingPage**
1. 「进入作业」type 条件化按钮（:148-155）移除 → 双击进入 + 右栏 primary。
2. 创建时间 slice(5,16)（:142）→ RelativeTime。
3. （可选）补概览型右栏（今日任务统计）。

**PickingTaskWorkPage**
1. 「完成任务」default（:245-252）→ primary；「开始任务」保持 primary（流程内
   顺序推进，二选一主操作：未开始时开始=primary，进行中完成=primary）。
2. 「完成任务」加 L1 Popconfirm。
3. 手写 aside（:466-539）保留（focus mode 特例），「异常」metric 值改数字（:537）。
4. 补返回列表入口（顶部条左侧返回箭头）。

**ShipmentsPage（整页重构）**
1. 补 PageHeader「发货管理」（primary=「从订单创建发货单」，移出筛选行 :86-88）/
   FilterBar（状态 Select 选项中文 label :80，与表格 SHIPMENT_STATUS_LABEL 统一）/
   DataTable + EmptyState + showTotal / 实体型右栏（状态/包裹/进度 + 操作区
   「查看详情/进入工作台」）。
2. STATUS_COLORS（:27-35）→ SHIPMENT_STATUS_META；「发货工作台」primary ghost
   （:156-162）移除 → 双击进入 + 右栏。
3. 订单列链接（:106-109，现指 /orders 列表）→ `/orders?keyword={orderNo}&focus={id}`
   深链模式（同 GlobalSearch）。
4. 时间 toLocaleString → RelativeTime/fmtDateTime。

**ShipmentDetailPage**
1. 补 PageHeader 返回导航（「发货单 {no}」+ 状态徽标 + 返回）。
2. 状态三实现统一：顶部 Badge 二值化（:194-199，CANCELLED 也显示 processing）
   → StatusBadge + SHIPMENT_STATUS_META；包裹 Tag（:355）→ PACKAGE_STATUS_META；
   作废行误用 SHIPMENT 标签（:296-298）→ 行状态正确映射。
3. `window.location.href = '#/packages/…'`（:118）→ navigate；包裹行「打包作业」
   primary ghost（:384-391）→ 行点击/双击进入。
4. 正式出库保持 L2（modal.confirm danger，:172-181 统一 okType danger 风格）。
5. 三个裸小表 → DataTable/SectionCard；时间格式统一。

**PackageWorkPage**
1. 纳入 focus mode（AppLayout 正则，G10）。
2. 裸 hex ×7（:179,202-215,229,236,256,264）→ tokens；手拼扫码反馈（:202-215）
   → ScanFeedback。
3. 「封箱」primary（已是）+ L1 Popconfirm（:162-171 现无确认）。
4. hash `<a href="#/shipments/…">`（:146）→ react-router Link。
5. Badge 二值状态（:149-152）→ StatusBadge。

**ImportPage**
1. 补 PageHeader「导入中心」（primary=上传 Excel；secondary=两个模板下载，且模板
   跟随 importType 联动 :147-148）。
2. 类型列裸枚举（:196）→ 中文 LABEL（入 G3 IMPORT META 或独立 TYPE 映射）；
   STATUS_TAG（:32-38）→ IMPORT_STATUS_META；'green'/'red'（:250-253）→ token。
3. 行点击开预览（:191-194）→ 双击；补行选中视觉。
4. 裸 fetch ×3（:60,85,104）→ 若 typed client 支持 FormData/下载则迁移，否则保留
   并保留注释说明；导入中心补概览型右栏（可选）。

### T5 采购 / 主数据域

**PurchaseOrdersPage**
1. 移除操作列 → 右栏操作区（查看详情/生成收货单（ORDERED 时）/取消采购单 L2）。
2. 生成收货单三入口收敛：PO Drawer 按钮（:406-411）移除；唯一入口 =
   收货单页 secondary「从采购单生成」（本页 Modal :572-587 移除）。
3. 生成收货单 Modal 仓库 Select 补 showSearch（:594-600）。
4. 分页 20→50；手写脚注 span（:201,602）→ RailHint/统一提示样式。

**PurchaseReceiptsPage**
1. primary 槽双按钮（:354-374）拆分：「新建收货单」primary + 「从采购单生成」
   secondary。
2. 取消草稿双入口统一：行菜单（modal.confirm :484-498）随操作列移除；
   Drawer 底部「取消草稿」直发（:640-642）→ L2 确认。
3. #d48806（:1028）→ colors.warning；单位成本警示样式统一 warning token。
4. 未知条码 Modal footer 主次顺序修正（bind(primary) 应在最右，:1075-1118）。
5. 右栏操作区补「查看详情/确认收货(L2)/编辑明细」；分页 20→50。

**SuppliersPage**
1. 主按钮补 PlusOutlined（:232）。
2. 启停 → 右栏 StatusSwitch（行菜单 :340-356 移除）；确认统一（现直发）。
3. Drawer 详情 ContextMetric（:371-405）→ InfoGrid；分页 20→50。

**WarehousesPage**
1. 行 link「详情」按钮（:483-495）移除 → 双击 + 右栏（ContextAction
   「查看详情与库位」:336-340 与行按钮去重后右栏唯一）。
2. 启停 → 右栏 StatusSwitch（Drawer extra :566-595 移除）；删除 Popconfirm
   （:586-592）→ DeleteConfirmModal。
3. SectionTitle/Field（:837-876）→ InfoGrid（G9）；嵌套表状态英文原值
   （:693,738）→ 中文 meta。
4. 新建仓库 Modal okText=创建（:503-514）；筛选顺序搜索第一位（:367-387）；
   onRow 语义 toggle 统一。
5. previewBinCodes/批量建位弹窗与 BinsPage 合并（G9）。

**BinsPage（整页重构）**
1. 补 PageHeader「库位管理」（primary=新建库位；secondary=批量创建）/ FilterBar
   （搜索第一位，:245-254 现第二）/ DataTable + EmptyState / 实体型右栏
   （StatusSwitch + 操作区：查看详情/打印标签/删除 DeleteConfirmModal）。
2. Tag（:306-311）→ StatusBadge；手写三按钮（:313-372）移除。
3. 共享批量建位（G9）。

**StoresPage**
1. rail badge「正常」→「启用」（:556-559）；启停双入口（行菜单 :771-781 +
   抽屉底部 :1468-1477）→ 右栏 StatusSwitch 唯一。
2. 同步动作三入口（行菜单 :741-753 + rail Dropdown :621-635 + 抽屉 :1397-1404）
   → 唯一 rail「立即同步」Dropdown；抽屉同步区保留状态展示与自动同步 Switch。
3. 店铺删除 Popconfirm（:928-949）→ DeleteConfirmModal；凭证删除 modal.confirm
   （:347-355）→ 子资源 Popconfirm 统一。
4. KPI 手写 grid（:813-819）→ KpiRow；平台 Select（:848）加 showSearch。
5. rail useMemo 依赖修正（:641 以 isPending 布尔为依赖）。
6. SectionTitle/InfoField（:1483-1529）→ InfoGrid（G9）。

**StoreBindingsPage（整页重构）**
1. 补 PageHeader「店仓绑定」（primary=新建绑定）/ FilterBar / DataTable + EmptyState /
   实体型右栏（StatusSwitch + 操作区：查看详情/编辑/删除 DeleteConfirmModal）。
2. Tag（:249-264）→ StatusBadge（含库存推送开关列 → 文字徽标或右栏 Switch 展示）；
   手写按钮（:265-300）移除。
3. 深路径 import（:25）→ design-system/index。

### T6 外壳 / 同步 / 系统

**SyncCenterPage**
1. Drawer 英文章节（Summary/Statistics/Errors/Total…，:682-780）→ 中文。
2. 「重新执行」双入口（rail :311-324 + Drawer :784-797）→ 唯一 rail 操作区
   primary + L1 确认（现无确认直发）；Drawer 改只读。
3. 「立即同步」（header primary）保留——触发新任务入口（语义：全店铺选择），
   与「重新执行」（针对失败任务）文案区分并在 tooltip 说明。
4. KPI 与 rail 空闲态去重（rail 改 RailHint + 最近失败任务列表，:222-245）。
5. pre（:864）→ RawDataBlock；事件表行点击直接开 Drawer（:608-611）→ 统一
   选中 + 双击开 Drawer。
6. 同步启停联动：右栏空闲态增加「自动同步开关在 店铺管理 → 店铺详情」提示
   （RailHint + EntityLink），弥补同步中心无法停同步的断层（不改 API）。

**SystemPage**
1. rail 与正文全量重复（:99-140 vs :201-269）→ rail 仅保留「当前账号」+ RailHint；
   服务状态只在正文卡。
2. /stores 双入口（:67-71 + :276-278）→ 保留功能入口卡一个。
3. hover JS 改 CSS（:162-167）；平台参数卡状态徽标保留只读。

**DashboardPage**
1. secondary 裸 Link（:317-319）→ default Button「同步中心」；/sync ×3、
   /exceptions ×2、/stores ×2 入口收敛（KPI 卡点击保留为主入口，卡片 extra
   链接与 header 链接二选一）。
2. 右栏补 `defaultCollapsed: true`（:231-307 现默认展开）；右栏同步异常行
   （:251-256 label=storeCode）修正为店铺名 + 状态 hint，且行可点击 → /sync。
3. 同步失败口径在 aux 文案中标注「最近 100 个任务内」（:186-197）。

**NotificationBell**
1. dot 逻辑修正：仅存在 FAILED 时显示（颜色 danger token）；裸 hex（:180）→ token。
2. TYPE_LABEL 补齐（:23-26 现仅 2 类）；条目点击深链 `/notifications?type=…`
   （页面补 URL 参数读取）。
3. 手写列表项保留（Popover 场景），颜色 token 化。

**GlobalSearch**
1. 搜索态空「快速操作」section 死分支（:271）修复（移除该分支）。
2. recents secondary 显示实体名而非裸 URL（:247）。
3. 店铺结果 secondary 去重 name（:228）。

**App.tsx / AppLayout / Login / HealthTest / SkuCreateModal**
1. 补 `*` 404 路由（EmptyState + 返回首页 Button）。
2. focus mode 正则纳入 `/packages/:id`（AppLayout.tsx:156）。
3. Login 过期双提示（message+Alert，:20-24,52-59）→ 仅 Alert；「登 录」→「登录」。
4. HealthTestPage 加「仅开发联调用」Alert 说明（保留路由）。
5. SkuCreateModal 文案「SKU 已创建」（:59）；三个触发路径登记（SkusPage 按钮 /
   ProductsPage 快速创建 / 命令面板）为合法多入口（不同上下文），不改。

---

## 10. T7 — 清理与共享提取

按 G9 清单执行；额外：

1. 删除所有被 InfoGrid/RawDataBlock/RailHint/KpiRow 替代的手写局部组件。
2. 死代码：Reservations 死注释（:44-46）、Notifications 无效 stopPropagation（:281）、
   GlobalSearch 死分支（:271）。
3. `gui-redesign-phase3-screenshots/` 目录用于本次回归截图（已存在占位）。

## 11. T8 — 回归与验收

1. `pnpm lint` / `pnpm typecheck` / `pnpm check:arch` /
   `pnpm --filter @wcies/web build` 全绿。
2. 1920×1080 与 1366×768 两档截图回归（每管理页 1 张 + 右栏选中态 1 张），
   存入 `gui-redesign-phase3-screenshots/`。
3. 手工清单（dev 环境）：
   - 每管理页：单击选中右栏更新、双击打开详情、右栏操作可执行、启停 Switch
     （停用有确认）、删除走 DeleteConfirmModal；
   - SKU 页分类筛选可搜索；Listings「清除筛选」清空全部；
   - 拣货/打包工作台 focus mode 一致、扫码反馈一致；
   - 全局搜索、通知铃铛、命令面板无回归。
4. 报告落盘 `docs/web-ui-phase3-report.md`（修复清单 + 截图索引 + 遗留项）。

## 12. 禁止事项

- 禁止修改业务逻辑、API 调用语义、状态机、后端代码。
- 禁止新增任何依赖（antd / react 现有版本内解决）。
- 禁止引入新顶级目录、新路由结构（404 页除外）、新状态管理。
- 禁止为统一而重写无关模块；每处改动须能对应本任务书条目。
- 禁止把规范外的写法当作先例复制（AGENTS.md §95/§97 同样适用）。
- 遵守 `docs/UI组件规范_V1.md` 全部条款；发现规范与业务现实冲突时停止并询问，
  不得静默偏离。

## 13. 完成定义（DoD)

```text
R1-R4 四条方向全部落地（§7 G5/G6/G7 可逐页验证）
G1-G10 横切清单清零（或报告中列出明确豁免与原因）
lint / typecheck / check:arch / build 通过
截图回归 + 手工清单通过
docs/web-ui-phase3-report.md 落盘
```

## 14. 推荐执行顺序

```text
T1（DS 组件）→ T4（库存/作业，含最脱离规范的页面，风险低验证组件）
→ T5（采购/主数据，StatusSwitch 密集区）→ T2（商品域，含分类弹窗合并）
→ T3（订单/售后/异常）→ T6（外壳/系统）→ T7（清理）→ T8（回归）
```

每批一个提交节点；T1 完成后其余批次可按域并行（不同会话），
但 G 横切项归属以本任务书为准，不得重复实现。
