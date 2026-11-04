# WCIES Web UI 组件规范 V1

> 制定日期：2026-09-16。
>
> 适用范围：`apps/web` 全部页面与共享组件。
>
> 本文件是前端 UI 的**唯一事实规范**。所有修改 `apps/web` 的 AI 会话与人工提交，
> 在编写或修改任何页面之前必须阅读本文件。
>
> 本文中的 **必须 / 禁止 / 只允许** 均为硬性规则。
> 与本文件冲突的既有代码属于待修复项（见 Phase 3 任务书），不得作为新代码的先例。
>
> 历史基线：Phase 1 / Phase 2 重构任务书（根目录）确立 design-system 与三栏工作台外壳；
> 本规范在其上收紧跨页一致性，冲突处以本文件为准。

---

## 目录

1. 总原则
2. 页面骨架标准
3. 按钮体系
4. 表格行内操作与 ContextRail
5. 状态展示与启用/停用
6. 筛选工具栏
7. 确认交互分级
8. Drawer 与 Modal
9. 数据展示格式
10. 颜色与样式纪律
11. 术语与文案表
12. 仓库作业工作台（focus mode）
13. 可访问性
14. Design System 组件契约总表

---

# 1. 总原则

1. **组件唯一来源**：一切 UI 由 `apps/web/src/design-system` 承载。页面不得手写
   已有 DS 组件的等价物（状态徽标、空态、行操作、扫码反馈、详情字段网格等）。
2. **操作入口唯一**：同一动作在一个页面只允许一个入口。出现在行内 + 右栏 +
   抽屉三处的动作属于违规（Phase 3 前的历史欠账）。
3. **展示与控制分离**：表格是扫描视图（StatusBadge 只读展示）；
   右栏 ContextRail 是控制面（操作按钮 / 状态切换 Switch）。
4. **规范高于先例**：新页面、新改动一律遵守本规范；不得复制旧页面的违规写法。
5. 不引入新依赖、不改业务逻辑、不改 API 契约 —— UI 层规范只约束展示与交互。
6. 与业务规则冲突时停止并询问用户（同 AGENTS.md §2）。

---

# 2. 页面骨架标准

标准管理页（列表型）自上而下的固定结构：

```text
PageHeader          标题 + 描述；secondary(刷新/工具) + primary(新建，至多 1 个)
[KpiRow]            可选；≤4 张 MetricCard，与右栏概览不得重复同一数字
[Tabs]              可选；放 PageHeader extra（唯一合法位置）
FilterBar           筛选控件 + actions 槽（清除筛选等）
SectionCard flush
  DataTable         统一密度、空态、分页；行点击选中、双击打开详情
ContextRail         右栏：概要 → 风险 → 关联操作 → 操作区（见 §4）
[Drawer / Modal]    详情与管理动作
```

规则：

- **PageHeader 必须存在**。禁止以控件行 / Card 直接开局的"无标题页"。
- PageHeader `primary` **每页至多一个**；不得在 primary 槽塞两个按钮。
- 主操作（新建 / 上传 / 立即同步）放 PageHeader；**禁止**把 primary 按钮混进筛选行。
- Tabs 的唯一位置是 PageHeader `extra`。禁止出现在 FilterBar 前、FilterBar 后等位置。
- KpiRow 数字与右栏空闲态概览**不得重复**：概览型数字只出现一次
  （要么 KPI 卡、要么右栏，按信息归属选一处）。
- 详情 / 工作台子页（`/xxx/:id`）必须有 PageHeader 或等效返回导航（面包屑 / 返回按钮），
  禁止依赖浏览器后退。

---

# 3. 按钮体系

## 3.1 类型语义（antd Button type）

| 类型 | 语义 | 数量限制 |
| --- | --- | --- |
| `primary` | 当前上下文最重要的推进动作 | 每个视图 ≤ 1 |
| `default` | 普通次级动作 | 不限 |
| `dashed` | 添加行 / 添加明细 | 表单内 |
| `text` / `link` | 弱化的行内文字动作（仅子表内，见 §4.5） | — |
| `danger` | 不可逆 / 影响外部承诺的动作 | 必须带确认（§7） |

- `primary` + `ghost` 组合**禁止**用于行内或工具栏按钮（历史上用于"进入作业 /
  发货工作台 / 处理拦截"，全部废除）。
- `danger` 只授予：删除、取消单据（采购单 / 收货草稿 / 退货批次）、作废、
  标记失败、停用方向确认。生命周期推进动作（释放占用、取消拣货、拣货、出库）
  **不是 danger**。

## 3.2 位置—动作矩阵（一个动作只住一个位置）

| 位置 | 承载的动作 | 形态 |
| --- | --- | --- |
| PageHeader `primary` | 新建 / 上传 / 立即同步 | primary + PlusOutlined 等 |
| PageHeader `secondary` | 刷新、导出、工具入口、跨页导航 | default Button（禁止裸 `<Link>` / EntityLink） |
| FilterBar `actions` | 清除筛选、列设置 | default 小按钮 |
| ContextRail 操作区 | 实体级动作（查看详情、同步、启停、重试…） | block 按钮（§4.3） |
| Drawer `extra` | 该实体的管理动作（编辑、删除） | `size="small"` |
| 表格行内 | **无**（§4.1） | — |
| 子表行内（Drawer/Modal 内） | 行级上下文动作 | small 按钮（§4.5） |

## 3.3 尺寸

- 页面 chrome（PageHeader / FilterBar）：默认尺寸。
- Drawer `extra` 与 Drawer / Modal 内表格行按钮：`size="small"`。
- ContextRail 操作按钮：默认尺寸 + `block`。
- 扫码工作台主按钮：`size="large"`。

## 3.4 文案

- 动词 + 宾语，全中文：「新建商品」「同步订单」「停用店铺」。
- 统一用「新建」，禁止「新增」（§11 术语表）。
- 打开详情的动作统一叫「查看详情」（行双击与右栏按钮同文案）。
- 按钮文案禁止中英混排（「登 录」加空格、'SKU已创建' 缺空格等一律修正）。

## 3.5 图标

- PageHeader primary：PlusOutlined（新建类）/ CloudSyncOutlined（同步类）。
- 刷新：ReloadOutlined。导出：ExportOutlined。
- 其余动作默认不带图标；禁止同页有的按钮带图标、同类按钮不带的混搭。

---

# 4. 表格行内操作与 ContextRail

## 4.1 主表不设操作列

- 管理页主表**移除"操作"列**。行交互统一为：
  - **单击行 = 选中**（toggle：再点同一行取消选中），右栏随之切换为该实体；
  - **双击行 = 打开详情 Drawer**。
- 进入工作台的跳转（进入作业 / 发货工作台 / 处理拦截 / 打包作业）同样由
  双击或右栏「进入作业」primary 按钮承载，不在行内放按钮。
- 右栏不可用的场景（≤1366 覆盖层模式）由顶栏"上下文面板"按钮打开，
  这是既定外壳行为，不构成恢复行内按钮的理由。

## 4.2 ContextRail 标准分区与顺序

实体型右栏（选中某行后）固定分区顺序：

```text
header        EntitySummary（title=业务编号，subtitle=名称，badge=StatusBadge，meta=PlatformTag 等）
1 概要         ContextSection「基本信息 / 库存 / 任务概况」ContextMetric 若干
              含启用/停用实体时的 StatusSwitch（§5.2，放本区底部）
2 风险         可选；ContextSection「风险」：风险指标 + 单条处理入口（EntityLink）
3 关联操作      可选；ContextSection「关联操作」：EntityLink 深链（查看订单 / 前往 SKU 映射…）
4 操作区       ContextAction：查看详情 + 实体动作按钮（§4.3）
```

- 概览型页面（通知中心、系统管理、Dashboard 类）可用恒定统计右栏（无选中态），
  但同一页面只能选一种形态，禁止混用。
- 空闲态（未选中）：单个 ContextSection「XX 概览」+ 统计 ContextMetric +
  `RailHint` 提示文案（DS 组件，禁止各页手写 span）。
- 空闲态统计与页面 KPI 不得重复展示同一数字（§2）。

## 4.3 ContextAction 操作按钮

- 全部 `block`、默认尺寸。
- 顺序固定：`查看详情`(default) → 主操作(≤1 个 primary) → 次操作(default) →
  危险操作(danger + 确认)。
- 操作总数 ≤ 5；同族动作（同步订单 / 同步商品）合并为一个 Dropdown 按钮。
- 危险操作必须带 §7 对应级别的确认。
- 触发外部写操作的按钮必须 `loading` 绑定 mutation pending。

## 4.4 注册时机

- 页面挂载即注册（含空闲态），行选中切换内容；`useMemo` 依赖不得包含
  mutation 对象（以 `isPending` 布尔为依赖），避免整个右栏无谓重建。

## 4.5 子表例外（Drawer / Modal 内的表格）

- Drawer / Modal 内的子表没有右栏，**允许**行内按钮，但：
  - 单行 ≤ 3 个按钮，超过用 ActionMenu（primary link + 菜单）；
  - 形态统一 `size="small"`；危险动作 danger 且带确认；
  - 同一动作不得同时出现在子表和页面右栏（入口唯一）。
- Form.List / 明细编辑器的行删除用 `text + danger`，可免确认（未提交的草稿行）。

---

# 5. 状态展示与启用/停用

## 5.1 StatusBadge 是唯一状态渲染组件

- 一切状态字段（业务状态、同步状态、事件状态、渠道…）用 `StatusBadge` +
  DS 内的 META 映射（label + tone + 可选 hint）渲染。
- **禁止**：antd `Tag`、`Badge status=`、纯文本、本地 STATUS_COLORS 色表。
- tone 语义：success 完成/健康；warning 需注意；danger 失败/阻塞；
  info 进行中；neutral 草稿/停用/无；purple 特殊域（映射失败等）。
- showDot 档位：**表格列统一 `showDot={false}`**（密集扫描场景）；
  右栏 / 抽屉徽标统一带点。同一字段禁止在同一区域内忽有忽无。
- 状态 META 表集中在 `design-system/components/StatusBadge.tsx`；
  页面本地不得再定义同名 LABEL / 色表（历史重复：TYPE_LABELS、STATUS_TAG 等）。

## 5.2 启用/停用 = 右栏 StatusSwitch（新组件）

- 一切 ACTIVE/INACTIVE 实体（店铺、仓库、库位、供应商、店仓绑定、商品、
  SKU、Listing、品牌、分类、平台凭证）：
  - **表格列**：StatusBadge 展示（启用=success / 停用=neutral），只读；
  - **右栏概要区底部**：`StatusSwitch`（label「状态」+ antd Switch，
    checked=ACTIVE），这是唯一的切换入口；
  - 行菜单、Drawer extra 中的「停用 / 启用」项**全部移除**。
- 停用方向带 Popconfirm（说明停用后果，如"停用后不再同步/不可被选用"）；
  启用方向直接执行。
- 确认文案统一「确认停用该{实体名}？」；禁止有的入口确认、有的不确认。
- 状态文案统一「启用 / 停用」（店铺右栏历史"正常"废除）。
- 布尔类业务开关（订单自动同步、Listing 自动同步、库存推送）同样用 Switch
  呈现，位置在对应实体的右栏或抽屉设置区，二选一不得重复。
- 例外：**子资源**（变体映射、平台凭证、条码、图片、弹窗内嵌管理器中的
  分类/品牌）的状态切换不强制进右栏，保留在所属子表操作或管理器内，
  但确认策略必须遵守本条（停用 Popconfirm / 启用直发）。

## 5.3 状态筛选的选项顺序

生命周期顺序统一：`DRAFT → ACTIVE → INACTIVE`（草稿 → 启用 → 停用）。
禁止各页自定义顺序。

---

# 6. 筛选工具栏（FilterBar）

## 6.1 控件顺序

```text
[关键词搜索] [枚举少的 Select …] [选项多的可搜索 Select / Cascader]  …  |actions|
```

- 关键词搜索永远第一位；类目 / 品牌 / 店铺 / 仓库等大选项集放后面。
- 搜索框 `allowClear` + `aria-label`；placeholder 说明可搜字段。

## 6.2 可搜索规则

- 静态选项 ≥ 8 个，或选项来自 API（店铺、仓库、类目、品牌、SKU、供应商、
  平台、拣货单…）的 Select / Cascader：**必须** `showSearch`。
  - 客户端过滤加 `optionFilterProp="label"`；
  - 服务端搜索用 `filterOption={false}` + onSearch debounce。
- 类目树（Cascader）必须 `showSearch`（内部分类树数千节点）。
- 少量固定枚举（状态 3-5 项、类型 2 项）不加 showSearch，宽度收窄到内容。

## 6.3 受控与清除

- 所有筛选控件**受控**（value + onChange）；禁止 `defaultValue` 非受控残留。
- 存在任一筛选时，FilterBar `actions` 显示「清除筛选」；点击后重置全部筛选
  （含搜索框文字、URL 参数）并回到第 1 页。

## 6.5 TimeRangeFilter（2026-11-04）

时间范围筛选**禁止**在页面里各写一套「Select + RangePicker」并排：

- 用 DS `TimeRangeFilter`（`Space.Compact` 连体：时间类型下拉 + 区间选择器
  共享边框/同一高度），一次选择同时决定「按哪个时间轴」和「哪段区间」；
- 切换时间类型不清空已选区间；清空区间即取消该筛选；
- 值以 ISO 字符串对外（页面不需要依赖 dayjs）；需要重置时改 `resetKey` 让它
  重新挂载。

## 6.4 FilterChips（新组件）

- 二级筛选（订单货物状态等成组互斥标签）用 DS `FilterChips`：
  受控 value、分组分隔、选中态 `primarySoft` 底 + primary 字，
  风险类 chip 选中可用 danger 系 token，禁止手写 hex。

---

# 7. 确认交互分级

| 级别 | 动作性质 | 载体 |
| --- | --- | --- |
| L0 直接执行 | 低危、可逆、草稿内操作 | 无确认 |
| L1 轻确认 | 停用、生命周期推进、标记类 | Popconfirm（一句话说明后果） |
| L2 强确认 | 删除、取消单据、作废、正式出库、确认收货 | DeleteConfirmModal（或带 danger ok 的 modal.confirm，见下） |

- **删除分两级**：
  - 主实体删除（商品、SKU、Listing、店铺、仓库、库位、绑定、供应商、分类…）：
    唯一载体 `DeleteConfirmModal`。禁止用 Popconfirm、modal.confirm、
    无确认直删承载主实体"删除"。
  - 子资源行删除（条码、图片、凭证、已提交的明细行）：`small danger +
    Popconfirm`（一句话后果）。
  - 未提交的表单草稿行（Form.List / 明细编辑器）：`text + danger` 免确认。
- 取消单据 / 确认收货 / 正式出库等 L2 业务确认：统一 `App.modal.confirm` +
  `okButtonProps={{ danger: true }}` + 说明后果文案；禁止同类似动作有的确认
  有的直发。
- 同一动作在所有入口共享同一确认级别（入口唯一化后自然满足）。

---

# 8. Drawer 与 Modal

## 8.1 用途

- **Drawer**：实体详情 + 管理动作（查看型）。
- **Modal**：创建 / 编辑表单、二次确认、导入预演。

## 8.2 尺寸档位（Drawer `size` 数值，antd v6）

| 档位 | 值 | 用途 |
| --- | --- | --- |
| S | 640 | 浅详情（同步任务、异常、店铺、拦截） |
| M | 760 | 标准详情（PO、仓库、商品、SKU、Listing） |
| L | 880 | 含子表 / 多 Tab 详情（订单、库存、收货、退货批次） |

- 禁止 560/720/860/960 等新数值；迁移时就近归档。

## 8.3 zIndex 档位

- 页面级 Modal：默认（不写）。
- 从 Drawer 内打开的 Modal：1100。
- 从 Modal 内再打开的 Modal：1200。

## 8.4 Drawer 规范

- `extra` 放该实体管理动作：`编辑`(small default)、`删除`(small danger)。
  启停不在 extra（在右栏 Switch）。
- title 带业务编号 + StatusBadge（Listings 历史缺徽标补齐）。
- 详情字段一律 `InfoGrid`；**禁止**手写 Field / SectionTitle / InfoField /
  DrawerSectionTitle / DrawerField 局部组件。
- 原始报文（Raw Data / 上下文数据 / payload）用 DS `RawDataBlock`
  （统一 pre 底色 token，禁止裸 hex）。
- Drawer 内 primary 动作（如创建拣货任务）至多 1 个。

## 8.5 Modal 规范

- `okText` 必须定制为动作动词（创建 / 保存 / 登记 / 生成草稿…），
  禁止默认"确定"。
- footer 按钮顺序：主操作在最右；自定义 footer 时主操作仍为 primary 且最右。
- 表单内 Select 遵守 §6.2 可搜索规则（同页一致，禁止一个 Select 可搜索
  另一个不可）。

---

# 9. 数据展示格式

- **时间**：
  - 列表列：`RelativeTime`（悬停 Tooltip 显示绝对时间）；
  - 详情 / Drawer / 历史：`fmtDateTime`；
  - **禁止** `slice(0,10)`、`slice(5,16)`、`toLocaleString()` 等手工截断/本地化。
- **数字**：右对齐 + `fontVariantNumeric: 'tabular-nums'`；金额带币种符号，
  来自后端 NUMERIC 字符串直接展示。
- **空值**：统一长破折号 `—`；禁止 `-`、空串、`null` 直出。
- **等宽字段**（单号 / 平台 ID / UUID）：monospace 字体样式统一由组件内 token
  处理，不得各页手写 fontFamily。
- **正负数量**（库存变更量等）：正数 success 色、负数 danger 色，
  用 token，禁止裸 hex。

---

# 10. 颜色与样式纪律

- 颜色、圆角、阴影、字号、间距**只能**来自 `design-system/tokens.ts`
  （直接引用或经 DS 组件）。
- **禁止裸 hex**。历史存量清单见 Phase 3 任务书 G1，迁移清零。
- hover / focus 效果用 CSS（stylesheet 或 DS 组件内样式），
  禁止 JS onMouseEnter 改 inline style。
- 扫码反馈（拣货 / 打包 / 收货 / 拦截工作台）一律用 DS `ScanFeedback`，
  禁止手拼反馈色块。
- 工作台大字号（binCode 40 等）属于工作台特例，但颜色仍用 token；
  后续如有第 3 个工作台，把大字号档位收入 tokens。

---

# 11. 术语与文案表

| 概念 | 统一用语 | 禁止 |
| --- | --- | --- |
| 内部商品分类 | 分类 | 类目（内部场景）；平台 OZON 场景保留"类目" |
| 创建实体 | 新建商品 / 新建SKU / 新建供应商 / 新建映射 | 新增XX |
| 打开详情 | 查看详情 | 查看、详情、打开完整详情、查看完整订单 |
| ACTIVE/INACTIVE | 启用 / 停用 | 正常 / 禁用 / Disable |
| 空值 | — | - |
| Reservation（面向用户） | 库存占用 | 英文直出 |
| On Hand / Reserved 等库存术语 | 按现有英文术语表统一（On Hand、可售、已占用、已拣货） | 同义中英混排 |

- 同一字段的中文名在表格列头、右栏、抽屉、筛选 placeholder 中必须一致。

---

# 12. 仓库作业工作台（focus mode）

- 适用路由：`/picking/:id`、`/packages/:id`（打包）。
  `/shipments/:id` 为管理型详情页，不进 focus mode，但必须有 PageHeader 返回。
- focus mode：左侧导航收窄为图标、无右栏；工作台自带的侧栏信息面板
  复用 `ContextSection / ContextMetric`。
- 工作台结构统一：顶部状态条（单号 + Progress + StatusBadge + 主按钮）→
  聚焦卡（库位 / SKU 大字）→ 扫码槽（ScanFeedback）→ 明细列表 → 右侧信息栏。
- 主按钮语义：开始=primary；完成/封箱=primary（终态推进是主操作，
  禁止 primary/default 倒置）；标记失败=danger。
- 完成类 / 封箱类按钮为 L1 确认（Popconfirm）。
- 页面内跳转用 react-router `Link`/`navigate`，禁止 `window.location.href`
  与 `<a href="#/...">`。

---

# 13. 可访问性

- 图标按钮必须有 `aria-label` 或 Tooltip。
- 筛选输入必须有 `aria-label`。
- 可点击的自定义块（MetricCard、待办行）用 button 语义或 role="button" +
  keyboard handler（现有 ContextMetric 已示范）。
- 状态不允许仅用颜色区分（StatusBadge 文本 + 点已满足，勿退化为纯色块）。

---

# 14. Design System 组件契约总表

现有（`design-system/index.ts`）：

| 组件 | 用途 | 规范章节 |
| --- | --- | --- |
| PageHeader | 页头 + 动作 | §2 §3 |
| FilterBar | 筛选栏 + actions 槽 | §6 |
| DataTable | 统一表格（密度/空态） | §2 §4 |
| SectionCard | 卡片容器 | §2 |
| MetricCard | KPI 卡 | §2 |
| ActionMenu | 子表行操作聚合 | §4.5 |
| ContextRail 系列 | 右栏（ContextSection/Metric/Action + useContextRail） | §4 |
| EntitySummary | 右栏头部 | §4.2 |
| StatusBadge + META 表 | 唯一状态渲染 | §5.1 |
| SyncStatusBadge | 同步任务状态 | §5.1 |
| RiskIndicator | 风险等级 | §4.2 |
| EntityLink | 右栏/抽屉内深链 | §4.2 |
| InfoGrid | 详情字段网格（唯一） | §8.4 |
| DeleteConfirmModal | 删除唯一确认 | §7 |
| EmptyState / ErrorState | 空态 / 错误态 | §2 |
| ScanFeedback | 扫码反馈 | §10 §12 |
| RelativeTime | 列表时间 | §9 |
| PlatformTag | 平台标识 | §4.2 |
| CommandPalette | 全局搜索 | — |

Phase 3 新增（契约见任务书 T1）：

| 组件 | 用途 | 规范章节 |
| --- | --- | --- |
| StatusSwitch | 启用/停用切换（右栏唯一入口） | §5.2 |
| FilterChips | 互斥标签组二级筛选 | §6.4 |
| KpiRow | MetricCard 标准网格行 | §2 |
| RailHint | 右栏空闲态提示文案 | §4.2 |
| RawDataBlock | 原始报文 pre 块 | §8.4 |
| TimeRangeFilter | 时间类型 + 区间连体控件（列表筛选唯一实现） | §6.5 |

---

## 变更记录

- V1（2026-09-16）：首次制定。基于 2026-09-16 全量 31 页面 UI 审计
  （Phase 3 任务书附录），收编 Phase 1/2 既有条款并收紧跨页一致性。
