/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Regenerate with: pnpm openapi:export && pnpm api-client:generate
 */
export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness probe (alias of /health/live) */
        get: operations["HealthController_getLiveAlias"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness probe - API process only */
        get: operations["HealthController_getLive"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Readiness probe - checks PostgreSQL and Redis */
        get: operations["HealthController_getReady"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Login with username/email + password (sets HttpOnly session cookie) */
        post: operations["AuthController_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current authenticated user */
        get: operations["AuthController_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Clear the session cookie */
        post: operations["AuthController_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/platforms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List platforms (OZON / WB / YANDEX) */
        get: operations["PlatformController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/platforms/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a platform by id */
        get: operations["PlatformController_getById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stores": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List stores (paged, with credential + binding counts) */
        get: operations["StoreController_list"];
        put?: never;
        /** Create a store on a platform */
        post: operations["StoreController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stores/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get store detail */
        get: operations["StoreController_getById"];
        put?: never;
        post?: never;
        /** Delete a store with zero references (else STORE_IN_USE) */
        delete: operations["StoreController_remove"];
        options?: never;
        head?: never;
        /** Update store fields (code and platform immutable) */
        patch: operations["StoreController_update"];
        trace?: never;
    };
    "/api/v1/stores/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate a store */
        post: operations["StoreController_activate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stores/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deactivate a store (no hard delete) */
        post: operations["StoreController_deactivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stores/{storeId}/credentials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List credential metadata for a store (no secrets) */
        get: operations["StoreCredentialController_list"];
        put?: never;
        /** Create a credential (payload encrypted at rest) */
        post: operations["StoreCredentialController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stores/{storeId}/credentials/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a credential record (a wrong key can be removed and re-entered) */
        delete: operations["StoreCredentialController_remove"];
        options?: never;
        head?: never;
        /** Replace the credential payload (re-encrypted) */
        patch: operations["StoreCredentialController_updatePayload"];
        trace?: never;
    };
    "/api/v1/stores/{storeId}/credentials/{id}/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 验证连接（安全 Read-only 调用；不返回任何密钥） */
        post: operations["StoreCredentialController_validate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stores/{storeId}/credentials/{id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable a credential */
        post: operations["StoreCredentialController_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stores/{storeId}/credentials/{id}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Re-enable a disabled credential (keeps the stored payload) */
        post: operations["StoreCredentialController_enable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/brands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List brands (filterable by keyword) */
        get: operations["CatalogController_listBrands"];
        put?: never;
        /** Create a brand */
        post: operations["CatalogController_createBrand"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/brands/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a brand with zero references (else BRAND_IN_USE) */
        delete: operations["CatalogController_removeBrand"];
        options?: never;
        head?: never;
        /** Update a brand */
        patch: operations["CatalogController_updateBrand"];
        trace?: never;
    };
    "/api/v1/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the category tree */
        get: operations["CatalogController_listCategoryTree"];
        put?: never;
        /** Create a category (tree node) */
        post: operations["CatalogController_createCategory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/tree-lite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the category tree without entity bookkeeping columns (8k-node pickers) */
        get: operations["CatalogController_listCategoryTreeLite"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/categories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a category with zero references (children -> CATEGORY_HAS_CHILDREN, products -> CATEGORY_IN_USE) */
        delete: operations["CatalogController_removeCategory"];
        options?: never;
        head?: never;
        /** Update a category (cycle-safe parent changes) */
        patch: operations["CatalogController_updateCategory"];
        trace?: never;
    };
    "/api/v1/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List products (paged, keyword/brand/category/status filters) */
        get: operations["ProductController_list"];
        put?: never;
        /** Create a product (code auto-generated when omitted) */
        post: operations["ProductController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/products/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Product detail incl. its SKUs */
        get: operations["ProductController_getById"];
        put?: never;
        post?: never;
        /** Delete a product with zero references (else PRODUCT_IN_USE) */
        delete: operations["ProductController_remove"];
        options?: never;
        head?: never;
        /** Update product fields (code read-only after creation) */
        patch: operations["ProductController_update"];
        trace?: never;
    };
    "/api/v1/products/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate a product */
        post: operations["ProductController_activate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/products/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deactivate a product (no hard delete once referenced) */
        post: operations["ProductController_deactivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skus": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List SKUs (paged; filters incl. hasListing/platformId/storeId) */
        get: operations["SkuController_list"];
        put?: never;
        /** Create an internal SKU (code auto-generated when omitted) */
        post: operations["SkuController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skus/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get SKU detail */
        get: operations["SkuController_getById"];
        put?: never;
        post?: never;
        /** Delete a SKU with zero references (else SKU_IN_USE) */
        delete: operations["SkuController_remove"];
        options?: never;
        head?: never;
        /** Update SKU fields (volume always recomputed server-side) */
        patch: operations["SkuController_update"];
        trace?: never;
    };
    "/api/v1/skus/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate a SKU */
        post: operations["SkuController_activate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skus/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deactivate a SKU */
        post: operations["SkuController_deactivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skus/{skuId}/barcodes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List barcodes of a SKU */
        get: operations["SkuController_listBarcodes"];
        put?: never;
        /** Add a barcode (globally unique; first becomes primary) */
        post: operations["SkuController_createBarcode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skus/{skuId}/barcodes/generate-internal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate an INTERNAL barcode (W%08d, decision 0017) for the SKU */
        post: operations["SkuController_generateInternalBarcode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skus/{skuId}/barcodes/{barcodeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete an unreferenced barcode */
        delete: operations["SkuController_deleteBarcode"];
        options?: never;
        head?: never;
        /** Update a barcode (type/primary/status) */
        patch: operations["SkuController_updateBarcode"];
        trace?: never;
    };
    "/api/v1/skus/{skuId}/images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List SKU images (signed URLs) */
        get: operations["SkuController_listImages"];
        put?: never;
        /** Upload a SKU image (png/jpeg/webp/gif, max 5MB) */
        post: operations["SkuController_uploadImage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skus/{skuId}/images/{imageId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete an image (DB row + object) */
        delete: operations["SkuController_deleteImage"];
        options?: never;
        head?: never;
        /** Update image sort order / primary flag */
        patch: operations["SkuController_updateImage"];
        trace?: never;
    };
    "/api/v1/barcodes/{barcode}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 按条码解析内部 SKU（收货/拣货扫码共用） */
        get: operations["BarcodeController_resolve"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List warehouses (with bin + bound store counts) */
        get: operations["WarehouseController_list"];
        put?: never;
        /** Create a warehouse */
        post: operations["WarehouseController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get warehouse detail */
        get: operations["WarehouseController_getById"];
        put?: never;
        post?: never;
        /** Delete a warehouse with zero references (else WAREHOUSE_IN_USE) */
        delete: operations["WarehouseController_remove"];
        options?: never;
        head?: never;
        /** Update warehouse fields */
        patch: operations["WarehouseController_update"];
        trace?: never;
    };
    "/api/v1/warehouses/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate a warehouse */
        post: operations["WarehouseController_activate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deactivate a warehouse (no hard delete) */
        post: operations["WarehouseController_deactivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/bins": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List bins of a warehouse (paged) */
        get: operations["WarehouseBinController_list"];
        put?: never;
        /** Create a single bin */
        post: operations["WarehouseBinController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/bins/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Batch-create bins (rack A01~A05 x level 01~04) */
        post: operations["WarehouseBinController_batchCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/bins/zones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Distinct zones present in a warehouse */
        get: operations["WarehouseBinController_zones"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/bins/{binId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a bin with zero references (else BIN_IN_USE) */
        delete: operations["WarehouseBinController_removeBin"];
        options?: never;
        head?: never;
        /** Update a bin */
        patch: operations["WarehouseBinController_update"];
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/bins/{binId}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable a bin */
        post: operations["WarehouseBinController_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/bins/{binId}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable a bin */
        post: operations["WarehouseBinController_enable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouse-bindings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List bindings across stores (paged, filterable) */
        get: operations["StoreWarehouseBindingController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stores/{storeId}/warehouse-bindings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List bindings of a store */
        get: operations["StoreWarehouseBindingController_listByStore"];
        put?: never;
        /** Bind a warehouse to a store with a fulfillment mode */
        post: operations["StoreWarehouseBindingController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stores/{storeId}/warehouse-bindings/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a store-warehouse binding */
        delete: operations["StoreWarehouseBindingController_removeBinding"];
        options?: never;
        head?: never;
        /** Update a binding */
        patch: operations["StoreWarehouseBindingController_update"];
        trace?: never;
    };
    "/api/v1/stores/{storeId}/warehouse-bindings/{id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable a binding */
        post: operations["StoreWarehouseBindingController_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stores/{storeId}/warehouse-bindings/{id}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable a binding */
        post: operations["StoreWarehouseBindingController_enable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List listings (platform/store/sku/status/mappingState filters) */
        get: operations["ListingController_list"];
        put?: never;
        /** Create a listing with variant SKU mappings in one submit */
        post: operations["ListingController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Resolve an internal SKU by platform identifiers (STRICTLY store-scoped, decision 0016) */
        get: operations["ListingController_resolve"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/mapping-stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Mapped / unmapped listing counters (Sprint 8 unmapped workbench) */
        get: operations["ListingController_mappingStats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/{listingId}/onboard-context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 建档弹窗上下文（Sprint 8.5）：变体图片/类目键/类目建议/预填尺寸重量 + 缺省挂靠商品 */
        get: operations["ListingController_onboardContext"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/exports/unmapped": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Export unmapped variants as a LISTING_MAPPING-compatible Excel (signed URL download) */
        post: operations["ListingController_exportUnmapped"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/skus/{skuId}/mappings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** All platform mappings of an internal SKU */
        get: operations["ListingController_listMappingsOfSku"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Listing detail incl. variant mappings */
        get: operations["ListingController_getById"];
        put?: never;
        post?: never;
        /** Delete a listing with zero mappings (else LISTING_IN_USE) */
        delete: operations["ListingController_remove"];
        options?: never;
        head?: never;
        /** Update listing title/url/rawData */
        patch: operations["ListingController_update"];
        trace?: never;
    };
    "/api/v1/listings/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate a listing */
        post: operations["ListingController_activate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deactivate a listing */
        post: operations["ListingController_deactivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/{listingId}/skus": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add a variant mapping to an existing listing */
        post: operations["ListingController_addMapping"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/{listingId}/skus/{id}/map": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 人工映射：将同步来的 UNMAPPED 平台SKU 绑定到 Internal SKU（同步不覆盖） */
        post: operations["ListingController_mapUnmappedSku"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/{listingId}/skus/{id}/onboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 建档并映射（Sprint 8 T1）：一个事务内建 Product + SKU +（可选）内部条码并映射该未映射变体，失败整体回滚 */
        post: operations["ListingController_onboard"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/{listingId}/skus/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a mapping without order history */
        delete: operations["ListingController_deleteMapping"];
        options?: never;
        head?: never;
        /** Update a variant mapping */
        patch: operations["ListingController_updateMapping"];
        trace?: never;
    };
    "/api/v1/listings/category-import/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 类目导入预演（dry-run，不落库；冲突清单 + 建树预览） */
        post: operations["CategoryImportController_preview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/listings/category-import/execute": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 确认导入（单事务：三级类目 + 复合键映射；有冲突时 409 拒绝） */
        post: operations["CategoryImportController_execute"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/imports/templates/{type}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download a fixed-template Excel (SKU / LISTING_MAPPING), header + one example row */
        get: operations["ImportController_downloadTemplate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/imports/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload a fixed-template Excel, parse + validate, return the error report */
        post: operations["ImportController_upload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/imports/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm import: enqueues the job to the import worker */
        post: operations["ImportController_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List import jobs */
        get: operations["ImportController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/imports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Import job detail incl. row-level errors */
        get: operations["ImportController_getById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List inventory balances with derived availability */
        get: operations["InventoryController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/skus/{skuId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** SKU inventory drilldown: totals -> warehouses -> bins */
        get: operations["InventoryController_getSkuInventory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Inventory transaction ledger (audit) */
        get: operations["InventoryController_listTransactions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/initialize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** [Admin] Initialize stock (first go-live import only) */
        post: operations["InventoryController_initialize"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/receive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** [Admin] Receive stock (future purchase-receipt primitive) */
        post: operations["InventoryController_receive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/adjust": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** [Admin] Manual stock adjustment (+N / -N with reason) */
        post: operations["InventoryController_adjust"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/move-bin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Move stock between bins of one warehouse (single event, two lines) */
        post: operations["InventoryController_moveBin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/reservations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List reservations */
        get: operations["InventoryReservationController_list"];
        put?: never;
        /** Reserve stock (multi-bin allocation, idempotent) */
        post: operations["InventoryReservationController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/replenishment-suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 补货建议（派生建议：销速/安全库存/在途采购 → 建议采购量） */
        get: operations["InventoryReservationController_replenishmentSuggestions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/reservations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Reservation detail with per-bin lines */
        get: operations["InventoryReservationController_getById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/reservations/{id}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Release an ACTIVE reservation (Reserved -N) */
        post: operations["InventoryReservationController_release"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/reservations/{id}/pick": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pick a full ACTIVE reservation (Reserved -N, Picked +N) */
        post: operations["InventoryReservationController_pick"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/reservations/{id}/unpick": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Undo a pick (PICKED -> ACTIVE; pick-correction only) */
        post: operations["InventoryReservationController_unpick"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/reservations/{id}/ship": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ship a PICKED reservation (Picked -N, On Hand -N) */
        post: operations["InventoryReservationController_ship"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/safety-stocks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List safety stock policies */
        get: operations["InventorySafetyStockController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/inventory/safety-stocks/{skuId}/{warehouseId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Set/update safety stock of a SKU in a warehouse (policy only) */
        put: operations["InventorySafetyStockController_upsert"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exceptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 异常列表（分页，可按订单行引用过滤） */
        get: operations["ExceptionController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exceptions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 异常详情 */
        get: operations["ExceptionController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exceptions/{id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 解决异常（OPEN → RESOLVED） */
        post: operations["ExceptionController_resolve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exceptions/{id}/ignore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 忽略异常（OPEN → IGNORED） */
        post: operations["ExceptionController_ignore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 订单列表（分页 + 汇总计数 + 未处理异常数） */
        get: operations["OrderController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 订单详情（行/预约/历史/异常/拦截/拣货） */
        get: operations["OrderController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/ingest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 标准化订单摄入（管理员/开发测试入口；未来 SyncService 复用 Service） */
        post: operations["OrderController_ingest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 取消订单（按行处理库存：Reserved 释放 / Picked 拦截） */
        post: operations["OrderController_cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{id}/mark-external-fulfillment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 标记外部履约（订单在系统外完成：行关账、不产生库存流水、关闭缺货/时限异常） */
        post: operations["OrderController_markExternalFulfillment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/items/{itemId}/retry-allocation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 重试分配库存（BACKORDERED / PENDING 行） */
        post: operations["OrderController_retryAllocation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 通知列表（分页，按类型/通道/状态过滤） */
        get: operations["NotificationController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 通知详情 */
        get: operations["NotificationController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 重试失败的 FEISHU 通知投递 */
        post: operations["NotificationController_retry"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/picking-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 拣货任务列表（分页 + 进度汇总） */
        get: operations["PickingController_list"];
        put?: never;
        /** 从订单创建拣货任务（仅 RESERVED 行，按仓拆分） */
        post: operations["PickingController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/picking-tasks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 拣货任务详情（待拣 SKU / 多 Bin / SN） */
        get: operations["PickingController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/picking-tasks/{id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 开始拣货任务（CREATED → IN_PROGRESS） */
        post: operations["PickingController_start"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/picking-tasks/{id}/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 扫码拣货（每次 1 件；SN 商品必带 serialNumber） */
        post: operations["PickingController_scan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/picking-tasks/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 完成拣货任务（校验全部行已拣完） */
        post: operations["PickingController_complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interceptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 拦截任务列表（分页） */
        get: operations["InterceptionController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interceptions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 拦截任务详情（要找什么/在哪找/SN/目标库位/历史） */
        get: operations["InterceptionController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interceptions/{id}/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 指派员工（CREATED → ASSIGNED） */
        post: operations["InterceptionController_assign"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interceptions/{id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 开始查找（CREATED/ASSIGNED → LOCATING） */
        post: operations["InterceptionController_start"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interceptions/{id}/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 拦截扫码：验证 SKU / SN / 目标库位（→ INTERCEPTED，不改库存） */
        post: operations["InterceptionController_scan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interceptions/{id}/return-to-stock": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 回库（原子：Picked - N，OnHand 不变，SN → IN_STOCK，Package 解除） */
        post: operations["InterceptionController_returnToStock"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interceptions/{id}/fail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 标记失败（未找到商品；库存保持 Picked + 异常） */
        post: operations["InterceptionController_fail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interceptions/{id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 关闭拦截任务（RETURNED_TO_STOCK/FAILED → CLOSED） */
        post: operations["InterceptionController_close"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/suppliers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List suppliers (paged + reference counts) */
        get: operations["SupplierController_list"];
        put?: never;
        /** Create a supplier (code auto-generated when omitted) */
        post: operations["SupplierController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/suppliers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get supplier detail */
        get: operations["SupplierController_getById"];
        put?: never;
        post?: never;
        /** Delete a supplier with zero references (else SUPPLIER_IN_USE) */
        delete: operations["SupplierController_remove"];
        options?: never;
        head?: never;
        /** Update supplier fields (code immutable) */
        patch: operations["SupplierController_update"];
        trace?: never;
    };
    "/api/v1/suppliers/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate a supplier */
        post: operations["SupplierController_activate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/suppliers/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deactivate a supplier */
        post: operations["SupplierController_deactivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/purchase-orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 采购单列表（筛选：状态/供应商/日期/关联订单行） */
        get: operations["PurchaseOrderController_list"];
        put?: never;
        /** 登记采购单（同一订单行重复登记会被拒绝） */
        post: operations["PurchaseOrderController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/purchase-orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 采购单详情（含明细与关联订单号） */
        get: operations["PurchaseOrderController_getById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 修改采购单（仅 ORDERED 状态） */
        patch: operations["PurchaseOrderController_update"];
        trace?: never;
    };
    "/api/v1/purchase-orders/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 取消采购单（仅未收货） */
        post: operations["PurchaseOrderController_cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/purchase-receipts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 收货单列表（筛选：状态/仓库/来源采购单） */
        get: operations["PurchaseReceiptController_list"];
        put?: never;
        /** 新建收货单草稿（确认时才写库存） */
        post: operations["PurchaseReceiptController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/purchase-receipts/from-po/{poId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 从采购单生成收货单（预填剩余数量/成本/供应商） */
        post: operations["PurchaseReceiptController_generateFromPo"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/purchase-receipts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 收货单详情（确认前预览即此数据） */
        get: operations["PurchaseReceiptController_getById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 修改收货单草稿（仅 DRAFT） */
        patch: operations["PurchaseReceiptController_update"];
        trace?: never;
    };
    "/api/v1/purchase-receipts/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 确认收货（整单一个事务写入库存与流水；重复确认幂等） */
        post: operations["PurchaseReceiptController_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/purchase-receipts/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 取消收货单（仅 DRAFT，从未碰库存） */
        post: operations["PurchaseReceiptController_cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/shipments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 发货单列表（分页 + 包裹汇总） */
        get: operations["ShipmentController_list"];
        put?: never;
        /** 从订单的 PICKED 行创建发货单（按仓拆分） */
        post: operations["ShipmentController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/shipments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 发货单详情（待发商品 / 包裹进度 / 面单 / 物流信息） */
        get: operations["ShipmentController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/shipments/{id}/packages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 创建包裹（发货单进入 PACKING） */
        post: operations["ShipmentController_createPackage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/shipments/{id}/tracking": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 人工录入/修改物流单号与承运商（未出库前） */
        patch: operations["ShipmentController_updateTracking"];
        trace?: never;
    };
    "/api/v1/shipments/{id}/ship": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 正式出库（原子扣减 Picked/OnHand，幂等，不重复扣减） */
        post: operations["ShipmentController_ship"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/shipments/{id}/labels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 面单列表（含短期签名查看 URL） */
        get: operations["ShipmentController_listLabels"];
        put?: never;
        /** 手工上传面单文件（PDF/PNG/JPEG，私有桶 + 签名访问） */
        post: operations["ShipmentController_uploadLabel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/packages/{id}/workbench": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 打包工作台数据（待装商品 + 已装明细 + SN 进度） */
        get: operations["PackageController_workbench"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/packages/{id}/items/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 扫码装箱（每次 1 件；SN 商品必带 serialNumber；不改变库存） */
        post: operations["PackageController_scan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/packages/{id}/seal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 封箱（OPEN/REPACK_REQUIRED → SEALED；齐全后发货单 READY_TO_SHIP） */
        post: operations["PackageController_seal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/returns/platform": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 平台退货记录列表（只读事实，支持待收货对账视图） */
        get: operations["ReturnsController_listPlatformReturns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/returns/platform/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 手动拉取店铺平台退货记录（OZON /v2/returns/rfbs/list，只读；不写库存） */
        post: operations["ReturnsController_syncPlatformReturns"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/returns/batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 退货批次列表 */
        get: operations["ReturnsController_listBatches"];
        put?: never;
        /** 创建退货批次（DRAFT：登记批次与预期行） */
        post: operations["ReturnsController_createBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/returns/batches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 退货批次详情（含行与检验结论） */
        get: operations["ReturnsController_getBatch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/returns/batches/{id}/receive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 确认收货（实物已到退货仓并清点；此后行不可增删） */
        post: operations["ReturnsController_receiveBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/returns/batches/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 取消批次（仅 DRAFT：实物未到、未入账） */
        post: operations["ReturnsController_cancelBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/returns/items/{itemId}/inspect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 检验退货行（一次性结论：SELLABLE/DEFECTIVE 经库存模块回库，LOST 不动库存；关联平台记录的差异行创建 RETURN_DIFFERENCE） */
        post: operations["ReturnsController_inspectItem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sync/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 手动触发订单同步（创建 SyncJob，立即返回） */
        post: operations["SyncController_triggerOrderSync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sync/listings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 手动触发 Listing 同步（创建 SyncJob，立即返回） */
        post: operations["SyncController_triggerListingSync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sync/category-tree": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 手动触发类目树同步（Sprint 8.5 T3a：ZH_HANS+RU 双语合并落缓存表） */
        post: operations["SyncController_triggerCategoryTreeSync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sync/product-enrichment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 手动触发商品属性补齐（Sprint 8.5 T5：v4 attributes 并入 raw_data） */
        post: operations["SyncController_triggerProductEnrichmentSync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sync/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 同步任务列表（Sync Dashboard） */
        get: operations["SyncController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sync/jobs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 同步任务详情（含游标与错误） */
        get: operations["SyncController_getById"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sync/stores/{storeId}/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 店铺同步概览（凭证状态/最近同步/连续失败） */
        get: operations["SyncController_storeOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sync/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 外部原始事件列表（Webhook 审计） */
        get: operations["SyncController_listEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/webhooks/ozon/stores/{storeCode}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** OZON push notification 入口（保存 raw event 后立即返回） */
        post: operations["OzonWebhookController_receive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 收支流水列表 */
        get: operations["FinanceController_listTransactions"];
        put?: never;
        /** 登记收支流水（追加型，不可修改；错账用冲正） */
        post: operations["FinanceController_createTransaction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/transactions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 收支流水详情 */
        get: operations["FinanceController_getTransaction"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/transactions/{id}/reverse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 冲正流水（生成方向相反的成对凭证） */
        post: operations["FinanceController_reverseTransaction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/payouts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 平台回款单列表 */
        get: operations["FinanceController_listPayouts"];
        put?: never;
        /** 登记平台回款单（DRAFT） */
        post: operations["FinanceController_createPayout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/payouts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 平台回款单详情 */
        get: operations["FinanceController_getPayout"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/payouts/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 回款对账预览（应计收入 vs 打款金额，人工判断） */
        get: operations["FinanceController_previewPayout"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/payouts/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 确认回款（自动生成销售收入流水，幂等） */
        post: operations["FinanceController_confirmPayout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/payouts/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 取消回款（仅 DRAFT；确认后错账走冲正） */
        post: operations["FinanceController_cancelPayout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/settlements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 订单结算列表（收入/成本/毛利快照） */
        get: operations["FinanceController_listSettlements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/settlements/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 订单结算详情（含行快照） */
        get: operations["FinanceController_getSettlement"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/settlements/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 生成单笔订单结算（仅已发货订单，幂等） */
        post: operations["FinanceController_generateSettlement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/settlements/generate-missing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 批量生成全部缺失结算（已发货未结算订单） */
        post: operations["FinanceController_generateMissingSettlements"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/settlements/{id}/fees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 修改结算费用（物流/其他，重算毛利；行快照不可改） */
        patch: operations["FinanceController_updateSettlementFees"];
        trace?: never;
    };
    "/api/v1/finance/payables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 采购应付列表（应付/已付/未付均为派生值） */
        get: operations["FinanceController_listPayables"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/finance/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 财务汇总（期间收支/毛利/应付/回款，全部派生） */
        get: operations["FinanceController_summary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/transfers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 调拨单列表 */
        get: operations["TransferController_list"];
        put?: never;
        /** 登记调拨单（DRAFT，可继续增删行） */
        post: operations["TransferController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/transfers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 调拨单详情（含行与库位） */
        get: operations["TransferController_getDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/transfers/{id}/lines": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 调拨单追加明细行（仅 DRAFT） */
        post: operations["TransferController_addLine"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/transfers/{id}/lines/{lineId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** 调拨单删除明细行（仅 DRAFT） */
        delete: operations["TransferController_removeLine"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/transfers/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 确认调拨（单事务双段移库，任一行失败整体回滚） */
        post: operations["TransferController_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/transfers/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 取消调拨（仅 DRAFT，未碰库存） */
        post: operations["TransferController_cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dev/test-job": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** [DEV ONLY] Enqueue a test job into wcies.test queue */
        post: operations["DevController_createTestJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dev/storage-test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** [DEV ONLY] Upload a test file and read it back via signed URL */
        post: operations["StorageTestController_runStorageTest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        LivenessData: {
            /** @example ok */
            status: string;
        };
        ReadinessChecksDto: {
            /**
             * @example up
             * @enum {string}
             */
            postgres: "up" | "down";
            /**
             * @example up
             * @enum {string}
             */
            redis: "up" | "down";
        };
        ReadinessData: {
            /** @example ok */
            status: string;
            checks: components["schemas"]["ReadinessChecksDto"];
        };
        UserResponseDto: {
            /** Format: uuid */
            id: string;
            /** @example admin */
            username: string;
            /** @example admin@wcies.local */
            email: Record<string, never> | null;
            /** @example ADMIN */
            role: string;
            /** @example ACTIVE */
            status: string;
        };
        LoginResponseDataDto: {
            user: components["schemas"]["UserResponseDto"];
        };
        LoginRequestDto: {
            /**
             * @description Username or email
             * @example admin
             */
            usernameOrEmail: string;
            /** @description Plain password (transit only, never stored) */
            password: string;
        };
        PlatformResponseDto: {
            /** Format: uuid */
            id: string;
            /** @example OZON */
            code: string;
            /** @example OZON */
            name: string;
            /** @example ACTIVE */
            status: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        StoreListItemDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            platformId: string;
            /** @example OZON */
            platformCode: string;
            /** @example OZON */
            platformName: string;
            /** @example OZON-A */
            storeCode: string;
            /** @example OZON 店铺 A */
            name: string;
            /** @example 123456 */
            sellerId: Record<string, never> | null;
            /** @example RUB */
            defaultCurrency: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            settings: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** @example true */
            credentialConfigured: boolean;
            /** @example 2 */
            bindingCount: number;
        };
        StoreResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            platformId: string;
            /** @example OZON */
            platformCode: string;
            /** @example OZON */
            platformName: string;
            /** @example OZON-A */
            storeCode: string;
            /** @example OZON 店铺 A */
            name: string;
            /** @example 123456 */
            sellerId: Record<string, never> | null;
            /** @example RUB */
            defaultCurrency: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            settings: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CreateStoreRequestDto: {
            /**
             * Format: uuid
             * @description Platform the store belongs to
             */
            platformId: string;
            /** @description Auto-generated ({prefix}-%03d, e.g. ON-001) when omitted; immutable after creation */
            storeCode?: string;
            /** @example OZON 店铺 A */
            name: string;
            /** @example 123456 */
            sellerId?: string;
            /** @example RUB */
            defaultCurrency?: string;
            /** @description Free-form store settings */
            settings?: Record<string, never>;
        };
        UpdateStoreRequestDto: {
            /** @example OZON 店铺 A（新） */
            name?: string;
            /** @example 123456 */
            sellerId?: string;
            /** @example RUB */
            defaultCurrency?: string;
            settings?: Record<string, never>;
        };
        CredentialResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            storeId: string;
            /** @example MAIN_API */
            credentialType: string;
            /** @example ACTIVE */
            status: string;
            /**
             * @description Encrypted payload present and active
             * @example true
             */
            configured: boolean;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            lastValidatedAt: Record<string, never> | null;
            /**
             * @description VALID=已连接 INVALID=认证失败 NULL=未验证
             * @enum {string|null}
             */
            lastValidationStatus: "VALID" | "INVALID" | "ERROR" | null;
            /** @description 最近一次验证失败原因（已脱敏） */
            lastValidationError: string | null;
            /** Format: date-time */
            updatedAt: string;
        };
        UpsertCredentialRequestDto: {
            /**
             * @example MAIN_API
             * @enum {string}
             */
            credentialType: "MAIN_API";
            /** @description Plain credential payload (e.g. apiKey/clientId); encrypted at rest */
            payload: Record<string, never>;
        };
        CredentialValidateResultDto: {
            credentialId: string;
            storeId: string;
            /** @enum {string} */
            validationStatus: "VALID" | "INVALID" | "ERROR";
            error: string | null;
            /** Format: date-time */
            validatedAt: string;
        };
        BrandResponseDto: {
            /** Format: uuid */
            id: string;
            /** @example BN00001 */
            code: string;
            /** @example Valkyrie */
            name: string;
            /** @example 瓦尔基里 */
            nameZh: Record<string, never> | null;
            nameEn: Record<string, never> | null;
            nameRu: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CreateBrandRequestDto: {
            /** @description Auto-generated (BN%05d) when omitted */
            code?: string;
            /**
             * @description General name; default display name
             * @example Valkyrie
             */
            name: string;
            /** @example 瓦尔基里 */
            nameZh?: string;
            /** @example Valkyrie */
            nameEn?: string;
            /** @example ВАЛЬКИРИЯ */
            nameRu?: string;
        };
        UpdateBrandRequestDto: {
            name?: string;
            nameZh?: string;
            nameEn?: string;
            nameRu?: string;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE";
        };
        CategoryTreeItemDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            parentId: Record<string, never> | null;
            /** @example CN00251 */
            code: string;
            /** @example 键盘 */
            nameZh: string;
            nameRu: Record<string, never> | null;
            /**
             * @description 1..3; products may only reference level 3
             * @example 3
             */
            level: number;
            /** @example 0 */
            sortOrder: number;
            /** @example ACTIVE */
            status: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            children: components["schemas"]["CategoryTreeItemDto"][];
        };
        CategoryTreeLiteItemDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            parentId: Record<string, never> | null;
            /** @example CN00251 */
            code: string;
            /** @example 键盘 */
            nameZh: string;
            nameRu: Record<string, never> | null;
            /**
             * @description 1..3; products may only reference level 3
             * @example 3
             */
            level: number;
            /** @example 0 */
            sortOrder: number;
            /** @example ACTIVE */
            status: string;
            children: components["schemas"]["CategoryTreeLiteItemDto"][];
        };
        CategoryResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            parentId: Record<string, never> | null;
            /** @example CN00251 */
            code: string;
            /** @example 键盘 */
            nameZh: string;
            nameRu: Record<string, never> | null;
            /**
             * @description 1..3; products may only reference level 3
             * @example 3
             */
            level: number;
            /** @example 0 */
            sortOrder: number;
            /** @example ACTIVE */
            status: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CreateCategoryRequestDto: {
            /** Format: uuid */
            parentId?: Record<string, never> | null;
            /**
             * @description Auto-generated (CN%05d) when omitted
             * @example CN00251
             */
            code?: string;
            /** @example 键盘 */
            nameZh: string;
            /** @example Клавиатуры */
            nameRu?: string;
            /** @example 0 */
            sortOrder?: number;
        };
        UpdateCategoryRequestDto: {
            /** Format: uuid */
            parentId?: Record<string, never> | null;
            nameZh?: string;
            nameRu?: string;
            /** @example 0 */
            sortOrder?: number;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE";
        };
        ProductListItemDto: {
            /** Format: uuid */
            id: string;
            /** @example PRD000001 */
            productCode: string;
            /** @example VALKYRIE VK87 MAX V2 机械键盘 */
            nameZh: string;
            nameRu: Record<string, never> | null;
            /** Format: uuid */
            categoryId: Record<string, never> | null;
            categoryName: Record<string, never> | null;
            /** Format: uuid */
            brandId: Record<string, never> | null;
            brandName: Record<string, never> | null;
            /** Format: uuid */
            mainImageId: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            remark: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** @example 2 */
            skuCount: number;
        };
        ProductResponseDto: {
            /** Format: uuid */
            id: string;
            /** @example PRD000001 */
            productCode: string;
            /** @example VALKYRIE VK87 MAX V2 机械键盘 */
            nameZh: string;
            nameRu: Record<string, never> | null;
            /** Format: uuid */
            categoryId: Record<string, never> | null;
            categoryName: Record<string, never> | null;
            /** Format: uuid */
            brandId: Record<string, never> | null;
            brandName: Record<string, never> | null;
            /** Format: uuid */
            mainImageId: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            remark: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CreateProductRequestDto: {
            /**
             * @description Auto-generated (PN%06d) when omitted; read-only after creation
             * @example PN000001
             */
            productCode?: string;
            /** @example VALKYRIE VK87 MAX V2 机械键盘 */
            nameZh: string;
            nameRu?: string;
            /** Format: uuid */
            categoryId?: string;
            /** Format: uuid */
            brandId?: string;
            remark?: string;
        };
        SkuResponseDto: {
            /** Format: uuid */
            id: string;
            /** @example SKU000001 */
            skuCode: string;
            /** @example VK87 MAX V2 黑色 */
            nameZh: string;
            nameRu: Record<string, never> | null;
            /** Format: uuid */
            productId: string;
            /** @example PRD000001 */
            productCode: string;
            /** @example VALKYRIE VK87 MAX V2 机械键盘 */
            productName: string;
            model: Record<string, never> | null;
            color: Record<string, never> | null;
            size: Record<string, never> | null;
            /**
             * @description Grams (g)
             * @example 950
             */
            weightG: Record<string, never> | null;
            /**
             * @description Millimeters (integer)
             * @example 355
             */
            lengthMm: Record<string, never> | null;
            /**
             * @description Millimeters (integer)
             * @example 122
             */
            widthMm: Record<string, never> | null;
            /**
             * @description Millimeters (integer)
             * @example 34
             */
            heightMm: Record<string, never> | null;
            /** @description Backend-computed: length_mm x width_mm x height_mm (read-only) */
            volumeMm3: Record<string, never> | null;
            /** @description Procurement link */
            purchaseUrl: Record<string, never> | null;
            latestPurchasePrice: Record<string, never> | null;
            /** @description Reserved; null until the purchase sprint (task §24) */
            movingAverageCost: Record<string, never> | null;
            /** @example CNY */
            costCurrency: string;
            /** @example false */
            serialTracking: boolean;
            /** @example ACTIVE */
            status: string;
            remark: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        ProductDetailDto: {
            product: components["schemas"]["ProductResponseDto"];
            skus: components["schemas"]["SkuResponseDto"][];
        };
        UpdateProductRequestDto: {
            nameZh?: string;
            nameRu?: string;
            /** Format: uuid */
            categoryId?: Record<string, never>;
            /** Format: uuid */
            brandId?: Record<string, never>;
            /**
             * Format: uuid
             * @description Must reference one of this product SKU images
             */
            mainImageId?: Record<string, never>;
            remark?: string;
        };
        SkuListItemDto: {
            /** Format: uuid */
            id: string;
            /** @example SKU000001 */
            skuCode: string;
            /** @example VK87 MAX V2 黑色 */
            nameZh: string;
            nameRu: Record<string, never> | null;
            /** Format: uuid */
            productId: string;
            /** @example PRD000001 */
            productCode: string;
            /** @example VALKYRIE VK87 MAX V2 机械键盘 */
            productName: string;
            model: Record<string, never> | null;
            color: Record<string, never> | null;
            size: Record<string, never> | null;
            /**
             * @description Grams (g)
             * @example 950
             */
            weightG: Record<string, never> | null;
            /**
             * @description Millimeters (integer)
             * @example 355
             */
            lengthMm: Record<string, never> | null;
            /**
             * @description Millimeters (integer)
             * @example 122
             */
            widthMm: Record<string, never> | null;
            /**
             * @description Millimeters (integer)
             * @example 34
             */
            heightMm: Record<string, never> | null;
            /** @description Backend-computed: length_mm x width_mm x height_mm (read-only) */
            volumeMm3: Record<string, never> | null;
            /** @description Procurement link */
            purchaseUrl: Record<string, never> | null;
            latestPurchasePrice: Record<string, never> | null;
            /** @description Reserved; null until the purchase sprint (task §24) */
            movingAverageCost: Record<string, never> | null;
            /** @example CNY */
            costCurrency: string;
            /** @example false */
            serialTracking: boolean;
            /** @example ACTIVE */
            status: string;
            remark: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: uuid */
            brandId: Record<string, never> | null;
            brandName: Record<string, never> | null;
            /** @description Primary barcode value */
            primaryBarcode: Record<string, never> | null;
            /** @description Signed URL of the primary image */
            primaryImageUrl: Record<string, never> | null;
            /** @example 3 */
            listingCount: number;
        };
        CreateSkuRequestDto: {
            /**
             * @description Auto-generated (SKU{product seq 6}{in-product seq 3}) when omitted; frozen after creation
             * @example SKU000001001
             */
            skuCode?: string;
            /** Format: uuid */
            productId: string;
            /** @example VK87 MAX V2 黑色 */
            nameZh: string;
            nameRu?: string;
            /** @example VK87MAX */
            model?: string;
            /** @example 黑色 */
            color?: string;
            /** @example 87键 */
            size?: string;
            /**
             * @description Grams (g), up to 3 decimals
             * @example 950
             */
            weightG?: number;
            /**
             * @description Millimeters, integer. Provide with width and height or not at all
             * @example 355
             */
            lengthMm?: number;
            /**
             * @description Millimeters, integer
             * @example 122
             */
            widthMm?: number;
            /**
             * @description Millimeters, integer
             * @example 34
             */
            heightMm?: number;
            /**
             * @description Procurement link (1688 / taobao / ...)
             * @example https://detail.1688.com/offer/123.html
             */
            purchaseUrl?: string;
            /**
             * @description Manually maintained in Sprint 1; up to 4 decimals
             * @example 299
             */
            latestPurchasePrice?: number;
            /**
             * @default CNY
             * @example CNY
             */
            costCurrency: string;
            /**
             * @description SN tracking config only (task §25)
             * @example false
             */
            serialTracking?: boolean;
            remark?: string;
        };
        UpdateSkuRequestDto: {
            nameZh?: string;
            nameRu?: string;
            model?: string;
            color?: string;
            size?: string;
            /** @description Grams (g), up to 3 decimals */
            weightG?: number;
            /** @description Millimeters, integer. Provide with width and height or not at all */
            lengthMm?: number;
            /** @description Millimeters, integer */
            widthMm?: number;
            /** @description Millimeters, integer */
            heightMm?: number;
            /** @description Procurement link */
            purchaseUrl?: string;
            /** @description Purchase price, up to 4 decimals */
            latestPurchasePrice?: number;
            costCurrency?: string;
            serialTracking?: boolean;
            remark?: string;
        };
        BarcodeResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            skuId: string;
            /** @example 6971234567890 */
            barcode: string;
            /** @example EAN */
            barcodeType: string;
            /** @example true */
            isPrimary: boolean;
            /** @example ACTIVE */
            status: string;
            /** Format: date-time */
            createdAt: string;
        };
        CreateBarcodeRequestDto: {
            /** @example 6971234567890 */
            barcode: string;
            /**
             * @description 69码 uses EAN/GTIN (task §29)
             * @example EAN
             * @enum {string}
             */
            barcodeType: "EAN" | "GTIN" | "MANUFACTURER" | "INTERNAL" | "OTHER";
            /**
             * @description First barcode of a SKU becomes primary automatically
             * @example true
             */
            isPrimary?: boolean;
        };
        UpdateBarcodeRequestDto: {
            /** @enum {string} */
            barcodeType?: "EAN" | "GTIN" | "MANUFACTURER" | "INTERNAL" | "OTHER";
            /** @description DB keeps at most one primary per SKU */
            isPrimary?: boolean;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE";
        };
        SkuImageResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            skuId: string;
            /** @example 0 */
            sortOrder: number;
            /** @example true */
            isPrimary: boolean;
            /** @example image/webp */
            mimeType: string;
            /** @example 12345 */
            fileSize: number;
            width: Record<string, never> | null;
            height: Record<string, never> | null;
            /**
             * @description Short-lived signed URL (private bucket)
             * @example https://...
             */
            url: string;
            /** Format: date-time */
            createdAt: string;
        };
        UpdateSkuImageRequestDto: {
            /** @example 0 */
            sortOrder?: number;
            /** @description DB keeps at most one primary per SKU */
            isPrimary?: boolean;
        };
        BarcodeResolveDto: {
            /** Format: uuid */
            skuId: string;
            /** @example SKU000001001 */
            skuCode: string;
            /** @example VK87 MAX V2 黑色 */
            skuName: string;
            /** @example 6971234567890 */
            matchedBarcode: string;
            /** @example EAN */
            barcodeType: string;
            /** @example false */
            serialTracking: boolean;
            /**
             * @description 建议单位成本（移动加权），未知时为 null
             * @example 12.3400
             */
            suggestedUnitCost: string | null;
            /** @enum {string|null} */
            suggestedUnitCostSource: "MOVING_AVERAGE" | null;
        };
        WarehouseListItemDto: {
            /** Format: uuid */
            id: string;
            /** @example SZ01 */
            warehouseCode: string;
            /** @example 深圳自管仓 */
            name: string;
            /** @example SELF */
            warehouseType: string;
            /** @example CN */
            countryCode: Record<string, never> | null;
            province: Record<string, never> | null;
            city: Record<string, never> | null;
            address: Record<string, never> | null;
            contactName: Record<string, never> | null;
            contactPhone: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            remark: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** @example 20 */
            binCount: number;
            /** @example 4 */
            boundStoreCount: number;
        };
        WarehouseResponseDto: {
            /** Format: uuid */
            id: string;
            /** @example SZ01 */
            warehouseCode: string;
            /** @example 深圳自管仓 */
            name: string;
            /** @example SELF */
            warehouseType: string;
            /** @example CN */
            countryCode: Record<string, never> | null;
            province: Record<string, never> | null;
            city: Record<string, never> | null;
            address: Record<string, never> | null;
            contactName: Record<string, never> | null;
            contactPhone: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            remark: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CreateWarehouseRequestDto: {
            /** @description Auto-generated ({prefix}-%02d, e.g. ZG-01) when omitted; immutable after creation */
            warehouseCode?: string;
            /** @example 深圳自管仓 */
            name: string;
            /**
             * @example SELF
             * @enum {string}
             */
            warehouseType: "SELF" | "PLATFORM" | "THIRD_PARTY" | "RETURN_TEMP";
            /** @example CN */
            countryCode?: string;
            /** @example 广东 */
            province?: string;
            /** @example 深圳 */
            city?: string;
            /** @example 深圳市宝安区... */
            address?: string;
            contactName?: string;
            contactPhone?: string;
            remark?: string;
        };
        UpdateWarehouseRequestDto: {
            name?: string;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE";
            countryCode?: string;
            province?: string;
            city?: string;
            address?: string;
            contactName?: string;
            contactPhone?: string;
            remark?: string;
        };
        BinResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            warehouseId: string;
            /** @example ZG-01-A01-1 */
            binCode: string;
            zone: Record<string, never> | null;
            rack: Record<string, never> | null;
            level: Record<string, never> | null;
            position: Record<string, never> | null;
            /** @example ZG-01-A01-1 */
            barcode: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            remark: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CreateBinRequestDto: {
            /**
             * @description 完整库位编码，仅导入与特例使用；一般留空，由 zone + rackNumber + level 生成
             * @example ZG-01-A03-1
             */
            binCode?: string;
            /**
             * @description 库区；同时作为货架编码前缀（A → 货架 A03）
             * @example A
             */
            zone?: string;
            /**
             * @description 货架号；与 zone 组合成完整货架（区 A + 3 → A03）。与 rack 二选一。
             * @example 3
             */
            rackNumber?: number;
            /**
             * @description 完整货架值，仅导入使用；一般用 rackNumber
             * @example A03
             */
            rack?: string;
            /**
             * @description 层号
             * @example 1
             */
            level?: string;
            /**
             * @description 位号（选填）
             * @example 02
             */
            position?: string;
            /**
             * @description 留空则与库位编码相同
             * @example ZG-01-A03-1
             */
            barcode?: string;
            remark?: string;
        };
        BatchCreateBinsResponseDto: {
            /** @example 20 */
            createdCount: number;
            bins: components["schemas"]["BinResponseDto"][];
        };
        BatchCreateBinsRequestDto: {
            /**
             * @description 库区；同时作为货架编码前缀（A → 货架 A01）。留空则货架编码无前缀。
             * @example A
             */
            zone?: string;
            /**
             * @description 起始货架号（含）
             * @example 1
             */
            rackStart: number;
            /**
             * @description 货架数量
             * @example 5
             */
            rackCount: number;
            /**
             * @description 每个货架的层数
             * @example 4
             */
            levelsPerRack: number;
        };
        UpdateBinRequestDto: {
            zone?: string;
            rack?: string;
            level?: string;
            position?: string;
            barcode?: string;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE";
            remark?: string;
        };
        BindingResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            storeId: string;
            /** @example OZON-A */
            storeCode: string;
            /** @example OZON A店 */
            storeName: string;
            /** @example OZON */
            platformCode: string;
            /** Format: uuid */
            warehouseId: string;
            /** @example SZ01 */
            warehouseCode: string;
            /** @example 深圳自管仓 */
            warehouseName: string;
            /** @example OZON_RFBS */
            fulfillmentMode: string;
            platformWarehouseId: Record<string, never> | null;
            /** @example true */
            isInventorySource: boolean;
            /** @example false */
            isInventoryPushEnabled: boolean;
            /** @example 100 */
            priority: number;
            settings: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CreateBindingRequestDto: {
            /** Format: uuid */
            warehouseId: string;
            /**
             * @example OZON_RFBS
             * @enum {string}
             */
            fulfillmentMode: "OZON_RFBS" | "OZON_FBS" | "OZON_FBO" | "OZON_FBP" | "WB_FBS" | "WB_FBW" | "YANDEX_FBS" | "YANDEX_FBY";
            /**
             * @description Warehouse id on the platform side
             * @example 123456
             */
            platformWarehouseId?: string;
            /** @default true */
            isInventorySource: boolean;
            /** @default false */
            isInventoryPushEnabled: boolean;
            /** @example 100 */
            priority?: number;
            settings?: Record<string, never>;
        };
        UpdateBindingRequestDto: {
            platformWarehouseId?: string;
            isInventorySource?: boolean;
            isInventoryPushEnabled?: boolean;
            priority?: number;
            settings?: Record<string, never>;
            /** @enum {string} */
            status?: "ACTIVE" | "DISABLED";
        };
        ListingResponseDto: {
            /** Format: uuid */
            id: string;
            /**
             * Format: date-time
             * @description 最近一次被 Listing Sync 观察到的时间
             */
            lastSeenAt: string | null;
            /** Format: uuid */
            platformId: string;
            /** @example OZON */
            platformCode: string;
            /** Format: uuid */
            storeId: string;
            /** @example OZON-A */
            storeCode: string;
            /** @example OZON A店 */
            storeName: string;
            /** @example 152987456001 */
            platformProductId: string;
            title: Record<string, never> | null;
            url: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /**
             * @description 该 Listing 的变体映射总数（含未映射）
             * @example 2
             */
            mappingCount: number;
            /**
             * @description 是否至少有一个 ACTIVE 且已绑定内部 SKU 的变体；与 mappingState 筛选同一判定
             * @example MAPPED
             * @enum {string}
             */
            mappingStatus: "MAPPED" | "UNMAPPED";
            /**
             * @description 是否有未解决的 ORDER_SKU_MAPPING_FAILED 异常撞上该 Listing（派生展示，Sprint 8 T3）
             * @example false
             */
            hasOrderException: boolean;
        };
        ListingSkuResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            listingId: string;
            /**
             * Format: uuid
             * @description UNMAPPED 平台SKU为 null
             */
            skuId: Record<string, never> | null;
            /**
             * @description UNMAPPED 行为 null
             * @example SKU000001
             */
            skuCode: Record<string, never> | null;
            /**
             * @description UNMAPPED 行为 null
             * @example VK87 MAX V2 黑色
             */
            skuName: Record<string, never> | null;
            /**
             * @description 人工映射状态（Sprint 5）
             * @enum {string}
             */
            mappingStatus: "UNMAPPED" | "MAPPED";
            platformSkuId: Record<string, never> | null;
            sellerSku: Record<string, never> | null;
            offerId: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        ListingDetailDto: {
            /** Format: uuid */
            id: string;
            /**
             * Format: date-time
             * @description 最近一次被 Listing Sync 观察到的时间
             */
            lastSeenAt: string | null;
            /** Format: uuid */
            platformId: string;
            /** @example OZON */
            platformCode: string;
            /** Format: uuid */
            storeId: string;
            /** @example OZON-A */
            storeCode: string;
            /** @example OZON A店 */
            storeName: string;
            /** @example 152987456001 */
            platformProductId: string;
            title: Record<string, never> | null;
            url: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /**
             * @description 该 Listing 的变体映射总数（含未映射）
             * @example 2
             */
            mappingCount: number;
            /**
             * @description 是否至少有一个 ACTIVE 且已绑定内部 SKU 的变体；与 mappingState 筛选同一判定
             * @example MAPPED
             * @enum {string}
             */
            mappingStatus: "MAPPED" | "UNMAPPED";
            /**
             * @description 是否有未解决的 ORDER_SKU_MAPPING_FAILED 异常撞上该 Listing（派生展示，Sprint 8 T3）
             * @example false
             */
            hasOrderException: boolean;
            skus: components["schemas"]["ListingSkuResponseDto"][];
        };
        ListingSkuVariantDto: {
            /** Format: uuid */
            skuId: string;
            /** @example 152987456 */
            platformSkuId?: string;
            /** @example VK87-BLK */
            sellerSku?: string;
            /** @example ABC */
            offerId?: string;
        };
        CreateListingRequestDto: {
            /** Format: uuid */
            platformId: string;
            /** Format: uuid */
            storeId: string;
            /** @example 152987456001 */
            platformProductId: string;
            /** @example VK87 MAX V2 机械键盘 */
            title?: string;
            /** @example https://ozon.ru/product/152987456001 */
            url?: string;
            rawData?: Record<string, never>;
            /** @description Variant rows mapped in one submit */
            skuVariants: components["schemas"]["ListingSkuVariantDto"][];
        };
        ResolveSkuResponseDto: {
            /** Format: uuid */
            listingId: string;
            /** Format: uuid */
            listingSkuId: string;
            /** Format: uuid */
            internalSkuId: string;
            /** @example SKU000001 */
            internalSkuCode: string;
            /**
             * @description 决策 0016 起恒为 null：Offer ID 可被运营修改，不作为订单解析依据（字段保留兼容）
             * @example null
             */
            matchedOfferId: Record<string, never> | null;
            /** @example VK87-BLK */
            matchedSellerSku: Record<string, never> | null;
            /** @example 152987456 */
            matchedPlatformSkuId: Record<string, never> | null;
        };
        ListingMappingStatsDto: {
            /** @example 1 */
            mapped: number;
            /** @example 1323 */
            unmapped: number;
        };
        OnboardContextVariantDto: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            mappingStatus: "UNMAPPED" | "MAPPED";
            platformSkuId: Record<string, never> | null;
            offerId: Record<string, never> | null;
            sellerSku: Record<string, never> | null;
            /** @description 已映射时该变体绑定的内部 SKU 编码 */
            skuCode: Record<string, never> | null;
            /** @description 已映射时该变体绑定的内部商品 id（挂靠目标） */
            productId: Record<string, never> | null;
            /** @description 已映射时该变体绑定的内部商品编码 */
            productCode: Record<string, never> | null;
            /** @description raw_data.primary_image CDN 直链 */
            primaryImage: Record<string, never> | null;
            /** @description raw_data.color_image CDN 直链（转存优先用它） */
            colorImage: Record<string, never> | null;
            /** @description 平台类目 id（raw_data.description_category_id） */
            descriptionCategoryId: Record<string, never> | null;
            /** @description 平台类型 id（raw_data.type_id） */
            descriptionTypeId: Record<string, never> | null;
            /**
             * Format: uuid
             * @description 复合键命中的内部三级分类（未命中为 null，人工选择）
             */
            suggestedCategoryId: Record<string, never> | null;
            /** @description v4 enrichment 预填重量（g） */
            weightG: Record<string, never> | null;
            /** @description v4 enrichment 预填长（mm） */
            lengthMm: Record<string, never> | null;
            /** @description v4 enrichment 预填宽（mm） */
            widthMm: Record<string, never> | null;
            /** @description v4 enrichment 预填高（mm） */
            heightMm: Record<string, never> | null;
        };
        ListingOnboardContextDto: {
            /** Format: uuid */
            listingId: string;
            title: Record<string, never> | null;
            /**
             * Format: uuid
             * @description 缺省挂靠目标：该 Listing 首个已建档变体的商品；无则为 null（新建）
             */
            defaultAttachProductId: Record<string, never> | null;
            /** @example PN000012 */
            defaultAttachProductCode: Record<string, never> | null;
            /** @example VK87 MAX V2 机械键盘 */
            defaultAttachProductName: Record<string, never> | null;
            variants: components["schemas"]["OnboardContextVariantDto"][];
        };
        UnmappedListingExportResponseDto: {
            /** @example exports/unmapped-listings/1760000000000-unmapped-listings.xlsx */
            objectKey: string;
            /** @description 短时效签名下载链接（直接打开即下载） */
            downloadUrl: string;
            /**
             * @description 导出的未映射变体行数
             * @example 1323
             */
            rowCount: number;
        };
        UnmappedListingExportRequestDto: {
            /** Format: uuid */
            platformId?: string;
            /** Format: uuid */
            storeId?: string;
        };
        SkuMappingRowDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            listingId: string;
            /**
             * Format: uuid
             * @description UNMAPPED 平台SKU为 null
             */
            skuId: Record<string, never> | null;
            /**
             * @description UNMAPPED 行为 null
             * @example SKU000001
             */
            skuCode: Record<string, never> | null;
            /**
             * @description UNMAPPED 行为 null
             * @example VK87 MAX V2 黑色
             */
            skuName: Record<string, never> | null;
            /**
             * @description 人工映射状态（Sprint 5）
             * @enum {string}
             */
            mappingStatus: "UNMAPPED" | "MAPPED";
            platformSkuId: Record<string, never> | null;
            sellerSku: Record<string, never> | null;
            offerId: Record<string, never> | null;
            /** @example ACTIVE */
            status: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** @example OZON */
            platformCode: string;
            /** @example OZON-A */
            storeCode: string;
            /** @example 152987456001 */
            platformProductId: string;
            /** @example VK87 MAX V2 机械键盘 */
            title: string | null;
            url: string | null;
        };
        UpdateListingRequestDto: {
            title?: string;
            url?: string;
            rawData?: Record<string, never>;
        };
        AddListingSkuRequestDto: {
            /** Format: uuid */
            skuId: string;
            platformSkuId?: string;
            sellerSku?: string;
            offerId?: string;
        };
        MapListingSkuRequestDto: {
            /**
             * Format: uuid
             * @description 目标 Internal SKU
             */
            skuId: string;
        };
        ListingOnboardProductDto: {
            /** Format: uuid */
            id: string;
            /** @example PN000012 */
            productCode: string;
            /** @example VK87 MAX V2 机械键盘 */
            nameZh: string;
        };
        ListingOnboardSkuDto: {
            /** Format: uuid */
            id: string;
            /** @example SKU000012001 */
            skuCode: string;
            /** @example VK87 MAX V2 机械键盘 */
            nameZh: string;
        };
        ListingOnboardResponseDto: {
            /** Format: uuid */
            listingId: string;
            /** Format: uuid */
            mappingId: string;
            /**
             * @description 成功后恒为 MAPPED
             * @enum {string}
             */
            mappingStatus: "MAPPED";
            product: components["schemas"]["ListingOnboardProductDto"];
            sku: components["schemas"]["ListingOnboardSkuDto"];
            /**
             * @description 未勾选生成时为 null
             * @example W00000042
             */
            barcode: Record<string, never> | null;
            /**
             * @description Sprint 8.5 T2：本次是否新建了商品（false = 挂靠已有商品）
             * @example false
             */
            productCreated: boolean;
        };
        ListingOnboardRequestDto: {
            /** @description 商品名；缺省取 Listing 标题 */
            productNameZh?: string;
            /** @description SKU 名；缺省取 Listing 标题 */
            skuNameZh?: string;
            /**
             * @description 同时生成内部条码（W…，决策 0017），生成后可直接打印标签
             * @default true
             */
            generateBarcode: boolean;
            /**
             * Format: uuid
             * @description Sprint 8.5 T2：挂靠到该已有商品（多变体同挂一个 Product）
             */
            existingProductId?: string;
            /** @description Sprint 8.5 T2：显式另建新商品（覆盖「缺省自动挂靠已有商品」） */
            createNewProduct?: boolean;
            /**
             * Format: uuid
             * @description Sprint 8.5 T4：商品品牌（仅新建商品时生效）
             */
            brandId?: string;
            /**
             * Format: uuid
             * @description Sprint 8.5 T3c：商品分类（三级，仅新建商品时生效）
             */
            categoryId?: string;
            /**
             * @description Sprint 8.5 T3c：记住「平台类目→内部类目」映射（onboard 同一事务写入，同类目后续自动命中）
             * @default true
             */
            rememberCategoryMapping: boolean;
            /** @description Sprint 8.5 T5：重量（g），可编辑预填 */
            weightG?: number;
            /** @description Sprint 8.5 T5：长（mm） */
            lengthMm?: number;
            /** @description Sprint 8.5 T5：宽（mm） */
            widthMm?: number;
            /** @description Sprint 8.5 T5：高（mm） */
            heightMm?: number;
            /** @description Sprint 8.5R1：最新采购价（CNY，人工录入通道；与仅由收货确认维护的移动加权平均成本无关） */
            latestPurchasePrice?: number;
        };
        UpdateListingSkuRequestDto: {
            platformSkuId?: Record<string, never> | null;
            sellerSku?: Record<string, never> | null;
            offerId?: Record<string, never> | null;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE";
        };
        CategoryImportStatsDto: {
            /** @example 7933 */
            totalNodes: number;
            /** @example 0 */
            skippedDisabled: number;
            /** @example 0 */
            skippedOrphaned: number;
            /** @example 22 */
            duplicateCompositeKeys: number;
            toCreate: Record<string, never>;
        };
        CategoryImportConflictDto: {
            /** @example 积木 */
            name: string;
            /** @example 3 */
            level: number;
            /** @example name_ru「Конструктор」与现有分类「积木」精确重名 */
            reason: string;
        };
        CategoryImportRenameDto: {
            /** @example 其他 */
            name: string;
            /** @example 其他 (91543) */
            renamedTo: string;
        };
        CategoryImportTopLevelPreviewDto: {
            /** @example 儿童用品 */
            nameZh: string;
            /** @example Детские товары */
            nameRu: Record<string, never> | null;
            /** @example 21 */
            level2Count: number;
            /** @example 289 */
            level3Count: number;
        };
        CategoryImportPreviewDto: {
            /** Format: uuid */
            platformId: string;
            stats: components["schemas"]["CategoryImportStatsDto"];
            conflicts: components["schemas"]["CategoryImportConflictDto"][];
            /** @description 同父同名候选的确定性去重命名（§89 不丢弃） */
            disambiguatedNames: components["schemas"]["CategoryImportRenameDto"][];
            /** @example 57 */
            disambiguatedCount: number;
            previewTopLevels: components["schemas"]["CategoryImportTopLevelPreviewDto"][];
        };
        CategoryImportRequestDto: {
            /** Format: uuid */
            platformId: string;
        };
        CategoryImportResultDto: {
            /** Format: uuid */
            platformId: string;
            created: Record<string, never>;
            /** @example 7365 */
            mappingCount: number;
        };
        ImportJobResponseDto: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            importType: "SKU" | "BARCODE" | "WAREHOUSE" | "BIN" | "LISTING_MAPPING" | "INITIAL_INVENTORY";
            /** @enum {string} */
            status: "VALIDATED" | "PENDING_IMPORT" | "IMPORTING" | "COMPLETED" | "FAILED";
            /** @example skus-2026.xlsx */
            originalFilename: string;
            /** @example 100 */
            totalRows: number;
            /** @example 92 */
            validRows: number;
            /** @example 8 */
            invalidRows: number;
            /** @example 92 */
            importedRows: number;
            /** @example 0 */
            failedRows: number;
            /** @description Row-level errors with exact Excel row numbers */
            errors: string[];
            createdBy: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            importedAt: Record<string, never> | null;
        };
        InventoryRowDto: {
            id: string;
            skuId: string;
            /** @example VK87-BLK */
            skuCode: string;
            /** @example VK87 MAX V2 黑色 */
            skuName: string;
            warehouseId: string;
            /** @example SZ01 */
            warehouseCode: string;
            /** @example 深圳自管仓 */
            warehouseName: string;
            binId: string;
            /** @example ZG-01-A01-1 */
            binCode: string;
            /** @enum {string} */
            condition: "SELLABLE" | "QC_PENDING" | "DEFECTIVE" | "REPAIR" | "SCRAPPED";
            /** @example 10.000 */
            onHandQty: string;
            /** @example 2.000 */
            reservedQty: string;
            /** @example 0.000 */
            pickedQty: string;
            /** @example 8.000 */
            physicalAvailableQty: string;
            /** @example 2.000 */
            safetyQty: string;
            /** @example 6.000 */
            sellableAvailableQty: string;
            /** @enum {string} */
            status: "IN_STOCK" | "OUT_OF_STOCK";
        };
        SkuInventoryTotalsDto: {
            onHandQty: string;
            reservedQty: string;
            pickedQty: string;
            physicalAvailableQty: string;
            safetyQty: string;
            sellableAvailableQty: string;
        };
        SkuInventoryWarehouseDto: {
            warehouseId: string;
            warehouseCode: string;
            warehouseName: string;
            onHandQty: string;
            reservedQty: string;
            pickedQty: string;
            physicalAvailableQty: string;
            safetyQty: string;
            sellableAvailableQty: string;
        };
        SkuInventoryDetailDto: {
            skuId: string;
            skuCode: string;
            skuName: string;
            totals: components["schemas"]["SkuInventoryTotalsDto"];
            warehouses: components["schemas"]["SkuInventoryWarehouseDto"][];
            bins: components["schemas"]["InventoryRowDto"][];
        };
        TransactionDto: {
            id: string;
            /** @example IEV00000042-1 */
            transactionNo: string;
            /** @example IEV00000042 */
            eventNo: string;
            /** @enum {string} */
            eventType: "INITIAL_STOCK" | "RECEIVE" | "RESERVE" | "RELEASE" | "PICK" | "UNPICK" | "SHIP" | "RETURN_PICKED" | "MOVE_BIN" | "MANUAL_ADJUSTMENT" | "TRANSFER_OUT" | "TRANSFER_IN";
            /** @enum {string} */
            transactionType: "INITIAL_STOCK" | "RECEIVE" | "RESERVE" | "RELEASE" | "PICK" | "UNPICK" | "SHIP" | "RETURN_PICKED" | "MOVE_BIN" | "MANUAL_ADJUSTMENT" | "TRANSFER_OUT" | "TRANSFER_IN";
            skuId: string;
            skuCode: string;
            warehouseId: string;
            warehouseCode: string;
            binId: string;
            binCode: string;
            quantityBefore: string;
            quantityChange: string;
            quantityAfter: string;
            reservedBefore?: Record<string, never> | null;
            reservedChange?: Record<string, never> | null;
            reservedAfter?: Record<string, never> | null;
            pickedBefore?: Record<string, never> | null;
            pickedChange?: Record<string, never> | null;
            pickedAfter?: Record<string, never> | null;
            /** @enum {string} */
            referenceType: "MANUAL" | "TEST" | "ORDER" | "IMPORT" | "PURCHASE_RECEIPT" | "RETURN_RECEIPT" | "TRANSFER";
            referenceId: string;
            operatorId?: Record<string, never> | null;
            operatorName?: Record<string, never> | null;
            remark?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
        };
        BalanceSnapshotDto: {
            balanceId: string;
            skuId: string;
            warehouseId: string;
            binId: string;
            /** @enum {string} */
            condition: "SELLABLE" | "QC_PENDING" | "DEFECTIVE" | "REPAIR" | "SCRAPPED";
            /** @example 10.000 */
            onHandQty: string;
            /** @example 0.000 */
            reservedQty: string;
            /** @example 0.000 */
            pickedQty: string;
        };
        StockChangeResultDto: {
            /** @example IEV00000042 */
            eventNo: string;
            /**
             * @example [
             *       "IEV00000042-1"
             *     ]
             */
            transactionNos: string[];
            balance: components["schemas"]["BalanceSnapshotDto"];
            /** @example false */
            idempotentReplay: boolean;
        };
        InitializeStockRequestDto: {
            skuId: string;
            warehouseId: string;
            /** @description 省略时仅允许无库位仓库（自动 DEFAULT 虚拟库位） */
            binId?: string;
            /**
             * @default SELLABLE
             * @enum {string}
             */
            condition: "SELLABLE" | "QC_PENDING" | "DEFECTIVE" | "REPAIR" | "SCRAPPED";
            /**
             * @description 允许 0（建立零余额记录），不允许负数
             * @example 10
             */
            quantity: string;
            /** @description SN 管理商品必填：与数量一致的 SN 列表；非 SN 商品禁止提供 */
            serialNumbers?: string[];
            /** @enum {string} */
            referenceType: "MANUAL" | "TEST" | "ORDER" | "IMPORT" | "PURCHASE_RECEIPT" | "RETURN_RECEIPT" | "TRANSFER";
            referenceId: string;
            remark?: string;
            /** @example INIT:PRD-VK87:2026-09-08 */
            idempotencyKey: string;
        };
        ReceiveStockRequestDto: {
            skuId: string;
            warehouseId: string;
            /** @description 省略时仅允许无库位仓库（自动 DEFAULT 虚拟库位） */
            binId?: string;
            /**
             * @default SELLABLE
             * @enum {string}
             */
            condition: "SELLABLE" | "QC_PENDING" | "DEFECTIVE" | "REPAIR" | "SCRAPPED";
            /**
             * @description 允许 0（建立零余额记录），不允许负数
             * @example 10
             */
            quantity: string;
            /** @description SN 管理商品必填：与数量一致的 SN 列表；非 SN 商品禁止提供 */
            serialNumbers?: string[];
            /** @enum {string} */
            referenceType: "MANUAL" | "TEST" | "ORDER" | "IMPORT" | "PURCHASE_RECEIPT" | "RETURN_RECEIPT" | "TRANSFER";
            referenceId: string;
            remark?: string;
            /** @example INIT:PRD-VK87:2026-09-08 */
            idempotencyKey: string;
        };
        AdjustStockRequestDto: {
            skuId: string;
            warehouseId: string;
            binId: string;
            /**
             * @default SELLABLE
             * @enum {string}
             */
            condition: "SELLABLE" | "QC_PENDING" | "DEFECTIVE" | "REPAIR" | "SCRAPPED";
            /**
             * @description 带符号增量，不允许 0
             * @example -1
             */
            quantityDelta: string;
            /** @example 盘点补录 */
            reason: string;
            remark?: string;
            idempotencyKey: string;
        };
        MoveBinResultDto: {
            /** @example IEV00000042 */
            eventNo: string;
            /**
             * @example [
             *       "IEV00000042-1"
             *     ]
             */
            transactionNos: string[];
            balance: components["schemas"]["BalanceSnapshotDto"];
            /** @example false */
            idempotentReplay: boolean;
            fromBalance: Record<string, never>;
            toBalance: Record<string, never>;
        };
        MoveBinRequestDto: {
            skuId: string;
            warehouseId: string;
            fromBinId: string;
            toBinId: string;
            /**
             * @default SELLABLE
             * @enum {string}
             */
            condition: "SELLABLE" | "QC_PENDING" | "DEFECTIVE" | "REPAIR" | "SCRAPPED";
            /** @example 4 */
            quantity: string;
            /** @enum {string} */
            referenceType: "MANUAL" | "TEST" | "ORDER" | "IMPORT" | "PURCHASE_RECEIPT" | "RETURN_RECEIPT" | "TRANSFER";
            referenceId: string;
            remark?: string;
            idempotencyKey: string;
        };
        ReservationLineDto: {
            id: string;
            binId: string;
            binCode: string;
            quantity: string;
            pickedQty: string;
            status: string;
        };
        ReservationDto: {
            id: string;
            /** @example RSV00000001 */
            reservationNo: string;
            skuId: string;
            skuCode: string;
            warehouseId: string;
            warehouseCode: string;
            /** @enum {string} */
            referenceType: "TEST" | "MANUAL" | "ORDER";
            referenceId: string;
            requestedQty: string;
            /** @enum {string} */
            status: "ACTIVE" | "PICKED" | "RELEASED" | "CONSUMED" | "CANCELLED";
            remark?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            pickedAt?: string | null;
            /** Format: date-time */
            releasedAt?: string | null;
            /** Format: date-time */
            consumedAt?: string | null;
            lines: components["schemas"]["ReservationLineDto"][];
            /** @example false */
            idempotentReplay: boolean;
        };
        ReserveStockRequestDto: {
            skuId: string;
            warehouseId: string;
            /** @example 3 */
            quantity: string;
            /** @enum {string} */
            referenceType: "TEST" | "MANUAL" | "ORDER";
            referenceId: string;
            remark?: string;
            /** @example ORDER_RESERVE:orderItem123 */
            idempotencyKey: string;
        };
        ReplenishmentSuggestionDto: {
            skuId: string;
            /** @example SKU000001001 */
            skuCode: string;
            /** @example 浴帘 黑色 */
            skuName: string;
            /** @example ACTIVE */
            skuStatus: string;
            /** @example 6.000 */
            onHandQty: string;
            /** @example 2.000 */
            reservedQty: string;
            /** @example 0.000 */
            pickedQty: string;
            /** @example 4.000 */
            availableQty: string;
            /** @example 2.000 */
            safetyQty: string;
            /** @example 30.000 */
            shippedInWindowQty: string;
            /** @example 1.000 */
            dailyVelocityQty: string;
            /** @example 12.000 */
            openPoQty: string;
            /** @example 16.000 */
            suggestedQty: string;
            needsReplenishment: boolean;
        };
        ReservationListItemDto: {
            id: string;
            reservationNo: string;
            skuId: string;
            skuCode: string;
            warehouseId: string;
            warehouseCode: string;
            referenceType: string;
            referenceId: string;
            requestedQty: string;
            /** @enum {string} */
            status: "ACTIVE" | "PICKED" | "RELEASED" | "CONSUMED" | "CANCELLED";
            remark?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            pickedAt?: string | null;
            /** Format: date-time */
            releasedAt?: string | null;
            /** Format: date-time */
            consumedAt?: string | null;
        };
        ReservationLifecycleRequestDto: {
            /** @description 同一业务事件重复请求时传相同 key 以幂等重放 */
            idempotencyKey?: string;
            remark?: string;
        };
        SafetyStockDto: {
            id: string;
            skuId: string;
            skuCode: string;
            warehouseId: string;
            warehouseCode: string;
            safetyQty: string;
            /** Format: date-time */
            updatedAt: string;
        };
        UpsertSafetyStockRequestDto: {
            /** @example 2 */
            safetyQty: string;
        };
        ExceptionItemDto: {
            id: string;
            /** @example EXC00000001 */
            exceptionNo: string;
            /** @enum {string} */
            exceptionType: "ORDER_SKU_MAPPING_FAILED" | "ORDER_OUT_OF_STOCK" | "ORDER_INVALID_STATE" | "ORDER_INTERCEPTION_FAILED" | "ORDER_SHIPMENT_DEADLINE_NEAR" | "SYNC_FAILED" | "ORDER_TRACKING_STALLED" | "ORDER_CANCELLED_AFTER_SHIP" | "RETURN_ORDER_NOT_FOUND" | "RETURN_DIFFERENCE";
            /** @enum {string} */
            severity: "LOW" | "MEDIUM" | "HIGH";
            /** @enum {string} */
            status: "OPEN" | "RESOLVED" | "IGNORED";
            /** @example ORDER_ITEM */
            referenceType: string;
            referenceId: string;
            storeId: string | null;
            message: string;
            details: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            resolvedAt: string | null;
        };
        ExceptionCloseRequestDto: {
            /** @description 处理备注（记录在 details.closeRemark） */
            remark?: string;
        };
        OrderListItemDto: {
            id: string;
            /** @example ORD00000001 */
            orderNo: string;
            storeId: string;
            /** @example OZON A店 */
            storeName: string;
            /** @example OZON */
            platformCode: string;
            /** @example 123456789 */
            platformOrderId: string;
            /** @example awaiting_packaging */
            platformStatus: string | null;
            /** @enum {string} */
            erpStatus: "NEW" | "ALLOCATING" | "READY_TO_PICK" | "PARTIALLY_BACKORDERED" | "BACKORDERED" | "PICKING" | "PICKED" | "PARTIALLY_SHIPPED" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
            fulfillmentMode: string | null;
            currency: string | null;
            /** Format: date-time */
            orderedAt: string;
            /**
             * Format: date-time
             * @description 平台要求的发货截止时间（平台事实，非 ERP 状态）
             */
            shipmentDeadline?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** @enum {string|null} */
            syncSource: "MANUAL" | "API" | "POLLING" | "WEBHOOK" | null;
            itemsCount: number;
            reservedCount: number;
            backorderedCount: number;
            pickedCount: number;
            mappingFailedCount: number;
            openExceptionsCount: number;
            /** @description 缺货行中已登记采购（ORDERED，purchase.md §3.5 派生）的行数（双轴 §2.3） */
            backorderedOrderedCount?: number;
            /** @description 缺货行中采购已到货（ARRIVED，purchase.md §3.5 派生）的行数（双轴 §2.3） */
            backorderedArrivedCount?: number;
        };
        OrderItemExceptionDto: {
            id: string;
            /** @example EXC00000001 */
            exceptionNo: string;
            exceptionType: string;
            status: string;
            message: string;
        };
        OrderItemDto: {
            id: string;
            orderId: string;
            lineNo: number;
            platformProductId: string | null;
            platformSkuId: string | null;
            sellerSku: string | null;
            offerId: string | null;
            listingSkuId: string | null;
            skuId: string | null;
            /** @example VK87-BLK */
            skuCode: string;
            /** @example VK87 MAX V2 黑色 */
            skuName: string;
            warehouseId: string | null;
            /** @example 2.000 */
            quantity: string;
            /**
             * @description 平台单价（财务事实，finance.md §2）；平台未提供为 null
             * @example 107.0000
             */
            unitPrice?: Record<string, never> | null;
            /**
             * @description 行金额 = 单价 × 数量；无价为 null
             * @example 214.0000
             */
            totalPrice?: Record<string, never> | null;
            /** @description 已映射行使用内部 SKU 主图签名 URL；未映射行使用平台公开图片直链 */
            imageUrl?: string | null;
            /** @enum {string|null} */
            imageSource: "INTERNAL" | "PLATFORM" | null;
            /** @enum {string} */
            fulfillmentStatus: "PENDING" | "RESERVED" | "BACKORDERED" | "PICKED" | "SHIPPED" | "RELEASED";
            /** @enum {string} */
            mappingStatus: "PENDING" | "MAPPED" | "FAILED";
            /**
             * @description 派生采购状态（purchase.md §3.5，不落库）；未映射行为 NULL
             * @enum {string|null}
             */
            procurementState?: "NOT_ORDERED" | "ORDERED" | "ARRIVED" | null;
            reservationId: string | null;
            /** @description 库存预约（含多 Bin 分配行，task §49-§50） */
            reservation: Record<string, never> | null;
            rawData: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            exceptions: components["schemas"]["OrderItemExceptionDto"][];
        };
        OrderHistoryDto: {
            id: string;
            fromStatus: string | null;
            toStatus: string;
            reason: string | null;
            operatorName: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        PlatformStatusHistoryDto: {
            id: string;
            /** @example awaiting_packaging */
            fromStatus: string | null;
            /** @example delivering */
            toStatus: string;
            /** @example ORDER_SYNC */
            source: string | null;
            /**
             * Format: date-time
             * @description 平台侧的迁移时间（webhook changed_state_date / 回读阶段锚点）；缺失时以 createdAt 为准（双轴 T2）
             */
            platformChangedAt?: string | null;
            operatorName: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        OrderInterceptionDto: {
            id: string;
            /** @example ITC00000001 */
            interceptionNo: string;
            orderItemId: string | null;
            warehouseId: string;
            /** @enum {string} */
            status: "CREATED" | "ASSIGNED" | "LOCATING" | "INTERCEPTED" | "FAILED" | "RETURNED_TO_STOCK" | "CLOSED";
            reason: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        OrderPickingTaskDto: {
            id: string;
            /** @example PCK00000001 */
            pickingNo: string;
            warehouseId: string;
            status: string;
            totalItems: number;
            pickedItems: number;
            /** Format: date-time */
            createdAt: string;
        };
        OrderDetailDto: {
            id: string;
            /** @example ORD00000001 */
            orderNo: string;
            storeId: string;
            /** @example OZON A店 */
            storeName: string;
            /** @example OZON */
            platformCode: string;
            /** @example 123456789 */
            platformOrderId: string;
            platformStatus: string | null;
            /** @enum {string} */
            erpStatus: "NEW" | "ALLOCATING" | "READY_TO_PICK" | "PARTIALLY_BACKORDERED" | "BACKORDERED" | "PICKING" | "PICKED" | "PARTIALLY_SHIPPED" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
            fulfillmentMode: string | null;
            currency: string | null;
            /** Format: date-time */
            orderedAt: string;
            /**
             * Format: date-time
             * @description 平台要求的发货截止时间（平台事实，非 ERP 状态）
             */
            shipmentDeadline?: string | null;
            rawData: Record<string, never> | null;
            remark: string | null;
            /** @enum {string|null} */
            syncSource: "MANUAL" | "API" | "POLLING" | "WEBHOOK" | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            items: components["schemas"]["OrderItemDto"][];
            history: components["schemas"]["OrderHistoryDto"][];
            /** @description 平台状态迁移时间线（与 ERP 历史按 createdAt 合并展示） */
            platformStatusHistory: components["schemas"]["PlatformStatusHistoryDto"][];
            interceptions: components["schemas"]["OrderInterceptionDto"][];
            pickingTasks: components["schemas"]["OrderPickingTaskDto"][];
        };
        OrderIngestItemResultDto: {
            orderItemId: string;
            lineNo: number;
            /** @enum {string} */
            mappingStatus: "PENDING" | "MAPPED" | "FAILED";
            /** @enum {string} */
            fulfillmentStatus: "PENDING" | "RESERVED" | "BACKORDERED" | "PICKED" | "SHIPPED" | "RELEASED";
            skuId: string | null;
            reservationId: string | null;
        };
        OrderIngestResultDto: {
            orderId: string;
            /** @example ORD00000001 */
            orderNo: string;
            /** @enum {string} */
            erpStatus: "NEW" | "ALLOCATING" | "READY_TO_PICK" | "PARTIALLY_BACKORDERED" | "BACKORDERED" | "PICKING" | "PICKED" | "PARTIALLY_SHIPPED" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
            /** @example false */
            alreadyIngested: boolean;
            itemResults: components["schemas"]["OrderIngestItemResultDto"][];
        };
        NormalizedOrderItemInputDto: {
            platformProductId?: string;
            platformSkuId?: string;
            sellerSku?: string;
            offerId?: string;
            /** @example 2 */
            quantity: string;
            /**
             * @description 平台单价（财务事实，finance.md §2）；平台未提供为 null，禁止臆造为 0
             * @example 107.0000
             */
            unitPrice?: Record<string, never> | null;
            rawData?: Record<string, never>;
        };
        NormalizedOrderInputDto: {
            storeId: string;
            /** @example OZON-123456789 */
            platformOrderId: string;
            /** @example awaiting_packaging */
            platformStatus?: string;
            /**
             * @description 归一化平台物流阶段（平台事实，非 ERP 状态）；未归类/未同步为 null（双轴 T1）
             * @enum {string|null}
             */
            platformStage?: "AWAITING_SHIPMENT" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED" | null;
            /**
             * Format: date-time
             * @description 平台自身记录的进入该阶段时间（停滞时钟锚点）；缺失为 null
             */
            platformStageChangedAt?: string | null;
            /** @example FBS */
            fulfillmentMode?: string;
            /** Format: date-time */
            orderedAt: string;
            /**
             * Format: date-time
             * @description 平台要求的发货截止时间（平台事实，非 ERP 状态；可空）
             */
            shipmentDeadline?: string;
            /** @example RUB */
            currency?: string;
            items: components["schemas"]["NormalizedOrderItemInputDto"][];
            /** @description 平台原始报文（保留事实，task §14） */
            rawData?: Record<string, never>;
            remark?: string;
            /**
             * @description 订单进入系统的渠道（Sprint 5 §58；默认 API）
             * @enum {string}
             */
            syncSource?: "MANUAL" | "API" | "POLLING" | "WEBHOOK";
        };
        OrderCancelResultDto: {
            orderId: string;
            /** @enum {string} */
            erpStatus: "NEW" | "ALLOCATING" | "READY_TO_PICK" | "PARTIALLY_BACKORDERED" | "BACKORDERED" | "PICKING" | "PICKED" | "PARTIALLY_SHIPPED" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
            releasedItems: number;
            interceptions: number;
        };
        OrderCancelRequestDto: {
            /** @description 取消原因（记入历史与拦截任务） */
            reason?: string;
        };
        OrderMarkExternalFulfillmentResultDto: {
            orderId: string;
            /** @enum {string} */
            erpStatus: "NEW" | "ALLOCATING" | "READY_TO_PICK" | "PARTIALLY_BACKORDERED" | "BACKORDERED" | "PICKING" | "PICKED" | "PARTIALLY_SHIPPED" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
            releasedItems: number;
        };
        OrderMarkExternalFulfillmentRequestDto: {
            /** @description 外部履约原因（必填，记入状态历史与操作日志；如线下直发买家） */
            reason: string;
        };
        OrderRetryAllocationResultDto: {
            orderItemId: string;
            /** @enum {string} */
            fulfillmentStatus: "PENDING" | "RESERVED" | "BACKORDERED" | "PICKED" | "SHIPPED" | "RELEASED";
            reserved: boolean;
        };
        NotificationDto: {
            id: string;
            /** @enum {string} */
            type: "ORDER_INTERCEPTION_REQUIRED" | "ORDER_INTERCEPTION_FAILED";
            /** @enum {string} */
            channel: "SYSTEM" | "FEISHU";
            /** @example ORDER_INTERCEPTION */
            referenceType: string;
            referenceId: string;
            recipient: Record<string, never> | null;
            /** @example 需要拦截：订单 ORD00000001 */
            title: string;
            content: string;
            /** @enum {string} */
            status: "PENDING" | "SENT" | "FAILED" | "CANCELLED";
            attemptCount: number;
            lastError: Record<string, never> | null;
            /** Format: date-time */
            sentAt: string | null;
            /** Format: date-time */
            failedAt: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        RetryNotificationResultDto: {
            id: string;
            /** @enum {string} */
            status: "PENDING" | "SENT" | "FAILED" | "CANCELLED";
            message: string;
        };
        PickingTaskListItemDto: {
            id: string;
            /** @example PCK00000001 */
            pickingNo: string;
            warehouseId: string;
            /** @example SZ01 */
            warehouseCode: string;
            /** @example 深圳自管仓 */
            warehouseName: string;
            /** @enum {string} */
            status: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
            ordersCount: number;
            itemsTotal: number;
            itemsPicked: number;
            /** @example 5.000 */
            requiredTotal: string;
            /** @example 2.000 */
            pickedTotal: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            startedAt: string | null;
            /** Format: date-time */
            completedAt: string | null;
        };
        CreatePickingTaskResultDto: {
            tasks: components["schemas"]["PickingTaskListItemDto"][];
        };
        CreatePickingTaskRequestDto: {
            /** @description 从该订单的 RESERVED 行生成拣货任务（按仓拆分） */
            orderId: string;
        };
        PickingBinLineDto: {
            binId: string;
            /** @example ZG-01-A01-1 */
            binCode: string;
            /** @example 2.000 */
            quantity: string;
            /** @example 0.000 */
            pickedQty: string;
        };
        PickingItemDto: {
            id: string;
            orderId: string;
            orderItemId: string;
            /** @example ORD00000001 */
            orderNo: string;
            skuId: string;
            /** @example VK87-BLK */
            skuCode: string;
            /** @example VK87 MAX V2 黑色 */
            skuName: string;
            /** @description 主条码（扫码提示） */
            primaryBarcode: string | null;
            reservationId: string;
            /** @example 2.000 */
            requiredQty: string;
            /** @example 1.000 */
            pickedQty: string;
            /** @enum {string} */
            status: "PENDING" | "PICKED";
            /** @description 目标库位分配（多 Bin 分别展示） */
            binLines: components["schemas"]["PickingBinLineDto"][];
            serialTracking: boolean;
            /** @description SN 管理商品：该预约仍待拣的 SN（提示可扫序列号） */
            pendingSerialNumbers: string[];
        };
        PickingTaskDetailDto: {
            id: string;
            /** @example PCK00000001 */
            pickingNo: string;
            warehouseId: string;
            /** @example SZ01 */
            warehouseCode: string;
            /** @example 深圳自管仓 */
            warehouseName: string;
            /** @enum {string} */
            status: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
            ordersCount: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            startedAt: string | null;
            /** Format: date-time */
            completedAt: string | null;
            items: components["schemas"]["PickingItemDto"][];
        };
        PickingScanResultDto: {
            taskId: string;
            itemId: string;
            /** @example 2.000 */
            pickedQty: string;
            /** @example 2.000 */
            requiredQty: string;
            /** @enum {string} */
            itemStatus: "PENDING" | "PICKED";
            /** @enum {string} */
            taskStatus: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
            /** @description 本次扫描的 SN */
            serialNumber: string | null;
            message: string;
        };
        PickingScanRequestDto: {
            /**
             * @description SKU 条码（USB/蓝牙扫码器=键盘输入）
             * @example 4601234506789
             */
            barcode: string;
            /** @description SN 管理商品必填 */
            serialNumber?: string;
            /** @description 预留：库位条码（第一阶段不强制） */
            binBarcode?: string;
            /** @description 显式指定拣货行（同 SKU 多行时） */
            itemId?: string;
        };
        InterceptionListItemDto: {
            id: string;
            /** @example ITC00000001 */
            interceptionNo: string;
            orderId: string;
            /** @example ORD00000001 */
            orderNo: string;
            warehouseId: string;
            /** @example SZ01 */
            warehouseCode: string;
            /** @example SKU000001 */
            skuCode: string;
            /** @example 无线键盘 */
            skuName: string;
            /** @enum {string} */
            status: "CREATED" | "ASSIGNED" | "LOCATING" | "INTERCEPTED" | "FAILED" | "RETURNED_TO_STOCK" | "CLOSED";
            assignedToName: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        InterceptionDetailDto: {
            id: string;
            /** @example ITC00000001 */
            interceptionNo: string;
            orderId: string;
            /** @example ORD00000001 */
            orderNo: string;
            orderErpStatus: string;
            warehouseId: string;
            /** @example SZ01 */
            warehouseCode: string;
            /** @enum {string} */
            status: "CREATED" | "ASSIGNED" | "LOCATING" | "INTERCEPTED" | "FAILED" | "RETURNED_TO_STOCK" | "CLOSED";
            reason: Record<string, never> | null;
            assignedToName: string | null;
            /** Format: date-time */
            assignedAt: string | null;
            /** Format: date-time */
            scannedAt: string | null;
            targetBinId: Record<string, never> | null;
            failedReason: Record<string, never> | null;
            /** Format: date-time */
            failedAt: string | null;
            /** Format: date-time */
            returnedToStockAt: string | null;
            /** Format: date-time */
            closedAt: string | null;
            /** Format: date-time */
            createdAt: string;
            /** @description 需要找回的订单行：SKU/数量/SN/原拣货库位/已打包包裹 */
            item: Record<string, never> | null;
            /** @description 状态迁移历史 */
            history: Record<string, never>[];
        };
        AssignInterceptionRequestDto: {
            /**
             * @description 指派员工（默认当前操作人）
             * @example 张三
             */
            assigneeName?: string;
        };
        InterceptionScanRequestDto: {
            /**
             * @description SKU 条码（后端验证）
             * @example 4601234506789
             */
            barcode: string;
            /** @description SN 管理商品必填 */
            serialNumber?: string;
            /**
             * @description 目标回库库位编码（后端验证）
             * @example ZG-01-A01-1
             */
            binBarcode: string;
        };
        ReturnToStockRequestDto: {
            /** @description 覆盖扫码时记录的目标库位 */
            binBarcode?: string;
        };
        FailInterceptionRequestDto: {
            /** @example 在暂存区未找到商品 */
            reason?: string;
        };
        SupplierListItemDto: {
            id: string;
            /** @example SUP0001 */
            code: string;
            /** @example 深圳华强北电子供应商 */
            name: string;
            contactName?: Record<string, never> | null;
            contactPhone?: Record<string, never> | null;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE";
            remark?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            referenceCount: number;
        };
        SupplierResponseDto: {
            id: string;
            /** @example SUP0001 */
            code: string;
            /** @example 深圳华强北电子供应商 */
            name: string;
            contactName?: Record<string, never> | null;
            contactPhone?: Record<string, never> | null;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE";
            remark?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CreateSupplierRequestDto: {
            /** @example 深圳华强北电子供应商 */
            name: string;
            /** @description 留空自动生成 SUP%04d；创建后不可改 */
            code?: string;
            contactName?: string;
            contactPhone?: string;
            remark?: string;
        };
        UpdateSupplierRequestDto: {
            name?: string;
            contactName?: string;
            contactPhone?: string;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE";
            remark?: string;
        };
        PurchaseOrderListItemDto: {
            id: string;
            /** @example PO000001 */
            poNo: string;
            supplierId?: Record<string, never> | null;
            supplierName?: Record<string, never> | null;
            sourceNote?: Record<string, never> | null;
            /** @enum {string} */
            status: "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
            /** Format: date-time */
            orderedAt: string;
            /** Format: date-time */
            expectedAt?: string | null;
            remark?: Record<string, never> | null;
            itemCount: number;
            /** @example 2.000 */
            totalQuantity: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        PurchaseOrderItemDto: {
            id: string;
            skuId: string;
            /** @example SKU000001001 */
            skuCode: string;
            /** @example VK87 MAX V2 黑色 */
            skuName: string;
            orderItemId?: Record<string, never> | null;
            /** @description 关联订单号（展示用） */
            orderNo?: Record<string, never> | null;
            /** @example 2.000 */
            quantity: string;
            /** @example 59.9000 */
            unitCost?: Record<string, never> | null;
            /** @example 0.000 */
            receivedQuantity: string;
            remark?: Record<string, never> | null;
        };
        PurchaseOrderDetailDto: {
            id: string;
            /** @example PO000001 */
            poNo: string;
            supplierId?: Record<string, never> | null;
            supplierName?: Record<string, never> | null;
            sourceNote?: Record<string, never> | null;
            /** @enum {string} */
            status: "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
            /** Format: date-time */
            orderedAt: string;
            /** Format: date-time */
            expectedAt?: string | null;
            remark?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            items: components["schemas"]["PurchaseOrderItemDto"][];
        };
        ReceivingOptionDto: {
            /** @description 收货仓库 */
            warehouseId: string;
            /** @description 默认收货库位 */
            defaultBinId?: string;
        };
        PurchaseOrderItemInputDto: {
            skuId: string;
            /** @description 为哪张订单行采购（可空 = 备货采购） */
            orderItemId?: string;
            /** @example 2 */
            quantity: string;
            /**
             * @description 单位成本（可空）
             * @example 59.9000
             */
            unitCost?: string;
            remark?: string;
        };
        CreatePurchaseOrderRequestDto: {
            /**
             * Format: date-time
             * @description 采购时间（可空=当前时刻）
             */
            orderedAt?: string;
            /** @description 同时生成独立收货草稿（不入库） */
            receipt?: components["schemas"]["ReceivingOptionDto"];
            /** @description 固定供应商（可空） */
            supplierId?: string;
            /**
             * @description 一次性网购的货源说明（如「淘宝 订单号 12345678」）
             * @example 淘宝 订单号 12345678
             */
            sourceNote?: string;
            /**
             * Format: date-time
             * @description 预计到货时间
             */
            expectedAt?: string;
            remark?: string;
            items: components["schemas"]["PurchaseOrderItemInputDto"][];
        };
        UpdatePurchaseOrderRequestDto: {
            supplierId?: string;
            sourceNote?: string;
            /** Format: date-time */
            expectedAt?: string;
            remark?: string;
            /** @description 整体替换明细（仅 ORDERED 状态） */
            items?: components["schemas"]["PurchaseOrderItemInputDto"][];
        };
        PurchaseReceiptListItemDto: {
            id: string;
            /** @example PR000001 */
            receiptNo: string;
            purchaseOrderId?: Record<string, never> | null;
            /** @example PO000001 */
            purchaseOrderNo?: Record<string, never> | null;
            supplierId?: Record<string, never> | null;
            supplierName?: Record<string, never> | null;
            sourceNote?: Record<string, never> | null;
            warehouseId: string;
            /** @example ZG-01 */
            warehouseCode?: Record<string, never> | null;
            /** @enum {string} */
            status: "DRAFT" | "RECEIVED" | "CANCELLED";
            /** Format: date-time */
            receivedAt?: string | null;
            itemCount: number;
            /** @example 2.000 */
            totalQuantity: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        PurchaseReceiptItemDto: {
            id: string;
            skuId: string;
            /** @example SKU000001001 */
            skuCode: string;
            /** @example VK87 MAX V2 黑色 */
            skuName: string;
            purchaseOrderItemId?: Record<string, never> | null;
            /** @example 2.000 */
            quantity: string;
            /** @example 59.9000 */
            unitCost?: Record<string, never> | null;
            binId?: Record<string, never> | null;
            /** @example ZG-01-A01-1 */
            binCode?: Record<string, never> | null;
            serialNumbers?: string[] | null;
            remark?: Record<string, never> | null;
        };
        PurchaseReceiptDetailDto: {
            id: string;
            /** @example PR000001 */
            receiptNo: string;
            purchaseOrderId?: Record<string, never> | null;
            /** @example PO000001 */
            purchaseOrderNo?: Record<string, never> | null;
            supplierId?: Record<string, never> | null;
            supplierName?: Record<string, never> | null;
            sourceNote?: Record<string, never> | null;
            warehouseId: string;
            /** @example ZG-01 */
            warehouseCode?: Record<string, never> | null;
            /** @enum {string} */
            status: "DRAFT" | "RECEIVED" | "CANCELLED";
            /** Format: date-time */
            receivedAt?: string | null;
            remark?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            items: components["schemas"]["PurchaseReceiptItemDto"][];
        };
        PurchaseReceiptItemInputDto: {
            skuId: string;
            /** @description 来源采购明细（可空 = 直接收货） */
            purchaseOrderItemId?: string;
            /** @example 2 */
            quantity: string;
            /** @example 59.9000 */
            unitCost?: string;
            /** @description 目标库位（可空 → 库存层既有解析规则） */
            binId?: string;
            /** @description SN 管理商品必填：与数量一致的 SN 列表；非 SN 商品禁止提供 */
            serialNumbers?: string[];
            remark?: string;
        };
        CreatePurchaseReceiptRequestDto: {
            /** @description 来源采购单（可空 = 直接收货） */
            purchaseOrderId?: string;
            supplierId?: string;
            sourceNote?: string;
            warehouseId: string;
            remark?: string;
            items: components["schemas"]["PurchaseReceiptItemInputDto"][];
        };
        GenerateReceiptFromPoRequestDto: {
            warehouseId: string;
            /** @description 默认目标库位（明细可单独覆盖） */
            defaultBinId?: string;
        };
        UpdatePurchaseReceiptRequestDto: {
            supplierId?: string;
            sourceNote?: string;
            remark?: string;
            /** @description 整体替换明细（仅 DRAFT） */
            items?: components["schemas"]["PurchaseReceiptItemInputDto"][];
        };
        PurchaseReceiptConfirmResultDto: {
            id: string;
            /** @example PR000001 */
            receiptNo: string;
            purchaseOrderId?: Record<string, never> | null;
            /** @example PO000001 */
            purchaseOrderNo?: Record<string, never> | null;
            supplierId?: Record<string, never> | null;
            supplierName?: Record<string, never> | null;
            sourceNote?: Record<string, never> | null;
            warehouseId: string;
            /** @example ZG-01 */
            warehouseCode?: Record<string, never> | null;
            /** @enum {string} */
            status: "DRAFT" | "RECEIVED" | "CANCELLED";
            /** Format: date-time */
            receivedAt?: string | null;
            remark?: Record<string, never> | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            items: components["schemas"]["PurchaseReceiptItemDto"][];
            /** @example false */
            idempotentReplay: boolean;
        };
        ShipmentListItemDto: {
            id: string;
            /** @example SHP00000001 */
            shipmentNo: string;
            orderId: string;
            /** @example ORD00000001 */
            orderNo: string;
            warehouseId: string;
            /** @example SZ01 */
            warehouseCode: string;
            /** @example 深圳自管仓 */
            warehouseName: string;
            /** @enum {string} */
            status: "DRAFT" | "READY_TO_PACK" | "PACKING" | "READY_TO_SHIP" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
            /** @example TRK123 */
            trackingNumber: Record<string, never> | null;
            packagesCount: number;
            sealedPackagesCount: number;
            itemsTotal: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            shippedAt: string | null;
        };
        CreateShipmentResultDto: {
            shipments: components["schemas"]["ShipmentListItemDto"][];
        };
        CreateShipmentRequestDto: {
            /** @description 从该订单的 PICKED 行创建发货单（按仓拆分，1 Shipment = 1 Warehouse） */
            orderId: string;
        };
        ShipmentItemDto: {
            id: string;
            orderItemId: string;
            skuId: string;
            /** @example SKU000001 */
            skuCode: string;
            /** @example 无线键盘 */
            skuName: string;
            reservationId: string;
            /**
             * @description 本发货单应发数量（PICKED 快照）
             * @example 2.000
             */
            quantity: string;
            /**
             * @description 已打包数量（全部包裹合计）
             * @example 2.000
             */
            packedQty: string;
            /** @description SN 管理商品 */
            serialTracking: boolean;
            /** @description 该行需要打包的 SN（SN 商品） */
            serialNumbers: string[];
            /** @enum {string} */
            status: "ACTIVE" | "VOIDED";
            /** Format: date-time */
            voidedAt: string | null;
            /** @description 作废操作人 users.id */
            voidedBy: Record<string, never> | null;
            /** @description 作废时操作人显示名快照 */
            voidedByName: Record<string, never> | null;
            voidReason: Record<string, never> | null;
            /** @enum {string|null} */
            voidSourceType: "ORDER_INTERCEPTION" | "MANUAL" | null;
            /** @description 多态来源 ID，如 order_interceptions.id */
            voidSourceId: Record<string, never> | null;
        };
        PackageItemDto: {
            id: string;
            orderItemId: string;
            skuId: string;
            /** @example SKU000001 */
            skuCode: string;
            /** @example 无线键盘 */
            skuName: string;
            /** @example 2.000 */
            quantity: string;
            serialNumbers: string[];
        };
        PackageListItemDto: {
            id: string;
            /** @example PKG00000001 */
            packageNo: string;
            shipmentId: string;
            /** @enum {string} */
            status: "OPEN" | "SEALED" | "SHIPPED" | "CANCELLED" | "REPACK_REQUIRED";
            /** Format: date-time */
            sealedAt: string | null;
            items: components["schemas"]["PackageItemDto"][];
            /**
             * @description 包裹内件数合计
             * @example 3.000
             */
            totalQty: string;
            /** Format: date-time */
            createdAt: string | null;
        };
        ShipmentDetailDto: {
            id: string;
            /** @example SHP00000001 */
            shipmentNo: string;
            orderId: string;
            /** @example ORD00000001 */
            orderNo: string;
            warehouseId: string;
            /** @example SZ01 */
            warehouseCode: string;
            /** @example 深圳自管仓 */
            warehouseName: string;
            /** @enum {string} */
            status: "DRAFT" | "READY_TO_PACK" | "PACKING" | "READY_TO_SHIP" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
            /** @example TRK123 */
            trackingNumber: Record<string, never> | null;
            /** @example CDEK */
            carrierCode: Record<string, never> | null;
            /** @example EXPRESS */
            shippingMethod: Record<string, never> | null;
            /** Format: date-time */
            shippedAt: string | null;
            /** Format: date-time */
            createdAt: string;
            /** @description 待发商品快照与打包进度（仅 ACTIVE） */
            items: components["schemas"]["ShipmentItemDto"][];
            /** @description 已作废 / 历史记录（VOIDED，永久保留，不参与任何计算） */
            voidedItems: components["schemas"]["ShipmentItemDto"][];
            packages: components["schemas"]["PackageListItemDto"][];
            /** @description 面单元数据（含签名查看 URL） */
            labels: Record<string, never>[];
        };
        CreatePackageResultDto: {
            packageId: string;
            /** @example PKG00000001 */
            packageNo: string;
            /** @enum {string} */
            shipmentStatus: "DRAFT" | "READY_TO_PACK" | "PACKING" | "READY_TO_SHIP" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
        };
        UpdateShipmentTrackingRequestDto: {
            /**
             * @description 人工录入物流单号（未来 Adapter 自动填入）
             * @example TRK123456789
             */
            trackingNumber?: string;
            /** @example CDEK */
            carrierCode?: string;
            /** @example EXPRESS */
            shippingMethod?: string;
        };
        ShipShipmentResultDto: {
            shipmentId: string;
            /** @enum {string} */
            status: "DRAFT" | "READY_TO_PACK" | "PACKING" | "READY_TO_SHIP" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
            /** Format: date-time */
            shippedAt: string | null;
            /** @description 重复出库时为 true（未再次扣减库存） */
            alreadyShipped: boolean;
            /** @example ORD00000001 */
            orderNo: string;
            /** @description 出库后订单 ERP 状态 */
            orderErpStatus: string;
            /** @description 本次出库产生的库存事件号 */
            eventNos: string[];
        };
        ShipShipmentRequestDto: {
            /** @description 幂等键：重复提交同一键不会重复扣减库存 */
            idempotencyKey?: string;
            /** @description 出库时顺带录入物流信息 */
            tracking?: components["schemas"]["UpdateShipmentTrackingRequestDto"];
        };
        ShippingLabelDto: {
            id: string;
            shipmentId: string;
            packageId: Record<string, never> | null;
            /** @enum {string} */
            labelType: "SHIPPING";
            /** @example 面单.pdf */
            fileName: string;
            /** @example application/pdf */
            mimeType: string;
            fileSize: number;
            /** @example MANUAL_UPLOAD */
            source: string;
            /** Format: date-time */
            createdAt: string;
            /** @description 短期有效的私有文件签名 URL（浏览器打开/打印） */
            signedUrl: string;
        };
        PackageWorkbenchItemDto: {
            id: string;
            orderItemId: string;
            skuId: string;
            /** @example SKU000001 */
            skuCode: string;
            /** @example 无线键盘 */
            skuName: string;
            /** @example 2.000 */
            quantity: string;
            serialNumbers: string[];
        };
        PackageWorkbenchDemandDto: {
            orderItemId: string;
            skuId: string;
            /** @example SKU000001 */
            skuCode: string;
            /** @example 无线键盘 */
            skuName: string;
            primaryBarcode: string | null;
            /** @example 2.000 */
            requiredQty: string;
            /** @example 1.000 */
            packedQty: string;
            /** @description SN 管理商品 */
            serialTracking: boolean;
            /** @description SN 商品尚未装箱的 SN */
            pendingSerialNumbers: string[];
        };
        PackageWorkbenchDto: {
            /** @description 包裹头（id/packageNo/shipmentId/status/sealedAt/createdAt） */
            package: Record<string, never>;
            /** @example SHP00000001 */
            shipmentNo: string;
            /** @enum {string} */
            shipmentStatus: "DRAFT" | "READY_TO_PACK" | "PACKING" | "READY_TO_SHIP" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
            /** @description 已装明细 */
            items: components["schemas"]["PackageWorkbenchItemDto"][];
            /** @description 待装商品与扫码进度 */
            demand: components["schemas"]["PackageWorkbenchDemandDto"][];
        };
        PackingScanResultDto: {
            packageId: string;
            orderItemId: string;
            skuId: string;
            /** @example SKU000001 */
            skuCode: string;
            /** @example 1.000 */
            packedQty: string;
            /**
             * @description 该行应打包总数
             * @example 2.000
             */
            requiredQty: string;
            serialNumber: string | null;
            message: string;
        };
        PackingScanRequestDto: {
            /**
             * @description SKU 条码（扫码器=键盘输入，每次 1 件）
             * @example 4601234506789
             */
            barcode: string;
            /** @description SN 管理商品必填 */
            serialNumber?: string;
        };
        SealPackageResultDto: {
            packageId: string;
            /** @enum {string} */
            packageStatus: "OPEN" | "SEALED" | "SHIPPED" | "CANCELLED" | "REPACK_REQUIRED";
            shipmentId: string;
            /** @enum {string} */
            shipmentStatus: "DRAFT" | "READY_TO_PACK" | "PACKING" | "READY_TO_SHIP" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
            /** @example 2.000 */
            totalQty: string;
        };
        PackageDimensionsDto: {
            /** @example 1.250 */
            weightKg?: string;
            /** @example 30.00 */
            lengthCm?: string;
            /** @example 20.00 */
            widthCm?: string;
            /** @example 10.00 */
            heightCm?: string;
        };
        SealPackageRequestDto: {
            /** @description 封箱时录入重量/尺寸 */
            dimensions?: components["schemas"]["PackageDimensionsDto"];
        };
        PlatformReturnDto: {
            id: string;
            storeId: string;
            /** @example R900001 */
            platformReturnId: string;
            platformOrderId: string | null;
            orderId: string | null;
            state: string | null;
            refundState: string | null;
            platformSkuId: string | null;
            offerId: string | null;
            /** @example 1 */
            quantity: string;
            /** Format: date-time */
            platformCreatedAt?: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        PlatformReturnSyncResultDto: {
            created: number;
            updated: number;
            /** @description 无法关联订单的平台退货记录数（已创建 RETURN_ORDER_NOT_FOUND） */
            unlinkable: number;
        };
        PlatformReturnSyncDto: {
            storeId: string;
            note?: string;
        };
        ReturnBatchDto: {
            id: string;
            /** @example RT000001 */
            batchNo: string;
            warehouseId: string;
            /** @enum {string} */
            status: "DRAFT" | "RECEIVED" | "COMPLETED" | "CANCELLED";
            sourceNote: string | null;
            itemCount: number;
            /** Format: date-time */
            createdAt: string;
        };
        ReturnBatchItemDto: {
            id: string;
            batchId: string;
            platformReturnId: string | null;
            platformReturnNo: string | null;
            skuId: string;
            /** @example 1.000 */
            quantity: string;
            /** @enum {string} */
            condition: "PENDING" | "SELLABLE" | "DEFECTIVE" | "LOST";
            binId: string | null;
            remark: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        ReturnBatchDetailDto: {
            id: string;
            /** @example RT000001 */
            batchNo: string;
            warehouseId: string;
            /** @enum {string} */
            status: "DRAFT" | "RECEIVED" | "COMPLETED" | "CANCELLED";
            sourceNote: string | null;
            itemCount: number;
            /** Format: date-time */
            createdAt: string;
            items: components["schemas"]["ReturnBatchItemDto"][];
        };
        ReturnBatchItemInputDto: {
            /** @description 人工行必须指定内部 SKU */
            skuId?: string;
            /** @description 关联平台退货记录（对账锚点） */
            platformReturnId?: string;
            /** @example 1 */
            quantity: string;
            remark?: string;
        };
        ReturnBatchCreateDto: {
            warehouseId: string;
            /** @example Amol 仓 9-15 批次 */
            sourceNote?: string;
            remark?: string;
            items: components["schemas"]["ReturnBatchItemInputDto"][];
        };
        ReturnItemInspectDto: {
            /**
             * @description 检验结论（一次性写定）：SELLABLE/DEFECTIVE 回库（DEFECTIVE 入隔离库存）；LOST 不动库存
             * @enum {string}
             */
            condition: "SELLABLE" | "DEFECTIVE" | "LOST";
            /** @description 回库目标库位；空则自动落到该仓 STAGING 库位 */
            binId?: string;
        };
        SyncJobDto: {
            id: string;
            storeId: string;
            /** @example OZON-A */
            storeCode: string;
            /** @example OZON A店 */
            storeName: string;
            /** @example OZON */
            platformCode: string;
            /** @enum {string} */
            syncType: "LISTING_SYNC" | "ORDER_SYNC" | "CATEGORY_TREE_SYNC" | "PRODUCT_ENRICHMENT_SYNC";
            /** @enum {string} */
            status: "PENDING" | "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
            /** @enum {string} */
            triggerType: "MANUAL" | "SCHEDULED" | "WEBHOOK" | "RETRY";
            /** Format: date-time */
            startedAt: string | null;
            /** Format: date-time */
            finishedAt: string | null;
            successCount: number;
            failedCount: number;
            skippedCount: number;
            retryCount: number;
            /** @description 适配器游标（Opaque） */
            cursorBefore: Record<string, never> | null;
            /** @description 适配器游标（Opaque） */
            cursorAfter: Record<string, never> | null;
            errorCode: string | null;
            errorMessage: string | null;
            /** Format: date-time */
            createdAt: string;
            /**
             * @description 运行时长（毫秒），未完成为 null
             * @example 4200
             */
            durationMs: Record<string, never>;
        };
        TriggerSyncRequestDto: {
            /** Format: uuid */
            storeId: string;
        };
        StoreSyncOverviewDto: {
            storeId: string;
            /** @example OZON-A */
            storeCode: string;
            /** @example OZON */
            platformCode: string;
            /** @description 凭证验证元数据（不含密钥） */
            credential: Record<string, never> | null;
            lastOrderSync: Record<string, never> | null;
            lastListingSync: Record<string, never> | null;
            /** @description 最近一次类目树同步（Sprint 8.5，手动；只展示不告警） */
            lastCategoryTreeSync: Record<string, never> | null;
            /** @description 最近一次商品属性增强同步（Sprint 8.5，手动；只展示不告警） */
            lastProductEnrichmentSync: Record<string, never> | null;
            /** @description 连续失败次数（成功即清零） */
            consecutiveFailures: number;
            activeJobId: string | null;
        };
        RawEventDto: {
            id: string;
            /** @example OZON */
            platform: string;
            storeId: string;
            /** @example NEW_POSTING */
            eventType: string;
            externalEventId: string | null;
            payload: Record<string, never>;
            payloadHash: string;
            /** @enum {string} */
            status: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED" | "SKIPPED" | "REJECTED";
            /** Format: date-time */
            receivedAt: string;
            /** Format: date-time */
            processedAt: string | null;
            errorCode: string | null;
            errorMessage: string | null;
        };
        FinanceTransactionDto: {
            id: string;
            /** @example FV000001 */
            voucherNo: string;
            /** @enum {string} */
            direction: "INCOME" | "EXPENSE";
            /** @enum {string} */
            category: "SALE_INCOME" | "SALE_REFUND" | "PURCHASE_PAYMENT" | "SUPPLIER_REFUND" | "PLATFORM_FEE" | "LOGISTICS_FEE" | "OTHER_INCOME" | "OTHER_EXPENSE";
            /** @example 107.0000 */
            amount: string;
            /** @example CNY */
            currency: string;
            /** Format: date-time */
            occurredAt: string;
            storeId: string | null;
            supplierId: string | null;
            orderId: string | null;
            purchaseOrderId: string | null;
            payoutId: string | null;
            reversedByVoucherNo: string | null;
            remark: string | null;
            createdBy: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            storeName?: string | null;
            supplierName?: string | null;
            orderNo?: string | null;
            purchaseOrderNo?: string | null;
        };
        CreateFinanceTransactionRequestDto: {
            /** @enum {string} */
            direction: "INCOME" | "EXPENSE";
            /** @enum {string} */
            category: "SALE_INCOME" | "SALE_REFUND" | "PURCHASE_PAYMENT" | "SUPPLIER_REFUND" | "PLATFORM_FEE" | "LOGISTICS_FEE" | "OTHER_INCOME" | "OTHER_EXPENSE";
            /** @example 107.0000 */
            amount: string;
            /** @example CNY */
            currency?: string;
            /**
             * Format: date-time
             * @description 业务发生时间，默认当前
             */
            occurredAt?: string;
            /** @description 关联店铺 */
            storeId?: string;
            /** @description 关联供应商（可空，采购付款亦可空） */
            supplierId?: string;
            /** @description 关联订单（销售收入/退款必填） */
            orderId?: string;
            /** @description 关联采购单（采购付款必填） */
            purchaseOrderId?: string;
            remark?: string;
        };
        FinancePayoutDto: {
            id: string;
            /** @example PY000001 */
            payoutNo: string;
            storeId: string;
            /** Format: date-time */
            periodStart: string;
            /** Format: date-time */
            periodEnd: string;
            /** @example 1284.0000 */
            amount: string;
            /** @example CNY */
            currency: string;
            /** @enum {string} */
            status: "DRAFT" | "CONFIRMED" | "CANCELLED";
            remark: string | null;
            createdBy: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            storeName?: string | null;
        };
        FinancePayoutPreviewDto: {
            payout: components["schemas"]["FinancePayoutDto"];
            /** @example 1284.0000 */
            settledRevenue: string;
            /** @example 12 */
            settledOrderCount: number;
            /** @example 0.0000 */
            difference: string;
        };
        CreateFinancePayoutRequestDto: {
            storeId: string;
            /** Format: date-time */
            periodStart: string;
            /** Format: date-time */
            periodEnd: string;
            /** @example 1284.0000 */
            amount: string;
            /** @example CNY */
            currency?: string;
            remark?: string;
        };
        OrderSettlementDto: {
            id: string;
            orderId: string;
            /** @example CNY */
            currency: string | null;
            /** @example 214.0000 */
            revenueTotal: string;
            /** @example 160.0000 */
            productCostTotal: string;
            /** @example 25.0000 */
            shippingFee: string;
            /** @example 0.0000 */
            otherFee: string;
            /** @example 29.0000 */
            profit: string | null;
            hasMissingPrice: boolean;
            hasMissingCost: boolean;
            generatedBy: string | null;
            /** Format: date-time */
            generatedAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** @example ORD00000001 */
            orderNo?: string;
            /** @example OZON-123 */
            platformOrderId?: string;
            storeId?: string;
            storeName?: string | null;
            /** Format: date-time */
            orderedAt?: string;
        };
        OrderSettlementItemDto: {
            id: string;
            settlementId: string;
            orderItemId: string;
            skuId: string | null;
            /** @example 2.000 */
            quantity: string;
            /** @example 107.0000 */
            unitPrice: string | null;
            /** @example 214.0000 */
            revenue: string;
            /** @example 80.0000 */
            unitCost: string | null;
            /** @example 160.0000 */
            cost: string;
        };
        OrderSettlementDetailDto: {
            id: string;
            orderId: string;
            /** @example CNY */
            currency: string | null;
            /** @example 214.0000 */
            revenueTotal: string;
            /** @example 160.0000 */
            productCostTotal: string;
            /** @example 25.0000 */
            shippingFee: string;
            /** @example 0.0000 */
            otherFee: string;
            /** @example 29.0000 */
            profit: string | null;
            hasMissingPrice: boolean;
            hasMissingCost: boolean;
            generatedBy: string | null;
            /** Format: date-time */
            generatedAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** @example ORD00000001 */
            orderNo?: string;
            /** @example OZON-123 */
            platformOrderId?: string;
            storeId?: string;
            storeName?: string | null;
            /** Format: date-time */
            orderedAt?: string;
            items: components["schemas"]["OrderSettlementItemDto"][];
        };
        GenerateOrderSettlementRequestDto: {
            orderId: string;
        };
        SettlementGenerateMissingResultDto: {
            /** @example 3 */
            generated: number;
            /** @example 0 */
            skipped: number;
            settlementIds: string[];
        };
        UpdateOrderSettlementFeesRequestDto: {
            /**
             * @description 物流费（重算毛利）
             * @example 25.0000
             */
            shippingFee?: string;
            /**
             * @description 其他费用（重算毛利）
             * @example 0.0000
             */
            otherFee?: string;
        };
        PayableRowDto: {
            id: string;
            /** @example PO000001 */
            poNo: string;
            supplierId: string | null;
            supplierName: string | null;
            /** @example RECEIVED */
            status: string;
            /** Format: date-time */
            orderedAt: string;
            /** @example 300.0000 */
            payableAmount: string;
            /** @example 100.0000 */
            paidAmount: string;
            /** @example 200.0000 */
            unpaidAmount: string;
            /** @enum {string} */
            paymentState: "NOTHING_TO_PAY" | "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";
            hasUnpricedLines: boolean;
        };
        FinanceSummaryResponseDto: {
            range: Record<string, never> | null;
            /** @example 150.0000 */
            incomeTotal: string;
            /** @example 300.0000 */
            expenseTotal: string;
            /** @example -150.0000 */
            netTotal: string;
            /** @example 214.0000 */
            settledRevenue: string;
            /** @example 185.0000 */
            settledCost: string;
            /** @example 29.0000 */
            settledProfit: string;
            /** @example 200.0000 */
            unpaidPurchaseTotal: string;
            /** @example 150.0000 */
            confirmedPayoutTotal: string;
        };
        TransferOrderDto: {
            id: string;
            /** @example TRF000001 */
            transferNo: string;
            fromWarehouseId: string;
            toWarehouseId: string;
            /** @enum {string} */
            status: "DRAFT" | "CONFIRMED" | "CANCELLED";
            remark: string | null;
            createdBy: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            fromWarehouseName?: string | null;
            toWarehouseName?: string | null;
            /** @example 2 */
            linesCount?: number;
        };
        TransferOrderLineDto: {
            id: string;
            transferId: string;
            skuId: string;
            /** @example 4.000 */
            quantity: string;
            fromBinId: string | null;
            toBinId: string | null;
            outEventNo: string | null;
            inEventNo: string | null;
            remark: string | null;
            /** Format: date-time */
            createdAt: string;
            /** @example SKU000001001 */
            skuCode?: string;
            /** @example 浴帘 黑色 */
            skuName?: string;
            fromBinCode?: string | null;
            toBinCode?: string | null;
        };
        TransferOrderDetailDto: {
            id: string;
            /** @example TRF000001 */
            transferNo: string;
            fromWarehouseId: string;
            toWarehouseId: string;
            /** @enum {string} */
            status: "DRAFT" | "CONFIRMED" | "CANCELLED";
            remark: string | null;
            createdBy: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            fromWarehouseName?: string | null;
            toWarehouseName?: string | null;
            /** @example 2 */
            linesCount?: number;
            lines: components["schemas"]["TransferOrderLineDto"][];
        };
        TransferLineInputDto: {
            skuId: string;
            /** @example 5 */
            quantity: string;
            /** @description 源库位（空 = 源仓默认库位） */
            fromBinId?: string;
            /** @description 目标库位（空 = 目标仓默认库位） */
            toBinId?: string;
            remark?: string;
        };
        CreateTransferRequestDto: {
            /** @description 源仓库 */
            fromWarehouseId: string;
            /** @description 目标仓库 */
            toWarehouseId: string;
            remark?: string;
            lines: components["schemas"]["TransferLineInputDto"][];
        };
        AddTransferLineRequestDto: {
            skuId: string;
            /** @example 5 */
            quantity: string;
            /** @description 源库位（空 = 源仓默认库位） */
            fromBinId?: string;
            /** @description 目标库位（空 = 目标仓默认库位） */
            toBinId?: string;
            remark?: string;
        };
        TestJobResultDto: {
            /** @example 42 */
            jobId: string;
            /** @example wcies.test */
            queue: string;
        };
        CreateTestJobDto: {
            /** @example hello */
            message?: string;
        };
        StorageTestData: {
            /** @example dev/storage-test-<uuid>.txt */
            objectKey: string;
            /** @example http://localhost:9000/wcies/dev/storage-test-....txt?X-Amz-... */
            signedUrl: string;
            /** @example true */
            verified: boolean;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    HealthController_getLiveAlias: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["LivenessData"];
                    };
                };
            };
        };
    };
    HealthController_getLive: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["LivenessData"];
                    };
                };
            };
        };
    };
    HealthController_getReady: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReadinessData"];
                    };
                };
            };
        };
    };
    AuthController_login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["LoginResponseDataDto"];
                    };
                };
            };
        };
    };
    AuthController_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["UserResponseDto"];
                    };
                };
            };
        };
    };
    AuthController_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    PlatformController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PlatformResponseDto"];
                    };
                };
            };
        };
    };
    PlatformController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PlatformResponseDto"];
                    };
                };
            };
        };
    };
    StoreController_list: {
        parameters: {
            query?: {
                platformId?: string;
                status?: "ACTIVE" | "INACTIVE";
                /** @description Matches store_code / name */
                keyword?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["StoreListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    StoreController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateStoreRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["StoreResponseDto"];
                    };
                };
            };
        };
    };
    StoreController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["StoreResponseDto"];
                    };
                };
            };
        };
    };
    StoreController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    StoreController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateStoreRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["StoreResponseDto"];
                    };
                };
            };
        };
    };
    StoreController_activate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["StoreResponseDto"];
                    };
                };
            };
        };
    };
    StoreController_deactivate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["StoreResponseDto"];
                    };
                };
            };
        };
    };
    StoreCredentialController_list: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CredentialResponseDto"][];
                    };
                };
            };
        };
    };
    StoreCredentialController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpsertCredentialRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CredentialResponseDto"];
                    };
                };
            };
        };
    };
    StoreCredentialController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    StoreCredentialController_updatePayload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpsertCredentialRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CredentialResponseDto"];
                    };
                };
            };
        };
    };
    StoreCredentialController_validate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CredentialValidateResultDto"];
                    };
                };
            };
        };
    };
    StoreCredentialController_disable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CredentialResponseDto"];
                    };
                };
            };
        };
    };
    StoreCredentialController_enable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CredentialResponseDto"];
                    };
                };
            };
        };
    };
    CatalogController_listBrands: {
        parameters: {
            query: {
                keyword: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BrandResponseDto"];
                    };
                };
            };
        };
    };
    CatalogController_createBrand: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateBrandRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BrandResponseDto"];
                    };
                };
            };
        };
    };
    CatalogController_removeBrand: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    CatalogController_updateBrand: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBrandRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BrandResponseDto"];
                    };
                };
            };
        };
    };
    CatalogController_listCategoryTree: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CategoryTreeItemDto"];
                    };
                };
            };
        };
    };
    CatalogController_createCategory: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCategoryRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CategoryResponseDto"];
                    };
                };
            };
        };
    };
    CatalogController_listCategoryTreeLite: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CategoryTreeLiteItemDto"];
                    };
                };
            };
        };
    };
    CatalogController_removeCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    CatalogController_updateCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateCategoryRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CategoryResponseDto"];
                    };
                };
            };
        };
    };
    ProductController_list: {
        parameters: {
            query?: {
                /** @description Matches product_code / name_zh / name_ru */
                keyword?: string;
                brandId?: string;
                categoryId?: string;
                status?: "DRAFT" | "ACTIVE" | "INACTIVE";
                sortBy?: "createdAt" | "updatedAt" | "productCode" | "nameZh";
                sortOrder?: "asc" | "desc";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ProductListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    ProductController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateProductRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ProductResponseDto"];
                    };
                };
            };
        };
    };
    ProductController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ProductDetailDto"];
                    };
                };
            };
        };
    };
    ProductController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    ProductController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProductRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ProductResponseDto"];
                    };
                };
            };
        };
    };
    ProductController_activate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ProductResponseDto"];
                    };
                };
            };
        };
    };
    ProductController_deactivate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ProductResponseDto"];
                    };
                };
            };
        };
    };
    SkuController_list: {
        parameters: {
            query?: {
                /** @description Matches sku_code / name_zh / name_ru / model */
                keyword?: string;
                productId?: string;
                brandId?: string;
                categoryId?: string;
                status?: "DRAFT" | "ACTIVE" | "INACTIVE";
                /** @description Filter SKUs with/without platform listings */
                hasListing?: string;
                /** @description SKU linked to a listing of this platform */
                platformId?: string;
                /** @description SKU linked to a listing of this store */
                storeId?: string;
                serialTracking?: "true" | "false";
                sortBy?: "createdAt" | "updatedAt" | "skuCode" | "nameZh";
                sortOrder?: "asc" | "desc";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SkuListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    SkuController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateSkuRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SkuResponseDto"];
                    };
                };
            };
        };
    };
    SkuController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SkuResponseDto"];
                    };
                };
            };
        };
    };
    SkuController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    SkuController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateSkuRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SkuResponseDto"];
                    };
                };
            };
        };
    };
    SkuController_activate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SkuResponseDto"];
                    };
                };
            };
        };
    };
    SkuController_deactivate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SkuResponseDto"];
                    };
                };
            };
        };
    };
    SkuController_listBarcodes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BarcodeResponseDto"][];
                    };
                };
            };
        };
    };
    SkuController_createBarcode: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateBarcodeRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BarcodeResponseDto"];
                    };
                };
            };
        };
    };
    SkuController_generateInternalBarcode: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BarcodeResponseDto"];
                    };
                };
            };
        };
    };
    SkuController_deleteBarcode: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
                barcodeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    SkuController_updateBarcode: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
                barcodeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBarcodeRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BarcodeResponseDto"];
                    };
                };
            };
        };
    };
    SkuController_listImages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SkuImageResponseDto"][];
                    };
                };
            };
        };
    };
    SkuController_uploadImage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SkuImageResponseDto"];
                    };
                };
            };
        };
    };
    SkuController_deleteImage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
                imageId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    SkuController_updateImage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
                imageId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateSkuImageRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SkuImageResponseDto"];
                    };
                };
            };
        };
    };
    BarcodeController_resolve: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                barcode: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BarcodeResolveDto"];
                    };
                };
            };
        };
    };
    WarehouseController_list: {
        parameters: {
            query?: {
                /** @description Matches warehouse_code / name / city */
                keyword?: string;
                warehouseType?: "SELF" | "PLATFORM" | "THIRD_PARTY" | "RETURN_TEMP";
                status?: "ACTIVE" | "INACTIVE";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["WarehouseListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    WarehouseController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateWarehouseRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["WarehouseResponseDto"];
                    };
                };
            };
        };
    };
    WarehouseController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["WarehouseResponseDto"];
                    };
                };
            };
        };
    };
    WarehouseController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    WarehouseController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateWarehouseRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["WarehouseResponseDto"];
                    };
                };
            };
        };
    };
    WarehouseController_activate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["WarehouseResponseDto"];
                    };
                };
            };
        };
    };
    WarehouseController_deactivate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["WarehouseResponseDto"];
                    };
                };
            };
        };
    };
    WarehouseBinController_list: {
        parameters: {
            query?: {
                /** @description Matches bin_code / barcode / zone / rack */
                keyword?: string;
                /** @description Exact zone match */
                zone?: string;
                status?: "ACTIVE" | "INACTIVE";
            };
            header?: never;
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BinResponseDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    WarehouseBinController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateBinRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BinResponseDto"];
                    };
                };
            };
        };
    };
    WarehouseBinController_batchCreate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BatchCreateBinsRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BatchCreateBinsResponseDto"];
                    };
                };
            };
        };
    };
    WarehouseBinController_zones: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        /**
                         * @example [
                         *       "A",
                         *       "B"
                         *     ]
                         */
                        data: string[];
                    };
                };
            };
        };
    };
    WarehouseBinController_removeBin: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                warehouseId: string;
                binId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    WarehouseBinController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                warehouseId: string;
                binId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBinRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BinResponseDto"];
                    };
                };
            };
        };
    };
    WarehouseBinController_disable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                warehouseId: string;
                binId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BinResponseDto"];
                    };
                };
            };
        };
    };
    WarehouseBinController_enable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                warehouseId: string;
                binId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BinResponseDto"];
                    };
                };
            };
        };
    };
    StoreWarehouseBindingController_list: {
        parameters: {
            query?: {
                storeId?: string;
                warehouseId?: string;
                status?: "ACTIVE" | "DISABLED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BindingResponseDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    StoreWarehouseBindingController_listByStore: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BindingResponseDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    StoreWarehouseBindingController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateBindingRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BindingResponseDto"];
                    };
                };
            };
        };
    };
    StoreWarehouseBindingController_removeBinding: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    StoreWarehouseBindingController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBindingRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BindingResponseDto"];
                    };
                };
            };
        };
    };
    StoreWarehouseBindingController_disable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BindingResponseDto"];
                    };
                };
            };
        };
    };
    StoreWarehouseBindingController_enable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["BindingResponseDto"];
                    };
                };
            };
        };
    };
    ListingController_list: {
        parameters: {
            query?: {
                platformId?: string;
                storeId?: string;
                /** @description Listings mapping this internal SKU */
                skuId?: string;
                status?: "ACTIVE" | "INACTIVE";
                mappingState?: "MAPPED" | "UNMAPPED";
                /** @description Matches platform_product_id / title */
                keyword?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingResponseDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    ListingController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateListingRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingDetailDto"];
                    };
                };
            };
        };
    };
    ListingController_resolve: {
        parameters: {
            query: {
                /** @description MANDATORY store scope (task §52) */
                storeId: string;
                /** @description 解析标识之一（决策 0016） */
                platformSkuId?: string;
                /** @description 解析标识之一（决策 0016） */
                sellerSku?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ResolveSkuResponseDto"];
                    };
                };
            };
        };
    };
    ListingController_mappingStats: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingMappingStatsDto"];
                    };
                };
            };
        };
    };
    ListingController_onboardContext: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                listingId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingOnboardContextDto"];
                    };
                };
            };
        };
    };
    ListingController_exportUnmapped: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UnmappedListingExportRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["UnmappedListingExportResponseDto"];
                    };
                };
            };
        };
    };
    ListingController_listMappingsOfSku: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SkuMappingRowDto"][];
                    };
                };
            };
        };
    };
    ListingController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingDetailDto"];
                    };
                };
            };
        };
    };
    ListingController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    ListingController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateListingRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingDetailDto"];
                    };
                };
            };
        };
    };
    ListingController_activate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingDetailDto"];
                    };
                };
            };
        };
    };
    ListingController_deactivate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingDetailDto"];
                    };
                };
            };
        };
    };
    ListingController_addMapping: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                listingId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddListingSkuRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingSkuResponseDto"];
                    };
                };
            };
        };
    };
    ListingController_mapUnmappedSku: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                listingId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MapListingSkuRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingSkuResponseDto"];
                    };
                };
            };
        };
    };
    ListingController_onboard: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                listingId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ListingOnboardRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingOnboardResponseDto"];
                    };
                };
            };
        };
    };
    ListingController_deleteMapping: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                listingId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    ListingController_updateMapping: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                listingId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateListingSkuRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ListingSkuResponseDto"];
                    };
                };
            };
        };
    };
    CategoryImportController_preview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryImportRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CategoryImportPreviewDto"];
                    };
                };
            };
        };
    };
    CategoryImportController_execute: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryImportRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CategoryImportResultDto"];
                    };
                };
            };
        };
    };
    ImportController_downloadTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                type: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Fixed-template xlsx workbook (binary download) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": string;
                };
            };
        };
    };
    ImportController_upload: {
        parameters: {
            query: {
                type: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ImportJobResponseDto"];
                    };
                };
            };
        };
    };
    ImportController_confirm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ImportJobResponseDto"];
                    };
                };
            };
        };
    };
    ImportController_list: {
        parameters: {
            query?: {
                importType?: "SKU" | "BARCODE" | "WAREHOUSE" | "BIN" | "LISTING_MAPPING" | "INITIAL_INVENTORY";
                status?: "VALIDATED" | "PENDING_IMPORT" | "IMPORTING" | "COMPLETED" | "FAILED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ImportJobResponseDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    ImportController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ImportJobResponseDto"];
                    };
                };
            };
        };
    };
    InventoryController_list: {
        parameters: {
            query?: {
                keyword?: string;
                skuId?: string;
                warehouseId?: string;
                binId?: string;
                condition?: "SELLABLE" | "QC_PENDING" | "DEFECTIVE" | "REPAIR" | "SCRAPPED";
                /** @description IN_STOCK=有可售, OUT_OF_STOCK=无可售 */
                status?: "IN_STOCK" | "OUT_OF_STOCK";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["InventoryRowDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    InventoryController_getSkuInventory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SkuInventoryDetailDto"];
                    };
                };
            };
        };
    };
    InventoryController_listTransactions: {
        parameters: {
            query?: {
                skuId?: string;
                warehouseId?: string;
                binId?: string;
                transactionType?: "INITIAL_STOCK" | "RECEIVE" | "RESERVE" | "RELEASE" | "PICK" | "UNPICK" | "SHIP" | "RETURN_PICKED" | "MOVE_BIN" | "MANUAL_ADJUSTMENT" | "TRANSFER_OUT" | "TRANSFER_IN";
                referenceType?: "MANUAL" | "TEST" | "ORDER" | "IMPORT" | "PURCHASE_RECEIPT" | "RETURN_RECEIPT" | "TRANSFER";
                referenceId?: string;
                createdFrom?: string;
                createdTo?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["TransactionDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    InventoryController_initialize: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InitializeStockRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["StockChangeResultDto"];
                    };
                };
            };
        };
    };
    InventoryController_receive: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReceiveStockRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["StockChangeResultDto"];
                    };
                };
            };
        };
    };
    InventoryController_adjust: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdjustStockRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["StockChangeResultDto"];
                    };
                };
            };
        };
    };
    InventoryController_moveBin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MoveBinRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["MoveBinResultDto"];
                    };
                };
            };
        };
    };
    InventoryReservationController_list: {
        parameters: {
            query?: {
                skuId?: string;
                warehouseId?: string;
                status?: "ACTIVE" | "PICKED" | "RELEASED" | "CONSUMED" | "CANCELLED";
                referenceType?: "TEST" | "MANUAL" | "ORDER";
                referenceId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReservationListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    InventoryReservationController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReserveStockRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReservationDto"];
                    };
                };
            };
        };
    };
    InventoryReservationController_replenishmentSuggestions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReplenishmentSuggestionDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    InventoryReservationController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReservationDto"];
                    };
                };
            };
        };
    };
    InventoryReservationController_release: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReservationLifecycleRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReservationDto"];
                    };
                };
            };
        };
    };
    InventoryReservationController_pick: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReservationLifecycleRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReservationDto"];
                    };
                };
            };
        };
    };
    InventoryReservationController_unpick: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReservationLifecycleRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReservationDto"];
                    };
                };
            };
        };
    };
    InventoryReservationController_ship: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReservationLifecycleRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReservationDto"];
                    };
                };
            };
        };
    };
    InventorySafetyStockController_list: {
        parameters: {
            query?: {
                skuId?: string;
                warehouseId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SafetyStockDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    InventorySafetyStockController_upsert: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skuId: string;
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpsertSafetyStockRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SafetyStockDto"];
                    };
                };
            };
        };
    };
    ExceptionController_list: {
        parameters: {
            query?: {
                exceptionType?: "ORDER_SKU_MAPPING_FAILED" | "ORDER_OUT_OF_STOCK" | "ORDER_INVALID_STATE" | "ORDER_INTERCEPTION_FAILED" | "ORDER_SHIPMENT_DEADLINE_NEAR" | "SYNC_FAILED" | "ORDER_TRACKING_STALLED" | "ORDER_CANCELLED_AFTER_SHIP" | "RETURN_ORDER_NOT_FOUND" | "RETURN_DIFFERENCE";
                status?: "OPEN" | "RESOLVED" | "IGNORED";
                referenceType?: string;
                referenceId?: string;
                storeId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ExceptionItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    ExceptionController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ExceptionItemDto"];
                    };
                };
            };
        };
    };
    ExceptionController_resolve: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExceptionCloseRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ExceptionItemDto"];
                    };
                };
            };
        };
    };
    ExceptionController_ignore: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExceptionCloseRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ExceptionItemDto"];
                    };
                };
            };
        };
    };
    OrderController_list: {
        parameters: {
            query?: {
                /** @description 订单号 / 平台订单号模糊搜索 */
                keyword?: string;
                erpStatus?: "NEW" | "ALLOCATING" | "READY_TO_PICK" | "PARTIALLY_BACKORDERED" | "BACKORDERED" | "PICKING" | "PICKED" | "PARTIALLY_SHIPPED" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
                /** @description 一级 · 物流阶段（双轴 §2.1）：PENDING=erp_status 非 SHIPPED/CANCELLED（缺货/分歧单均在内）；IN_TRANSIT=已发货且平台未妥投（platform_stage 非 DELIVERED，含未同步）；COMPLETED=已发货且平台已妥投 */
                stage?: "PENDING" | "IN_TRANSIT" | "COMPLETED";
                /** @description 二级 · 行级货物状态（双轴 §2.2，单选）：TO_PICK=存在 RESERVED 行；PICKING=erp_status PICKING；TO_SHIP=存在 PICKED 行；BACKORDERED=存在缺货行；MAPPING_FAILED=存在映射失败行；SHIPMENT_OVERDUE=已过发货时限未发完；ABNORMAL=缺货∪映射失败∪发货超时∪物流停滞（OPEN ORDER_TRACKING_STALLED） */
                goodsState?: "TO_PICK" | "PICKING" | "TO_SHIP" | "BACKORDERED" | "MAPPING_FAILED" | "SHIPMENT_OVERDUE" | "ABNORMAL";
                storeId?: string;
                /** @description 待采购视图：存在 MAPPED+BACKORDERED 且无未取消采购单覆盖的订单行 */
                pendingProcurement?: "true";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["OrderListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    OrderController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["OrderDetailDto"];
                    };
                };
            };
        };
    };
    OrderController_ingest: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NormalizedOrderInputDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["OrderIngestResultDto"];
                    };
                };
            };
        };
    };
    OrderController_cancel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OrderCancelRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["OrderCancelResultDto"];
                    };
                };
            };
        };
    };
    OrderController_markExternalFulfillment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OrderMarkExternalFulfillmentRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["OrderMarkExternalFulfillmentResultDto"];
                    };
                };
            };
        };
    };
    OrderController_retryAllocation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                itemId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["OrderRetryAllocationResultDto"];
                    };
                };
            };
        };
    };
    NotificationController_list: {
        parameters: {
            query?: {
                type?: "ORDER_INTERCEPTION_REQUIRED" | "ORDER_INTERCEPTION_FAILED";
                channel?: "SYSTEM" | "FEISHU";
                status?: "PENDING" | "SENT" | "FAILED" | "CANCELLED";
                referenceId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["NotificationDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    NotificationController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["NotificationDto"];
                    };
                };
            };
        };
    };
    NotificationController_retry: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["RetryNotificationResultDto"];
                    };
                };
            };
        };
    };
    PickingController_list: {
        parameters: {
            query?: {
                warehouseId?: string;
                status?: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
                orderId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PickingTaskListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    PickingController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePickingTaskRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CreatePickingTaskResultDto"];
                    };
                };
            };
        };
    };
    PickingController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PickingTaskDetailDto"];
                    };
                };
            };
        };
    };
    PickingController_start: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PickingTaskDetailDto"];
                    };
                };
            };
        };
    };
    PickingController_scan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PickingScanRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PickingScanResultDto"];
                    };
                };
            };
        };
    };
    PickingController_complete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PickingTaskDetailDto"];
                    };
                };
            };
        };
    };
    InterceptionController_list: {
        parameters: {
            query?: {
                orderId?: string;
                warehouseId?: string;
                status?: "CREATED" | "ASSIGNED" | "LOCATING" | "INTERCEPTED" | "FAILED" | "RETURNED_TO_STOCK" | "CLOSED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["InterceptionListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    InterceptionController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["InterceptionDetailDto"];
                    };
                };
            };
        };
    };
    InterceptionController_assign: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssignInterceptionRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["InterceptionDetailDto"];
                    };
                };
            };
        };
    };
    InterceptionController_start: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["InterceptionDetailDto"];
                    };
                };
            };
        };
    };
    InterceptionController_scan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InterceptionScanRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["InterceptionDetailDto"];
                    };
                };
            };
        };
    };
    InterceptionController_returnToStock: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReturnToStockRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["InterceptionDetailDto"];
                    };
                };
            };
        };
    };
    InterceptionController_fail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FailInterceptionRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["InterceptionDetailDto"];
                    };
                };
            };
        };
    };
    InterceptionController_close: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["InterceptionDetailDto"];
                    };
                };
            };
        };
    };
    SupplierController_list: {
        parameters: {
            query?: {
                /** @description 编码 / 名称模糊搜索 */
                keyword?: string;
                status?: "ACTIVE" | "INACTIVE";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SupplierListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    SupplierController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateSupplierRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SupplierResponseDto"];
                    };
                };
            };
        };
    };
    SupplierController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SupplierResponseDto"];
                    };
                };
            };
        };
    };
    SupplierController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: Record<string, never>;
                    };
                };
            };
        };
    };
    SupplierController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateSupplierRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SupplierResponseDto"];
                    };
                };
            };
        };
    };
    SupplierController_activate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SupplierResponseDto"];
                    };
                };
            };
        };
    };
    SupplierController_deactivate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SupplierResponseDto"];
                    };
                };
            };
        };
    };
    PurchaseOrderController_list: {
        parameters: {
            query?: {
                /** @description PO号 / 货源说明 / 供应商名 模糊搜索 */
                keyword?: string;
                status?: "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
                supplierId?: string;
                orderItemId?: string;
                orderedFrom?: string;
                orderedTo?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseOrderListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    PurchaseOrderController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePurchaseOrderRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseOrderDetailDto"];
                    };
                };
            };
        };
    };
    PurchaseOrderController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseOrderDetailDto"];
                    };
                };
            };
        };
    };
    PurchaseOrderController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdatePurchaseOrderRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseOrderDetailDto"];
                    };
                };
            };
        };
    };
    PurchaseOrderController_cancel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseOrderDetailDto"];
                    };
                };
            };
        };
    };
    PurchaseReceiptController_list: {
        parameters: {
            query?: {
                /** @description 收货单号 / 货源说明 模糊搜索 */
                keyword?: string;
                status?: "DRAFT" | "RECEIVED" | "CANCELLED";
                warehouseId?: string;
                purchaseOrderId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseReceiptListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    PurchaseReceiptController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePurchaseReceiptRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseReceiptDetailDto"];
                    };
                };
            };
        };
    };
    PurchaseReceiptController_generateFromPo: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                poId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenerateReceiptFromPoRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseReceiptDetailDto"];
                    };
                };
            };
        };
    };
    PurchaseReceiptController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseReceiptDetailDto"];
                    };
                };
            };
        };
    };
    PurchaseReceiptController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdatePurchaseReceiptRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseReceiptDetailDto"];
                    };
                };
            };
        };
    };
    PurchaseReceiptController_confirm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseReceiptConfirmResultDto"];
                    };
                };
            };
        };
    };
    PurchaseReceiptController_cancel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PurchaseReceiptDetailDto"];
                    };
                };
            };
        };
    };
    ShipmentController_list: {
        parameters: {
            query?: {
                orderId?: string;
                warehouseId?: string;
                status?: "DRAFT" | "READY_TO_PACK" | "PACKING" | "READY_TO_SHIP" | "SHIPPED" | "CANCELLED" | "EXCEPTION";
                /** @description 物流单号模糊搜索 */
                trackingNumber?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ShipmentListItemDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    ShipmentController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateShipmentRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CreateShipmentResultDto"];
                    };
                };
            };
        };
    };
    ShipmentController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ShipmentDetailDto"];
                    };
                };
            };
        };
    };
    ShipmentController_createPackage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["CreatePackageResultDto"];
                    };
                };
            };
        };
    };
    ShipmentController_updateTracking: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateShipmentTrackingRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ShipmentDetailDto"];
                    };
                };
            };
        };
    };
    ShipmentController_ship: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShipShipmentRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ShipShipmentResultDto"];
                    };
                };
            };
        };
    };
    ShipmentController_listLabels: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ShippingLabelDto"];
                    };
                };
            };
        };
    };
    ShipmentController_uploadLabel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ShippingLabelDto"];
                    };
                };
            };
        };
    };
    PackageController_workbench: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PackageWorkbenchDto"];
                    };
                };
            };
        };
    };
    PackageController_scan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PackingScanRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PackingScanResultDto"];
                    };
                };
            };
        };
    };
    PackageController_seal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SealPackageRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SealPackageResultDto"];
                    };
                };
            };
        };
    };
    ReturnsController_listPlatformReturns: {
        parameters: {
            query?: {
                storeId?: string;
                orderId?: string;
                /** @description linked=false：待收货对账视图（尚无退货批次行关联的平台退货记录） */
                linked?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PlatformReturnDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    ReturnsController_syncPlatformReturns: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlatformReturnSyncDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PlatformReturnSyncResultDto"];
                    };
                };
            };
        };
    };
    ReturnsController_listBatches: {
        parameters: {
            query?: {
                status?: "DRAFT" | "RECEIVED" | "COMPLETED" | "CANCELLED";
                warehouseId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReturnBatchDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    ReturnsController_createBatch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReturnBatchCreateDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReturnBatchDetailDto"];
                    };
                };
            };
        };
    };
    ReturnsController_getBatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReturnBatchDetailDto"];
                    };
                };
            };
        };
    };
    ReturnsController_receiveBatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReturnBatchDetailDto"];
                    };
                };
            };
        };
    };
    ReturnsController_cancelBatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReturnBatchDetailDto"];
                    };
                };
            };
        };
    };
    ReturnsController_inspectItem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                itemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReturnItemInspectDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["ReturnBatchItemDto"];
                    };
                };
            };
        };
    };
    SyncController_triggerOrderSync: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TriggerSyncRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SyncJobDto"];
                    };
                };
            };
        };
    };
    SyncController_triggerListingSync: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TriggerSyncRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SyncJobDto"];
                    };
                };
            };
        };
    };
    SyncController_triggerCategoryTreeSync: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TriggerSyncRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SyncJobDto"];
                    };
                };
            };
        };
    };
    SyncController_triggerProductEnrichmentSync: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TriggerSyncRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SyncJobDto"];
                    };
                };
            };
        };
    };
    SyncController_list: {
        parameters: {
            query?: {
                storeId?: string;
                syncType?: "LISTING_SYNC" | "ORDER_SYNC" | "CATEGORY_TREE_SYNC" | "PRODUCT_ENRICHMENT_SYNC";
                status?: "PENDING" | "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SyncJobDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    SyncController_getById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SyncJobDto"];
                    };
                };
            };
        };
    };
    SyncController_storeOverview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["StoreSyncOverviewDto"];
                    };
                };
            };
        };
    };
    SyncController_listEvents: {
        parameters: {
            query?: {
                storeId?: string;
                status?: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED" | "SKIPPED" | "REJECTED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["RawEventDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    OzonWebhookController_receive: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                storeCode: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OZON 约定的确认格式（非 WCIES envelope） */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @example 2.0 */
                        version: string;
                        /** @example WCIES */
                        name: string;
                        /**
                         * Format: date-time
                         * @description 开始处理该通知的时间（UTC）
                         * @example 2026-09-14T15:30:00Z
                         */
                        time: string;
                    };
                };
            };
        };
    };
    FinanceController_listTransactions: {
        parameters: {
            query?: {
                /** @description 凭证号 / 订单号 / 采购单号模糊搜索 */
                keyword?: string;
                direction?: "INCOME" | "EXPENSE";
                category?: "SALE_INCOME" | "SALE_REFUND" | "PURCHASE_PAYMENT" | "SUPPLIER_REFUND" | "PLATFORM_FEE" | "LOGISTICS_FEE" | "OTHER_INCOME" | "OTHER_EXPENSE";
                storeId?: string;
                supplierId?: string;
                orderId?: string;
                purchaseOrderId?: string;
                payoutId?: string;
                from?: string;
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["FinanceTransactionDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    FinanceController_createTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateFinanceTransactionRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["FinanceTransactionDto"];
                    };
                };
            };
        };
    };
    FinanceController_getTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["FinanceTransactionDto"];
                    };
                };
            };
        };
    };
    FinanceController_reverseTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["FinanceTransactionDto"];
                    };
                };
            };
        };
    };
    FinanceController_listPayouts: {
        parameters: {
            query?: {
                /** @description 回款单号模糊搜索 */
                keyword?: string;
                storeId?: string;
                status?: "DRAFT" | "CONFIRMED" | "CANCELLED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["FinancePayoutDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    FinanceController_createPayout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateFinancePayoutRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["FinancePayoutDto"];
                    };
                };
            };
        };
    };
    FinanceController_getPayout: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["FinancePayoutDto"];
                    };
                };
            };
        };
    };
    FinanceController_previewPayout: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["FinancePayoutPreviewDto"];
                    };
                };
            };
        };
    };
    FinanceController_confirmPayout: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["FinancePayoutDto"];
                    };
                };
            };
        };
    };
    FinanceController_cancelPayout: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["FinancePayoutDto"];
                    };
                };
            };
        };
    };
    FinanceController_listSettlements: {
        parameters: {
            query?: {
                /** @description 订单号 / 平台订单号模糊搜索 */
                keyword?: string;
                storeId?: string;
                /** @description 结算生成时间 ≥ */
                from?: string;
                /** @description 结算生成时间 < */
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["OrderSettlementDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    FinanceController_getSettlement: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["OrderSettlementDetailDto"];
                    };
                };
            };
        };
    };
    FinanceController_generateSettlement: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenerateOrderSettlementRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["OrderSettlementDto"];
                    };
                };
            };
        };
    };
    FinanceController_generateMissingSettlements: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["SettlementGenerateMissingResultDto"];
                    };
                };
            };
        };
    };
    FinanceController_updateSettlementFees: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateOrderSettlementFeesRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["OrderSettlementDto"];
                    };
                };
            };
        };
    };
    FinanceController_listPayables: {
        parameters: {
            query?: {
                /** @description 采购单号 / 供应商模糊搜索 */
                keyword?: string;
                paymentState?: "NOTHING_TO_PAY" | "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["PayableRowDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    FinanceController_summary: {
        parameters: {
            query?: {
                from?: string;
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["FinanceSummaryResponseDto"];
                    };
                };
            };
        };
    };
    TransferController_list: {
        parameters: {
            query?: {
                /** @description 调拨单号模糊搜索 */
                keyword?: string;
                fromWarehouseId?: string;
                toWarehouseId?: string;
                status?: "DRAFT" | "CONFIRMED" | "CANCELLED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["TransferOrderDto"][];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
    };
    TransferController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTransferRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["TransferOrderDto"];
                    };
                };
            };
        };
    };
    TransferController_getDetail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["TransferOrderDetailDto"];
                    };
                };
            };
        };
    };
    TransferController_addLine: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddTransferLineRequestDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["TransferOrderDto"];
                    };
                };
            };
        };
    };
    TransferController_removeLine: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                lineId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["TransferOrderDto"];
                    };
                };
            };
        };
    };
    TransferController_confirm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["TransferOrderDto"];
                    };
                };
            };
        };
    };
    TransferController_cancel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["TransferOrderDto"];
                    };
                };
            };
        };
    };
    DevController_createTestJob: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTestJobDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["TestJobResultDto"];
                    };
                };
            };
        };
    };
    StorageTestController_runStorageTest: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        success: true;
                        data: components["schemas"]["StorageTestData"];
                    };
                };
            };
        };
    };
}
