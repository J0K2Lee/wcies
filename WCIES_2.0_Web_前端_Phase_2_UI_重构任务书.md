# WCIES 2.0 Web Frontend Redesign — Phase 2 任务书

## 1. 任务名称

WCIES 2.0 Web 前端 Phase 2 UI 重构

本阶段基于 Phase 1 已完成版本继续开发，不重新推翻现有 Design System，不重做已经完成的 Dashboard / SKU / Inventory / Orders / Picking 页面。

Phase 1 当前基线包括：

- Design System
- 三栏 AppShell
- Dashboard
- SKU
- Inventory
- Orders
- Picking
- Context Rail
- Drawer 三级交互体系
- 响应式布局
- Ant Design 统一 Theme
- 基础 GUI 回归

Phase 2 的核心目标是：

> 将 WCIES 从“核心业务页面已重构”推进到“完整 ERP 工作台可持续使用”的状态。

---

# 2. Phase 2 总目标

本阶段主要完成以下 6 个方向：

1. 重构「同步与店铺」模块
2. 建立统一「异常中心」
3. 重构「系统管理」模块
4. 完善全局搜索与 Command Palette
5. 完善通知、任务状态、错误反馈体系
6. 对 Phase 1 页面进行第二轮一致性与可用性收敛

本阶段仍然属于：

**Web Frontend UI / UX 重构**

除非实现当前前端所需数据确实缺少 API，否则原则上：

**禁止修改核心业务逻辑。**

如果发现后端缺少接口，可以记录 API Gap，但不得为了做 UI 而伪造业务数据。

---

# 3. 当前开发基线

开始 Phase 2 前：

1. 检查 Git 工作区
2. 确认当前分支
3. 确认 Phase 1 最终提交存在
4. 确认无未提交文件
5. 运行：

```bash
pnpm lint
pnpm typecheck
pnpm check:arch
pnpm test
pnpm build
```

若当前版本全部通过，则建立 Phase 2 起始 checkpoint。

提交建议：

```text
chore(web): checkpoint before phase 2 redesign
```

不得覆盖或 squash Phase 1 已有提交。

---

# 4. Phase 2 页面范围

本阶段主要处理以下页面。

## P1 — Stores / 店铺管理

建议路由：

```text
/stores
/stores/:id
```

如果当前项目已有对应路由，则沿用，不重新创造重复路由。

---

## P2 — Sync Center / 同步中心

建议路由：

```text
/sync
/sync/jobs
/sync/jobs/:id
```

---

## P3 — Exception Center / 异常中心

建议路由：

```text
/exceptions
```

如果当前不存在页面，可以增加前端页面。

但异常数据必须来自现有 API。

---

## P4 — System / 系统管理

包括但不限于：

```text
/settings
/users
/warehouses
/platform-mappings
```

实际以当前已有路由、权限模型和 API 为准。

禁止创造不存在的业务实体。

---

## P5 — Global Search

完善当前 AppShell Topbar 的搜索框。

目标不是单纯输入框，而是升级成 ERP 全局检索入口。

---

## P6 — Notification / Activity

完善系统通知、同步状态、异常状态与任务反馈。

---

# 5. 设计原则

Phase 2 必须继续遵守 Phase 1 的视觉方向：

**精致、中性、商务、信息密度高但不拥挤。**

视觉关键词：

- 白色主背景
- Neutral Gray
- Low Saturation Blue Gray
- 极少使用纯黑
- 极少使用高饱和颜色
- 红色仅表示 Error / Critical
- 橙色表示 Warning
- 绿色表示 Success
- 蓝色表示 Active / Info / Primary Action

禁止：

- 渐变大背景
- 彩虹色 Dashboard
- 大面积高饱和品牌色
- 巨型圆角
- 大量玻璃拟态
- 大面积阴影
- 装饰性图标堆砌
- Card 套 Card 套 Card

---

# 6. Design System 原则

Phase 2 不新建第二套组件系统。

必须优先复用 Phase 1：

```text
PageHeader
FilterBar
DataTable
StatusBadge
PlatformTag
MetricCard
SectionCard
InfoGrid
ContextRail
EntitySummary
ScanFeedback
TrendChart
ActionMenu
```

如果需要新增共享组件，必须满足：

> 至少两个页面可以复用，或者属于全局 AppShell 能力。

允许新增的典型组件：

```text
EmptyState
ErrorState
SyncStatusBadge
TimelineList
ActivityFeed
CommandPalette
QuickAction
EntityLink
RiskIndicator
ProgressStatus
StatGroup
KeyValueList
```

禁止为了单个页面视觉效果创建大量一次性组件。

---

# 7. Stores 页面重构

## 7.1 页面目标

店铺页面必须让运营人员快速回答：

1. 哪些店铺正常？
2. 哪些店铺授权异常？
3. 哪些店铺最近同步失败？
4. 哪个平台存在风险？
5. 店铺最后同步时间是什么？
6. 店铺对应的平台和主体是什么？

---

# 8. Stores 列表结构

PageHeader：

```text
店铺管理
管理所有销售平台店铺、连接状态与同步状态
```

Header Actions：

```text
刷新
添加店铺
```

如果系统当前不支持前端添加店铺：

不得显示假按钮。

---

## 8.1 店铺 KPI

建议：

```text
全部店铺
正常
需要关注
同步异常
```

必须使用真实 API 数据。

如果后端只能返回部分状态：

宁可减少 KPI，也不得前端臆造。

---

## 8.2 Store Card / Store Table

根据当前店铺数量决定。

店铺数量：

```text
<= 12
```

可以使用 Store Cards。

数量更多：

使用 DataTable。

建议字段：

```text
店铺名称
平台
国家 / 市场
状态
授权状态
商品同步
订单同步
库存同步
最后同步时间
最近异常
```

---

# 9. 店铺状态

统一使用：

```text
正常
警告
异常
停用
未连接
```

不得直接把后端 enum 裸露给用户。

例如：

```text
ACTIVE
TOKEN_EXPIRED
AUTH_FAILED
DISABLED
```

前端统一映射为人类可理解的状态。

同时保留 Tooltip 显示原始代码。

---

# 10. Store Context Rail

点击店铺行后：

右栏显示 Entity Summary。

内容包括：

```text
店铺名称
平台
连接状态
最近同步
最近订单
SKU 数量
异常数量
```

快捷操作：

```text
查看详情
立即同步
查看异常
```

实际 API 不支持的操作不得显示。

---

# 11. Store Detail Drawer / 页面

一级点击：

Table Row

二级：

Context Rail

三级：

Drawer / Detail Page

详情内容建议：

## 基础信息

```text
店铺名称
平台
国家
Store ID
状态
创建时间
```

## Connection

```text
授权状态
Token 状态
最后验证时间
```

禁止显示：

```text
Access Token
Refresh Token
API Secret
Password
```

---

## Sync 状态

```text
商品
库存
订单
物流
```

分别显示：

```text
最后成功
最近失败
同步状态
```

---

# 12. Sync Center

这是 Phase 2 最重要页面之一。

页面目标：

> 让用户看懂“系统正在同步什么、哪些失败、为什么失败”。

---

# 13. Sync 页面 Header

```text
同步中心

监控平台商品、库存、订单等同步任务
```

Header Actions：

```text
刷新
```

如果存在手动触发同步接口：

```text
立即同步
```

如果没有：

不得创建假按钮。

---

# 14. Sync KPI

建议：

```text
运行中
今日成功
今日失败
等待处理
```

必须完全基于后端现有 job 数据计算。

---

# 15. Sync Job Table

字段建议：

```text
任务
平台
店铺
类型
状态
进度
开始时间
耗时
成功
失败
```

Task 类型映射：

```text
PRODUCT
INVENTORY
ORDER
SHIPMENT
MAPPING
```

前端展示：

```text
商品
库存
订单
物流
映射
```

---

# 16. Sync Status

统一视觉语义：

```text
Queued
Running
Success
Partial
Failed
Cancelled
```

其中：

Running：

蓝色

Success：

绿色

Partial：

橙色

Failed：

红色

Cancelled：

灰色

---

# 17. Sync Progress

Running Job 应显示：

```text
62%
```

或：

```text
620 / 1000
```

如果后端没有 total：

只能显示 spinner / Running。

禁止制造百分比。

---

# 18. Sync Job Context Rail

点击 Job：

右栏显示：

```text
Job ID
任务类型
平台
店铺
开始时间
耗时
当前状态
处理数量
成功
失败
```

Error Preview：

```text
最近 3 条错误
```

Action：

```text
查看完整日志
重新执行
```

仅后端支持时显示。

---

# 19. Sync Job Detail Drawer

Drawer 顶部：

```text
同步任务详情
```

内容：

## Summary

```text
状态
平台
店铺
任务类型
开始
结束
耗时
```

## Statistics

```text
Total
Success
Failed
Skipped
```

## Errors

DataTable：

```text
时间
对象
错误代码
错误说明
```

---

# 20. Exception Center

建立统一异常工作台。

目标：

> 用户不需要分别进入订单、SKU、库存、同步页面寻找异常。

---

# 21. Exception 分类

如果后端当前支持，统一分类：

```text
订单异常
SKU 映射异常
库存异常
同步异常
店铺连接异常
拣货异常
```

必须来源真实 API。

---

# 22. Exception KPI

```text
待处理
高风险
今日新增
已解决
```

没有数据则删掉对应 KPI。

---

# 23. Exception Table

建议字段：

```text
异常
类型
关联对象
平台
店铺
风险
发生时间
状态
```

Risk：

```text
Critical
High
Medium
Low
```

仅当后端真的存在 risk 或可从明确状态映射。

不能凭 UI 随机判断。

---

# 24. Exception Row Interaction

Row Click：

打开 Context Rail。

右栏：

```text
异常名称
风险
关联对象
发生时间
错误说明
```

Quick Actions：

```text
查看对象
重新执行
重试分配
查看同步任务
```

根据异常类型动态显示。

---

# 25. 异常视觉规范

不能整张 Table 使用红色。

正确方式：

Critical：

```text
Status Badge
左侧 2px 风险指示
文字局部红
```

禁止：

```text
红色 Card
红色 Table Row 大背景
大面积红色区域
```

Warning 同理。

---

# 26. System 页面

System 不再做传统“设置菜单列表”。

使用清晰的 Settings Information Architecture。

建议：

```text
系统
├─ 仓库
├─ 用户与权限
├─ SKU 映射
├─ 平台配置
└─ 系统信息
```

以当前实际已有功能为准。

---

# 27. Warehouse Settings

如果当前存在 Warehouse API：

列表：

```text
仓库
代码
状态
SKU 数量
库存记录
```

Context Rail：

```text
仓库基本信息
库存摘要
异常数量
```

---

# 28. 用户与权限

如当前后端支持：

字段：

```text
用户
角色
状态
最近登录
```

禁止 UI 自创权限。

禁止为了 UI 添加虚假的：

```text
Admin
Manager
Operator
Viewer
```

除非后端真实存在。

---

# 29. Platform Mapping

对 SKU / Brand / Category / Platform Mapping 建立统一设置页。

不要重复 SKU Detail 页面。

Settings 页面负责：

```text
总体状态
未映射数量
异常数量
批量入口
```

SKU 页面负责：

```text
单 SKU Mapping
```

两者职责必须分开。

---

# 30. Global Search

Phase 1 已存在 Topbar Search。

Phase 2 将其升级为：

**Command Palette + Global Entity Search**

快捷键：

```text
Ctrl + K
```

Mac：

```text
Cmd + K
```

---

# 31. Search UI

打开后使用居中 Modal / Palette。

结构：

```text
Search...

最近访问

快速操作

搜索结果
```

---

# 32. Search Entity 类型

优先支持：

```text
订单
SKU
店铺
拣货任务
```

如果 API 无统一搜索：

允许分别调用现有接口。

但要求：

输入 debounce：

```text
250–400ms
```

避免每次按键请求。

---

# 33. Search Results

每条结果：

```text
Entity Icon
Primary Text
Secondary Text
Type
Status
```

例如：

```text
ORD-24092833
OZON · Store RU 01
订单
Processing
```

点击：

直接进入 Entity Detail。

---

# 34. Command Palette Quick Actions

允许加入：

```text
查看异常
打开同步中心
进入拣货
创建 SKU
```

只能显示当前系统真实存在的页面 / Action。

---

# 35. Notification Center

Topbar Notification 图标升级。

点击：

Popover / Drawer。

内容按时间倒序：

```text
同步失败
订单异常
库存风险
店铺连接异常
```

---

# 36. Notification Item

格式：

```text
Title
Description
Time
```

示例：

```text
OZON 库存同步失败

Store RU 01 · 32 个 SKU 同步失败

3 分钟前
```

---

# 37. Notification 与 Exception 区别

必须明确：

Notification：

```text
事件流
```

Exception：

```text
需要处理的问题
```

不要将两者设计成完全相同的页面。

---

# 38. Activity Feedback

所有后台 Action 都必须明确反馈。

例如：

```text
重新同步
重新分配
创建 Picking
保存 Mapping
```

状态：

```text
Submitting
Success
Failed
```

不能出现：

点击后按钮没有反馈。

---

# 39. Empty State

建立统一 EmptyState。

例如：

```text
暂无异常

当前没有需要处理的异常
```

Button：

只有存在有效下一步时才显示。

---

# 40. Error State

API 请求失败：

不能仅在 Console 报错。

页面应显示：

```text
无法加载数据
```

并提供：

```text
重新加载
```

---

# 41. Loading State

Table：

优先 Skeleton / loading。

Drawer：

Skeleton。

Context Rail：

Skeleton。

避免：

页面整体闪白。

---

# 42. Context Rail 第二轮统一

Phase 2 对所有页面 Context Rail 做统一。

规则：

顶部：

```text
Entity Type
Entity Name
Status
```

中部：

```text
Summary
```

下部：

```text
Context Actions
```

最下：

```text
Related
```

避免每个页面自行设计完全不同结构。

---

# 43. Drawer 统一

所有业务详情 Drawer：

Desktop：

```text
520–640px
```

复杂订单：

允许：

```text
720px
```

不得使用超过：

```text
80vw
```

Drawer Header：

```text
Entity Name
Status
Secondary Metadata
```

---

# 44. Table 统一

所有 DataTable 默认：

```text
Row Height: 44–48
```

主字段：

深色

次字段：

灰色

Status：

Badge

金额：

Tabular Numbers

时间：

统一格式

---

# 45. 时间格式

统一：

最近时间：

```text
5 分钟前
```

Tooltip：

```text
2026-09-10 16:30:22
```

历史时间：

```text
2026-09-08 14:20
```

不要同一页面混用多个格式。

---

# 46. 数字格式

订单：

```text
1,234
```

金额：

```text
₽ 12,450
```

百分比：

```text
98.4%
```

库存：

```text
12,450
```

避免：

```text
12450.000000
```

---

# 47. Icon 规则

使用：

```text
@ant-design/icons
```

禁止：

Emoji

例如禁止：

```text
⚠️
✅
📦
```

作为 ERP 主 UI 图标。

---

# 48. Platform 统一

继续使用 PlatformTag：

```text
OZON
WB
Yandex
```

平台色必须低饱和。

禁止使用原品牌 Logo 大面积着色。

---

# 49. AppShell 改进

Phase 2 可以完善：

## Navigation

支持：

```text
展开
折叠
当前路由高亮
```

---

## Breadcrumb

复杂页面增加：

```text
Orders / ORD-12345
```

简单列表页无需 Breadcrumb。

---

# 50. Responsive

继续执行 Phase 1 规则。

## ≥1600

三栏完整：

```text
Sidebar
Main
Context Rail
```

---

## 1400–1599

业务表格页：

Context Rail 默认折叠。

---

## ≤1366

Context Rail：

Overlay Drawer。

---

## ≤1024

允许：

Sidebar Collapse。

---

# 51. 禁止 Mobile 优先重构

WCIES 是桌面 ERP。

Phase 2 优先：

```text
1920
1440
1366
```

手机端只需保证：

不完全崩溃。

本阶段不要求专门设计移动端 ERP。

---

# 52. Accessibility

最低要求：

按钮：

aria-label

Icon-only Button：

必须 Tooltip。

键盘：

Tab 可达。

Drawer：

Esc 关闭。

Command Palette：

```text
↑
↓
Enter
Esc
```

---

# 53. Keyboard Shortcuts

Global：

```text
Ctrl/Cmd + K
```

Search

Picking：

保留现有扫码输入自动聚焦。

禁止增加大量快捷键造成学习成本。

---

# 54. Phase 1 回归检查

必须重新检查：

```text
Dashboard
SKU
Inventory
Orders
Picking
```

确保 Phase 2 修改 AppShell 后：

不破坏 Phase 1。

---

# 55. Dashboard 第二轮优化

只允许轻量改进。

可以调整：

```text
Loading
Error
Tooltip
数字格式
时间格式
Context Rail
```

禁止大改 Layout。

---

# 56. SKU 第二轮优化

检查：

```text
Search
Filters
Selected Row
Context Rail
Drawer
Platform Mapping
```

---

# 57. Inventory 第二轮优化

检查：

```text
风险显示
库存详情
仓库信息
SKU 信息
Context Rail
```

---

# 58. Orders 第二轮优化

检查：

```text
状态 Tabs
Exception
Context Rail
Drawer
Picking Creation
```

---

# 59. Picking 第二轮优化

重点检查：

```text
扫码成功
扫码错误
任务完成
输入自动 focus
Location 提示
SN
```

Picking 页不得因为 AppShell 改动失去专注模式。

---

# 60. API 原则

严禁：

```text
Math.random()
Fake KPI
Hardcoded order count
Hardcoded revenue
Fake trend
Fake errors
Fake stores
```

所有业务数据显示：

来自真实 API。

---

# 61. API Gap 处理

发现 API 缺失时：

在最终报告增加：

```text
API Gap
```

格式：

```text
页面
需要的数据
当前 API
缺失内容
建议接口
是否阻塞 UI
```

不要偷偷改后端。

---

# 62. TypeScript

要求：

```text
禁止 any
```

特殊第三方类型确实无法避免时：

必须局部使用并说明。

---

# 63. React 规则

避免：

```text
巨大 Page Component
```

超过约：

```text
400–500 行
```

应拆分。

拆分原则：

按业务模块，而不是按视觉碎片。

---

# 64. API Hooks

沿用当前 API Client 与 hooks。

不得：

在页面直接散落 fetch。

统一：

```text
api client
query hooks
mutation hooks
```

如果当前已有模式，则必须遵守。

---

# 65. Error Handling

Mutation 失败：

```text
message.error
```

但不能只 toast。

如果业务状态受影响：

页面必须保留失败状态。

---

# 66. Optimistic UI

本阶段默认：

**不做复杂 optimistic update。**

除非已有代码已稳定支持。

ERP 一致性优先于动画速度。

---

# 67. 浏览器 GUI 验收

Phase 2 完成后必须使用真实浏览器。

分辨率：

```text
1920 × 1080
1440 × 900
1366 × 768
```

---

# 68. 必须截图页面

至少：

```text
01-stores-1440
02-store-detail
03-sync-center
04-sync-job-detail
05-exceptions
06-exception-context
07-system
08-global-search
09-notification-center
10-dashboard-regression
11-sku-regression
12-inventory-regression
13-orders-regression
14-picking-regression
```

至少 14 张。

---

# 69. Screenshot 检查内容

逐张检查：

```text
溢出
错位
重叠
空白
Column 宽度
Tooltip
Drawer
Context Rail
Status
Padding
```

禁止仅截图、不实际检查。

---

# 70. GUI 功能回归

必须真实点击验证：

## Stores

```text
筛选
点击 Row
Context Rail
详情
```

---

## Sync

```text
Status Filter
Job Row
Context Rail
Job Detail
```

若支持 Retry：

测试 Retry。

---

## Exception

```text
Filter
Row
关联对象
Action
```

---

## Global Search

测试：

```text
Ctrl + K
输入 SKU
输入 Order
输入 Store
Keyboard Select
Enter
Esc
```

---

## Notification

```text
Open
Click Item
Navigate
Close
```

---

# 71. Console

验收时打开 Console。

要求：

```text
0 runtime error
```

尽量：

```text
0 warning
```

若是 AntD Deprecated API：

本阶段必须顺手清理。

---

# 72. 测试

完成后执行：

```bash
pnpm lint
pnpm typecheck
pnpm check:arch
pnpm test
pnpm build
```

如果有 integration tests：

必须运行。

---

# 73. OOM 规则

如果 integration 默认并行 OOM：

允许：

```bash
--maxWorkers=1
```

但最终报告必须明确：

```text
环境 OOM
单 worker 全部通过
```

不能写成：

默认测试通过。

---

# 74. Git 提交策略

建议至少拆成：

```text
feat(web): redesign stores workspace

feat(web): add sync center workspace

feat(web): add exception center

feat(web): redesign system settings

feat(web): add global search command palette

feat(web): refine activity and notifications

refactor(web): unify phase 2 interaction patterns

test(web): add phase 2 ui regression coverage

docs(web): add phase 2 redesign report
```

不要一次提交全部代码。

---

# 75. 禁止事项

Phase 2 禁止：

1. 重写 Backend
2. 修改库存核心逻辑
3. 修改订单核心状态机
4. 修改 Picking 业务逻辑
5. 修改同步业务规则
6. 自创后台数据
7. 自创权限模型
8. 替换 Ant Design
9. 引入第二套 UI 框架
10. 大量新增 npm UI 依赖
11. 引入大型 Chart Library
12. 引入 Tailwind
13. 重写 Router
14. 为视觉效果破坏现有 API contract
15. 无理由修改 Phase 1 页面结构

---

# 76. Performance

避免：

```text
每个 Row 单独请求
```

避免：

```text
Context Rail 打开触发多个重复 API
```

React Query 或当前 query cache 必须合理利用。

---

# 77. Search Performance

Global Search：

minimum keyword：

```text
2 characters
```

debounce：

```text
300ms
```

必须取消过期搜索或避免竞态。

---

# 78. Table Performance

优先：

Server Pagination。

禁止一次请求数千条记录，然后纯前端过滤。

---

# 79. Loading UX

搜索：

小 spinner。

页面：

Skeleton。

Table：

loading state。

Drawer：

局部 Skeleton。

不使用 Full Screen Loading。

---

# 80. Right Rail 内容原则

右栏不是 Detail Page。

只显示：

```text
关键摘要
风险
下一步动作
```

完整信息：

进入 Drawer / Detail Page。

---

# 81. 用户操作原则

ERP 最重要动作：

Primary Button。

危险动作：

Danger。

普通动作：

Secondary。

禁止一行出现：

5 个 Primary Buttons。

---

# 82. 信息层级

Page：

```text
PageHeader
Metrics
Filters
Main Data
Context
```

避免：

```text
PageHeader
Card
Card
Card
Card
Nested Card
```

---

# 83. Stores 验收标准

用户进入 Stores 后 5 秒内应知道：

```text
店铺是否正常
哪个平台有问题
哪个店铺需要处理
最后同步是否正常
```

---

# 84. Sync 验收标准

用户进入 Sync 后 5 秒内应知道：

```text
是否正在同步
是否有失败
哪个店失败
失败了多少
```

---

# 85. Exception 验收标准

用户进入 Exception Center 后 5 秒内应知道：

```text
有多少问题
哪些最严重
问题属于订单还是库存
下一步应该做什么
```

---

# 86. Search 验收标准

任意页面：

```text
Ctrl + K
```

搜索：

```text
SKU
Order
Store
```

应在不进入列表页的情况下直接找到实体。

---

# 87. Phase 2 视觉验收目标

最终应达到：

```text
Workbench
Not Website
```

整个应用看起来应像：

成熟 ERP / Operations Console。

而不是：

普通后台模板。

---

# 88. 完成定义 Definition of Done

Phase 2 只有满足以下所有条件才算完成：

- Stores 完成
- Sync Center 完成
- Exception Center 完成
- System 页面完成
- Global Search 完成
- Notification / Activity 完成
- Phase 1 页面无回归
- 1920 验收
- 1440 验收
- 1366 验收
- GUI 真实功能测试完成
- Console 无 Runtime Error
- lint 通过
- typecheck 通过
- architecture check 通过
- unit tests 通过
- integration tests 通过
- build 通过
- 截图完成
- Phase 2 Report 完成
- Git 工作区干净

---

# 89. 最终报告

创建：

```text
docs/web-redesign-phase2-report.md
```

至少包含以下部分：

1. Executive Summary
2. Starting Baseline
3. Scope
4. Stores
5. Sync Center
6. Exception Center
7. System
8. Global Search
9. Notification Center
10. Design System Changes
11. AppShell Changes
12. API Usage
13. API Gaps
14. Responsive Behavior
15. Accessibility
16. Performance
17. GUI Test
18. Screenshots
19. Automated Tests
20. Known Limitations
21. Git Commits
22. Final Status

---

# 90. 最终回复格式

任务完成后，回复必须明确给出：

```text
Phase 2 完成状态
```

并列出：

```text
Git Commit
主要页面
测试结果
GUI 回归
截图目录
最终报告
API Gap
Known Issues
```

不得只回复：

```text
完成了
```

---

# 91. 推荐执行顺序

建议严格按照：

```text
Step 1
读取任务书 + 检查 Git

Step 2
探索现有 Stores / Sync / System API

Step 3
确认 API Gap

Step 4
Stores

Step 5
Sync Center

Step 6
Exception Center

Step 7
System

Step 8
Global Search

Step 9
Notification

Step 10
统一 Context Rail / Drawer / Error / Empty / Loading

Step 11
Phase 1 Regression

Step 12
1920 / 1440 / 1366 GUI 验收

Step 13
自动测试

Step 14
Build

Step 15
截图

Step 16
Report

Step 17
Final Commit
```

---

# 92. 第一原则

如果任务书中的设计建议和真实业务数据结构产生冲突：

优先级：

```text
真实业务逻辑
>
真实 API Contract
>
数据正确性
>
操作效率
>
设计稿
>
视觉装饰
```

不要为了严格模仿 UI 而损害 ERP 的业务正确性。

---

# 93. Phase 2 最终目标

完成后，WCIES 的 Web 应形成完整工作闭环：

```text
Dashboard
↓
SKU
↓
Inventory
↓
Orders
↓
Picking
↓
Stores
↓
Sync
↓
Exceptions
↓
System
```

用户可以从 Dashboard 看状态，从业务页面处理订单和库存，从 Sync / Exception Center 定位后台问题，通过 Context Rail 快速判断，再进入 Detail Drawer 完成进一步操作。

Phase 2 完成后，WCIES Web 前端应具备：

**完整运营工作台的基础形态。**