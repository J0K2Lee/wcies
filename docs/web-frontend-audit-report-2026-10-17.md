# WCIES 2.0 Web 前端代码体检报告

> 日期：2026-10-17
> 范围：`apps/web/src`（43 个页面文件 / 100 个 ts·tsx / 35,084 行）+ 构建产物 + 依赖版本
> 性质：**只读体检**。本次未修改任何业务代码，也未改动仓库文件（除本报告）
> 基线提交：`e6bfb2f feat(web,orders): 分页与批量动作迁入页面底部浮岛`
> 关联文档：`AGENTS.md`、`docs/UI组件规范_V1.md`、`docs/web-ui-phase3-report.md`

---

## 1. Executive Summary

**结论：类型纪律与设计系统是好的底子；真正的成本集中在两处 —— 打包策略与列表页脚手架的复制。**

六个维度的现状与判断：

| 维度 | 现状 | 主要症结 | 优先级 |
| --- | --- | --- | --- |
| 性能（加载） | 差 | 单 chunk 1.94 MB / gzip 572 KB，零路由级代码分割 | **P0** |
| 性能（渲染） | 中 | 超长组件每次 setState 全表重渲染；逐单元格挂 Tooltip | P1 |
| 代码结构 / 可维护性 | 中偏弱 | 27 个页面各自实现分页与查询键；单文件最大 3,907 行 | P1 |
| 组件复用 / 状态管理 | 中 | Design System 完备，但列表壳未抽 hook；筛选态不进 URL | P1–P2 |
| 可访问性 | 中偏弱 | 32 处可点击行无键盘支持；`aria-live` 仅 1 处；标题恒为「WCIES」 | P2 |
| 错误与边界处理 | 弱 | 161 处查询仅 9 个文件渲染错误态；单一 ErrorBoundary 且不复位 | P1 |

**三件最该先做的事**：① 路由级 lazy 分包（首屏 gzip 预计 572 → 约 327 KB）；② 订单大表加横向滚动（当前列宽合计 1,380 px，可用宽度仅 1,044 px，必然折行）；③ 8 处搜索框补防抖（现在每敲一个字符打一次接口）。

**已经做得好的**（不应在改造中回退）：

- 类型纪律：`any` 全站仅 1 处；`check:arch` 规则化架构校验常驻 pre-commit。
- Design System：39 个组件、令牌集中（`design-system/tokens.ts`），`DataTable`/`PageHeader`/`SectionCard` 已被广泛复用。
- 语义不依赖颜色：`StatusBadge`/`RiskIndicator` 均为「色 + 文案（+ 原始枚举 hint）」三重表达。
- 图标按钮可访问性：`aria-label` 47 处，`AppLayout` 的 `nav`/`aside`/`main` 均有 landmark 与可读名称。

---

## 2. 测量方法与基线

所有数字均为本机实测，命令见附录 A。**这份基线是后续验收的对照物，不是估算。**

### 2.1 构建产物

| 指标 | 基线值 | 采集方式 |
| --- | --- | --- |
| JS chunk 数量 | **1** | `apps/web/dist/assets/*.js` |
| JS 原始体积 | **1,987,419 B（1,940.8 KB）** | `stat` |
| JS gzip 体积 | **586,169 B（572.4 KB）** | `gzip -c \| wc -c` |
| CSS 体积 | 675 B（antd v6 为 CSS-in-JS，样式随 JS 走） | 同上 |
| sourcemap | 0 | — |
| 构建内核 | Vite **8.2.2** + rolldown **1.2.7** | `package.json` / `.pnpm` |

### 2.2 分包潜力（试构建实测）

用临时配置把 `src/pages/*` 按目录切成独立 chunk 试构建一次（产物写入系统临时目录，跑完即删，未进仓库）：

| 指标 | 值 |
| --- | --- |
| 可延迟加载的首方页面代码合计 | **899.8 KB（min，未 gzip）**，占单包的 **46%** |
| 其中最大的页面 chunk | `finance` 161.6 KB、`listings` 98.6 KB、`HealthTestPage` 74.8 KB、`skus` 67.6 KB、`orders` 60.1 KB |
| 常驻首屏的依赖块 | ≈ 976.7 KB（react / react-dom / antd / dayjs / rc-* 被并进首个引用方 chunk） |

**结论与预估**：路由级 `lazy()` 后，首屏只需 shell + 依赖 + 首页，预估 **gzip 572 KB → 约 327 KB（-43%，省约 245 KB）**（= 首方 `index` 块 7.2 KB gzip + 常驻依赖块 320.2 KB gzip）；其余页面按访问时加载 5–162 KB/页。此为按上述实测推导的预估，落地后须以真实构建复测。

> **实施注意（已实测踩坑）**：在 Vite 8 / rolldown 下，`build.rollupOptions.output.manualChunks` 的 vendor 分组**不可靠** —— 试构建中 `react`/`react-dom`/`react-router`/`dayjs` 的分组条件均未生效，`vendor-*` 只占 61.7 KB，其余被并入首个引用它们的首方 chunk。因此**不要照搬 Vite 5 时代的 `manualChunks` 配方**；主杠杆应是路由级动态 `import()`（rolldown 原生按动态导入切块），vendor 分组需以构建产物实测为准，见 §4.3。

### 2.3 源码与运行期计数

| 指标 | 值 |
| --- | --- |
| 源码规模 | 100 个 ts/tsx，35,084 行；43 个页面文件 |
| 最大单文件 | `OrdersPage.tsx` 3,907 行（27 个 `useState`）、`StoresPage` 1,894、`SkusPage` 1,826、`PurchaseReceiptsPage` 1,715、`PurchaseOrdersPage` 1,447 |
| `React.lazy` / `Suspense` | **0 处** |
| `useApiQuery` 调用 | **161 处** |
| 渲染 `<ErrorState>` 的文件 | **9 个** |
| `onRow={{ onClick }}` | **32 处** |
| 内联 `style={{}}` | **1,030 处** |
| 页面级 `useState(1)` 管 page | 27 个页面 |
| 前端测试 | 3 个 spec / 320 行 |
| `document.title` 赋值 | **0 次** |
| `aria-live` | 1 处；`aria-label` 47 处 |
| 空 `catch {}` | 8 处 |

---

## 3. 问题清单（按影响排序）

每条给出：**位置**（文件:行）、**证据**、**潜在风险**、**优化方向**。

### P0 — 影响首屏与主流程

#### P0-1 全站单包 1.9 MB（gzip 572 KB），零代码分割

- **位置**：`app/App.tsx:4-43`（40 个页面静态 import）；`vite.config.ts`（无 `build` 分包配置）
- **证据**：构建产物仅 1 个 JS chunk（§2.1）；全站 `React.lazy`/`Suspense` 0 处；可延迟的页面代码占 46%（§2.2，实测）
- **风险**：登录后首屏必须下载并解析全部 43 个页面（含 3,907 行的订单页、antd Table/Drawer/Modal/Timeline/DatePicker、dayjs、rc-table、rc-picker）；中低端机与弱网下首屏可交互时间被显著拖长；每次发版单个 hash 变化导致**全量缓存失效**
- **优化方向**：路由级 `lazy()` 分包（`AuthGate`/`AppLayout`/`design-system` 保持静态常驻），统一 `Suspense` fallback 为页面骨架而非全屏 Spin；首屏 vendor 分组需实测（见 §4.3 注意项）；建议同时定一个体积预算并在 CI 卡口

#### P0-2 订单主表列宽合计 1,380 px，却没有横向滚动

- **位置**：`pages/orders/OrdersPage.tsx:2722-2963`（`mainColumnDefs` 9 列）、`:3230`（`columns={mainColumns}` 处未传 `scroll`）
- **证据**：9 列 `width` 合计 **1,380 px**；该表无 `scroll={{ x }}`；全站仅 3 处使用 `scroll`；`<main>` 可用宽度 = 1600（右栏展开）时 **1,044 px**、1366 时 **1,110 px**（实测 `main` 矩形 209→1299）
- **风险**：列宽被压缩后单元格内容折成 2–3 行 → 行高翻倍、一屏可见行数骤减（2026-10-16 验收截图中平台订单号已折行）；`PlatformTag`/`StatusBadge` 等行内 chip 挤压变形；订单页是最核心的作业页，此项直接影响日常效率
- **优化方向**：给大表加 `scroll={{ x: 1380 }}`（或按最宽配置 1440）让**表格内部**横滚，页面本身仍不横滚；`PlatformTag`/`StatusBadge` 补 `whiteSpace: nowrap`；窄屏用列 `responsive` 隐藏次要列。同批复查 `SkusPage`/`StoresPage`/`ListingsPage` 的列宽合计

#### P0-3 搜索框每输入一个字符就打一次接口

- **位置**：`OrdersPage.tsx:3034`、`InventoryPage.tsx:492`、`SkusPage.tsx:922`、`StoresPage.tsx:951`、`ListingsPage.tsx:596`、`PlatformMappingsPage.tsx:238`、`BrandManageModal.tsx:155`、`CategoryManageModal.tsx:374`
- **证据**：`onChange={(event) => setKeyword(event.target.value)}` 直接写入查询参数，而 `keyword` 位于 `useApiQuery` 的 queryKey 中；项目内已有 `useDebouncedValue`（`api/hooks.ts:60`）且已被 `GlobalSearch`、`SkusPage`、`ListingsPage` 等 6 处使用，这 8 处未用
- **风险**：输入 6 个字符 = 6 次列表接口（后端 ILIKE 扫描）+ 6 次整页重渲染；弱网下结果闪烁、与翻页/排序请求竞态（后到的旧结果覆盖新结果）；对 3,907 行的订单页尤其昂贵
- **优化方向**：统一改为 `useDebouncedValue(keyword, 300)` 后再进入查询参数与 queryKey；保留回车 `onSearch` 立即生效的语义（防抖值需支持立即刷新或让 `onSearch` 直接写入）

---

### P1 — 结构性成本，越早收敛越省

#### P1-4 列表页脚手架被复制约 27 份

- **位置**：27 个页面各自 `useState(1)` 管 page；25 个页面用表格自带分页、14 个页面 `pagination={false}`；`ActionIsland` 仅接入 4 个文件，`PurchaseOrdersPage.tsx:621-660` 仍是旧的顶部批量条
- **证据**：上一轮修复的「queryKey 漏 `pageSize`」缺陷（commit `7d86cc6`）正是「参数与键手写两遍」的直接后果——`useApiQuery` 的 `queryKey` 与 `params` 由调用方分别维护，没有任何机制保证二者一致
- **风险**：同类缺陷会在每个新列表页复现，且**静默**（不报错、不告警，只是不刷新）；分页交互两套并存（表底 vs 浮岛）造成体感不一致
- **优化方向**：抽 `useListQuery({ path, filters, defaultPageSize })`，内部统一构造 `page/pageSize/keyword/排序` 的 params 与 queryKey（由同一份对象派生，从根上消除漂移）；把剩余列表页收口到 `ActionIsland`

#### P1-5 超长组件：`OrdersPage.tsx` 3,907 行 / 27 个 state

- **位置**：`mainColumnDefs`（`:2722-2963`）、`mainColumns`（`:2965-2968`）、`rowSelection`（`:3148-3153`）、`expandable`（`:3155-3212`）、`onRow`（`:3214-3227`）均为**每次渲染重建**
- **证据**：`mainColumnDefs` 是渲染函数体内的对象字面量，`mainColumns` 每渲染 `filter+map` 出新数组；antd Table 依赖 `columns` 引用做列级记忆化，引用一变即全表重算
- **风险**：选行、开关抽屉、敲搜索词等任何一次 `setState` 都会让 3,907 行组件整重渲染 + 重建列定义 + 全部行重渲染；排查问题时单文件认知负荷过高
- **优化方向**：先按职责拆文件（`columns.tsx` 列定义、`OrderRail.tsx` 右栏、`ExpandedOrderItems`、`ViewSettingsModal`）；列定义提为模块级常量或用 `useMemo`；`rowSelection`/`expandable`/`onRow` 同样记忆化

#### P1-6 每个时间单元格都挂一个 antd Tooltip

- **位置**：`design-system/components/RelativeTime.tsx:18`（`<Tooltip title={fmtDateTime(value)}>`）、`:20`（`relativeTime` 每次渲染重算）
- **证据**：全站 `<RelativeTime>` 50 处；订单页「下单时间/发货时限」两列逐行渲染 → 100 行 ≈ 200 个 Tooltip 实例
- **风险**：rc-tooltip + trigger + 定位逻辑常驻内存，却只在 hover 时有用；表格每次重渲染这些实例全部重建，是 P1-5 重渲染成本的放大器
- **优化方向**：改用原生 `title` 属性（零实例、零浮层、系统级提示），精确时间同时进详情抽屉；`relativeTime` 结果按「分钟精度」缓存，避免同一秒内反复 `Date.now()`

#### P1-7 161 处查询，只有 9 个文件会渲染错误态

- **位置**：`<ErrorState>` 仅出现于 Exceptions/Listings/Notifications/Stores/Sync/PlatformMappings/System/Users/Warehouses 共 9 个页面；其余页面普遍用 `query.data?.meta.total ?? 0` 兜底
- **证据**：`useApiQuery` 调用 161 处 vs `<ErrorState>` 9 处
- **风险**：请求失败时 `data` 为 `undefined` → 列表渲染成空表 + 「共 0 单」，**与「确实没有数据」无法区分**；这直接违背 `AGENTS.md` 的核心原则「异常可见」，且用户会误判为数据丢失
- **优化方向**：在 `DataTable`/列表壳层统一接收 `error` 与 `onRetry`，失败时渲染 `ErrorState`（含重试）；把「失败 ≠ 空」做成框架级保证，而不是逐页自觉

#### P1-8 唯一 ErrorBoundary 挂在根部，且不会复位

- **位置**：`app/providers.tsx:52`（`<ErrorBoundary>` 包住整个 App）、`components/ErrorBoundary.tsx:10-27`
- **证据**：`state` 只有 `hasError`/`message`，无 `resetKeys`、不随路由变化清除；`render` 直接把 `error.message` 作为 `subTitle` 展示
- **风险**：任一页面渲染异常 → **整个工作台**变成错误页；`hasError` 不会因路由切换复位，用户只能整页刷新；英文技术栈信息直接暴露给业务用户
- **优化方向**：在 `<Outlet>` 外层包路由级 boundary，以 `location.key` 作重置 key；提供「重试 / 返回首页」；对外文案与内部细节分离（细节进 console 或上报）

---

### P2 — 一致性、可访问性与体验

#### P2-9 可点击表格行不支持键盘操作

- **位置**：32 处 `onRow={{ onClick }}`，典型 `OrdersPage.tsx:3214-3227`（仅 `onClick`/`onDoubleClick` + `cursor: pointer`）
- **证据**：`<tr>` 无 `tabIndex`、无 `role`、无 `onKeyDown`；全站 `aria-live` 仅 1 处
- **风险**：键盘用户无法选中/展开行，屏幕阅读器不把行视为可交互元素（WCAG 2.1「键盘」「名称角色值」不达标）；批量操作的异步结果也缺少播报
- **优化方向**：行内主操作改为真实按钮/链接（项目已有 `EntityLink` 可直接复用）；或保留行点击的同时补 `tabIndex={0}`、`onKeyDown`（Enter/Space）、`aria-selected`；`aria-live` 用于批量结果提示

#### P2-10 所有路由共用一个页面标题

- **位置**：`apps/web/index.html:7`（`<title>WCIES</title>`）；全站 `document.title` 赋值 0 次
- **风险**：多标签页无法区分、书签与历史记录同名、读屏切换页面无提示
- **优化方向**：在 `PageHeader` 内统一 `useEffect(() => { document.title = \`\${title} · WCIES\` })`，一处改动覆盖全部页面

#### P2-11 筛选状态没有统一进 URL

- **位置**：`OrdersPage.tsx:824-831` 只从 `useSearchParams` 读 `focus`；keyword / 平台 / 店铺 / 履约方式 / 排序 / 页码全在内存
- **证据**：部分页面（Exceptions/Listings/Notifications 等）已用 `useSearchParams`，订单页未用 → 同一套交互两套行为
- **风险**：刷新、分享链接、从详情页返回都会丢失筛选，排查线上问题时无法复现同一视图
- **优化方向**：随 P1-4 的 `useListQuery` 一并把筛选序列化进 query string，订单页优先

#### P2-12 内联样式 1,030 处，设计令牌被绕过

- **位置**：全站 `style={{}}`；`design-system/tokens.ts:95` 的 `layout.railBreakpointNarrow` 全站仅此一处定义、**无任何引用**，而 `AppLayout.tsx:147` 硬编码 `1400`
- **风险**：令牌名义上是唯一事实源，实际断点/间距散落在字面量里，改视觉规范需全站搜替换；内联对象每次渲染新建，也无法被静态检查
- **优化方向**：高频重复样式（卡片头、工具栏、表格单元）收敛为 design-system 组件或 CSS class；断点统一从 tokens 读取，删除或启用死令牌

#### P2-13 前端测试覆盖极低

- **位置**：仅 `design-system/components/phase3.spec.tsx`、`printing/code128.spec.ts`、`printing/print-browser.spec.ts`（合计 320 行），对比源码 35,084 行
- **风险**：最容易回归的逻辑（分页查询键、跨分页选择、批量按钮互斥禁用）零覆盖 —— 上一轮的 `pageSize` 静默 bug 正属此类，靠人工验收才发现
- **优化方向**：不为页面写渲染测试，而是给**列表壳 hook**（`useListQuery`）与选择态逻辑补纯函数级单测，成本低、覆盖面广

---

## 4. 优化实施计划

### 4.1 阶段总览

| 阶段 | 主题 | 主要改动 | 改动面 | 风险 |
| --- | --- | --- | --- | --- |
| **S0** | 基线固化 | 记录 §2 全部指标；把构建体积打印进 CI 日志 | 1–2 文件（配置/脚本） | 无 |
| **S1** | 解 P0（三项） | 路由分包、大表横滚、搜索防抖 | App.tsx + vite.config + 3 个列表页 + 8 处搜索框 | 中（分包影响全部路由，需全路由冒烟） |
| **S2** | 结构收敛 | `useListQuery`、收口 `ActionIsland`、拆订单页、`DataTable` 接错误态、路由级 boundary | 列表页 ~15 + design-system 3 | 中（触碰所有列表页的查询键） |
| **S3** | 体验与兜底 | 行键盘可达、页面标题、筛选入 URL、令牌收敛、列表壳单测 | 分散、单点小 | 低 |

建议顺序：S0 → S1 → S2 → S3。**S1 与 S2 不要并行**：两者都会改列表页与查询键，并行必然冲突。

### 4.2 S0 — 基线固化（前置，半天量级）

1. 把 §2.1 的四项产物指标（chunk 数、原始体积、gzip 体积、CSS 体积）写进 `apps/web` 的构建脚本，输出到 CI 日志末尾。
2. 定体积预算（建议首屏 gzip ≤ 350 KB、单 chunk ≤ 300 KB），超限仅告警、不阻断，避免初期就卡住交付。
3. 记录 8 个核心路由（`/`、`/orders`、`/skus`、`/listings`、`/inventory`、`/purchase-orders`、`/warehouse-ops`、`/finance`）的首屏 LCP / TTI 基线。

**验收**：`pnpm build` 输出包含上述指标；基线数值写入本报告 §2 或独立记录。

### 4.3 S1 — 解 P0

**S1-1 路由级分包**

1. `App.tsx` 中 40 个页面 import 改为 `lazy(() => import(...))`；因组件是**命名导出**，需 `.then(m => ({ default: m.XxxPage }))`。
2. `AuthGate`、`AppLayout`、`design-system`、`providers` 保持静态（它们是首帧必需的外壳）。
3. 在 `<Routes>` 外层（`AppLayout` 的 `<Outlet>` 之上）+ 每个 `lazy` 组件的 `Suspense` 边界，fallback 用页面骨架（`Skeleton`），不要全屏 `Spin`——否则页面切换会闪白。
4. **vendor 分组要实测**：本机已验证 `manualChunks` 在 Vite 8/rolldown 下不可靠（§2.2 注意项）。正确做法是先用动态 import 拿到天然分块，再视构建报告决定是否需要在 rolldown 的输出选项里做显式分组，**不要直接照搬旧配方**。
5. 保留 `/login`、`/invite`、`/reset-password`、`/change-email/confirm` 为独立入口（未登录即需加载，不适合放在 AuthGate 之下）。

**验收**：构建产物 chunk 数 ≥ 20；首屏 gzip 明显下降（目标 ≤ 350 KB）；直接访问 `/orders` 时 Network 中才出现 `page-orders` 块；8 个核心路由逐一冒烟无白屏、Console 无 error。

**风险与对策**：`Suspense` 边界放置不当会导致整页 spinner 闪烁 → 骨架下沉到内容区；`StrictMode` 下重复挂载属正常，不要误判为 bug。

**S1-2 大表横向滚动**

1. 订单主表加 `scroll={{ x: 1440 }}`，并把 `PlatformTag`/`StatusBadge` 的行内 chip 设为 `nowrap`。
2. 同批复查 `SkusPage`、`StoresPage`、`ListingsPage`、`PurchaseReceiptsPage` 的列宽合计与是否声明 `scroll`。
3. 窄屏策略：优先「表格内部横滚」，不要压缩列宽；确需精简时用列级 `responsive`。

**验收**：在 1600×900（右栏展开）与 1366×768 两种尺寸下，订单号的单元格不折行、行高保持一致；横向滚动条出现在表格内部，页面本身不横滚。

**S1-3 搜索防抖**

1. 8 处 `keyword` 改为「输入态 + 防抖后的查询态」两个值：输入框绑定输入态，查询参数与 queryKey 用防抖值。
2. 保留回车立即搜索：`onSearch` 直接把防抖值刷新为当前输入并 `setPage(1)`。
3. 防抖期间在输入框加 `suffix` 加载指示，避免用户误以为没反应。

**验收**：连续输入 6 个字符，Network 中只出现 1 次列表请求；回车立即生效；清空输入（`allowClear`）立即回到全量。

### 4.4 S2 — 结构收敛

1. **新增 `useListQuery`**（建议落在 `apps/web/src/api/` 或 `design-system/hooks/`）：入参 `path`、`filters`、`defaultPageSize`、`defaultSort`；出参 `query`、`page`、`pageSize`、`setPage`、`setPageSize`、`filters`、`queryKey`。**params 与 queryKey 必须由同一对象派生**，从机制上消灭 `7d86cc6` 那类缺陷。
2. **列表页迁移**：先迁订单页（验证 hook 设计可覆盖排序、阶段 Tab、跨分页选择），再按「改动最小优先」批量迁移其余列表页；每迁一页跑一次真实冒烟。
3. **`ActionIsland` 收口**：`PurchaseOrdersPage.tsx:621-660` 等旧顶部批量条迁到浮岛，删除重复的顶部条。
4. **拆 `OrdersPage.tsx`**：`columns.tsx`（列定义 + 记忆化）、`OrderRail.tsx`（右栏）、`ExpandedOrderItems`、`ViewSettingsModal`。目标：主文件降到 1,200 行以内，列定义不再是渲染函数体内的字面量。
5. **`DataTable` 接错误态**：新增 `error` / `onRetry` prop，失败时渲染 `ErrorState`；列表页把 `query.error` 透传下来。**这一步让「失败 ≠ 空」成为框架保证**。
6. **路由级 ErrorBoundary**：在 `AppLayout` 的 `<Outlet>` 外层包一层，`resetKeys={[location.key]}`；对外文案固定，细节进 console。

**验收**：任选一个列表接口断网 → 表格显示错误态与重试按钮（而非空表）；切换到下一个路由错误页自动消失；跨分页选择、批量互斥禁用、每页条数与视图设置联动全部保持（这三项是本轮已验收行为，改造后必须逐项复测）。

### 4.5 S3 — 体验与兜底

1. 行键盘可达：优先把行内主操作改为真实按钮（复用 `EntityLink`）；保留行点击时补 `tabIndex`/`onKeyDown`/`aria-selected`。
2. `PageHeader` 统一设置 `document.title`。
3. 订单页筛选入 URL（复用 `useListQuery` 的序列化能力）。
4. 令牌收敛：删除 `railBreakpointNarrow` 或让 `AppLayout` 改用它；把「卡片头/工具栏/表格单元」三类重复内联样式收敛为组件。
5. 列表壳单测：`useListQuery` 的 queryKey 构造（含 pageSize 变化）、跨分页选择快照、批量按钮禁用矩阵。

**验收**：Tab 遍历可完成「选行 → 批量生成拣货单 → 取消」全流程；浏览器标签页标题随路由变化；刷新订单页后筛选与页码保持；`useListQuery` 单测覆盖上述三类断言。

### 4.6 明确「不做」

以下项在拿到数据前不引入，避免为假设付代价：

- **虚拟滚动**：订单页单页最多 100 行 × 展开行，先解决 P1-5 的列定义重建，再评估是否仍需虚拟化。
- **全局状态库（Zustand 等）**：当前是「页面本地态 + React Query 服务端态」，没有跨页共享需求；`useListQuery` + URL 序列化已足够。`AGENTS.md` 里「Zustand 按需」的定位应继续保持。
- **微前端 / 模块联邦**：分包后首屏已达标，无拆分必要。
- **重写类库 / 换 UI 框架**：现有 Design System 是资产，不是负担。

---

## 5. 附录

### A. 可复现命令

```bash
# 基线产物指标
cd apps/web && ls -la dist/assets
stat -c%s dist/assets/*.js
gzip -c dist/assets/*.js | wc -c

# 规模
find apps/web/src -name "*.tsx" -o -name "*.ts" | xargs wc -l | sort -rn | head

# 关键计数
grep -rho "React\.lazy\|Suspense" apps/web/src | wc -l          # 0
grep -rho "useApiQuery[<(]" apps/web/src --include=*.tsx | wc -l # 161
grep -rn "<ErrorState" apps/web/src --include=*.tsx | wc -l      # 9（文件数）
grep -rn "onRow={" apps/web/src --include=*.tsx | wc -l          # 32
grep -rho "style={{" apps/web/src --include=*.tsx | wc -l        # 1030
grep -rn "document.title" apps/web/src --include=*.tsx | wc -l   # 0
```

### B. 逐项定位索引

| 编号 | 位置 |
| --- | --- |
| P0-1 | `app/App.tsx:4-43`；`vite.config.ts` |
| P0-2 | `pages/orders/OrdersPage.tsx:2722-2963`、`:3230` |
| P0-3 | `OrdersPage.tsx:3034`；`InventoryPage.tsx:492`；`SkusPage.tsx:922`；`StoresPage.tsx:951`；`ListingsPage.tsx:596`；`PlatformMappingsPage.tsx:238`；`BrandManageModal.tsx:155`；`CategoryManageModal.tsx:374` |
| P1-4 | 27 个页面 `useState(1)`；`ActionIsland` 仅 4 个文件；`PurchaseOrdersPage.tsx:621-660` |
| P1-5 | `OrdersPage.tsx:2722`、`:2965`、`:3148-3227` |
| P1-6 | `design-system/components/RelativeTime.tsx:18-22` |
| P1-7 | 161 处 `useApiQuery` vs 9 个文件 `<ErrorState>` |
| P1-8 | `app/providers.tsx:52`；`components/ErrorBoundary.tsx:10-27` |
| P2-9 | 32 处 `onRow`；典型 `OrdersPage.tsx:3214-3227` |
| P2-10 | `apps/web/index.html:7` |
| P2-11 | `OrdersPage.tsx:824-831` |
| P2-12 | `design-system/tokens.ts:95`；`app/AppLayout.tsx:147` |
| P2-13 | `design-system/components/phase3.spec.tsx`；`printing/*.spec.ts` |

---

## 6. S0 / S1 落地结果（2026-10-17 当日实施）

S0 与 S1 已实施完毕，全部改动经类型检查、lint、格式化、生产构建与真实浏览器验收。

### 6.1 落地内容

| 项 | 改动 |
| --- | --- |
| **S0** | 新增 `apps/web/scripts/bundle-budget.mjs`，接入 `apps/web` 的 `build` 脚本（`tsc → vite build → 体积报告`）。报告**以 index.html 声明的入口 + modulepreload 作为「首屏」口径**——分包之后「全部 chunk 之和」不再是首屏代价。预算：首屏 gzip ≤ 350 kB、单 chunk ≤ 300 kB；只告警不阻断。 |
| **S1-1** | `App.tsx` 39 个页面全部改为路由级懒加载；新增 `app/lazy-page.ts`（类型安全的「动态 import + 取命名导出」包装）与 `app/RouteFallback.tsx`（`PageFallback` 只占内容区、`BootFallback` 全屏）。`AppLayout` 的 `<Outlet />` 外包 `Suspense`，外壳不闪白。`AuthGate`/`AppLayout`/`design-system` 保持静态。 |
| **S1-2** | 订单主表按**当前可见列**宽度动态计算 `scroll.x`（列可在视图设置里增删，故不能用写死的 1380）。 |
| **S1-3** | 6 个页面接入搜索防抖：`OrdersPage`/`InventoryPage`/`SkusPage`/`StoresPage`/`ListingsPage`/`PlatformMappingsPage`——输入态即时回显，查询态 `useDebouncedValue(300)`，并在防抖值变化时回到第 1 页。 |

### 6.2 实测前后对比

| 指标 | 改造前 | 改造后 | 变化 |
| --- | --- | --- | --- |
| JS chunk 数 | 1 | 72（首屏 9 / 按需 63） | — |
| 首屏 JS 原始 | 1,940.8 kB | **1,080.7 kB** | −860.2 kB（**−44.3%**） |
| 首屏 JS gzip | 572.4 kB | **348.2 kB** | −224.2 kB（**−39.2%**） |
| 全站 JS gzip（浏览全部页面） | 572.4 kB | 669.1 kB | +96.7 kB（+16.9%） |
| 订单表内容宽 vs 可视宽 | 1380 : 1044（列被压窄） | 1428 : 1040（表格内横滚） | 列宽不再压缩 |
| 订单页搜索「输入 6 个字符」 | 6 次列表请求 | **1 次**（停在第 1 页时） | −83% |

> **全站 gzip 总量上升属预期**：分块后被压缩的公共字典被切开，压缩局部性变差。用户实际付的是「首屏」那份，其余按需。

### 6.3 验收结果

- **10 个核心路由**（`/`、`/orders`、`/skus`、`/listings`、`/inventory`、`/purchase-orders`、`/purchase-receipts`、`/warehouse-ops`、`/finance`、`/stores`）在 1600×900 与 1366×768 下均正常渲染：**Console 0 error、0 失败请求**。
- **懒加载**：生产构建产出 72 个分块；静态校验 38 个 `page()` 声明的导出名与页面文件一致（`page()` 运行期还有兜底报错）。
- **防抖**：CDP 连续输入 6 个字符 → 列表请求 1 次、输入框回显正确、页码回到 1。
- **横滚**：订单表 `scrollWidth 1428 > clientWidth 1040`，列宽按定义生效；单元格内文字单行（平台单号与内部单号是设计上的两行）。
- `tsc --noEmit` / `eslint` / `prettier --check` 全绿；`pnpm --filter @wcies/web build` 通过且体积在预算内。

### 6.4 与计划的偏差（如实记录）

1. **搜索防抖实际是 6 处，不是 8 处**：`BrandManageModal.tsx` 早已使用 `useDebouncedValue`；`CategoryManageModal.tsx` 是纯前端树过滤（不发请求），无需防抖。§3 P0-3 的清单在此更正。
2. **「行高翻倍」未复现为列压缩所致**：订单页行高 75 px 来自「平台单号 + 内部单号」两行加徽标换行，属既定设计（1366 与 1600 下相同，说明与宽度无关）。P0-2 的真实收益是**列宽不再被压缩**，而不是行高变化。
3. **vendor 分组仍未做**：rolldown 下 `manualChunks` 不可靠（§2.2），本轮只做路由级动态 import；首屏 348.2 kB 已达标，vendor 分组留作后续按实测决定。
4. **`SkusPage` 81 px / `StoresPage` 67 px 行高未动**：没有证据表明是列压缩导致（1366 下反而不再横滚），不在本轮范围。

### 6.5 遗留（对应 S2 / S3）

见 §7：S2/S3 已在同日继续完成，仅 `useListQuery` 与 OrdersPage 的列定义/右栏拆分按下述理由推迟。

---

## 7. S2 / S3 落地结果（2026-10-17 同日续做）

### 7.1 落地内容

| 项 | 改动 | 结果 |
| --- | --- | --- |
| **S2-1** | `DataTable` 新增 `error` / `onRetry` / `retrying`，失败时整块替换为空表之外的 `ErrorState`（含重试按钮）。 | **31 个使用 DataTable 的页面里 30 个已接线**（剩余 1 个是 `ShipmentDetailPage` 的明细表，数据来自已取回的详情对象，改由详情查询的错误态覆盖）。 |
| 补漏 | `ShipmentDetailPage` / `InterceptionDetailPage` 原来只有一个「加载中…」兜底 —— 请求失败会**永远停在加载中**。已补 `isError` 分支。 | 失败不再伪装成加载中。 |
| **S2-2** | `ErrorBoundary` 重写：`resetKeys` 变化即复位、`inset` 模式、对外文案与 `console` 细节分离、新增「重试 / 返回首页」。在 `AppLayout` 的 `<Outlet>` 外层加路由级边界（`resetKeys={[location.key]}`）。 | 单页崩溃只毁内容区，换页自动恢复。 |
| **S2-3** | `PurchaseOrdersPage` 收口到 `ActionIsland`。 | **已由用户并行完成**（提交 `0af02ac`），本轮未重复改动。 |
| **S2-4** | `useListQuery` 收敛查询键。 | **推迟**，理由见 §7.3。 |
| **S3-1** | 新增 `design-system/components/rowInteraction.ts`：给可点击行补 `tabIndex` / `aria-selected` / `aria-label` 与 Enter·空格激活；订单页与采购单页接入。`PageHeader` 统一设置 `document.title`。 | 键盘可选中行；标签页标题随路由变化。 |
| **S3-2** | `AppLayout` 的硬编码 `1400` 改用 `layout.railBreakpointNarrow`（消除死令牌）；新增 `rowInteraction.spec.ts`（5 例），并给 `apps/web` 补上 `test` 脚本 —— 此前 3 个既有 spec（35 例）**从未被 `pnpm test` 跑到**。 | `pnpm --filter @wcies/web test` 35 例全绿。 |
| 结构 | 订单页把视图设置的类型/默认值/本地读写抽出为 `pages/orders/view-settings.ts`。 | `OrdersPage.tsx` 3,958 → **3,859 行**。 |

### 7.2 验收结果（真实浏览器 + 构建）

- **10 个核心路由**：全部渲染，**Console 0 error**；标签页标题随路由变化（`订单管理 · WCIES`、`SKU管理 · WCIES`…），改造前恒为 `WCIES`。
- **行键盘**：订单表 20 行全部 `tabIndex=0`、`aria-selected` 正常、`aria-label="订单 55934906-0485-1"`。
- **错误态**：用 CDP 屏蔽 `/api/v1/orders` 后，页面显示「无法加载数据」+「重新加载」，且**不再出现「暂无订单」**（失败与空态分清）；解除屏蔽后点「重新加载」→ 恢复 20 行、错误态消失。
- `tsc` / `eslint` / `prettier` / `check:arch` 全绿；`pnpm --filter @wcies/web test` 35 例通过。
- 生产构建：首屏 gzip **348.6 kB**（预算 350），73 个 chunk（首屏 9 / 按需 64），全站 670.5 kB。

### 7.3 为什么推迟 S2-4（`useListQuery`）

试做时发现一个隐性耦合：现有 queryKey 的形状是 **`['listings', page, …]`**（以实体名开头），而全站多处用 `invalidateQueries({ queryKey: ['listings'] })` 做**前缀失效**。若把键改成由统一构造器生成（很自然会用 path 作首元素 `['/api/v1/listings', …]`），这些跨页失效会**静默失效**——又是一次「不报错但数据不刷新」。

因此这项不是「机械替换」，必须先定好键前缀契约并逐页核对失效链路。在用户正并行提交的条件下，本轮不做半成品迁移；建议单独开一轮：先写死「键前缀 = 实体名」的约定与测试，再逐页迁移，每页跑一次真实冒烟。

### 7.4 仍未做（下一轮）

- **OrdersPage 的列定义与右栏拆分**（`columns.tsx` / `OrderRail.tsx`）：3,859 行里 `mainColumnDefs`（约 240 行）与右栏内容仍内联在组件体内。抽出需要给每列传回调与依赖，属单独一轮的工作量。
- **筛选入 URL**（P2-11）：随 `useListQuery` 一起做更划算。
- **`useMemo` 列定义 / `rowSelection` / `expandable` 记忆化**（P1-5 的渲染部分）：与上面的拆分同批做。
- **`RelativeTime` 去掉逐单元格 Tooltip**（P1-6）：改动小但影响 50 处，建议与视觉走查一起。
- 8 个已自带错误态的页面里，`DataTable` 的 `error` 属性目前是冗余的（这些页面用 `isError ? … : …` 守卫，表格只在无错时渲染）；等下一轮把它们改成直接用 `error` 属性即可自然消除。
