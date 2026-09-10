# WCIES 2.0 Web Frontend Redesign — Phase 2 Final Report

> 日期：2026-09-10
> 任务书：`WCIES_2.0_Web_前端_Phase_2_UI_重构任务书.md`
> 范围：Web Frontend UI/UX 重构（不修改核心业务逻辑）

---

## 1. Executive Summary

Phase 2 完成。在 Phase 1 的 Design System 与三栏 AppShell 基线之上，本次交付了 6 个方向：

1. **Stores 店铺管理**重构为完整工作台（同步健康 KPI、行级同步状态、Context Rail、详情 Drawer）
2. **Sync Center 同步中心**重构（KPI 卡、任务表、错误预览右栏、详情 Drawer、Webhook 事件页签、手动同步/重新执行）
3. **Exception Center 异常中心**新建（统一异常工作台：风险分级、解决/忽略闭环、按异常类型动态跳转关联对象）
4. **System 系统管理**新建 Hub（功能入口、实时服务健康、当前账号、平台参数）+ 仓库工作台重构 + SKU 映射总览页
5. **Global Search** 升级为 Command Palette（Ctrl/Cmd+K、订单/SKU/店铺搜索、最近访问、快速操作、键盘导航、实体深链直达）
6. **Notification / Activity** 体系（Topbar Popover 事件流、通知中心页重构、明确 Notification=事件流 / Exception=待处理问题的边界）

过程中清理了全部 antd v6 废弃 API（Drawer `width`→`size`、Space `direction`→`orientation`、Alert `message`→`title`），修复了一类 React Query 缓存失效前缀不匹配导致的 KPI 不刷新缺陷。18 个路由在真实浏览器中 Console 0 error / 0 warning。lint / typecheck / check:arch / 104 单测 / build / 134 集成测试全部通过。

## 2. Starting Baseline

- 起始提交：`5a49cf3 chore(web): checkpoint before phase 2 redesign`
- 基线验证（全部通过后建立 checkpoint）：`pnpm lint` / `pnpm typecheck` / `pnpm check:arch` / `pnpm test`(104) / `pnpm build`
- 未 squash / 未覆盖 Phase 1 提交（Phase 1 最终提交为 `65b3abb`）

## 3. Scope

| 方向 | 页面/路由 | 状态 |
| --- | --- | --- |
| Stores | `/stores`（含 Drawer 三级交互） | 重构 |
| Sync Center | `/sync`（任务 + Webhook 事件双页签） | 重构 |
| Exception Center | `/exceptions`（新路由） | 新建 |
| System | `/system`（Hub）、`/platform-mappings`（新路由）、`/warehouses` | 新建/重构 |
| Global Search | AppShell Topbar + 全局 | 新建 |
| Notification | Topbar Popover + `/notifications` | 重构 |
| AppShell | 导航分组（同步与异常 / 系统管理 / 映射总览） | 增强 |
| Phase 1 回归 | Dashboard / SKU / Inventory / Orders / Picking | 验证 + 轻量收敛 |

不在范围（未改动）：后端业务逻辑、库存核心、订单状态机、Picking 业务、同步业务规则。

## 4. Stores

- **KPI（§8.1）**：全部店铺（`meta.total`，服务端事实）/ 正常 / 需要关注 / 同步异常。后三项由当前页行 + 最近同步任务推导（135 家店铺、50 行分页），aux 文案说明推导口径；不臆造。
- **表格（§8.2）**：店铺（名称+编码）/ 平台 / 状态 / 授权（已配置·未连接）/ 商品同步 / 订单同步 / 最后同步（相对时间 + Tooltip 绝对时间）/ 操作（详情 + ActionMenu）。
- **每行同步健康**：由一次 `GET /sync/jobs?pageSize=100` 按店铺+类型推导最新任务（§76 禁止逐行请求），非逐行调用。
- **状态映射（§9）**：ACTIVE→启用、凭证缺失→未连接、任务 FAILED→同步异常等中文映射，Tooltip 保留原始代码。
- **Context Rail（§10）**：EntitySummary + 连接状态 + 最近同步 + 概况；快捷操作：查看详情 / 立即同步（下拉：同步订单、同步商品）/ 查看异常（跳转 `/exceptions?storeId=`）。
- **Drawer（§11）**：基础信息（InfoGrid 风格）/ Connection（凭证表、验证连接、配置 MAIN_API）/ 同步状态（overview 接口 + 手动同步）/ 仓库绑定 / 启停用。不显示任何密钥明文。
- 既有业务流保留：新建店铺（`POST /stores` 真实支持，故显示"添加店铺"按钮）、凭证加密保存、连接验证、启停用。

## 5. Sync Center

- **Header（§13）**：刷新 + 立即同步（Modal：店铺 + 类型单选 → `POST /sync/orders|listings`，真实接口，202 Accepted 已实测）。
- **KPI（§14）**：运行中 / 等待处理 / 累计成功 / 累计失败。后端无日期过滤，故标注"累计"而非"今日"——不伪造时间窗。每项为 `pageSize=1` 计数查询。
- **Job Table（§15-§17）**：任务（类型中文 + 触发方式 + Job ID 短码）/ 平台 / 店铺 / 类型 / 状态（SyncStatusBadge 语义色）/ 处理（成功/跳过/失败三色数字）/ 开始时间 / 耗时（`fmtDuration`）/ 错误（errorCode + Tooltip message）。后端无 progress/total 字段，不制造百分比（§17），以计数表达。
- **Context Rail（§18）**：任务概况 + 最近错误（errorCode/message）+ 查看完整详情 + 重新执行（真实触发同店铺同类型新任务，已实测 202 + 列表实时刷新）。
- **Drawer（§19）**：Summary / Statistics（Total·Success·Failed·Skipped）/ Errors（局部浅红卡）/ 游标 Cursor（可复制，保留既有能力）/ 重新执行。
- **Webhook 事件页签**：RawEvent 表 + 原始报文 Drawer（保留既有功能，统一视觉）。
- 运行中任务存在时每 3 秒轮询刷新（`useEffect` + `invalidateQueries`，替换原 `setTimeout` 逃逸写法）。

## 6. Exception Center

- **数据**：全部来自 `GET /exceptions`（类型/状态/引用/店铺过滤），resolve/ignore 为 `POST /exceptions/{id}/resolve|ignore`。
- **类型映射（§21）**：仅后端真实枚举 → ORDER_SKU_MAPPING_FAILED=SKU 映射失败 / ORDER_OUT_OF_STOCK=订单缺货 / ORDER_INVALID_STATE=订单状态异常 / ORDER_INTERCEPTION_FAILED=拦截失败。店铺连接异常、同步异常暂无对应异常类型（API Gap，见 §13）。
- **KPI（§22）**：待处理（服务端 total）/ 高风险（OPEN 最近 100 条中 HIGH 计数，aux 明示口径）/ 已解决 / 已忽略。"今日新增"因无日期过滤 API 而省略（§22 允许）。
- **表格（§23）**：异常（类型 + message）/ 类型分类 / 店铺 / 风险（RiskIndicator）/ 发生时间 / 状态。风险来自后端 severity 字段，不做 UI 猜测。
- **视觉（§25）**：红色仅出现在 Badge 与文字局部；OPEN+HIGH 行使用 2px 左侧风险指示条；无红色行背景、无大面积红色。
- **Row 交互（§24）**：Rail 展示风险/错误说明/关联对象；**关联操作按 details JSON 动态生成**（`orderNo` → 查看订单、映射失败 → 按 offerId/platformSkuId 跳转 SKU 映射工作台），均为真实数据驱动；快捷操作：标记解决（备注 Modal）/ 忽略。
- 已实测闭环：解决后列表、Tabs 计数、KPI 实时刷新（8→7→6）。

## 7. System

- **IA（§26）**：`/system` Hub = 功能入口（仓库与库位 / SKU 映射总览 / 店铺与平台 / 同步中心 / 导入中心 / 通知中心）+ 系统状态（`/health/ready` 实时：API/PostgreSQL/Redis）+ 当前账号（`/auth/me`）+ 平台参数（`/platforms` 只读）。
- **用户与权限（§28）**：后端无用户管理 API，未自创任何角色/权限 UI；仅展示当前登录账号（admin / ADMIN）。
- **仓库（§27）**：重构为工作台（PageHeader + FilterBar + DataTable + Rail：基本信息/库存摘要 + Drawer：基本信息/库位/绑定店铺）；新建仓库、批量创建库位等既有业务流保留。
- **SKU 映射总览（§29）**：`/platform-mappings` 只读总览（已映射 105 / 未映射 1,334 / 映射类异常 3，均服务端计数），UNMAPPED 行左侧橙色指示；单 SKU 映射与批量操作仍归 `/listings` 工作台与 SKU 页，职责不重叠。

## 8. Global Search

- **入口（§30）**：Topbar 搜索框改为触发器按钮（含 Ctrl K 提示）；`Ctrl/Cmd+K` 全局开关；Esc 关闭。
- **结构（§31）**：居中 Palette = 搜索输入 + 最近访问（localStorage，上限 6）+ 快速操作 + 分组搜索结果 + 底部键盘提示。
- **实体搜索（§32-§33）**：无统一搜索 API，分别调用现有 `orders?keyword` / `skus?keyword` / `stores?keyword`（各取 5 条）；**min 2 字符、300ms debounce**（§77），过期请求通过 queryKey 竞态隔离。
- **结果条目**：图标 + 主文本 + 次文本（平台·店铺）+ 类型标签 + 状态 Badge（订单 ERP 状态 / SKU 状态）。
- **深链直达（§33/§86）**：点击/Enter → `/orders?keyword=ORD…&focus=<id>` 等，目标页自动预填搜索、选中行并直接打开详情 Drawer（已实测订单深链）。
- **快速操作（§34）**：查看异常 / 打开同步中心 / 进入拣货 / 创建 SKU（`/skus?create=1` 打开新建弹窗）——全部为真实存在的页面/动作。
- **键盘（§52）**：↑ ↓ 高亮、Enter 执行、Esc 关闭，已实测。

## 9. Notification Center

- **Topbar Popover（§35-§36）**：铃铛 → Popover，按时间倒序展示最近 6 条（Title / Description / Time 结构）；存在 FAILED 投递时红点提示；条目点击与"查看全部"跳 `/notifications`；已实测 Open → Click → Navigate → Close。
- **通知页**：重构为工作台（KPI：当前筛选总数 / 投递失败；类型+状态过滤；可展开详情含失败原因与尝试次数；FEISHU FAILED 可重试 `POST /notifications/{id}/retry`）。
- **边界（§37）**：通知页明确标注"事件流；需要处理的问题请前往异常中心"，两者结构刻意不同。

## 10. Design System Changes

新增共享组件/工具（均满足"≥2 页面复用或全局能力"）：

| 名称 | 说明 | 使用方 |
| --- | --- | --- |
| `RelativeTime` | "5 分钟前" + Tooltip 绝对时间（§45） | Stores/Sync/Exceptions/Notifications/Warehouses/Popover |
| `SyncStatusBadge` | 同步任务状态语义色 + 原始码 Tooltip | Stores/Sync |
| `ErrorState` | "无法加载数据" + 重新加载（§40） | 全部 Phase 2 页面主数据区 |
| `EntityLink` | 关联实体跳转链接 | Exceptions/Sync/PlatformMappings |
| `RiskIndicator` + `riskAccentColor` | 异常风险徽章 + 2px 行指示条（§25） | Exceptions/PlatformMappings |
| `CommandPalette` | 命令面板外壳（§30-§34） | GlobalSearch |
| `utils/format.ts` | fmtDateTime / fmtDateTimeShort / relativeTime / fmtDuration / fmtNumber（§45-§46） | 全部新页面 |

未新建第二套组件系统；EmptyState 复用 Phase 1 版本（error 变体即 ErrorState 底座）。

## 11. AppShell Changes

- 导航分组调整：`同步与店铺` → **`同步与异常`**（同步中心 / 异常中心 / 店铺管理 / 店仓绑定）；`系统` 增加 **系统管理** Hub；`商品` 增加 **映射总览**。全部沿用现有路由，无重复路由。
- Topbar：搜索 Input → Command Palette 触发器；通知按钮 → Popover；`Ctrl/Cmd+K` 监听更新。
- 交互体系不变：行点击 → Context Rail → Drawer 三级交互；Rail 折叠偏好 localStorage 记忆。

## 12. API Usage（Phase 2 新消费）

| 端点 | 用途 |
| --- | --- |
| `GET /stores`、`GET /stores/{id}`、`POST /stores`、`POST /stores/{id}/activate\|deactivate` | 店铺列表/详情/新建/启停 |
| `GET /stores/{storeId}/credentials`、`POST .../credentials`、`POST .../credentials/{id}/validate` | 凭证列表/配置/验证（无明文回显） |
| `GET /stores/{storeId}/warehouse-bindings` | 店铺仓库绑定 |
| `GET /sync/stores/{storeId}/overview` | 店铺级凭证/最近同步/连续失败（选中时单次调用） |
| `GET /sync/jobs`（列表+计数）、`GET /sync/jobs/{id}` | 任务表 / KPI / 详情 |
| `POST /sync/orders`、`POST /sync/listings` | 手动同步 / 重新执行（真实 202 已验证） |
| `GET /sync/events` | Webhook 事件页签 |
| `GET /exceptions`（过滤+计数）、`GET /exceptions/{id}` | 异常列表 / KPI |
| `POST /exceptions/{id}/resolve\|ignore` | 异常处理闭环（实测通过） |
| `GET /notifications`（列表+计数）、`POST /notifications/{id}/retry` | 通知流 / 重试 |
| `GET /warehouses`、`GET /warehouses/{id}`、`GET /warehouses/{id}/bins`、`POST /warehouses`、`POST .../bins/batch` | 仓库工作台 |
| `GET /listings`（mappingState 过滤+计数） | 映射总览 |
| `GET /platforms`、`GET /auth/me`、`GET /health/ready` | System Hub |

所有业务数据均来自真实 API；无 Math.random / Fake KPI / Hardcoded 数据。

## 13. API Gaps

| 页面 | 需要的数据 | 当前 API | 缺失内容 | 建议接口 | 是否阻塞 UI |
| --- | --- | --- | --- | --- | --- |
| Stores | 每店铺最新同步状态批量查询 | `GET /sync/jobs` 全量列表 | 无按店铺聚合的批量端点 | `GET /sync/stores/status`（批量） | 否（前端一次取 100 条推导，店铺规模大时需后端聚合） |
| Stores/Sync | 库存同步 / 物流同步 / 映射同步类型 | syncType 仅 ORDER_SYNC / LISTING_SYNC | INVENTORY/SHIPMENT/MAPPING 同步类型 | 后端新增 SyncType | 否（仅展示现有两类，未伪造） |
| Sync Center | 任务进度百分比/total | SyncJobDto 无 progress/total 字段 | 进度数据 | job 增加 processed/total | 否（按要求不制造百分比，以计数+耗时表达） |
| Sync Center | 按日期统计（今日成功/失败） | 无日期过滤参数 | createdAfter/createdBefore 查询参数 | 列表接口增加日期过滤 | 否（改为"累计"口径并标注） |
| Exception Center | 今日新增、风险维度过滤 | 无日期过滤、无 severity 过滤参数 | severity/createdAt 查询参数 | 列表接口增加过滤 | 否（高风险 KPI 以"近 100 条待处理"口径标注） |
| Exception Center | 店铺连接异常、同步异常类别 | 异常枚举仅订单类 4 种 | SYNC_FAILED / NEGATIVE_INVENTORY 等异常类型接入 | 后端将同步失败等写入异常中心 | 否（仅显示真实存在的类别） |
| System | 用户与权限管理 | 仅 `auth/me` | 用户列表/角色 CRUD | `GET/POST /users` 等 | 否（明确提示"暂无用户管理 API"，未自创权限模型） |
| Global Search | 统一搜索端点；拣货任务关键字搜索 | 无（分别调用三个列表接口；PickingTask 无 keyword 参数） | 统一搜索 API | `GET /search?q=` | 否（三接口并行 + debounce；拣货暂不入搜索范围） |
| Stores 列表 | 国家/市场字段 | StoreListItemDto 无 country | 国家字段 | Store 增加市场属性 | 否（未显示该列） |

未为补齐任何 Gap 修改后端。

## 14. Responsive Behavior

| 分辨率 | 行为 | 验证 |
| --- | --- | --- |
| 1920×1080 | 三栏完整（Sidebar / Main / Context Rail inline） | 全页面截图 02-14 |
| 1440×900 | 表格页 Rail 默认折叠，表格占满（01-stores-1440） | 实测 |
| 1366×768 | Rail 不再挤压表格（inline 隐藏），经 Topbar 切换按钮以 Overlay Drawer 打开 | 实测（15/16/17 截图 + DOM 断言：inlineRail=false、无横向滚动） |

未做移动端专门设计（§51）；Picking 专注模式（`/picking/:id` 侧栏收窄）未受 AppShell 改动影响（focusMode 逻辑保留）。

## 15. Accessibility

- 全部 Icon-only 按钮带 `aria-label`（全局搜索 / 右栏切换 / 帮助 / 通知中心 / 更多操作）。
- Command Palette：`role="dialog"` + `aria-modal` + 输入 `aria-label`，↑↓EnterEsc 可达（§52 实测）。
- Drawer Esc 关闭（实测）；ActionMenu 展开按钮 `aria-label="更多操作"`。
- 状态传达为"文字+色点"，不依赖颜色单独表达（StatusBadge 结构）。

## 16. Performance

- 无逐行请求：店铺行级同步健康来自一次 recent-jobs 查询（§76）；店铺 overview 仅在选中时单次调用并被 React Query 缓存复用（Rail 预览与 Drawer 共用同一 queryKey）。
- KPI 计数统一 `pageSize=1` 轻查询。
- 服务端分页：stores(50)/jobs(20)/exceptions(20)/listings(20)/notifications(20)；未出现"一次拉数千条前端过滤"（§78）。
- 搜索 300ms debounce + 2 字符下限 + queryKey 竞态隔离（§77）。
- 修复缓存失效缺陷：KPI/计数查询 queryKey 统一前缀（`['exceptions', …]`、`['sync-jobs', …]`、`['listings', …]`、`['notifications', …]`），保证一次 invalidate 全族刷新。

## 17. GUI Test（真实浏览器）

环境：Playwright + Chromium，后端 `localhost:3000`（真实种子数据：135 店铺 / 15 订单 / 8 异常 / 同步任务 / 3 通知）。

| 场景 | 结果 |
| --- | --- |
| Stores：平台/状态筛选、关键字搜索、行点击→Rail、详情 Drawer、添加店铺 Modal、立即同步下拉 | ✅ |
| Sync：状态/类型/店铺筛选、任务行→Rail、Job Detail Drawer、重新执行（202→新任务失败本地可见）、立即同步 Modal、Webhook 页签 | ✅ |
| Exceptions：Tabs/类型/店铺筛选、行→Rail、关联对象链接（订单/映射 offerId）、标记解决（备注）→ 计数实时刷新、忽略入口 | ✅ |
| Global Search：Ctrl+K 开、输入订单号命中、↓ 选择、Enter 深链直达订单 Drawer、Esc 关闭、SKU/店铺搜索、最近访问 | ✅ |
| Notification：铃铛 Open、条目 Click→Navigate、Popover Close、查看全部 | ✅ |
| Phase 1 回归：Dashboard/SKU/Inventory/Orders/Picking 数据加载与交互正常 | ✅ |
| Console：18 路由全部 0 error / 0 warning（含 antd 废弃 API 全部清理） | ✅ |

期间发现并修复的真实缺陷：SystemPage 响应包结构解包错误（运行时崩溃）、React Query 计数缓存不失效（KPI 停留旧值）、antd v6 三类废弃 API、Modal 表单未挂载警告（forceRender）、同步成功提示依赖未 enrich 的响应字段。

## 18. Screenshots

目录：`gui-redesign-phase2-screenshots/`（17 张，含任务书要求的全部 14 张）

```
01-stores-1440.png             02-store-detail-1920.png
03-sync-center-1920.png        04-sync-job-detail-1920.png
05-exceptions-1920.png         06-exception-context-1920.png
07-system-1920.png             08-global-search-1920.png
09-notification-center-1920.png
10-dashboard-regression-1920.png
11-sku-regression-1920.png     12-inventory-regression-1920.png
13-orders-regression-1920.png  14-picking-regression-1920.png
15-exceptions-1366.png         16-exception-overlay-rail-1366.png
17-platform-mappings-1366.png
```

每张均经人工/视觉模型逐项检查：溢出、错位、重叠、空白、列宽、Tooltip、Drawer、Context Rail、状态、Padding —— 无未解决缺陷。

## 19. Automated Tests

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | ✅ 0 error |
| `pnpm typecheck` | ✅（shared/platform-contracts/api-client/api/web） |
| `pnpm check:arch` | ✅ 5 rules passed |
| `pnpm test` | ✅ 15 files / 104 tests |
| `pnpm test:integration` | ⚠️→✅ 默认并行 3 个文件 ECONNRESET（Postgres 连接被并行压垮）；按任务书 §73 以 `--maxWorkers=1` 重跑：**16 files / 134 tests 全部通过**。即：环境并行不稳，单 worker 全部通过 |
| `pnpm build` | ✅（chunk >500kB 提示为既有 informational warning） |

说明：`@wcies/web` 无测试运行器（Phase 1 即无）。为 web 引入 vitest+RTL 属于新增 dev 依赖（AGENTS.md §73 禁止擅自安装），且 UI 正确性已由真实浏览器 GUI 回归覆盖，故本阶段未添加 web 单测，留待后续决策。

## 20. Known Limitations

1. Stores KPI 的"正常/需要关注/同步异常"基于第一页（50 行）+ 最近 100 条任务推导；`meta.total` 为服务端事实。店铺数量显著超过单页时建议后端提供聚合端点（见 API Gap）。
2. 高风险 KPI 口径为"最近 100 条待处理中 HIGH 计数"，已在 UI 标注。
3. 同步触发响应体中 storeCode/platformCode 为空（后端创建时尚未 enrich），前端提示文案改用请求上下文的店铺标签。
4. 部分种子数据本身含乱码店铺名（如"OZON A??"，历史 GUI 测试遗留），非本次 UI 缺陷。
5. web 前端无自动化单测（见 §19 说明）。
6. 集成测试在本机需 `--maxWorkers=1`（并行连接重置）。

## 21. Git Commits

```
5a49cf3 chore(web): checkpoint before phase 2 redesign (add phase 2 task spec)
feee07a feat(web): redesign stores workspace with sync health KPIs, context rail and drawer
0deaa87 feat(web): add sync center workspace with KPI cards, job rail and detail drawer
81b45c8 feat(web): add exception center with risk indicators, resolve/ignore and entity jump
337edb1 feat(web): redesign system settings hub, mapping overview and warehouses workbench
5fe86a5 feat(web): refine activity feed and topbar notification popover
cbb62e5 feat(web): add global search command palette with entity deep links
866ed68 refactor(web): unify phase 2 interaction patterns; fix antd v6 deprecated APIs and query cache invalidation
<final> docs(web): add phase 2 redesign report and GUI acceptance screenshots
```

统计：33 文件，+5,103 / −855 行（不含报告与截图）。

## 22. Final Status

**Phase 2 完成（Definition of Done 全项满足）**：

- [x] Stores 完成
- [x] Sync Center 完成
- [x] Exception Center 完成
- [x] System 页面完成
- [x] Global Search 完成
- [x] Notification / Activity 完成
- [x] Phase 1 页面无回归
- [x] 1920 / 1440 / 1366 验收
- [x] GUI 真实功能测试完成
- [x] Console 无 Runtime Error（且 0 warning）
- [x] lint / typecheck / architecture check 通过
- [x] unit tests 通过（104）
- [x] integration tests 通过（134，单 worker）
- [x] build 通过
- [x] 截图完成（17 张）
- [x] Phase 2 Report 完成
- [x] Git 工作区干净

用户工作闭环已成形：Dashboard 看状态 → 业务页处理订单/库存 → Sync/Exception 定位后台问题 → Context Rail 快速判断 → Detail Drawer 完成操作；任意页面 Ctrl+K 直达实体。
