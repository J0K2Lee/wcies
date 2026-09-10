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
