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
        delete?: never;
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
        delete?: never;
        options?: never;
        head?: never;
        /** Replace the credential payload (re-encrypted) */
        patch: operations["StoreCredentialController_updatePayload"];
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
        delete?: never;
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
        delete?: never;
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
        delete?: never;
        options?: never;
        head?: never;
        /** Update product fields (business code editable, UUID immutable) */
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
        delete?: never;
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
        /** Generate an INTERNAL barcode (WCSKU%08d) for the SKU */
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
        delete?: never;
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
        delete?: never;
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
        delete?: never;
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
        /** Resolve an internal SKU by platform identifiers (STRICTLY store-scoped) */
        get: operations["ListingController_resolve"];
        put?: never;
        post?: never;
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
        delete?: never;
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
        LivenessResponseDto: Record<string, never>;
        ReadinessResponseDto: Record<string, never>;
        LoginRequestDto: {
            /**
             * @description Username or email
             * @example admin
             */
            usernameOrEmail: string;
            /** @description Plain password (transit only, never stored) */
            password: string;
        };
        LoginResponseDto: Record<string, never>;
        UserEnvelopeDto: Record<string, never>;
        LogoutResponseDto: Record<string, never>;
        PlatformListEnvelopeDto: Record<string, never>;
        PlatformEnvelopeDto: Record<string, never>;
        StoreListEnvelopeDto: Record<string, never>;
        CreateStoreRequestDto: {
            /**
             * Format: uuid
             * @description Platform the store belongs to
             */
            platformId: string;
            /** @example OZON-A */
            storeCode: string;
            /** @example OZON 店铺 A */
            name: string;
            /** @example 123456 */
            sellerId?: string;
            /** @example RUB */
            defaultCurrency?: string;
            /** @description Free-form store settings */
            settings?: Record<string, never>;
        };
        StoreEnvelopeDto: Record<string, never>;
        UpdateStoreRequestDto: {
            /** @example OZON 店铺 A（新） */
            name?: string;
            /** @example 123456 */
            sellerId?: string;
            /** @example RUB */
            defaultCurrency?: string;
            settings?: Record<string, never>;
        };
        CredentialListEnvelopeDto: Record<string, never>;
        UpsertCredentialRequestDto: {
            /**
             * @example MAIN_API
             * @enum {string}
             */
            credentialType: "MAIN_API";
            /** @description Plain credential payload (e.g. apiKey/clientId); encrypted at rest */
            payload: Record<string, never>;
        };
        CredentialEnvelopeDto: Record<string, never>;
        BrandListEnvelopeDto: Record<string, never>;
        CreateBrandRequestDto: {
            /** @example VALKYRIE */
            code: string;
            /** @example VALKYRIE */
            nameZh: string;
            /** @example Valkyrie */
            nameEn?: string;
            /** @example VALKYRIE */
            nameRu?: string;
        };
        BrandEnvelopeDto: Record<string, never>;
        UpdateBrandRequestDto: {
            nameZh?: string;
            nameEn?: string;
            nameRu?: string;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE";
        };
        CategoryTreeEnvelopeDto: Record<string, never>;
        CreateCategoryRequestDto: {
            /** Format: uuid */
            parentId?: Record<string, never> | null;
            /** @example KEYBOARD */
            code: string;
            /** @example 键盘 */
            nameZh: string;
            /** @example Клавиатуры */
            nameRu?: string;
            /** @example 0 */
            sortOrder?: number;
        };
        CategoryEnvelopeDto: Record<string, never>;
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
        ProductListEnvelopeDto: Record<string, never>;
        CreateProductRequestDto: {
            /**
             * @description Auto-generated (PRD%06d) when omitted
             * @example PRD000001
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
        ProductEnvelopeDto: Record<string, never>;
        ProductDetailEnvelopeDto: Record<string, never>;
        UpdateProductRequestDto: {
            /** @description Business code is editable; the UUID never changes (task §16) */
            productCode?: string;
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
        SkuListEnvelopeDto: Record<string, never>;
        CreateSkuRequestDto: {
            /**
             * @description Auto-generated (SKU%06d) when omitted
             * @example VK87-BLK
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
            /** @example 0.95 */
            weightKg?: number;
            /**
             * @description Provide with width and height or not at all
             * @example 35.5
             */
            lengthCm?: number;
            /** @example 12.2 */
            widthCm?: number;
            /** @example 3.4 */
            heightCm?: number;
            /**
             * @description Manually maintained in Sprint 1
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
        SkuEnvelopeDto: Record<string, never>;
        UpdateSkuRequestDto: {
            /** @description Business code is editable; the UUID never changes */
            skuCode?: string;
            nameZh?: string;
            nameRu?: string;
            model?: string;
            color?: string;
            size?: string;
            weightKg?: number;
            /** @description Provide with width and height or not at all */
            lengthCm?: number;
            widthCm?: number;
            heightCm?: number;
            latestPurchasePrice?: number;
            costCurrency?: string;
            serialTracking?: boolean;
            remark?: string;
        };
        BarcodeListEnvelopeDto: Record<string, never>;
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
        BarcodeEnvelopeDto: Record<string, never>;
        UpdateBarcodeRequestDto: {
            /** @enum {string} */
            barcodeType?: "EAN" | "GTIN" | "MANUFACTURER" | "INTERNAL" | "OTHER";
            /** @description DB keeps at most one primary per SKU */
            isPrimary?: boolean;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE";
        };
        ImageListEnvelopeDto: Record<string, never>;
        ImageEnvelopeDto: Record<string, never>;
        UpdateSkuImageRequestDto: {
            /** @example 0 */
            sortOrder?: number;
            /** @description DB keeps at most one primary per SKU */
            isPrimary?: boolean;
        };
        WarehouseListEnvelopeDto: Record<string, never>;
        CreateWarehouseRequestDto: {
            /** @example SZ01 */
            warehouseCode: string;
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
        WarehouseEnvelopeDto: Record<string, never>;
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
        BinListEnvelopeDto: Record<string, never>;
        CreateBinRequestDto: {
            /** @example SZ01-A01-01 */
            binCode: string;
            /** @example A */
            zone?: string;
            /** @example A01 */
            rack?: string;
            /** @example 01 */
            level?: string;
            /** @example 01 */
            position?: string;
            /**
             * @description Auto-generated when omitted
             * @example BIN-SZ01-A01-01
             */
            barcode?: string;
            remark?: string;
        };
        BinEnvelopeDto: Record<string, never>;
        BatchCreateBinsRequestDto: {
            /**
             * @description Stored on every generated bin
             * @example A
             */
            zone?: string;
            /** @example A01 */
            rackFrom: string;
            /** @example A05 */
            rackTo: string;
            /** @example 01 */
            levelFrom: string;
            /** @example 04 */
            levelTo: string;
            /**
             * @description Position range; omit for no position suffix
             * @example 01
             */
            positionFrom?: string;
            /** @example 02 */
            positionTo?: string;
        };
        BatchBinsEnvelopeDto: Record<string, never>;
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
        BindingListEnvelopeDto: Record<string, never>;
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
        BindingEnvelopeDto: Record<string, never>;
        UpdateBindingRequestDto: {
            platformWarehouseId?: string;
            isInventorySource?: boolean;
            isInventoryPushEnabled?: boolean;
            priority?: number;
            settings?: Record<string, never>;
            /** @enum {string} */
            status?: "ACTIVE" | "DISABLED";
        };
        ListingListEnvelopeDto: Record<string, never>;
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
        ListingDetailEnvelopeDto: Record<string, never>;
        ResolveEnvelopeDto: Record<string, never>;
        SkuMappingsEnvelopeDto: Record<string, never>;
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
        ListingSkuEnvelopeDto: Record<string, never>;
        UpdateListingSkuRequestDto: {
            platformSkuId?: Record<string, never> | null;
            sellerSku?: Record<string, never> | null;
            offerId?: Record<string, never> | null;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE";
        };
        ImportJobEnvelopeDto: Record<string, never>;
        ImportListEnvelopeDto: Record<string, never>;
        InventoryListEnvelopeDto: Record<string, never>;
        SkuInventoryEnvelopeDto: Record<string, never>;
        TransactionListEnvelopeDto: Record<string, never>;
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
            referenceType: "MANUAL" | "TEST" | "ORDER" | "IMPORT";
            referenceId: string;
            remark?: string;
            /** @example INIT:PRD-VK87:2026-09-08 */
            idempotencyKey: string;
        };
        StockChangeEnvelopeDto: Record<string, never>;
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
            referenceType: "MANUAL" | "TEST" | "ORDER" | "IMPORT";
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
            referenceType: "MANUAL" | "TEST" | "ORDER" | "IMPORT";
            referenceId: string;
            remark?: string;
            idempotencyKey: string;
        };
        MoveBinEnvelopeDto: Record<string, never>;
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
        ReservationEnvelopeDto: Record<string, never>;
        ReservationListEnvelopeDto: Record<string, never>;
        ReservationLifecycleRequestDto: {
            /** @description 同一业务事件重复请求时传相同 key 以幂等重放 */
            idempotencyKey?: string;
            remark?: string;
        };
        SafetyStockListEnvelopeDto: Record<string, never>;
        UpsertSafetyStockRequestDto: {
            /** @example 2 */
            safetyQty: string;
        };
        SafetyStockEnvelopeDto: Record<string, never>;
        ExceptionCloseRequestDto: {
            /** @description 处理备注（记录在 details.closeRemark） */
            remark?: string;
        };
        NormalizedOrderItemInputDto: {
            platformProductId?: string;
            platformSkuId?: string;
            sellerSku?: string;
            offerId?: string;
            /** @example 2 */
            quantity: string;
            rawData?: Record<string, never>;
        };
        NormalizedOrderInputDto: {
            storeId: string;
            /** @example OZON-123456789 */
            platformOrderId: string;
            /** @example awaiting_packaging */
            platformStatus?: string;
            /** @example FBS */
            fulfillmentMode?: string;
            /** Format: date-time */
            orderedAt: string;
            /** @example RUB */
            currency?: string;
            items: components["schemas"]["NormalizedOrderItemInputDto"][];
            /** @description 平台原始报文（保留事实，task §14） */
            rawData?: Record<string, never>;
            remark?: string;
        };
        OrderCancelRequestDto: {
            /** @description 取消原因（记入历史与拦截任务） */
            reason?: string;
        };
        CreatePickingTaskRequestDto: {
            /** @description 从该订单的 RESERVED 行生成拣货任务（按仓拆分） */
            orderId: string;
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
        CreateTestJobDto: Record<string, never>;
        TestJobResponseDto: Record<string, never>;
        StorageTestResponseDto: Record<string, never>;
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
                    "application/json": components["schemas"]["LivenessResponseDto"];
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
                    "application/json": components["schemas"]["LivenessResponseDto"];
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
                    "application/json": components["schemas"]["ReadinessResponseDto"];
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
                    "application/json": components["schemas"]["LoginResponseDto"];
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
                    "application/json": components["schemas"]["UserEnvelopeDto"];
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
                    "application/json": components["schemas"]["LogoutResponseDto"];
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
                    "application/json": components["schemas"]["PlatformListEnvelopeDto"];
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
                    "application/json": components["schemas"]["PlatformEnvelopeDto"];
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
                    "application/json": components["schemas"]["StoreListEnvelopeDto"];
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
                    "application/json": components["schemas"]["StoreEnvelopeDto"];
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
                    "application/json": components["schemas"]["StoreEnvelopeDto"];
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
                    "application/json": components["schemas"]["StoreEnvelopeDto"];
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
                    "application/json": components["schemas"]["StoreEnvelopeDto"];
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
                    "application/json": components["schemas"]["StoreEnvelopeDto"];
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
                    "application/json": components["schemas"]["CredentialListEnvelopeDto"];
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
                    "application/json": components["schemas"]["CredentialEnvelopeDto"];
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
                    "application/json": components["schemas"]["CredentialEnvelopeDto"];
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
                    "application/json": components["schemas"]["CredentialEnvelopeDto"];
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
                    "application/json": components["schemas"]["BrandListEnvelopeDto"];
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
                    "application/json": components["schemas"]["BrandEnvelopeDto"];
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
                    "application/json": components["schemas"]["BrandEnvelopeDto"];
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
                    "application/json": components["schemas"]["CategoryTreeEnvelopeDto"];
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
                    "application/json": components["schemas"]["CategoryEnvelopeDto"];
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
                    "application/json": components["schemas"]["CategoryEnvelopeDto"];
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
                    "application/json": components["schemas"]["ProductListEnvelopeDto"];
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
                    "application/json": components["schemas"]["ProductEnvelopeDto"];
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
                    "application/json": components["schemas"]["ProductDetailEnvelopeDto"];
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
                    "application/json": components["schemas"]["ProductEnvelopeDto"];
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
                    "application/json": components["schemas"]["ProductEnvelopeDto"];
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
                    "application/json": components["schemas"]["ProductEnvelopeDto"];
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
                    "application/json": components["schemas"]["SkuListEnvelopeDto"];
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
                    "application/json": components["schemas"]["SkuEnvelopeDto"];
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
                    "application/json": components["schemas"]["SkuEnvelopeDto"];
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
                    "application/json": components["schemas"]["SkuEnvelopeDto"];
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
                    "application/json": components["schemas"]["SkuEnvelopeDto"];
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
                    "application/json": components["schemas"]["SkuEnvelopeDto"];
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
                    "application/json": components["schemas"]["BarcodeListEnvelopeDto"];
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
                    "application/json": components["schemas"]["BarcodeEnvelopeDto"];
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
                    "application/json": components["schemas"]["BarcodeEnvelopeDto"];
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
                content?: never;
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
                    "application/json": components["schemas"]["BarcodeEnvelopeDto"];
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
                    "application/json": components["schemas"]["ImageListEnvelopeDto"];
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
                    "application/json": components["schemas"]["ImageEnvelopeDto"];
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
                content?: never;
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
                    "application/json": components["schemas"]["ImageEnvelopeDto"];
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
                    "application/json": components["schemas"]["WarehouseListEnvelopeDto"];
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
                    "application/json": components["schemas"]["WarehouseEnvelopeDto"];
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
                    "application/json": components["schemas"]["WarehouseEnvelopeDto"];
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
                    "application/json": components["schemas"]["WarehouseEnvelopeDto"];
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
                    "application/json": components["schemas"]["WarehouseEnvelopeDto"];
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
                    "application/json": components["schemas"]["WarehouseEnvelopeDto"];
                };
            };
        };
    };
    WarehouseBinController_list: {
        parameters: {
            query?: {
                /** @description Matches bin_code / barcode / zone / rack */
                keyword?: string;
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
                    "application/json": components["schemas"]["BinListEnvelopeDto"];
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
                    "application/json": components["schemas"]["BinEnvelopeDto"];
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
                    "application/json": components["schemas"]["BatchBinsEnvelopeDto"];
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
                    "application/json": components["schemas"]["BinEnvelopeDto"];
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
                    "application/json": components["schemas"]["BinEnvelopeDto"];
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
                    "application/json": components["schemas"]["BinEnvelopeDto"];
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
                    "application/json": components["schemas"]["BindingListEnvelopeDto"];
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
                    "application/json": components["schemas"]["BindingListEnvelopeDto"];
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
                    "application/json": components["schemas"]["BindingEnvelopeDto"];
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
                    "application/json": components["schemas"]["BindingEnvelopeDto"];
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
                    "application/json": components["schemas"]["BindingEnvelopeDto"];
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
                    "application/json": components["schemas"]["BindingEnvelopeDto"];
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
                    "application/json": components["schemas"]["ListingListEnvelopeDto"];
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
                    "application/json": components["schemas"]["ListingDetailEnvelopeDto"];
                };
            };
        };
    };
    ListingController_resolve: {
        parameters: {
            query: {
                /** @description MANDATORY store scope (task §52) */
                storeId: string;
                platformSkuId?: string;
                sellerSku?: string;
                offerId?: string;
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
                    "application/json": components["schemas"]["ResolveEnvelopeDto"];
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
                    "application/json": components["schemas"]["SkuMappingsEnvelopeDto"];
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
                    "application/json": components["schemas"]["ListingDetailEnvelopeDto"];
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
                    "application/json": components["schemas"]["ListingDetailEnvelopeDto"];
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
                    "application/json": components["schemas"]["ListingDetailEnvelopeDto"];
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
                    "application/json": components["schemas"]["ListingDetailEnvelopeDto"];
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
                    "application/json": components["schemas"]["ListingSkuEnvelopeDto"];
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
                content?: never;
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
                    "application/json": components["schemas"]["ListingSkuEnvelopeDto"];
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
                    "application/json": components["schemas"]["ImportJobEnvelopeDto"];
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
                    "application/json": components["schemas"]["ImportJobEnvelopeDto"];
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
                    "application/json": components["schemas"]["ImportListEnvelopeDto"];
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
                    "application/json": components["schemas"]["ImportJobEnvelopeDto"];
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
                    "application/json": components["schemas"]["InventoryListEnvelopeDto"];
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
                    "application/json": components["schemas"]["SkuInventoryEnvelopeDto"];
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
                transactionType?: "INITIAL_STOCK" | "RECEIVE" | "RESERVE" | "RELEASE" | "PICK" | "UNPICK" | "SHIP" | "MOVE_BIN" | "MANUAL_ADJUSTMENT";
                referenceType?: "MANUAL" | "TEST" | "ORDER" | "IMPORT";
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
                    "application/json": components["schemas"]["TransactionListEnvelopeDto"];
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
                    "application/json": components["schemas"]["StockChangeEnvelopeDto"];
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
                    "application/json": components["schemas"]["StockChangeEnvelopeDto"];
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
                    "application/json": components["schemas"]["StockChangeEnvelopeDto"];
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
                    "application/json": components["schemas"]["MoveBinEnvelopeDto"];
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
                    "application/json": components["schemas"]["ReservationListEnvelopeDto"];
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
                    "application/json": components["schemas"]["ReservationEnvelopeDto"];
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
                    "application/json": components["schemas"]["ReservationEnvelopeDto"];
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
                    "application/json": components["schemas"]["ReservationEnvelopeDto"];
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
                    "application/json": components["schemas"]["ReservationEnvelopeDto"];
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
                    "application/json": components["schemas"]["ReservationEnvelopeDto"];
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
                    "application/json": components["schemas"]["ReservationEnvelopeDto"];
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
                    "application/json": components["schemas"]["SafetyStockListEnvelopeDto"];
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
                    "application/json": components["schemas"]["SafetyStockEnvelopeDto"];
                };
            };
        };
    };
    ExceptionController_list: {
        parameters: {
            query?: {
                exceptionType?: "ORDER_SKU_MAPPING_FAILED" | "ORDER_OUT_OF_STOCK" | "ORDER_INVALID_STATE";
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
                content?: never;
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
                content?: never;
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
                content?: never;
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
                content?: never;
            };
        };
    };
    OrderController_list: {
        parameters: {
            query?: {
                /** @description 订单号 / 平台订单号模糊搜索 */
                keyword?: string;
                erpStatus?: "NEW" | "ALLOCATING" | "READY_TO_PICK" | "PARTIALLY_BACKORDERED" | "BACKORDERED" | "PICKING" | "PICKED" | "CANCELLED" | "EXCEPTION";
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
                content?: never;
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
                content?: never;
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
                content?: never;
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
                content?: never;
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
                content?: never;
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
                content?: never;
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
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
                content?: never;
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
                content?: never;
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
                content?: never;
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
                content?: never;
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
                    "application/json": components["schemas"]["TestJobResponseDto"];
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
                    "application/json": components["schemas"]["StorageTestResponseDto"];
                };
            };
        };
    };
}
