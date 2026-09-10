# WCIES UI Redesign — Phase 1
## 精致中性商务 · 自适应三栏运营工作台

## 1. 任务目标

在**不修改 WCIES 现有业务规则和后端领域逻辑**的前提下，对 Web 前端进行第一阶段视觉与交互重构。

唯一批准的设计方向：

```text
WCIES Neutral Business Workbench

精致中性商务
+
自适应三栏运营工作台
```

视觉基准以用户确认的“方案 D · 精致中性商务”截图为准。

结构基准：

```text
左侧全局导航
+
中央主工作区
+
可折叠上下文右栏
```

目标不是简单修改 Ant Design 主题色，而是形成一套可以长期扩展到整个 WCIES 的 ERP Design System。

---

# 2. Phase 1 范围

本阶段完成：

```text
P1-01 Design System
P1-02 Adaptive Three-Column AppShell
P1-03 Dashboard 首页
P1-04 SKU 管理
P1-05 Inventory 库存
P1-06 Orders 订单
P1-07 Picking 拣货工作台
```

暂不整体迁移：

```text
Product
Listing
Warehouse
Store
Shipment
Package
Interception
Sync Center
Exception
Notification
Import
Finance
```

这些页面留到 Phase 2。

---

# 3. 业务冻结

本 Sprint 是 UI/UX 重构。

禁止修改：

```text
Inventory 公式
Reservation
Order 状态机
Picking 状态机
Shipment 状态机
Interception
Listing Resolver
Sync Engine
OZON Adapter
数据库 Schema
API业务语义
权限规则
```

继续使用现有：

```text
@wcies/api-client
TanStack Query
现有后端 API
```

发现真实业务 Bug：

记录并报告。

不得为了方便 UI 顺手重写领域逻辑。

---

# 4. 技术栈不变

继续使用：

```text
React 19
TypeScript
Vite
Ant Design 6
React Router
TanStack Query
```

禁止迁移至：

```text
MUI
shadcn
Chakra
Bootstrap
另一套完整 UI Framework
```

允许：

在 AntD 上建立 WCIES Design System。

---

# 5. 最终视觉关键词

必须体现：

```text
精致
中性
专业
商务
现代 SaaS
高信息密度
克制
轻量
长期使用不疲劳
```

禁止：

```text
深色科技风
霓虹
玻璃拟态
大量渐变
高饱和蓝
营销 Banner
大面积插画
默认 Ant Design Admin 风
```

---

# 6. 全局颜色体系

建议建立 Token，而不是页面硬编码。

基础：

```text
Canvas Background    #F6F7F9
Container            #FFFFFF
Sidebar              #FAFAFA / #FFFFFF

Text Primary         #172033
Text Secondary       #667085
Text Tertiary        #98A2B3

Border               #E7E9EE
Border Soft          #EEF0F3
```

Primary 使用低饱和蓝灰，例如：

```text
#496F96
#52779C
```

不要大面积使用 AntD 默认亮蓝。

---

# 7. 语义颜色

Success：

```text
柔和绿色
```

Warning：

```text
暖橙
```

Danger：

```text
柔和红
```

Info：

```text
蓝灰
```

状态优先：

```text
浅背景
+
深色文字
+
小面积 Indicator
```

不要满屏彩色 Tag。

---

# 8. Typography

统一建立：

```text
Page Title       28–30 / 600–700
Section Title    16–18 / 600
Card Title       14–16 / 600
Body             14
Secondary        12–13
KPI              28–34 / 650–700
```

中文字体：

```text
PingFang SC
Microsoft YaHei
system-ui
```

数字需要清晰、稳定对齐。

---

# 9. Spacing / Radius / Shadow

Spacing：

```text
4
8
12
16
20
24
32
```

Radius：

```text
Card     12px
Button   8px
Input    8px
Tag      6px
```

Shadow：

非常轻。

优先：

```text
1px Border
+
Soft Shadow
```

而不是强烈悬浮。

---

# 10. Design System

建议建立：

```text
apps/web/src/design-system/
├── tokens/
│   ├── colors
│   ├── spacing
│   ├── radius
│   ├── typography
│   └── shadows
│
├── components/
│   ├── PageHeader
│   ├── PageToolbar
│   ├── MetricCard
│   ├── StatusBadge
│   ├── DataTable
│   ├── FilterBar
│   ├── SearchInput
│   ├── ContextRail
│   ├── SectionCard
│   ├── InfoGrid
│   ├── EntitySummary
│   ├── ActionMenu
│   ├── EmptyState
│   └── ScanFeedback
│
└── index.ts
```

不要求机械照搬目录。

重点是形成统一视觉组件。

---

# 11. AntD Theme

通过统一：

```text
ConfigProvider
```

覆盖：

```text
colorPrimary
colorBgLayout
colorBgContainer
colorText
colorTextSecondary
colorBorder

borderRadius
controlHeight
fontSize

Menu
Table
Button
Input
Select
Tabs
Drawer
Modal
Card
Tag
```

禁止每个页面自己定义一套主题。

---

# 12. 核心 AppShell：自适应三栏

最终结构：

```text
┌─────────────┬─────────────────────────────┬───────────────┐
│             │                             │               │
│  左侧导航    │         主工作区             │  上下文右栏    │
│             │                             │               │
│ Dashboard   │ Page Header                 │ 当前风险       │
│ Product     │ Filters                     │ 当前实体       │
│ Inventory   │ Table / Charts              │ 同步状态       │
│ Orders      │ Main Actions                │ 快捷操作       │
│ Warehouse   │                             │ 重点事项       │
│             │                             │               │
└─────────────┴─────────────────────────────┴───────────────┘
```

右栏不是固定装饰。

它必须显示：

> 当前页面 / 当前选择实体最值得立即知道的信息。

---

# 13. 左侧导航

宽度建议：

```text
196–216px
```

视觉：

```text
白色 / 极浅灰
右侧 1px 边框
```

选中状态：

```text
低饱和蓝灰底
深蓝灰文字
```

一级导航：

```text
首页

商品
库存
订单

仓库作业
  拣货
  发货
  拦截

同步中心
异常
通知

系统
```

保持现有路由。

Phase 1 不重构菜单业务层级。

---

# 14. Topbar

结构：

```text
全局搜索
店铺上下文
通知
帮助
用户
```

搜索视觉参考方案 D：

```text
搜索订单、商品、SKU、店铺或功能...
```

可以显示：

```text
Ctrl K
```

Phase 1 不要求实现完整 Command Palette。

---

# 15. 主工作区

Main Content：

```text
padding: 24–28px
```

必须支持：

```text
1366×768
1440×900
1600×900
1920×1080
```

不能在超宽屏无限拉伸。

---

# 16. Context Rail 右栏

建立统一：

```text
ContextRail
```

建议展开宽度：

```text
280–320px
```

内容可以是：

```text
今日重点
库存风险
同步状态
当前实体摘要
异常
快捷操作
最近活动
```

---

# 17. 右栏响应规则

### ≥1600px

Dashboard：

```text
默认展开
```

SKU / Inventory / Orders：

```text
可默认展开
```

---

### 1400–1599px

Dashboard：

```text
默认展开
```

Table-heavy 页面：

```text
允许折叠
```

用户展开后保持。

---

### ≤1366px

右栏：

```text
默认折叠
```

通过：

```text
Context Button
```

打开。

可以：

Overlay / Drawer / Side Rail。

主表格不得被压到无法使用。

---

# 18. Context Rail 使用原则

右栏不得承担核心 CRUD。

核心业务操作仍在：

```text
Main Work Area
Drawer
Modal
Detail Page
```

右栏负责：

```text
Observe
Preview
Navigate
Quick Action
```

---

# 19. 三级交互模型

统一形成：

```text
Table Row
↓
Context Rail 快速预览
↓
需要进一步处理
↓
Full Drawer / Detail Page
```

减少简单查看动作反复打开 Drawer。

---

# 20. Dashboard

Dashboard 使用最完整的三栏结构。

---

# 21. Dashboard 主区顶部

参考方案 D：

```text
早上好，Admin 👋

今天是 YYYY-MM-DD
当前有 XX 个待处理事项
```

右侧：

```text
全部店铺
OZON
WB
Yandex
日期
```

数据优先使用现有 API。

禁止为视觉效果伪造新的后端数据。

---

# 22. Dashboard KPI

第一排 4 个：

```text
待处理订单
缺货预警
Mapping 覆盖率
店铺在线
```

样式：

```text
小 Icon
标题
大数字
辅助数据
轻量趋势
```

参考方案 D。

不要彩色大卡片。

---

# 23. Dashboard 中央区

建议：

```text
订单趋势
+
今日重点
```

订单趋势：

轻量 Line Chart。

Chart 风格：

```text
细线
淡 Grid
无 3D
无重渐变
白色 Tooltip
```

---

# 24. Dashboard Context Rail

右栏重点：

### 店铺状态

```text
OZON · Store A
● 正常
2分钟前同步
```

### 同步异常

```text
WB Store B
● 同步失败
```

### 今日风险

```text
3 Mapping Failed
5 Backordered
2 Interception
```

---

# 25. Dashboard 底部

最近订单：

Tabs：

```text
全部
待处理
处理中
已发货
异常
```

Table保持高密度。

---

# 26. SKU 页面

路径：

```text
/skus
```

主区采用：

```text
Header
FilterBar
DataTable
```

右栏承担 SKU Quick View。

---

# 27. SKU Header

```text
SKU管理

管理内部 SKU、条码、成本、库存及平台映射
```

筛选：

```text
Search
Brand
Category
Status
Mapping
```

右侧：

```text
新增SKU
```

---

# 28. SKU Table

建议：

```text
商品
型号/规格
条码
成本
库存
平台映射
状态
更新时间
操作
```

商品列整合：

```text
[48×48 图片]

VALKYRIE VK87 MAX
VK87-BLK
```

避免图片、名称、SKU完全拆散。

---

# 29. SKU Context Rail

点击一行：

右栏变为：

```text
[商品图片]

VK87-BLK
VALKYRIE VK87 MAX

● ACTIVE

库存
On Hand       32
Available     26

Mapping
3 / 4
75%

主条码
695...

成本
¥399

[打开完整详情]
```

---

# 30. SKU Detail

完整操作仍使用 Drawer。

Drawer宽度：

```text
760–840px
```

Tabs：

```text
概览
条码
图片
平台映射
```

只读信息使用：

```text
InfoGrid
```

不要全部显示成 Form。

---

# 31. Inventory 页面

库存非常适合三栏结构。

路径：

```text
/inventory
```

---

# 32. Inventory Header

```text
库存管理

查看各仓库实时库存、占用、拣货和可售状态
```

Filter：

```text
Search SKU
Warehouse
Bin
Status
```

Actions：

```text
库存初始化
库存调整
```

---

# 33. Inventory KPI

主区顶部：

```text
库存SKU
On Hand
Reserved
库存异常
```

保持紧凑。

---

# 34. Inventory Table

```text
商品
仓库
库位
On Hand
Reserved
Picked
Safety
Available
状态
操作
```

数字：

右对齐。

Available：

视觉强调。

---

# 35. Inventory Context Rail

默认：

```text
库存风险

缺货 SKU        6
低库存 SKU     23

低库存 TOP

VK87-BLU        2
MOUSE-V7        0
...

当前仓库

深圳仓
总库存       1,284
Reserved       83
Available    1,110
```

选中 SKU 后：

可切换成当前 SKU 摘要。

---

# 36. Inventory Detail

仍使用 Drawer。

Tabs：

```text
库存概览
仓库明细
Reservation
库存流水
```

Summary：

```text
On Hand
Reserved
Picked
Safety
Available
```

---

# 37. Orders 页面

路径：

```text
/orders
```

使用：

```text
Main Table
+
Order Context Rail
```

---

# 38. Orders Header

```text
订单管理

统一管理各平台订单及内部履约状态
```

筛选：

```text
Search
Platform
Store
ERP Status
Exception
Date
```

---

# 39. Order Status Tabs

```text
全部
待处理
拣货中
待发货
已发货
异常
```

附小计数：

```text
待处理 128
异常 12
```

---

# 40. Orders Table

建议：

```text
订单号
平台 / 店铺
商品
金额
ERP状态
异常
下单时间
操作
```

商品：

```text
VK87-BLK ×1
+2 商品
```

---

# 41. Order Context Rail

选中 Order：

```text
ORD000091

OZON · Store A

READY_TO_PICK

商品           3
Reserved       3/3
异常           0

最近状态

14:21 创建
14:22 SKU解析
14:22 库存锁定
14:23 Ready to Pick

[查看完整订单]
```

---

# 42. Order 风险模式

存在异常时：

右栏优先显示：

```text
ORDER_SKU_MAPPING_FAILED
```

或：

```text
BACKORDERED
```

以及：

```text
重新尝试分配
```

按钮。

颜色：

Mapping Failed → Red  
Backordered → Orange

不要统一用“异常”一个颜色。

---

# 43. Order Detail Drawer

Tabs：

```text
订单
商品
履约
异常
状态历史
Raw Data
```

Header：

```text
ORD000091
OZON · Store A
READY_TO_PICK
```

---

# 44. Picking 页面

Picking 不强制普通三栏。

这是专门：

```text
Warehouse Operation Mode
```

---

# 45. Picking List

路径：

```text
/picking
```

继续使用 AppShell。

显示：

```text
Picking No
Warehouse
Orders
Items
Progress
Status
Created
```

---

# 46. Picking Workbench

路径：

```text
/picking/:id
```

进入后：

弱化左导航。

结构：

```text
主作业区
+
右侧任务信息栏
```

不需要传统 ERP 三栏。

---

# 47. Picking 主区

顶部：

```text
PCK000091

深圳仓

16 / 20
████████████████░░
```

中心突出：

```text
下一库位

A03-02

[商品图片]

VK87-BLK
VALKYRIE VK87 MAX

需要       2
已拣       1
```

---

# 48. Picking 右栏

显示：

```text
任务概要

订单数        8
商品行       14
总件数       20

当前进度
16 / 20

剩余库位

A03-02
A03-04
B01-01

异常
0
```

---

# 49. 扫码输入

必须是页面视觉焦点之一。

```text
┌───────────────────────────────┐
│       扫描商品条码             │
└───────────────────────────────┘
```

要求保持：

```text
auto focus
Enter submit
clear
refocus
```

已有业务逻辑不变。

---

# 50. 扫码成功

必须有大面积视觉反馈：

```text
浅绿色区域

✓ 扫码成功

VK87-BLK

2 / 2
```

不能只有 Toast。

---

# 51. 扫码错误

必须：

```text
浅红区域

✕ 商品错误

需要：
VK87-BLK

扫描：
MOUSE-V7
```

错误后继续自动 focus。

---

# 52. DataTable

建立统一表格视觉。

默认 row：

```text
44–48px
```

Header：

```text
浅灰背景
中灰文字
```

分隔线：

很淡。

禁止每个 Cell 强 Border。

---

# 53. Table Actions

每行不显示：

```text
查看 编辑 删除 调整 更多
```

优先：

```text
查看
⋯
```

或只使用：

```text
⋯
```

Action Menu。

---

# 54. FilterBar

统一模式：

```text
[Search] [Select] [Select] [Date]       [Action]
```

所有核心管理页面使用同一高度和间距。

---

# 55. PageHeader

统一：

```text
标题
说明

                      Secondary
                      Primary
```

禁止不同页面标题随意排版。

---

# 56. StatusBadge

建立统一：

```text
StatusBadge
```

支持：

```text
success
warning
danger
info
neutral
purple
```

页面不得自行决定随机颜色。

---

# 57. Context Rail Component

实现统一：

```text
ContextRail
ContextSection
ContextMetric
ContextAction
```

要求支持：

```text
expanded
collapsed
selectedEntity
pageContext
```

不要为每页重新写一套右栏。

---

# 58. Drawer

统一：

```text
Detail Header
Tabs
Sections
Footer Actions
```

减少原生 AntD Drawer 的默认感。

---

# 59. Empty / Loading / Error

统一 Empty：

```text
暂无异常订单
当前没有需要处理的异常。
```

Loading：

优先 Skeleton。

Error：

```text
数据加载失败
[重新加载]
```

---

# 60. Platform Identity

OZON / WB / Yandex：

统一尺寸。

例如：

```text
Logo 20–24px
+
Platform Name
```

不要不同页面尺寸不一致。

---

# 61. 第一阶段视觉验收点

完成：

```text
Design System
AppShell
Dashboard
```

后：

**暂停继续批量迁移。**

必须输出截图：

```text
01-dashboard-1440.png
02-dashboard-1920.png
03-dashboard-1366.png
```

并进行视觉自检。

如果与方案 D 明显偏离：

先修视觉。

再继续 SKU / Inventory / Orders / Picking。

---

# 62. 第二阶段实施

视觉方向确认后再完成：

```text
SKU
Inventory
Orders
Picking
```

---

# 63. GUI截图要求

最终至少：

```text
01-dashboard.png

02-sku-list.png
03-sku-context.png
04-sku-detail.png

05-inventory.png
06-inventory-context.png
07-inventory-detail.png

08-orders.png
09-order-context.png
10-order-detail.png

11-picking-list.png
12-picking-workbench.png
13-picking-success.png
14-picking-error.png
```

统一建议：

```text
1440×900
```

另外 Dashboard：

增加 1920 和 1366。

---

# 64. GUI功能回归

Dashboard：

```text
Navigation
KPI
Store Status
Recent Orders
```

SKU：

```text
Search
Filter
Row selection
Context Rail
Drawer
Tabs
Mapping
```

Inventory：

```text
Filter
Context Rail
Initialize
Adjust
Drawer
```

Orders：

```text
Tabs
Filters
Context Rail
Detail
Exception
Retry Allocation
```

Picking：

```text
Start
Correct Scan
Wrong Scan
Progress
Complete
```

---

# 65. 视觉自检

逐页检查：

```text
文字是否溢出
表格是否过松
右栏是否压缩主区
按钮是否过多
状态颜色是否太艳
留白是否失衡
Card是否套Card
边框是否过重
字体层级是否统一
Alignment是否统一
1366 是否仍可用
1920 是否过度空旷
```

---

# 66. 禁止出现的 UI

禁止：

```text
大 Banner
装饰性地球图
大片品牌渐变
玻璃拟态
全屏蓝色卡
超大圆角
多层 Card 套娃
各种 Emoji Icon
全页面 Rainbow Tag
```

方案 D 的高级感来自：

```text
比例
排版
留白
颜色克制
信息层级
```

不是装饰。

---

# 67. Accessibility

至少保证：

```text
Keyboard focus 清晰
Input有语义 label
Button可识别
状态不能只靠颜色
Picking可全键盘工作
```

---

# 68. 性能要求

UI重构不得导致：

```text
重复网络请求
Context Rail 每点击行重新请求全部列表
大量不必要 rerender
```

优先复用：

```text
现有 Table 数据
TanStack Query Cache
```

需要 Detail API时才请求。

---

# 69. 不增加无必要依赖

如 Dashboard 现有项目无 Chart Library：

先检查已有依赖。

如果确需加入：

Agent必须在实施前说明：

```text
Library
Bundle Impact
Reason
Alternative
```

不要为了一个折线图引入巨型图表平台。

---

# 70. AntD Warning

重构触及已有 deprecated API：

可以顺手更新。

不要求为了清除全项目旧 warning 扩大范围。

---

# 71. Tests

最终必须通过：

```bash
pnpm lint
pnpm typecheck
pnpm check:arch
pnpm test
pnpm test:integration
pnpm build
```

当前业务测试不得因为 UI 重构下降。

---

# 72. OpenAPI

原则上不修改 API。

如果：

```text
openapi.json
```

无变化：

不要制造无意义提交。

如果真的改变 Response Contract：

必须：

```text
openapi:export
api-client:generate
check:openapi
```

---

# 73. 推荐提交

例如：

```text
feat(web-design): establish WCIES neutral business design system

feat(web-shell): add adaptive three-column workbench shell

feat(web-dashboard): redesign dashboard

feat(web-sku): redesign sku management and context rail

feat(web-inventory): redesign inventory workbench

feat(web-orders): redesign order workbench

feat(web-picking): redesign warehouse picking experience
```

不强制数量。

---

# 74. 最终报告格式

## 1. Design Direction

说明如何实现：

```text
方案D
+
自适应三栏
```

## 2. Design Tokens

## 3. AntD Theme

## 4. Adaptive AppShell

说明：

```text
1366
1440
1600
1920
```

下三栏行为。

## 5. Context Rail

说明各页面右栏内容。

## 6. Dashboard

## 7. SKU

## 8. Inventory

## 9. Orders

## 10. Picking

## 11. Shared Design Components

## 12. Before / After

## 13. GUI Acceptance

附截图路径。

## 14. Functional Regression

## 15. Accessibility

## 16. Performance

## 17. Tests

## 18. 未完成项

## 19. 风险

## 20. Git Commits

## 21. Phase 2建议

---

# 75. Phase 1完成定义

只有以下全部满足：

```text
方案D视觉语言明显成立

Neutral Business Design System建立

AntD Theme统一

Adaptive Three-Column AppShell建立

左导航完成
Topbar完成
Context Rail完成

Dashboard完整三栏工作台完成

SKU:
主表 + Context Rail + Detail Drawer完成

Inventory:
主表 + 风险右栏 + Detail Drawer完成

Orders:
主表 + Order Context Rail + Detail Drawer完成

Picking:
Warehouse Operation Workbench完成

1366可用
1440视觉完整
1600三栏舒适
1920不过度空

Table密度统一
StatusBadge统一
FilterBar统一
PageHeader统一

扫码成功/错误反馈仍清晰

现有业务功能无回归

视觉截图完成

lint通过
typecheck通过
check:arch通过
unit通过
integration通过
build通过
```

才可以标记：

> **WCIES UI Redesign — Phase 1 完成**

---

## 76. 最重要的实现原则

不要把“三栏”理解成：

> 每个页面右边永远放一列 Card。

正确理解是：

> **左栏负责导航，主区负责完成工作，右栏负责提供当前工作所需的上下文。**

也不要把“方案 D”理解成：

> 白色背景 + 蓝色按钮。

正确目标是：

> **让 WCIES 看起来像一套经过专业产品设计、适合运营团队每天长时间使用的现代跨境电商 ERP，而不是换了主题色的 Ant Design 后台。**