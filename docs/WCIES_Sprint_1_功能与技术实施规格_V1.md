# WCIES 跨境电商综合管理系统
## Sprint 1 功能与技术实施规格 V1

---

# 1. Sprint 1 目标

Sprint 1 的目标：

> 建立 WCIES 的商品主数据、平台店铺主数据、仓库主数据及平台商品映射体系。

本阶段完成后，系统必须能够真实录入并维护：

- Product / SPU
- SKU
- SKU Barcode
- SKU Image
- Brand
- Category
- Platform
- Store
- Store Credential 基础信息
- Warehouse
- Warehouse Bin
- Store Warehouse Binding
- Platform Listing
- Platform Listing SKU Mapping

Sprint 1 是库存系统正式开发前的：

**Master Data Foundation / 主数据基础层。**

---

# 2. Sprint 1 不开发的范围

本阶段明确不做：

- 实时库存余额
- 库存 Reservation
- 库存流水
- 采购入库
- 扫码入库
- 拣货
- 出库
- 订单同步
- OZON真实订单API
- 平台库存推送
- 财务
- 物流
- 退货
- SN实际库存生命周期

可以预留字段：

但不实现完整业务。

---

# 3. Sprint 1 核心业务链路

本阶段最终要跑通：

```text
Platform
   ↓
Store
   ↓
Store Warehouse Binding

Product
   ↓
SKU
   ├─ Barcode
   ├─ Image
   └─ Platform Listing SKU
             ↓
       Platform Listing
             ↓
            Store

Warehouse
   ↓
Warehouse Bin
```

最终可以回答：

> 这是什么商品？

> 它有哪些 SKU？

> SKU 有哪些条码？

> 图片是什么？

> SKU 在 OZON/WB/Yandex 哪些店铺存在？

> 对应哪些商品链接？

> 平台 SKU / Offer ID 是什么？

> 哪些店铺使用深圳仓？

> 哪些店铺对应哪些平台仓？

> 深圳仓有哪些货架/库位？

---

# 4. Sprint 1 模块范围

建议实现以下 NestJS 模块：

```text
ProductModule

CatalogModule
或：
BrandModule
CategoryModule

PlatformModule

StoreModule

WarehouseModule

ListingModule

ImportModule（基础版）
```

其中 SKU 继续属于：

```text
ProductModule
```

第一阶段不必单独建立：

SkuModule。

---

# 5. Product 数据模型

表：

```text
products
```

代表 SPU / 商品主体。

建议字段：

```text
id UUID PK

product_code VARCHAR(100) UNIQUE NOT NULL

name_zh VARCHAR(500) NOT NULL

name_ru VARCHAR(500) NULL

category_id UUID NULL

brand_id UUID NULL

main_image_id UUID NULL

status VARCHAR(30) NOT NULL

remark TEXT NULL

created_at TIMESTAMPTZ NOT NULL

updated_at TIMESTAMPTZ NOT NULL

created_by UUID NULL

updated_by UUID NULL
```

---

# 6. Product Code

Product Code 是：

**公司内部商品编号**

与数据库 UUID 分离。

例如：

```text
PRD000001
```

或者未来人工定义：

```text
VALKYRIE-VK87
```

Sprint 1 推荐：

系统自动生成默认编码。

允许管理员修改业务编码。

但：

UUID 永远不改变。

---

# 7. Product Status

建议：

```text
DRAFT

ACTIVE

INACTIVE
```

含义：

### DRAFT

资料尚未完整。

### ACTIVE

正常使用。

### INACTIVE

停用，不再新建业务关联。

禁止物理删除已经存在 SKU / Listing / 历史业务关系的 Product。

---

# 8. Brand

表：

```text
brands
```

字段：

```text
id UUID PK

code VARCHAR(100) UNIQUE

name_zh VARCHAR(200) NOT NULL

name_en VARCHAR(200) NULL

name_ru VARCHAR(200) NULL

status VARCHAR(30) NOT NULL

created_at

updated_at
```

例如：

```text
VALKYRIE

iKF
```

---

# 9. Category

Sprint 1 暂时采用简单树结构。

表：

```text
categories
```

字段：

```text
id UUID PK

parent_id UUID NULL

code VARCHAR(100) UNIQUE

name_zh VARCHAR(200) NOT NULL

name_ru VARCHAR(200) NULL

sort_order INTEGER DEFAULT 0

status VARCHAR(30)

created_at

updated_at
```

支持：

```text
3C
 ├─ 键盘
 ├─ 鼠标
 └─ 耳机
```

暂时不做：

复杂平台类目映射。

平台 Category Mapping 留给 Listing / 刊登阶段。

---

# 10. SKU 数据模型

表：

```text
skus
```

建议字段：

```text
id UUID PK

product_id UUID NOT NULL

sku_code VARCHAR(100) UNIQUE NOT NULL

name_zh VARCHAR(500) NOT NULL

name_ru VARCHAR(500) NULL

model VARCHAR(200) NULL

color VARCHAR(100) NULL

size VARCHAR(100) NULL

weight_kg NUMERIC(12,4) NULL

length_cm NUMERIC(12,3) NULL

width_cm NUMERIC(12,3) NULL

height_cm NUMERIC(12,3) NULL

volume_cm3 NUMERIC(18,3) NULL

latest_purchase_price NUMERIC(18,4) NULL

moving_average_cost NUMERIC(18,4) NULL

cost_currency VARCHAR(10) DEFAULT 'CNY'

serial_tracking BOOLEAN NOT NULL DEFAULT FALSE

status VARCHAR(30) NOT NULL

remark TEXT NULL

created_at

updated_at
```

---

# 11. SKU Code

由于当前公司没有统一内部 SKU 编码：

Sprint 1 必须提供：

**自动生成内部 SKU Code**

建议初始格式：

```text
SKU000001
SKU000002
SKU000003
```

未来允许人工改成：

```text
VK87MAX-BLK
```

约束：

```text
sku_code 全系统唯一
```

---

# 12. SKU与Product关系

关系：

```text
Product
1
↓
N
SKU
```

一个 Product：

可以没有 SKU，但 DRAFT。

ACTIVE Product：

建议至少存在1个ACTIVE SKU。

---

# 13. SKU物理属性

必须保存：

```text
weight

length

width

height
```

体积：

推荐：

由系统自动计算：

```text
volume_cm3 =
length × width × height
```

不建议用户手填体积后又与长宽高不一致。

可：

数据库不永久保存 volume，

也可保存并由后端统一更新。

建议 Sprint 1：

**数据库保存 volume_cm3，但只允许后端计算。**

前端只读。

---

# 14. SKU重量

Sprint 1 保存：

```text
标准重量
```

以后采购入库：

可以记录：

```text
实际单件重量
```

两者不同。

不要用采购实测重量直接覆盖标准重量。

后续可人工选择：

更新 SKU 标准重量。

---

# 15. SKU成本字段

Sprint 1 暂时允许：

```text
latest_purchase_price
```

人工维护。

```text
moving_average_cost
```

字段存在，但暂时：

只读 / 空值。

真正移动加权平均：

Sprint 采购入库阶段实现。

---

# 16. serial_tracking

字段：

```text
serial_tracking BOOLEAN
```

表示：

该 SKU 是否需要单件序列号管理。

Sprint 1：

只提供配置。

不建立真实库存 SN。

Sprint 库存入库阶段：

再实际创建：

```text
inventory_serials
```

---

# 17. SKU Barcode

表：

```text
sku_barcodes
```

字段：

```text
id UUID PK

sku_id UUID NOT NULL

barcode VARCHAR(255) NOT NULL

barcode_type VARCHAR(30) NOT NULL

is_primary BOOLEAN DEFAULT FALSE

status VARCHAR(30)

created_at
```

---

# 18. Barcode Type

建议：

```text
EAN

GTIN

MANUFACTURER

INTERNAL

OTHER
```

其中现有的：

69码

通常可以归类：

```text
EAN / GTIN
```

无需建立一个：

```text
CN_69_CODE
```

专门业务类型。

前端可显示：

“69码/EAN”。

---

# 19. 条码唯一性

Sprint 1建议：

```text
barcode
```

全系统唯一。

即：

一个条码不能映射两个内部 SKU。

如果导入时发现：

```text
697XXXX
```

已经绑定 SKU-A，

再次尝试绑定 SKU-B：

必须报：

```text
PRODUCT_BARCODE_ALREADY_EXISTS
```

---

# 20. 主条码

一个 SKU 可以有：

多个 Barcode。

但最多：

```text
1个 is_primary = true
```

建议通过数据库：

Partial Unique Index

约束。

---

# 21. Internal Barcode

如果 SKU 没有可用条码：

支持生成：

```text
INTERNAL
```

类型条码。

例如：

```text
WCSKU00000001
```

Sprint 1只需要：

生成 + 查看。

实际打印：

可以在 Sprint Warehouse 中完成。

如果开发成本低：

Sprint 1 可以提前增加简单：

Barcode Label Preview。

---

# 22. SKU Image

表：

```text
sku_images
```

字段：

```text
id UUID PK

sku_id UUID NOT NULL

object_key TEXT NOT NULL

mime_type VARCHAR(100)

file_size BIGINT

width INTEGER NULL

height INTEGER NULL

sort_order INTEGER DEFAULT 0

is_primary BOOLEAN DEFAULT FALSE

created_at
```

---

# 23. 图片存储

图片实际文件：

存 Object Storage。

例如：

```text
products/{productId}/skus/{skuId}/{uuid}.webp
```

数据库：

不存：

Base64

不存：

本地Windows路径。

---

# 24. SKU图片规则

一个 SKU：

可以上传多张图片。

最多一张：

```text
is_primary = true
```

Product 主图：

可以：

- 独立上传
- 或引用SKU图片

Sprint 1建议：

**Product main image 独立字段引用文件资源。**

以后更灵活。

---

# 25. Platform

表：

```text
platforms
```

Sprint 1 Seed：

```text
OZON
WB
YANDEX
```

字段：

```text
id UUID

code

name

status
```

平台不是普通用户随意创建的数据。

建议：

只有系统管理员：

可新增平台。

---

# 26. Store

表：

```text
stores
```

字段：

```text
id UUID PK

platform_id UUID NOT NULL

store_code VARCHAR(100) NOT NULL

name VARCHAR(200) NOT NULL

seller_id VARCHAR(255) NULL

default_currency VARCHAR(10) NULL

status VARCHAR(30)

settings JSONB NULL

created_at

updated_at
```

唯一：

```text
platform_id + store_code
```

---

# 27. Sprint 1真实店铺初始化

系统应支持录入当前：

```text
OZON × 8

WB × 1

Yandex × 2
```

合计：

11 Store。

不要求 Sprint 1 接真实 API。

但 Store 主数据必须先建立。

---

# 28. Store Credential

建议 Sprint 1 就建立：

```text
platform_credentials
```

但只完成：

- 创建
- 加密保存
- 更新
- 停用

不完成真实平台验证。

字段：

```text
id UUID

store_id UUID NOT NULL

credential_type VARCHAR(50)

encrypted_payload TEXT

status VARCHAR(30)

created_at

updated_at
```

---

# 29. Credential Type

先允许：

```text
MAIN_API
```

未来：

```text
ADS_API
FINANCE_API
WEBHOOK
OTHER
```

---

# 30. Credential API

前端创建：

发送：

```json
{
  "credentialType": "MAIN_API",
  "payload": {
    "...": "..."
  }
}
```

后端：

加密。

数据库：

只保存密文。

读取详情时：

前端不能获得原始 Secret。

只能显示：

```text
已配置
最后更新时间
状态
```

---

# 31. Warehouse

表：

```text
warehouses
```

字段：

```text
id UUID PK

warehouse_code VARCHAR(100) UNIQUE

name VARCHAR(200) NOT NULL

warehouse_type VARCHAR(30) NOT NULL

country_code VARCHAR(10)

province VARCHAR(100)

city VARCHAR(100)

address TEXT

contact_name VARCHAR(100)

contact_phone VARCHAR(100)

status VARCHAR(30)

remark TEXT

created_at

updated_at
```

---

# 32. Warehouse Type

已确定：

```text
SELF

PLATFORM

THIRD_PARTY

RETURN_TEMP
```

Sprint 1：

不建立 Virtual Warehouse。

以后 Warehouse Group 单独实现。

---

# 33. 当前仓库示例

可以录入：

```text
深圳自管仓
type = SELF
```

俄罗斯第三方仓：

```text
Amol
type = THIRD_PARTY
```

平台仓：

```text
OZON FBO ...
type = PLATFORM
```

---

# 34. 仓库删除规则

仓库支持：

- Create
- Read
- Update
- Disable

不建议真实 DELETE。

即使 Sprint 1 尚无库存业务：

数据模型从第一天就按照：

逻辑停用。

---

# 35. Warehouse Bin

表：

```text
warehouse_bins
```

字段：

```text
id UUID PK

warehouse_id UUID NOT NULL

bin_code VARCHAR(100) NOT NULL

zone VARCHAR(100) NULL

rack VARCHAR(100) NULL

level VARCHAR(100) NULL

position VARCHAR(100) NULL

barcode VARCHAR(255) NULL

status VARCHAR(30)

remark TEXT

created_at

updated_at
```

唯一：

```text
warehouse_id + bin_code
```

---

# 36. 自管仓库位

深圳仓当前：

约5组货架。

Sprint 1必须可以建立：

```text
A01
A02
A03
A04
A05
```

也可以更细：

```text
SZ01-A01-L01
SZ01-A01-L02
```

---

# 37. 库位编码

建议系统支持：

自动生成

和：

人工填写。

例如：

```text
SZ01-A01-01
```

系统内部：

UUID。

业务操作：

bin_code。

---

# 38. 库位Barcode

Sprint 1建议：

每个 Bin 自动拥有：

```text
barcode
```

例如：

```text
BIN-SZ01-A01-01
```

实际打印功能：

可在 Sprint 1 做简单版本。

因为它与仓库后续扫码关系非常大。

---

# 39. Warehouse Bin适用范围

Platform Warehouse：

不一定需要实体 Bin。

因此：

```text
Warehouse
```

可以：

0..N Bin。

自管仓：

建议强制至少建立库位后再进入正式库存业务。

---

# 40. Store Warehouse Binding

表：

```text
store_warehouse_bindings
```

这是 Sprint 1 非常重要的一张表。

字段：

```text
id UUID PK

store_id UUID NOT NULL

warehouse_id UUID NOT NULL

fulfillment_mode VARCHAR(50) NOT NULL

platform_warehouse_id VARCHAR(255) NULL

is_inventory_source BOOLEAN DEFAULT TRUE

is_inventory_push_enabled BOOLEAN DEFAULT FALSE

priority INTEGER DEFAULT 100

settings JSONB NULL

status VARCHAR(30)

created_at

updated_at
```

---

# 41. Fulfillment Mode

不能全系统写死单一枚举。

但第一阶段建立规范值：

```text
OZON_RFBS
OZON_FBS
OZON_FBO
OZON_FBP

WB_FBS
WB_FBW

YANDEX_FBS
YANDEX_FBY
```

数据库：

推荐 VARCHAR。

业务层：

定义 Typed Constant / Enum。

---

# 42. Binding示例

例如：

```text
OZON Store A

RFBS

→ 深圳仓
```

数据：

```text
store = Ozon A
warehouse = 深圳
fulfillment = OZON_RFBS
```

---

另一条：

```text
OZON Store A

FBO

→ OZON FBO仓
```

---

# 43. 一个仓库多店共享

系统必须允许：

```text
深圳仓
```

被：

11个Store中的多个同时绑定。

因此：

不得：

```text
warehouse.store_id
```

直接放在Warehouse表。

必须使用：

多对多 Binding。

---

# 44. Listing

表：

```text
platform_listings
```

代表：

一个平台商品页面/商品主体。

字段：

```text
id UUID PK

platform_id UUID NOT NULL

store_id UUID NOT NULL

platform_product_id VARCHAR(255) NOT NULL

title TEXT NULL

url TEXT NULL

status VARCHAR(30)

raw_data JSONB NULL

created_at

updated_at
```

唯一：

```text
store_id
+
platform_product_id
```

---

# 45. Platform Listing SKU

建立：

```text
platform_listing_skus
```

字段：

```text
id UUID PK

listing_id UUID NOT NULL

sku_id UUID NOT NULL

platform_sku_id VARCHAR(255) NULL

seller_sku VARCHAR(255) NULL

offer_id VARCHAR(255) NULL

status VARCHAR(30)

raw_data JSONB NULL

created_at

updated_at
```

---

# 46. Listing映射原则

必须支持：

```text
一个 Internal SKU
↓
多个 Listing SKU
```

包括：

```text
同平台
同店铺
多个商品链接
```

这是当前业务明确要求。

因此禁止：

```text
UNIQUE(sku_id, store_id)
```

---

# 47. 平台SKU身份唯一性

建议根据平台实际字段：

建立业务查询索引。

通用规则：

同一个Store内：

```text
platform_sku_id
```

如果存在：

应尽量唯一。

同一个Store内：

```text
offer_id
```

如果平台定义唯一：

应设置唯一约束。

但由于各平台语义不同：

Sprint 1不要在统一表中过度假设。

推荐：

Service层：

按 Platform Adapter Contract 定义。

数据库先建立普通索引。

真正接 OZON 时：

再增加经验证的唯一约束。

---

# 48. Listing手动映射

Sprint 1必须支持：

**人工建立 Listing / SKU 映射。**

例如：

选择：

```text
OZON

店铺 A
```

录入：

```text
Platform Product ID

Platform SKU ID

Offer ID

商品URL

标题
```

然后：

选择内部 SKU。

---

# 49. 一Listing多SKU

一个Listing可以：

包含多个：

```text
Platform Listing SKU
```

例如一个商品页面：

黑色

蓝色

白色

分别映射：

内部不同 SKU。

因此：

```text
PlatformListing
1
↓
N
PlatformListingSku
```

---

# 50. 同内部SKU多Listing

同时：

```text
Internal SKU
1
↓
N
PlatformListingSku
```

因此 ListingSku 实际承担：

**多对多桥梁的一侧。**

---

# 51. Bundle预留

Sprint 1建议创建：

```text
sku_bundle_components
```

表。

但 UI 可暂不开放。

字段：

```text
bundle_sku_id

component_sku_id

quantity
```

原因：

已经确认未来可能存在组合商品。

提前建模成本很低。

---

# 52. Bundle规则

禁止：

```text
bundle_sku = component_sku
```

禁止：

```text
quantity <= 0
```

Sprint 1暂时不做：

递归Bundle。

即：

一个Bundle组件：

不允许继续是Bundle。

第一阶段保持简单。

---

# 53. Product API

建议：

```text
GET    /api/v1/products

POST   /api/v1/products

GET    /api/v1/products/:id

PATCH  /api/v1/products/:id

POST   /api/v1/products/:id/activate

POST   /api/v1/products/:id/deactivate
```

不推荐提供：

```text
DELETE /products/:id
```

---

# 54. Product List API

支持：

```text
page

pageSize

keyword

brandId

categoryId

status

createdFrom

createdTo

sort
```

搜索：

至少匹配：

```text
product_code
name_zh
name_ru
```

---

# 55. SKU API

```text
GET    /api/v1/skus

POST   /api/v1/skus

GET    /api/v1/skus/:id

PATCH  /api/v1/skus/:id

POST   /api/v1/skus/:id/activate

POST   /api/v1/skus/:id/deactivate
```

---

# 56. SKU List筛选

至少：

```text
keyword

productId

brandId

categoryId

status

serialTracking

hasListing

platformId

storeId
```

---

# 57. Barcode API

```text
GET    /api/v1/skus/:skuId/barcodes

POST   /api/v1/skus/:skuId/barcodes

PATCH  /api/v1/skus/:skuId/barcodes/:barcodeId

DELETE /api/v1/skus/:skuId/barcodes/:barcodeId
```

Barcode因为尚未产生业务记录：

Sprint 1可以允许删除。

但后续已经出现扫码/历史业务：

需要改成停用。

---

# 58. 图片 API

```text
POST /api/v1/skus/:skuId/images

GET  /api/v1/skus/:skuId/images

PATCH /api/v1/skus/:skuId/images/:id

DELETE /api/v1/skus/:skuId/images/:id
```

上传：

multipart/form-data。

实际：

ObjectStorageService。

---

# 59. Platform API

```text
GET /api/v1/platforms

GET /api/v1/platforms/:id
```

Sprint 1平台初始化以后：

普通用户不需要Create。

管理员未来可开放。

---

# 60. Store API

```text
GET    /api/v1/stores

POST   /api/v1/stores

GET    /api/v1/stores/:id

PATCH  /api/v1/stores/:id

POST   /api/v1/stores/:id/activate

POST   /api/v1/stores/:id/deactivate
```

---

# 61. Credential API

```text
GET
/api/v1/stores/:storeId/credentials

POST
/api/v1/stores/:storeId/credentials

PATCH
/api/v1/stores/:storeId/credentials/:id

POST
/api/v1/stores/:storeId/credentials/:id/disable
```

GET结果：

不返回密文。

只返回：

```text
id
type
status
configured
updatedAt
```

---

# 62. Warehouse API

```text
GET    /api/v1/warehouses

POST   /api/v1/warehouses

GET    /api/v1/warehouses/:id

PATCH  /api/v1/warehouses/:id

POST   /api/v1/warehouses/:id/activate

POST   /api/v1/warehouses/:id/deactivate
```

---

# 63. Bin API

```text
GET
/api/v1/warehouses/:warehouseId/bins

POST
/api/v1/warehouses/:warehouseId/bins

PATCH
/api/v1/warehouses/:warehouseId/bins/:binId

POST
/api/v1/warehouses/:warehouseId/bins/:binId/disable
```

---

# 64. Binding API

```text
GET
/api/v1/stores/:storeId/warehouse-bindings

POST
/api/v1/stores/:storeId/warehouse-bindings

PATCH
/api/v1/stores/:storeId/warehouse-bindings/:id

POST
/api/v1/stores/:storeId/warehouse-bindings/:id/disable
```

---

# 65. Listing API

```text
GET    /api/v1/listings

POST   /api/v1/listings

GET    /api/v1/listings/:id

PATCH  /api/v1/listings/:id

POST   /api/v1/listings/:id/activate

POST   /api/v1/listings/:id/deactivate
```

---

# 66. Listing SKU Mapping API

```text
POST
/api/v1/listings/:listingId/skus

PATCH
/api/v1/listings/:listingId/skus/:id

DELETE
/api/v1/listings/:listingId/skus/:id
```

Sprint 1可以允许删除：

未产生订单业务的映射。

后续订单存在后：

应改成停用并保留历史。

---

# 67. Sprint 1页面结构

左侧导航第一阶段：

```text
首页

商品
 ├─ 商品管理
 ├─ SKU管理
 └─ SKU映射

仓库
 ├─ 仓库管理
 └─ 库位管理

平台
 ├─ 店铺管理
 └─ 店仓绑定

系统
 └─ 导入中心
```

---

# 68. 商品管理页面

路径：

```text
/products
```

表格建议字段：

```text
商品编号

商品名称

品牌

分类

SKU数量

状态

更新时间

操作
```

---

# 69. 商品详情

路径：

```text
/products/:id
```

展示：

### 基础信息

- 商品编号
- 中文名称
- 俄文名称
- 品牌
- 分类
- 主图
- 状态

### SKU列表

- SKU Code
- SKU名称
- 型号
- 颜色
- 尺寸
- 条码
- Serial Tracking
- 状态

---

# 70. SKU管理

路径：

```text
/skus
```

这是运营和仓库以后非常高频的页面。

建议列：

```text
图片

SKU Code

中文名称

Product

型号

颜色

尺寸

主条码

重量

最新采购价

SN管理

Listing数量

状态
```

---

# 71. SKU Detail Drawer

建议：

点击 SKU：

使用：

```text
Drawer
```

而不是每次跳详情页。

内部Tabs：

```text
基本信息

条码

图片

平台映射

未来：库存

未来：采购

未来：订单
```

这样以后非常适合ERP工作流。

---

# 72. SKU映射页面

路径：

```text
/listings
```

支持：

按：

```text
平台
店铺
SKU
映射状态
Listing状态
```

筛选。

---

# 73. 映射页面展示

建议每行：

```text
平台

店铺

Platform Product ID

标题

平台SKU

Offer ID

内部SKU

状态

URL

操作
```

同一个 Listing多个SKU：

允许：

展开子行。

---

# 74. 未映射视图

虽然“本地SKU未映射平台”不是异常：

但需要提供快速筛选：

```text
未映射SKU
```

供运营查看。

同时：

```text
平台Listing SKU
无法找到Internal SKU
```

可以单独显示：

```text
待映射
```

未来订单进入时：

才作为严重异常。

---

# 75. 仓库管理页

路径：

```text
/warehouses
```

列：

```text
仓库编码

仓库名称

类型

国家

城市

库位数量

绑定店铺数量

状态
```

---

# 76. 仓库详情

展示：

### 基础资料

### 库位

### 店铺绑定

未来增加：

### 库存

### 调拨

### 盘点

---

# 77. 库位管理页

对于深圳仓：

支持：

Table或简单货架列表。

字段：

```text
Bin Code

Zone

Rack

Level

Position

Barcode

状态
```

---

# 78. 批量创建库位

Sprint 1建议增加：

**批量创建**

例如：

```text
仓库：深圳仓

Rack：
A01-A05

Level：
01-04
```

自动产生：

```text
SZ01-A01-01
SZ01-A01-02
...
```

这比一个一个创建实用很多。

---

# 79. 库位二维码/条码预览

Sprint 1如果开发量可控：

支持：

```text
打印库位标签
```

至少：

- Bin Code
- Barcode
- QR Code

以后仓库扫码直接复用。

---

# 80. 店铺管理页

路径：

```text
/stores
```

按平台分组：

```text
OZON

WB

Yandex
```

展示：

```text
店铺名称

Seller ID

币种

Credential状态

绑定仓数量

状态
```

---

# 81. 店铺详情Drawer

Tabs：

```text
基本资料

API凭证

仓库绑定

未来：同步状态

未来：库存规则
```

---

# 82. 店仓绑定UI

例如：

```text
店铺：
OZON-A

履约：
OZON_RFBS

ERP Warehouse：
深圳仓

Platform Warehouse ID：
123456

Inventory Source：
Yes

Inventory Push：
Yes
```

---

# 83. Binding校验

后端至少校验：

### Platform匹配

不能：

```text
WB Store
+
OZON_FBO
```

### Warehouse Type

例如：

```text
OZON_RFBS
```

通常应绑定：

```text
SELF
```

但不要在数据库写死。

使用：

Service Validation。

---

# 84. Listing创建UI

建议：

一个页面支持：

### 基础Listing

```text
平台
店铺
Platform Product ID
Title
URL
```

### SKU Variants

可以追加多行：

```text
Platform SKU ID
Seller SKU
Offer ID
Internal SKU
```

一次提交。

---

# 85. 批量导入

Sprint 1必须加入基础：

**Excel Import Center**

至少支持：

```text
Product

SKU

Barcode

Warehouse

Bin

Listing Mapping
```

---

# 86. 导入流程

```text
上传Excel
↓
保存Object Storage
↓
创建ImportJob
↓
解析
↓
字段映射
↓
校验
↓
预览
↓
确认
↓
导入
```

如果 Sprint 1 工作量需要控制：

可以分两阶段：

### 1A

固定模板导入。

### 1B

通用字段映射。

建议 Sprint 1：

先做 **固定模板 + 错误报告**。

通用Mapper可放 Sprint 1.5。

---

# 87. SKU导入模板

例如：

| sku_code | product_code | name_zh | model | color | size | barcode | weight_kg | latest_purchase_price |
|---|---|---|---|---|---|---|---:|---:|

允许：

`sku_code`

为空：

系统自动生成。

---

# 88. Listing Mapping模板

例如：

| platform | store_code | platform_product_id | platform_sku_id | offer_id | internal_sku_code | title | url |
|---|---|---|---|---|---|---|---|

这是你们历史数据迁移非常重要的一部分。

---

# 89. 导入错误

错误必须具体到：

```text
Excel Row 18

internal_sku_code = VK87-BLU

ERROR:
SKU_NOT_FOUND
```

不能只提示：

```text
Import failed
```

---

# 90. Operation Log

Sprint 1所有重要主数据修改：

写：

```text
operation_logs
```

至少：

- Product修改
- SKU修改
- Barcode修改
- Store修改
- Credential修改
- Warehouse修改
- Listing映射修改

Credential日志：

不得保存原始密钥内容。

---

# 91. 搜索

Sprint 1建议统一后端：

```text
keyword
```

简单模糊搜索。

暂不需要：

Elasticsearch。

PostgreSQL：

```text
ILIKE
```

足够当前规模。

---

# 92. 分页

所有主要列表：

默认：

```text
pageSize = 50
```

支持：

```text
20
50
100
```

不要前端一次：

加载全部SKU。

---

# 93. 排序

API规范：

例如：

```text
sortBy=updatedAt
sortOrder=desc
```

只允许白名单字段。

不能直接把用户输入拼 SQL。

---

# 94. Product Module目录

建议：

```text
product/
├── product.module.ts
├── controllers/
│   ├── product.controller.ts
│   └── sku.controller.ts
├── services/
│   ├── product.service.ts
│   ├── sku.service.ts
│   ├── barcode.service.ts
│   └── sku-image.service.ts
├── repositories/
├── entities/
├── dto/
├── errors/
├── mappers/
└── tests/
```

---

# 95. Warehouse Module目录

```text
warehouse/
├── warehouse.module.ts
├── controllers/
│   ├── warehouse.controller.ts
│   └── warehouse-bin.controller.ts
├── services/
│   ├── warehouse.service.ts
│   ├── warehouse-bin.service.ts
│   └── store-warehouse-binding.service.ts
├── entities/
├── repositories/
├── dto/
└── tests/
```

---

# 96. Store / Platform目录

建议：

```text
platform/
```

负责：

Platform。

```text
store/
```

负责：

Store

Credential。

店仓绑定：

建议属于：

Warehouse模块。

因为它定义仓库使用关系。

---

# 97. Listing Module

单独：

```text
listing/
```

因为未来：

商品刊登

平台同步

订单映射

都会依赖它。

结构：

```text
listing/
├── listing.module.ts
├── controllers/
├── services/
│   ├── listing.service.ts
│   └── listing-mapping.service.ts
├── repositories/
├── entities/
└── dto/
```

---

# 98. Listing Resolver

Sprint 1必须实现核心：

```text
ListingResolverService
```

提供：

```text
resolveInternalSku(
  storeId,
  platformSkuId,
  sellerSku,
  offerId
)
```

现在可以用于：

映射测试。

下一阶段订单同步直接复用。

---

# 99. Resolver原则

解析必须：

**Store Scoped**

例如：

```text
OZON-A offer_id = ABC

OZON-B offer_id = ABC
```

可以映射两个不同对象。

禁止全局：

```text
WHERE offer_id = ABC
```

直接解析。

---

# 100. Sprint 1 Migration建议顺序

```text
001_create_platforms

002_create_stores

003_create_credentials

004_create_brands_categories

005_create_products

006_create_skus

007_create_sku_barcodes

008_create_sku_images

009_create_warehouses

010_create_warehouse_bins

011_create_store_warehouse_bindings

012_create_platform_listings

013_create_platform_listing_skus

014_create_bundle_components

015_add_master_data_indexes
```

---

# 101. 核心索引

必须：

```text
products.product_code

skus.sku_code

sku_barcodes.barcode

stores(platform_id, store_code)

warehouses.warehouse_code

warehouse_bins(warehouse_id, bin_code)

platform_listings(store_id, platform_product_id)

platform_listing_skus.sku_id

platform_listing_skus.platform_sku_id

platform_listing_skus.offer_id
```

---

# 102. Sprint 1自动化测试

## Product

- 创建商品
- product_code重复拒绝
- 停用商品

## SKU

- 创建SKU
- 自动生成sku_code
- sku_code重复拒绝
- Product 1:N SKU

## Barcode

- 一个SKU多个条码
- 同条码不能绑定多个SKU
- 一个SKU最多一个Primary

---

# 103. Warehouse测试

- 创建仓库
- warehouse_code重复拒绝
- 一个仓多个Bin
- 同仓bin_code唯一
- 不同仓允许相同bin_code
- 停用仓库

---

# 104. Store测试

- 同Platform store_code唯一
- 不同Platform允许相同store_code
- Credential可以加密
- API返回不泄露密文

---

# 105. Binding测试

验证：

```text
Store
→
多个Warehouse
```

和：

```text
Warehouse
→
多个Store
```

均正常。

---

# 106. Listing测试

必须测试：

### Case A

一个SKU：

```text
OZON-A
Listing1

OZON-A
Listing2
```

都允许。

### Case B

同一个Listing：

多个SKU Variant。

### Case C

不同Store：

相同Offer ID。

Resolver不能串店。

---

# 107. Image测试

- 图片上传MinIO
- DB保存object key
- Signed URL读取
- 删除数据库记录后按规则处理Object
- 非图片拒绝

---

# 108. Import测试

至少：

```text
100条SKU
```

导入。

包括：

- 正常
- 重复sku_code
- 重复barcode
- product不存在

输出准确错误行。

---

# 109. E2E验收场景一：真实SKU

录入：

```text
VALKYRIE VK87 MAX V2
```

Product。

创建：

```text
黑色SKU
蓝色SKU
```

分别添加：

- 69码
- 图片
- 型号
- 重量
- 最新采购价

页面可以完整查看。

---

# 110. E2E验收场景二：11店

系统录入：

```text
8 OZON

1 WB

2 Yandex
```

每个Store：

可以配置：

- 平台
- Seller ID
- 币种
- Credential
- 状态

---

# 111. E2E验收场景三：深圳仓

创建：

```text
深圳自管仓
```

建立：

5组货架。

每组多个Bin。

可以：

- 搜索
- 编辑
- 查看Barcode

---

# 112. E2E验收场景四：店仓绑定

例如：

```text
OZON-A
RFBS
深圳仓
```

和：

```text
OZON-A
FBO
OZON平台仓
```

同时存在。

---

# 113. E2E验收场景五：多链接

选择：

```text
Internal SKU
VK87-BLK
```

创建：

```text
OZON-A Listing 1

OZON-A Listing 2

WB Listing 1
```

全部成功。

SKU详情：

显示：

3个平台映射记录。

---

# 114. Sprint 1性能目标

当前规模不需要极端优化。

基本目标：

### SKU列表

2000 SKU：

正常分页搜索。

### Listing

5000 Mapping：

分页正常。

### 页面

普通查询：

目标：

```text
< 500ms
```

服务端业务查询。

不把第三方API延迟算入。

---

# 115. Sprint 1数据权限

由于当前复杂权限暂不考虑：

管理员：

全部权限。

普通用户：

暂时也可以大部分可见。

但是：

Credential页面：

只允许管理员操作。

为以后RBAC预留：

```text
Permission Guard
```

---

# 116. Sprint 1错误码

至少增加：

```text
PRODUCT_NOT_FOUND

PRODUCT_CODE_ALREADY_EXISTS

SKU_NOT_FOUND

SKU_CODE_ALREADY_EXISTS

SKU_BARCODE_ALREADY_EXISTS

BRAND_NOT_FOUND

CATEGORY_NOT_FOUND

STORE_NOT_FOUND

STORE_CODE_ALREADY_EXISTS

WAREHOUSE_NOT_FOUND

WAREHOUSE_CODE_ALREADY_EXISTS

WAREHOUSE_BIN_ALREADY_EXISTS

STORE_WAREHOUSE_BINDING_INVALID

LISTING_NOT_FOUND

LISTING_ALREADY_EXISTS

LISTING_SKU_MAPPING_NOT_FOUND

LISTING_SKU_RESOLVE_FAILED

FILE_INVALID_TYPE

IMPORT_VALIDATION_FAILED
```

---

# 117. 业务删除原则

Sprint 1开始正式执行：

**主数据原则上停用，而不是删除。**

例如：

Product

SKU

Store

Warehouse

Listing

使用：

```text
ACTIVE
INACTIVE
```

真正 DELETE：

仅允许：

明显的：

- 尚未引用的Barcode
- 尚未引用的图片
- 错误创建且无任何关联的数据

并且以后可能进一步收紧。

---

# 118. Vibe Coding开发顺序

建议严格：

## S1-01 Platform + Store

先建立最基本组织上下文。

## S1-02 Brand + Category

## S1-03 Product

## S1-04 SKU

## S1-05 Barcode + Image

## S1-06 Warehouse

## S1-07 Warehouse Bin

## S1-08 Store Warehouse Binding

## S1-09 Listing

## S1-10 Listing SKU Mapping

## S1-11 Listing Resolver

## S1-12 Import

## S1-13 前端整合

## S1-14 E2E与真实数据录入

---

# 119. 每个Task要求

每一个 Vibe Coding Task 必须包括：

```text
Migration

Entity

Repository

Service

DTO

Controller/API

Swagger

Unit Test

必要的Integration Test

Frontend

Operation Log
```

不要先：

把全部数据库建好

然后：

一次性生成全部页面。

应该：

一个垂直功能一个垂直功能完成。

---

# 120. S1-01示例验收

Platform + Store：

完成后必须：

```text
GET /platforms
```

得到：

```text
OZON
WB
YANDEX
```

然后：

创建：

```text
OZON-A
```

并在Web看到。

这一步完成：

再进入 Product。

---

# 121. Sprint 1完成标准

Sprint 1全部完成以后：

WCIES必须可以真实录入：

### 公司商品

```text
Product
SKU
Barcode
图片
成本基础资料
```

### 仓库

```text
深圳仓
第三方仓
平台仓
库位
```

### 店铺

```text
11个真实Store
```

### 履约关系

```text
Store
+
Fulfillment
+
Warehouse
```

### 平台映射

```text
Internal SKU
↔
平台商品
↔
Store
```

并支持：

一个内部SKU：

对应多个平台、多个店铺和多个商品链接。

---

# 122. Sprint 1最终业务验收标准

管理员能够进入WCIES：

```text
创建 Product
↓
创建多个 SKU
↓
添加69码
↓
上传图片
↓
建立深圳仓
↓
建立货架
↓
建立OZON/WB/Yandex 11个店铺
↓
配置店仓履约关系
↓
录入平台商品
↓
把平台SKU映射至内部SKU
↓
通过SKU搜索看到全部平台映射
```

整个流程：

无需直接修改数据库。

所有操作：

通过正式 Web UI + API 完成。

---

# 123. Sprint 1结束后的系统能力

此时系统已经具备：

```text
统一商品库

统一内部SKU

统一条码体系

统一图片资产

统一Platform

统一Store

统一Warehouse

统一Bin

Store-Warehouse关系

统一Platform Listing

多平台SKU Mapping
```

因此 Sprint 2 可以正式进入：

# 库存核心引擎

包括：

```text
InventoryBalance

InventorySafetyStock

InventoryReservation

InventoryTransaction

InventorySerial

Available计算

并发锁

InventoryService

库存调整

初始化库存导入
```

Sprint 2 将是 WCIES 第一个真正涉及“绝对不能算错”的核心业务 Sprint。