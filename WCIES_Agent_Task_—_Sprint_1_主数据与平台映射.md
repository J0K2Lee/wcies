# WCIES Agent Task
## Sprint 1 — 商品主数据、店铺、仓库与 Listing Mapping

### 任务目标

在已经完成的 Sprint 0 工程基础上，实现 WCIES 第一批真实 ERP 业务功能：

```text
Product
SKU
Barcode
SKU Image

Platform
Store
Platform Credential

Warehouse
Warehouse Bin
Store Warehouse Binding

Platform Listing
Platform Listing SKU Mapping
Listing Resolver

Excel Import（固定模板基础版）
```

Sprint 1 完成后，系统必须能够真实录入并管理：

- 公司商品；
- 内部 SKU；
- 商品条码；
- SKU 图片；
- OZON / WB / Yandex 共 11 个店铺；
- 深圳自管仓及库位；
- 平台仓 / 第三方仓；
- 店铺与仓库的履约关系；
- 一个内部 SKU 对应多个平台、多个店铺、多个商品链接；
- 平台 SKU 到 Internal SKU 的可靠映射。

本 Sprint **不进入真实库存和订单业务**。

---

# 一、开始任务前

先执行：

```text
git status
```

确认工作区状态。

然后阅读：

```text
AGENTS.md
docs/architecture/*
docs/business-rules/inventory.md
docs/business-rules/orders.md
```

以及 Sprint 1 规格文档：

```text
docs/WCIES_Sprint_1_功能与技术实施规格_V1.md
```

如果实际文件名不同：

先查找对应 Sprint 1 规格。

已有正确实现：

必须保留。

不得重新初始化 Sprint 0 工程。

---

# 二、Sprint 0遗留项处理原则

Sprint 0已经验收通过。

因此本 Sprint 不重新设计：

- Monorepo
- NestJS基础设施
- Auth
- Redis
- BullMQ
- MinIO
- Logging
- Error Response
- OpenAPI生成链路
- CI

仅允许处理：

本 Sprint 开发过程中实际阻塞业务开发的问题。

例如：

`supertest` 当前未使用。

**不要为了“清理漂亮”专门扩大范围。**

如果顺手安全删除且确认无引用：

可单独提交。

否则保留。

---

# 三、硬性禁止范围

本 Sprint 禁止实现：

```text
InventoryBalance
InventoryReservation
InventoryTransaction
InventorySerial真实库存状态
Safety Stock
Allocator执行逻辑

Order同步
Webhook订单处理
OZON真实订单API
WB真实订单API
Yandex真实订单API

采购入库
拣货
出库
物流
退货
财务
平台库存推送
```

可以建立将来需要的主数据字段。

不得提前实现后续业务。

---

# 四、开发原则

必须严格遵守：

```text
AGENTS.md
```

尤其：

1. Controller不得直接访问Repository；
2. Entity不得作为API Response；
3. Schema修改必须有Migration；
4. Store Scoped数据必须带storeId；
5. Platform Credential与Store分离；
6. 一个Internal SKU允许多个Listing；
7. 禁止`UNIQUE(sku_id, store_id)`；
8. Listing Resolver必须Store Scoped；
9. 不得连接真实平台API；
10. 不得操作生产环境。

---

# 五、建议实施顺序

严格按以下垂直切片推进：

```text
S1-01 Platform + Store
S1-02 Brand + Category
S1-03 Product
S1-04 SKU
S1-05 Barcode
S1-06 SKU Image
S1-07 Warehouse
S1-08 Warehouse Bin
S1-09 Store Warehouse Binding
S1-10 Listing
S1-11 Listing SKU Mapping
S1-12 Listing Resolver
S1-13 Excel Import
S1-14 Frontend Integration
S1-15 E2E + Realistic Seed Data
```

每个切片：

```text
Migration
→ Entity
→ Repository
→ Service
→ DTO
→ Controller
→ Swagger
→ Frontend
→ Test
```

完成并通过测试以后再进入下一项。

---

# 六、S1-01 Platform

建立：

```text
platforms
```

字段至少：

```text
id UUID PK

code VARCHAR(...) UNIQUE NOT NULL

name VARCHAR(...) NOT NULL

status VARCHAR(...) NOT NULL

created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

初始化：

```text
OZON
WB
YANDEX
```

必须通过：

Migration / Seed。

不要要求人工直接改数据库。

---

# 七、Platform业务规则

Platform属于系统级主数据。

普通运营人员：

默认只读。

不得让用户随意创建：

```text
OZON2
WB_NEW
```

等无规范平台。

Sprint 1 API至少：

```text
GET /api/v1/platforms
GET /api/v1/platforms/:id
```

---

# 八、Store

建立：

```text
stores
```

字段至少：

```text
id UUID PK

platform_id UUID FK NOT NULL

store_code VARCHAR(...) NOT NULL

name VARCHAR(...) NOT NULL

seller_id VARCHAR(...) NULL

default_currency VARCHAR(...) NULL

status VARCHAR(...) NOT NULL

settings JSONB NULL

created_at
updated_at
```

唯一约束：

```text
platform_id + store_code
```

---

# 九、Store API

至少：

```text
GET    /api/v1/stores
POST   /api/v1/stores
GET    /api/v1/stores/:id
PATCH  /api/v1/stores/:id

POST   /api/v1/stores/:id/activate
POST   /api/v1/stores/:id/deactivate
```

不提供硬DELETE。

---

# 十、真实店铺支持

系统必须能够录入：

```text
OZON × 8
WB × 1
Yandex × 2
```

合计：

```text
11 Store
```

Sprint 1不要求录入真实账号密钥。

---

# 十一、Platform Credential

建立：

```text
platform_credentials
```

Credential与Store严格分离。

字段至少：

```text
id

store_id

credential_type

encrypted_payload

status

created_at
updated_at
```

初期：

```text
MAIN_API
```

后续可扩：

```text
ADS_API
FINANCE_API
WEBHOOK
```

---

# 十二、Credential安全

必须复用 Sprint 0：

```text
CredentialEncryptionService
```

不得自行实现第二套加密方案。

API：

不得返回：

```text
encrypted_payload
```

只返回类似：

```text
id
credentialType
status
configured
updatedAt
```

Operation Log中：

不得保存Secret内容。

---

# 十三、Brand

建立：

```text
brands
```

至少：

```text
id
code
name_zh
name_en
name_ru
status
created_at
updated_at
```

`code`：

唯一。

---

# 十四、Category

建立简单树形：

```text
categories
```

字段：

```text
id
parent_id
code
name_zh
name_ru
sort_order
status
```

支持：

```text
3C
├─ 键盘
├─ 鼠标
└─ 耳机
```

本 Sprint 不做平台类目映射。

---

# 十五、Product

建立：

```text
products
```

字段至少：

```text
id UUID

product_code VARCHAR(...) UNIQUE

name_zh VARCHAR(...) NOT NULL

name_ru VARCHAR(...) NULL

category_id UUID NULL

brand_id UUID NULL

main_image_id UUID NULL

status

remark

created_at
updated_at
created_by
updated_by
```

---

# 十六、Product Code

提供系统自动生成：

例如：

```text
PRD000001
```

同时允许管理员修改业务编码。

UUID永远不变。

---

# 十七、Product状态

使用：

```text
DRAFT
ACTIVE
INACTIVE
```

已被业务引用的Product：

禁止物理删除。

---

# 十八、Product API

至少：

```text
GET    /api/v1/products
POST   /api/v1/products
GET    /api/v1/products/:id
PATCH  /api/v1/products/:id

POST   /api/v1/products/:id/activate
POST   /api/v1/products/:id/deactivate
```

---

# 十九、Product列表

至少支持：

```text
page
pageSize
keyword
brandId
categoryId
status
sortBy
sortOrder
```

keyword匹配：

```text
product_code
name_zh
name_ru
```

---

# 二十、SKU

建立：

```text
skus
```

字段至少：

```text
id UUID

product_id UUID NOT NULL

sku_code VARCHAR(...) UNIQUE NOT NULL

name_zh VARCHAR(...) NOT NULL

name_ru VARCHAR(...) NULL

model
color
size

weight_kg NUMERIC(12,4)
length_cm NUMERIC(...)
width_cm NUMERIC(...)
height_cm NUMERIC(...)
volume_cm3 NUMERIC(...)

latest_purchase_price NUMERIC(...)
moving_average_cost NUMERIC(...)

cost_currency VARCHAR(...) DEFAULT 'CNY'

serial_tracking BOOLEAN DEFAULT FALSE

status
remark

created_at
updated_at
```

---

# 二十一、SKU Code

如果用户未提供：

系统自动生成：

```text
SKU000001
SKU000002
```

必须：

全系统唯一。

Internal SKU是以后：

库存、订单、采购、成本、SN、调拨

统一商品身份。

---

# 二十二、Product : SKU

关系：

```text
Product 1:N SKU
```

禁止：

一个SKU属于多个Product。

---

# 二十三、SKU体积

前端输入：

```text
length
width
height
```

后端计算：

```text
volume_cm3
```

前端不得独立修改volume。

---

# 二十四、SKU成本

本 Sprint：

```text
latest_purchase_price
```

允许人工维护。

```text
moving_average_cost
```

可以存在字段，

但不要实现移动加权成本逻辑。

该逻辑属于采购/库存后续Sprint。

---

# 二十五、Serial Tracking

Sprint 1只提供：

```text
serial_tracking
```

配置。

不得提前实现：

```text
inventory_serials
```

真实库存生命周期。

---

# 二十六、SKU API

至少：

```text
GET    /api/v1/skus
POST   /api/v1/skus
GET    /api/v1/skus/:id
PATCH  /api/v1/skus/:id

POST   /api/v1/skus/:id/activate
POST   /api/v1/skus/:id/deactivate
```

---

# 二十七、SKU筛选

至少支持：

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

# 二十八、Barcode

建立：

```text
sku_barcodes
```

字段：

```text
id

sku_id

barcode

barcode_type

is_primary

status

created_at
```

---

# 二十九、Barcode Type

第一阶段：

```text
EAN
GTIN
MANUFACTURER
INTERNAL
OTHER
```

69码：

归入EAN/GTIN语义。

不创建专门：

```text
CN_69_CODE
```

---

# 三十、Barcode唯一性

默认：

```text
barcode
```

全系统唯一。

同一条码不能绑定两个SKU。

冲突错误码：

```text
SKU_BARCODE_ALREADY_EXISTS
```

---

# 三十一、Primary Barcode

一个SKU：

允许多个Barcode。

最多一个：

```text
is_primary = true
```

优先通过数据库Partial Unique Index保证。

不要只依赖前端。

---

# 三十二、Internal Barcode

没有厂商条码时：

允许系统生成：

```text
INTERNAL
```

例如：

```text
WCSKU00000001
```

本 Sprint 生成即可。

不需要完整打印系统。

---

# 三十三、SKU Image

建立：

```text
sku_images
```

字段至少：

```text
id
sku_id
object_key
mime_type
file_size
width
height
sort_order
is_primary
created_at
```

实际文件：

必须使用 Sprint 0：

```text
ObjectStorageService
```

不得直接使用S3 SDK。

---

# 三十四、图片规则

一个SKU：

可以多张图。

最多一张：

```text
is_primary = true
```

Bucket：

保持Private。

展示时使用：

Signed URL。

---

# 三十五、Warehouse

建立：

```text
warehouses
```

字段至少：

```text
id

warehouse_code UNIQUE

name

warehouse_type

country_code
province
city
address

contact_name
contact_phone

status
remark

created_at
updated_at
```

---

# 三十六、Warehouse Type

当前：

```text
SELF
PLATFORM
THIRD_PARTY
RETURN_TEMP
```

不要新增：

```text
VIRTUAL
```

本 Sprint 不做 WarehouseGroup。

---

# 三十七、Warehouse API

至少：

```text
GET    /api/v1/warehouses
POST   /api/v1/warehouses
GET    /api/v1/warehouses/:id
PATCH  /api/v1/warehouses/:id

POST   /api/v1/warehouses/:id/activate
POST   /api/v1/warehouses/:id/deactivate
```

不提供硬DELETE。

---

# 三十八、Warehouse Bin

建立：

```text
warehouse_bins
```

字段：

```text
id
warehouse_id
bin_code
zone
rack
level
position
barcode
status
remark
created_at
updated_at
```

唯一：

```text
warehouse_id + bin_code
```

---

# 三十九、Bin业务规则

必须支持：

```text
一个Warehouse → 多Bin
```

以后数据模型必须允许：

```text
一个SKU → 多Bin
一个Bin → 多SKU
```

因此不得：

在Bin表增加单一：

```text
sku_id
```

---

# 四十、Bin Barcode

支持系统生成，例如：

```text
BIN-SZ01-A01-01
```

本 Sprint至少做到：

- 生成；
- 查看；
- API返回。

如果实现成本低：

可增加标签预览。

不要扩大成完整打印系统。

---

# 四十一、批量建Bin

实现实用的批量创建功能。

例如输入：

```text
Warehouse = 深圳仓

Rack:
A01 ~ A05

Level:
01 ~ 04
```

系统批量生成Bin。

必须在后端校验：

重复编码。

---

# 四十二、Store Warehouse Binding

建立：

```text
store_warehouse_bindings
```

字段：

```text
id

store_id

warehouse_id

fulfillment_mode

platform_warehouse_id

is_inventory_source

is_inventory_push_enabled

priority

settings JSONB

status

created_at
updated_at
```

---

# 四十三、Store / Warehouse关系

必须支持：

```text
Store N:M Warehouse
```

例如：

```text
深圳仓
```

可以同时被：

```text
OZON-A
OZON-B
WB-A
Yandex-A
```

绑定。

禁止给Warehouse直接增加：

```text
store_id
```

---

# 四十四、Fulfillment Mode

第一阶段规范值：

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

可以使用VARCHAR。

应用层：

使用Typed Constant / Enum。

---

# 四十五、Binding校验

必须校验：

Store所属Platform

和：

Fulfillment Mode

一致。

例如：

```text
WB Store + OZON_FBO
```

必须拒绝。

Warehouse Type匹配：

在Service层校验。

不要通过数据库硬编码平台业务。

---

# 四十六、Listing

建立：

```text
platform_listings
```

代表一个平台商品主体/页面。

字段：

```text
id

platform_id

store_id

platform_product_id

title

url

status

raw_data JSONB

created_at
updated_at
```

唯一：

```text
store_id + platform_product_id
```

---

# 四十七、Platform Listing SKU

建立：

```text
platform_listing_skus
```

字段：

```text
id

listing_id

sku_id

platform_sku_id

seller_sku

offer_id

status

raw_data JSONB

created_at
updated_at
```

---

# 四十八、最重要的Listing规则

必须允许：

```text
一个Internal SKU
→ 多个平台
→ 多个Store
→ 多个Listing
```

并且必须允许：

```text
同一Store
同一Internal SKU
→ 多个Listing
```

禁止增加：

```text
UNIQUE(sku_id, store_id)
```

---

# 四十九、Listing Variant

一个Listing：

允许多个：

```text
PlatformListingSku
```

例如：

```text
黑色
蓝色
白色
```

映射不同Internal SKU。

---

# 五十、平台标识唯一性

不要凭通用模型猜测：

```text
platform_sku_id
seller_sku
offer_id
```

在所有平台都绝对唯一。

Sprint 1：

建立必要查询索引。

除已经通过业务规则确认的唯一关系外：

不要过度添加Unique Constraint。

后续接真实平台API时再根据官方语义收紧。

---

# 五十一、Listing Resolver

必须实现：

```text
ListingResolverService
```

提供类似：

```typescript
resolveInternalSku({
  storeId,
  platformSkuId?,
  sellerSku?,
  offerId?,
})
```

返回：

Internal SKU Mapping。

---

# 五十二、Resolver必须Store Scoped

绝对禁止：

```text
WHERE offer_id = ?
```

全局查找。

必须至少：

```text
WHERE store_id = ?
```

范围内解析。

---

# 五十三、Resolver歧义

如果：

同一个Store范围内

多个候选记录同时匹配：

不得：

```text
取第一条
```

必须：

显式返回：

```text
LISTING_SKU_RESOLVE_AMBIGUOUS
```

或等价Domain Error。

这是未来订单安全边界。

---

# 五十四、Resolver找不到

当前人工主数据操作中：

可以返回：

```text
LISTING_SKU_RESOLVE_FAILED
```

未来订单同步：

会进入：

```text
ORDER_SKU_MAPPING_FAILED
```

本 Sprint不实现订单异常。

---

# 五十五、Bundle

Sprint 1可以建立：

```text
sku_bundle_components
```

结构：

```text
bundle_sku_id
component_sku_id
quantity
```

但：

UI暂时可以不开放。

---

# 五十六、Bundle限制

至少：

```text
bundle_sku_id != component_sku_id

quantity > 0
```

第一阶段：

不做递归Bundle。

如果实现明显扩大工作量：

只建Schema + Service基础约束即可。

---

# 五十七、Import Center

实现固定模板基础版。

不要做：

任意Excel字段拖拽Mapper。

Sprint 1目标：

可靠导入现有业务数据。

---

# 五十八、需要支持的Import

至少：

```text
SKU
Barcode
Warehouse
Bin
Listing Mapping
```

Product可以：

和SKU一起创建/匹配，

或者单独模板。

由实现选择简单且可维护的方案。

---

# 五十九、Import流程

必须经过：

```text
Upload
↓
Object Storage
↓
Import Job
↓
Parse
↓
Validate
↓
Preview / Validation Result
↓
Confirm
↓
Import
```

如果完整Preview显著扩大Sprint范围：

至少实现：

```text
Upload
↓
Validate
↓
错误报告
↓
确认导入
```

不得直接上传即静默落库。

---

# 六十、Import错误

必须具体到：

```text
row
field
code
message
```

例如：

```text
Row 18
field = internal_sku_code
code = SKU_NOT_FOUND
```

禁止只返回：

```text
Import failed
```

---

# 六十一、Import幂等/重复

对于唯一业务键：

例如：

```text
sku_code
barcode
warehouse_code
```

重复时：

必须明确：

- Reject
- Update

采用哪一种。

Sprint 1默认：

**不要静默覆盖已有主数据。**

如果没有明确Update语义：

Reject并报告错误。

---

# 六十二、Operation Log

以下修改至少写Operation Log：

```text
Product
SKU
Barcode
Store
Credential
Warehouse
Bin
StoreWarehouseBinding
Listing
ListingSkuMapping
```

Credential：

不得记录Secret原文。

---

# 六十三、前端导航

Sprint 1建立：

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

# 六十四、Product页面

路径：

```text
/products
```

列表至少：

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

# 六十五、Product详情

至少：

```text
基础信息
SKU列表
```

不要在Sprint 1增加库存、订单等未来Tab的真实功能。

可以显示禁用占位：

但非必要。

---

# 六十六、SKU页面

路径：

```text
/skus
```

列表至少：

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

# 六十七、SKU详情

优先使用：

```text
Drawer
```

Tabs：

```text
基本信息
条码
图片
平台映射
```

这四个Sprint 1需要真实工作。

---

# 六十八、Listing页面

路径：

```text
/listings
```

筛选：

```text
Platform
Store
Internal SKU
Status
Mapping State
```

展示：

```text
平台
店铺
Platform Product ID
标题
Platform SKU
Seller SKU
Offer ID
Internal SKU
状态
URL
```

---

# 六十九、Warehouse页面

路径：

```text
/warehouses
```

显示：

```text
Warehouse Code
Name
Type
Country
City
Bin Count
Bound Store Count
Status
```

---

# 七十、Store页面

路径：

```text
/stores
```

按平台分组或支持Platform筛选。

显示：

```text
Platform
Store Name
Seller ID
Currency
Credential Status
Warehouse Binding Count
Status
```

---

# 七十一、Credential UI

前端允许：

创建/更新Credential。

读取后：

不得重新显示完整Secret。

可以显示：

```text
••••••••
已配置
更新时间
```

---

# 七十二、分页

主要列表统一：

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

后端分页。

禁止一次加载全部SKU。

---

# 七十三、搜索

当前规模使用：

PostgreSQL查询。

不引入：

Elasticsearch。

keyword：

支持主要业务字段模糊匹配。

---

# 七十四、API Client

所有新增前端接口：

优先通过：

```text
OpenAPI
→ @wcies/api-client
```

生成。

不要手写另一套重复Type定义。

---

# 七十五、Migration顺序建议

可以根据实际依赖调整编号，但逻辑顺序建议：

```text
platforms
stores
platform_credentials

brands
categories

products
skus
sku_barcodes
sku_images

warehouses
warehouse_bins
store_warehouse_bindings

platform_listings
platform_listing_skus

sku_bundle_components

indexes
```

不得一个巨大Migration塞入所有内容。

---

# 七十六、数据库约束

优先由数据库保证：

- product_code unique
- sku_code unique
- barcode unique
- warehouse_code unique
- warehouse + bin_code unique
- platform + store_code unique
- store + platform_product_id unique
- 主条码单SKU最多一个

Service层仍需返回友好的Domain Error。

---

# 七十七、错误码

至少建立：

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
LISTING_SKU_RESOLVE_AMBIGUOUS

FILE_INVALID_TYPE
IMPORT_VALIDATION_FAILED
```

沿用 Sprint 0：

统一错误Response。

---

# 七十八、测试要求：Product

至少测试：

```text
创建Product
重复product_code拒绝
Product更新
Product停用
Product 1:N SKU
```

---

# 七十九、测试要求：SKU

至少：

```text
自动sku_code
sku_code唯一
物理属性校验
volume后端计算
serial_tracking保存
```

---

# 八十、测试要求：Barcode

必须：

```text
一个SKU多个Barcode
全局Barcode唯一
一个SKU只能一个Primary
```

Primary约束必须测试数据库层。

---

# 八十一、测试要求：Warehouse

至少：

```text
创建Warehouse
warehouse_code唯一
一个仓多个Bin
同仓bin_code唯一
不同仓允许相同bin_code
停用仓库
```

---

# 八十二、测试要求：Store

至少：

```text
同Platform store_code唯一
不同Platform允许相同store_code
Credential加密
Credential API不泄露payload
```

---

# 八十三、测试要求：Binding

必须验证：

```text
Store → 多Warehouse

Warehouse → 多Store
```

以及：

```text
WB Store + OZON_FBO
```

这种非法组合被拒绝。

---

# 八十四、最关键Listing测试

必须长期保留以下测试。

## Case A

Internal SKU：

```text
SKU-A
```

在：

```text
OZON Store A
```

拥有：

```text
Listing 1
Listing 2
```

两条都创建成功。

---

## Case B

一个Listing：

存在多个Platform Listing SKU，

映射多个Internal SKU。

---

## Case C

```text
OZON Store A offer_id = ABC
OZON Store B offer_id = ABC
```

允许同时存在。

Resolver：

根据storeId返回正确SKU。

---

## Case D

Resolver同Store多候选：

必须返回：

```text
AMBIGUOUS
```

禁止取第一条。

---

# 八十五、图片测试

至少：

```text
上传到ObjectStorageService
DB保存objectKey
Signed URL正常
Primary Image规则
非法文件类型拒绝
```

---

# 八十六、Import测试

至少使用：

```text
100条
```

测试数据。

包含：

```text
正常行
重复sku_code
重复barcode
未知product
未知store
未知sku mapping
```

必须报告准确行号。

---

# 八十七、真实业务验收数据

Sprint 1结束前：

使用非敏感真实/近真实业务数据进行验收。

至少选择：

```text
1个真实Product
2个SKU
```

例如当前已有商品中的一个。

为SKU录入：

- 条码
- 图片
- 型号
- 重量
- 成本基础资料

---

# 八十八、11店验收

至少证明系统可以完整录入：

```text
8 OZON
1 WB
2 Yandex
```

不要求真实Credential。

可以使用明确标注的开发占位Store数据。

---

# 八十九、深圳仓验收

创建：

```text
深圳自管仓
```

类型：

```text
SELF
```

建立至少：

```text
5组Rack/Bin数据
```

验证：

批量创建Bin。

---

# 九十、店仓绑定验收

至少建立：

```text
OZON-A
OZON_RFBS
→ 深圳仓
```

以及一个：

```text
PLATFORM Warehouse
```

的示例绑定。

---

# 九十一、多Listing验收

选一个Internal SKU：

建立：

```text
OZON-A Listing 1
OZON-A Listing 2
WB-A Listing 1
```

SKU详情必须能够看到：

3条映射。

这是本Sprint关键验收。

---

# 九十二、性能要求

使用开发数据测试：

```text
2000 SKU
5000 Listing Mapping
```

不要求一次真实人工创建。

可通过开发Seed生成。

主要列表必须：

正常分页、筛选。

普通数据库列表请求：

目标：

```text
< 500ms
```

本机开发环境合理情况下。

若超出：

先检查N+1和索引。

不要过早引入新技术。

---

# 九十三、N+1检查

列表页面特别关注：

```text
Product → SKU Count
SKU → Listing Count
Warehouse → Bin Count
Store → Binding Count
```

不得每行单独发数据库Query。

使用：

- aggregate
- relation count
- join
- batch query

解决。

---

# 九十四、OpenAPI

所有新增API：

必须：

- 有Swagger Tag；
- Request DTO清晰；
- Response DTO清晰；
- API Client可以正常重新生成。

Sprint结束时执行：

```text
openapi:export
api-client:generate
```

并提交生成物。

---

# 九十五、不要接真实Platform API

虽然已经建立：

```text
Platform
Store
Credential
Listing
```

但本Sprint不调用真实：

```text
OZON
WB
Yandex
```

API。

Listing数据：

先通过：

```text
UI
Excel Import
Seed
```

建立。

---

# 九十六、Git提交建议

不要只做一次巨大提交。

建议至少按领域提交，例如：

```text
feat(master-data): add platform store and catalog foundation

feat(product): add product sku barcode and images

feat(warehouse): add warehouse bins and store bindings

feat(listing): add listing mappings and resolver

feat(import): add sprint1 master-data import

feat(web): complete sprint1 management UI

test: add sprint1 integration and e2e coverage
```

提交数量不作为硬指标。

关键是：

每个提交状态可验证。

---

# 九十七、每个切片完成后

运行：

```text
pnpm lint
pnpm typecheck
pnpm check:arch
相关tests
```

不要积累到最后统一修。

---

# 九十八、Sprint最终验证

完成后必须运行：

```text
pnpm lint
pnpm typecheck
pnpm check:arch
pnpm test
pnpm test:integration
pnpm build
```

如果新增E2E命令：

同时执行。

任何失败：

不得声明Sprint完成。

---

# 九十九、数据库验证

使用全新空数据库：

执行：

```text
全部Migration
Seed
```

必须成功。

再执行现有开发数据库Migration：

也必须成功。

确保：

不是只在当前开发库碰巧可运行。

---

# 一百、最终报告

请按以下格式回复。

## 1. 完成内容

按：

```text
S1-01 ~ S1-15
```

报告实际完成情况。

## 2. Database

列出：

- 新表；
- Migration；
- 关键Unique Constraint；
- 关键Index。

## 3. API

列出主要Endpoint。

## 4. Frontend

列出完成页面。

## 5. Tests

列出：

```text
unit
integration
e2e
```

数量和结果。

## 6. 关键业务验收

明确报告：

- 一个SKU多个Listing是否通过；
- Store Scoped Resolver是否通过；
- 11 Store是否可录入；
- 深圳仓/Bin是否通过；
- Excel Import是否通过。

## 7. Verification

报告：

```text
lint
typecheck
check:arch
test
integration
build
```

结果。

## 8. 新增架构决策

只列真正新增的。

不得重新定义现有架构。

## 9. 未完成项

明确列出。

不得隐藏。

## 10. 风险/问题

特别说明：

- 数据库迁移风险
- Mapping歧义
- 性能问题
- 环境问题
- 文档冲突

## 11. Git

列出：

主要Commit Hash。

## 12. 下一步

Sprint 1完成后：

**停止。**

不得自行开始 Sprint 2。

等待确认后再进入：

```text
Sprint 2
Inventory Core
```

---

# 一百零一、Sprint 1完成定义

只有同时满足以下条件：

```text
Platform工作
Store工作
Credential安全工作

Brand/Category工作
Product工作
SKU工作
Barcode工作
SKU Image工作

Warehouse工作
Warehouse Bin工作
Store Warehouse Binding工作

Listing工作
Listing SKU Mapping工作
Listing Resolver工作

Excel Import基础版工作

Web UI可完整操作
API全部通过OpenAPI
Migration全部可从空库执行

一个SKU多个Listing验证通过
Store Scoped Resolver验证通过
11店模型验证通过
深圳仓库位模型验证通过

lint通过
typecheck通过
architecture check通过
tests通过
build通过
```

才可以将：

**WCIES Sprint 1**

标记为完成。