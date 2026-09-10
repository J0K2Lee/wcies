# WCIES UI Redesign — Phase 1 最终报告

> 精致中性商务 · 自适应三栏运营工作台
> 完成日期：2026-09-10 · 基线提交：`6abbd06`（重构前）→ `HEAD`

---

## 1. Design Direction

唯一批准方向「方案 D · 精致中性商务 + 自适应三栏运营工作台」通过三层落地：

1. **Token 层**（`apps/web/src/design-system/tokens.ts`）：#F6F7F9 画布 / #FFFFFF 容器 / #172033-#98A2B3 三级文字 / #E7E9EE 边框 / 低饱和蓝灰主色 **#496F96**（不用 AntD 默认亮蓝）。语义色全部为「浅背景 + 深色文字 + 6px 圆点」的克制形态。
2. **组件层**：PageHeader / FilterBar / DataTable / StatusBadge / MetricCard / ContextRail 等 14 个统一组件，页面不再自行发明视觉。
3. **壳层**（AppLayout）：左侧 208px 白底导航 + 中央主工作区（max-width 1680，超宽屏不无限拉伸）+ 300px 可折叠 Context Rail。

高级感来自比例、排版、留白与信息层级，而非装饰：无 Banner、无渐变、无玻璃拟态、无 Emoji 图标、无 Rainbow Tag。

## 2. Design Tokens

`tokens.ts` 单一事实源：`colors`（基础 + 6 组语义色对）、`spacing`（4/8/12/16/20/24/32）、`radius`（Card 12 / Button·Input 8 / Tag 6）、`typography`（PageTitle 28/650、KPI 30/680、Body 14，PingFang SC → Microsoft YaHei → system-ui）、`shadows`（1px 边框 + 极轻投影）、`layout`（Sider 208 / Topbar 56 / Rail 300 / 断点 1600·1366）。全站数字 `font-variant-numeric: tabular-nums` 稳定对齐。

## 3. AntD Theme

`theme.ts` 导出唯一的 `wciesTheme`，在 `providers.tsx` 的单个 ConfigProvider 挂载（任务 §11：禁止页面级主题）。覆盖 colorPrimary/colorBgLayout/colorText/colorBorder、borderRadius 8、controlHeight 32、fontSize 14，以及 Menu（38px 项高、8px 圆角选中底 #ECF1F6）、Table（浅灰表头 #F8F9FB、透明分隔、44-48px 行）、Button/Input/Select（8px）、Tag（6px）、Tabs、Drawer、Modal、Card、Progress。顺手的 deprecated API 更新：Drawer `width`→`size`、Timeline `items.children`→`items.content`。

## 4. Adaptive AppShell

| 宽度 | 左导航 | 主工作区 | Context Rail |
|---|---|---|---|
| ≥1600 | 208px | max 1680 居中，padding 24 | 内联展开（默认） |
| 1400–1599 | 208px | 同上 | 内联可折叠：Dashboard 默认展开；表格页（SKU/Inventory/Orders）默认折叠，用户展开后 localStorage 持久化 |
| ≤1366 | 208px | 表格完整宽度（scroll x 兜底） | 不挤压主区，Topbar 按钮以 Overlay Drawer 打开（378px） |

`/picking/:id` 进入仓库专注模式：导航收窄为 60px 图标列，全局 Rail 关闭，作业区占据视口。断点由 `useViewportTier`（resize 监听）驱动，用户偏好 `wcies.rail-expanded` 持久化。

## 5. Context Rail

统一注册机制：页面调用 `useContextRail(content)` 将 `{header?, sections, defaultCollapsed?}` 注册进壳，AppLayout 渲染唯一的 Rail 帧——不为每页重写右栏（§57）。三级交互（§19）：行点击 → Rail 快速预览 → 「查看完整详情」→ Drawer。

- **Dashboard**：店铺状态（平台徽标 + 最近同步结果与相对时间）、同步异常（FAILED/PARTIAL）、今日风险（OPEN 异常按严重度着色）。
- **SKU**：未选中=页面概览；选中=SKU Quick View（图、编码、状态、On Hand/可售（一条 detail 请求）、映射数、主条码、成本）。
- **Inventory**：默认=库存风险（缺货/有可售/异常计数 + 缺货 TOP6）；选中=SKU 库存摘要（与 Drawer 共享同一 query 缓存）。
- **Orders**：选中订单风险优先——MAPPING_FAILED 红色块 / BACKORDERED 橙色块 + 行级「重新尝试分配」按钮（§42），下方订单概况与最近状态时间线。

右栏不承担 CRUD：核心操作仍在主区/Drawer（§18）。

## 6. Dashboard

- 顶部问候（按时段）+ 日期 + 待处理事项数（NEW 订单 + OPEN 异常，真实 API）；右侧平台筛选按钮组（全部/OZON/WB/Yandex，计数来自 stores）。
- KPI 四卡（§22）：待处理订单（orders?erpStatus=NEW meta.total）、缺货预警（inventory OUT_OF_STOCK total）、Mapping 覆盖率（skus total 与 hasListing=false total 推导）、店铺在线（ACTIVE/总数）。单色克制、无彩色大卡。
- 中央：订单趋势 = 纯 SVG 折线图（零依赖，细线/淡格/白色 Tooltip），基于最近 100 单按日聚合（已标注）；下方最近订单 Tabs（全部/待处理/处理中/已发货/异常，本地过滤零请求）+ 高密度表。

## 7. SKU

PageHeader（新增SKU primary）→ FilterBar（搜索/品牌/类目/状态/平台映射 + 清除筛选，全部服务端过滤）→ DataTable（商品组合列 [44px 图 + 名称 + 编码·品牌]、型号/规格、条码、成本、平台映射、状态、更新时间、查看+⋯）。行点击 → Rail Quick View；Drawer 800px：Detail Header（编码+状态+启停）+ Tabs（概览 InfoGrid / 条码 / 图片 / 平台映射），条码增删、主条码切换、内部条码生成、图片上传、主图切换等 Sprint 1/5 业务原样保留。

## 8. Inventory

KPI 四卡（库存记录/有可售/缺货记录/库存异常，全部 meta.total 真实值）→ FilterBar（搜索/仓库服务端搜索/可售状态）→ DataTable（数字右对齐、Available 加粗强调、状态徽标、⋯ 菜单）。风险右栏（缺货 TOP 来自真实查询）。Drawer 860px：InfoGrid 汇总 + Tabs（仓库明细 / Reservation / 库存流水）。库存初始化/调整/移位/安全库存四个 Modal 业务（幂等键、二次确认）逐行保留。

## 9. Orders

状态 Tabs（全部/待处理/拣货中/待发货/已发货/异常；全部·待处理·异常带计数轻查询）→ FilterBar（搜索/店铺/平台联动）→ DataTable（订单号、PlatformTag+店铺、商品行+风险徽标、ERP 状态徽标+异常计数、下单时间、查看+⋯取消）。Rail 风险优先 + retry。Drawer 880px：状态徽标 + InfoGrid + 创建拣货任务 + Tabs（商品/履约/异常/状态历史/Raw Data）。摄入测试订单（Case A–D fixtures）保留。

## 10. Picking

- `/picking` 列表留在 AppShell：进度条 + 状态徽标 + 进入作业。
- `/picking/:id` 专注模式：顶部条（单号大字、仓库、大进度条、开始/完成按钮）；「下一库位」焦点卡（40px 库位大字 + SKU + 需要/已拣）；扫码输入（label 显式、autoFocus、Enter 提交、结果后自动清空重聚焦，业务接口不变）；ScanFeedback 大面积浅绿 ✓ / 浅红 ✕ 反馈（非仅 Toast，§50-51）；待拣行列表（当前行高亮、bin 行徽标）；右侧 280px 任务信息栏（任务概要/当前进度/剩余库位/异常）。SN 双扫流程保留。

## 11. Shared Design Components

`design-system/`：tokens、theme、PageHeader、FilterBar、MetricCard、StatusBadge（6 tone + 6 张域状态映射表：ERP/履约/拣货/库存/SKU/同步）、DataTable（统一空态）、SectionCard、InfoGrid、EntitySummary、ActionMenu（查看+⋯）、EmptyState、ScanFeedback、PlatformTag（OZON/WB/Yandex 统一 22px 徽标）、ContextRail（Section/Metric/Action + AppRailSetterProvider/useContextRail）、TrendChart（纯 SVG）。

## 12. Before / After

| 维度 | Before | After |
|---|---|---|
| 壳 | 深色 Sider + 白 Header + 16px margin Content | 白色 208px 导航 + 56px Topbar（全局搜索 Ctrl K/右栏开关/帮助/通知/用户）+ 24px 主区 + 自适应 Rail |
| 主题 | AntD 默认亮蓝、各页自带 Tag 颜色 | #496F96 单一主题、6 tone StatusBadge |
| 表格 | 列多而散（图片/名称/SKU 拆列）、行内 3-5 按钮 | 组合商品列、右对齐数字、查看+⋯ |
| 详情 | 点击行直接开 Drawer | 行→Rail 预览→Drawer 三级 |
| Picking | AntD Card 堆叠 | 专注模式 + 下一库位焦点 + 大反馈 |
| 空态/加载 | AntD 默认 Empty | 统一 EmptyState（标题+描述）/ Skeleton |

## 13. GUI Acceptance

17 张截图位于 `gui-redesign-screenshots/`（1440×900 为主，Dashboard 另有 1920/1366）：
`01-dashboard-1440/02-dashboard-1920/03-dashboard-1366`、`02-sku-list`、`03-sku-context`、`04-sku-detail`、`05-inventory`、`06-inventory-risk`、`06-inventory-sku`、`07-inventory-detail`、`08-orders`、`09-order-context`、`10-order-detail`、`11-picking-list`、`12-picking-workbench`、`13-picking-success`、`14-picking-error`。

## 14. Functional Regression

GUI 实测通过：Dashboard 导航/KPI/店铺状态/最近订单；SKU 搜索（VK87→4 条）、筛选、行选中、Rail、Drawer、Tabs、映射（4 Listing）；Inventory 筛选、Rail（风险⇄SKU 摘要）、Drawer、四个操作入口；Orders Tabs（异常 6 单）、平台/店铺筛选、Rail 风险（MAPPING_FAILED 红块）、Drawer、从订单创建拣货任务；Picking Start→错误扫码（WRONG 条码→浅红反馈+refocus）→正确扫码 ×2（浅绿反馈 1/2→2/2）→自动完成。Retry Allocation 按钮仅对 MAPPED+BACKORDERED 行渲染（本例为 MAPPING_FAILED 不显示，符合业务）；行级 retry 业务已在历史 Sprint 集成测试覆盖。

## 15. Accessibility

全局 :focus-visible 双焦点环；输入均有 aria-label 或显式 label（扫码框 `label[for]`）；StatusBadge 文字+圆点双通道（不依赖颜色，§67）；Rail 指标/卡片支持键盘 Enter/Space；Picking 全键盘可作业（扫码 Enter 提交、错误后自动 refocus）。

## 16. Performance

零新增网络请求模式：列表数据单次查询 + meta.total；KPI 用 `pageSize=1` 轻查询（TanStack 缓存 30s）；Rail 选中态仅按需请求一条 detail（SKU 库存 / Order detail / Inventory detail），且 Rail 与 Drawer **共享同一 query key**（如 `['order-detail', id]`、`['inventory-detail', skuId]`）；最近订单 Tabs 本地过滤零请求；Rail 内容 useMemo 稳定注册。无 Context Rail 连带全列表重拉。

## 17. Tests

| 命令 | 结果 |
|---|---|
| pnpm lint | ✅ |
| pnpm typecheck | ✅（shared/platform-contracts/api-client/api/web 全过） |
| pnpm check:arch | ✅ 5 rules |
| pnpm test | ✅ 15 files / 104 tests |
| pnpm test:integration | ✅ 16 files / 134 tests（单 worker；默认并行在本机因内存不足 OOM，与环境相关，非代码回归） |
| pnpm build | ✅（web 1464KB 单 chunk 为 AntD 既有量级，非本次引入） |

## 18. 未完成项 / 偏离说明

- **Orders「金额」「Date 筛选」「Exception 筛选」列/筛选未做**：list API 无金额字段、无日期/异常 query 参数（§21 禁止伪造），留待 Phase 2 若后端补契约。
- **Inventory KPI 命名偏离 §33**：无 On Hand/Reserved 全库聚合 API，改用「库存记录/有可售/缺货记录/库存异常」四个真实 meta.total。
- **SKU Table 无「库存」列**：skus list 无库存字段；库存经 Rail Quick View 的单条 detail 呈现（§68 允许）。
- Topbar 店铺上下文为占位展示（全局店铺切换是跨页数据语义，Phase 2）；全局搜索回车跳转订单搜索（完整 Command Palette 按任务书不要求）。
- Picking 拣满后由后端自动 COMPLETED（既有行为），「完成任务」按钮用于提前完成场景。

## 19. 风险

- 1440–1599 表格页 Rail 默认折叠（§17 允许），用户需一次点击展开（偏好持久化）——若运营反馈强烈可改为默认展开。
- 单 chunk 体积：Phase 2 迁移更多页面后建议做路由级 code-split（rolldown codeSplitting）。
- Context Rail 注册依赖页面 useMemo 纪律；已在全部 5 页示范正确用法，Phase 2 页面迁移需沿用。
- 集成测试在低内存机器需 `--maxWorkers=1`。

## 20. Git Commits

```
6abbd06 feat(product,ozon): sku units/purchase-url fields + ...; add Phase 1 UI redesign task spec（重构前基线）
6a3bec0 feat(web-design): establish WCIES neutral business design system + adaptive three-column shell
2367b46 feat(web-dashboard): redesign dashboard as full three-column workbench
869461f feat(web-sku,web-inventory,web-orders,web-picking): redesign four core workbench pages with context rail
63cc40b docs(web-redesign): add Phase 1 GUI acceptance screenshots
```

依赖变化：`@ant-design/icons@6.3.4` 显式加入 apps/web（原为 antd 传递依赖，lockfile 无新包、零 bundle 增量）。

## 21. Phase 2 建议

1. 按同一 Design System 迁移 Product/Listing/Warehouse/Store/Shipment/Package/Interception/Sync Center/Exception/Notification/Import/Finance（复用 PageHeader/FilterBar/DataTable/StatusBadge/ContextRail，预计每页 1-2 小时）。
2. 新增 /exceptions 异常中心页面（API 已存在），左导航「异常」目前并入系统组。
3. 路由级 code-splitting + AntD 按需优化。
4. 若后端补充订单金额/日期筛选契约，回补 Orders 对应列与筛选。
5. 全局 Command Palette（Ctrl K）与全局店铺上下文切换。
