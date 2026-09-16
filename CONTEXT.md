# WCIES 术语表（统一语言）

> 全项目中英对照术语表。代码、文档、界面文案统一使用本表词汇；冲突时以本表为准。
> 本表只放术语语义，不放字段名、表名或实现细节。

| 中文 | 英文 | 说明 |
|---|---|---|
| 库存占用 | Reservation | 订单占住库存但商品仍在货架 |
| 已拣货 | Picked | 商品已从库位取出 |
| 现存 | On Hand | 实际在库数量 |
| 可售 | Available | 推导值，非独立事实源 |
| 安全库存 | Safety Stock | 为防超卖而预留的最低库存 |
| 渠道库存 | Channel Inventory | 准备推送给平台的数量 |
| 内部 SKU | Internal SKU | 统一库存身份 |
| 平台 SKU | Platform SKU | 外部映射，不是主键 |
| 商品 | Product / SPU | 商品主数据，与 SKU 分离 |
| 商品链接 | Listing | 平台上的在售商品条目 |
| 映射 | Mapping（MAPPED / UNMAPPED） | 平台 SKU 与内部 SKU 的关联状态 |
| 类目树 / 三级分类 | Category Tree | 最多三级的商品分类层级 |
| 一般名称 | General Name | 品牌的主显示名 |
| 拦截 | Interception | Picked 订单取消后的追回流程 |
| 库位 | Bin | 仓库内的具体储位 |
| 单据占用号 | Reservation No | 库存占用关联的业务单据编号 |
| 供应商 | Supplier | 可复用的货源主数据（可空引用） |
| 货源说明 | Source Note | 一次性采购的来源备注，不进主数据 |
| 采购单 | Purchase Order | 采购意图登记（可取消，不碰库存） |
| 收货单 | Purchase Receipt | 收货入库的业务凭证（不可逆库存事实） |
| 发货时限 | Shipment Deadline | 平台要求的发货截止时间（平台事实，非 ERP 状态） |
| 待采购 | NOT_ORDERED | 订单行派生采购状态：尚未登记采购 |
| 移动加权平均成本 | Moving Average Cost | 收货确认时按数量加权更新的 SKU 平均成本 |
| 财务流水 | Finance Transaction | 追加型资金凭证（FV 编号）；不可修改，错账冲正 |
| 冲正 | Reversal | 方向相反的成对流水，两笔在汇总中净额为零 |
| 平台回款 | Payout | 平台打款批次（PY 编号）；确认后自动生成收入流水 |
| 订单结算 | Order Settlement | 已发货订单的收入/成本/毛利快照（成本冻结于生成时点） |
| 采购应付 | Payable | 派生值：采购单行金额 − 已付款流水（不落库） |
| 调拨 | Transfer | 仓库间库存移动（TRF 编号）；确认时单事务双段移库 |
| 补货建议 | Replenishment Suggestion | 销速/安全库存/在途采购推导的建议采购量（仅建议） |
