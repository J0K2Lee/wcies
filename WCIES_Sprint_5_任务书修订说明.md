# WCIES Sprint 5 任务书修订说明

本修订说明优先级高于原 Sprint 5 任务书中对应条款。

其余未涉及内容保持原任务书不变。

---

## 1. 删除原 P0：Shipment VOIDED 审计修复

原 Sprint 5 中以下前置任务已经完成：

> 修复 `shipment_items` 拦截回库时物理删除，改为可审计 VOIDED。

当前已经完成并提交：

```text
c158565 feat(shipment): preserve voided shipment and package audit history
c68f8a0 feat(web): show voided shipment item history
4bdc7e8 test(shipment): cover void lifecycle and partial unique constraints
```

当前事实：

```text
shipment_items:
ACTIVE | VOIDED

package_items:
ACTIVE | VOIDED

package_item_serials:
ACTIVE | VOIDED
```

所有业务计算只统计 ACTIVE。

历史 VOIDED：

永久保留。

部分唯一约束已经建立。

Sprint 5：

**不得重新设计或重做此功能。**

除非 OZON Integration 实际暴露出明确 bug，否则不得修改该领域规则。

---

# 2. 新 P0：修复 OpenAPI Response Schema 技术债

Sprint 5 开始平台集成之前，先处理：

```text
docs/architecture/overview.md §6
```

记录的 OpenAPI response schema 技术债。

当前已知问题：

```text
ShipmentEnvelopeDto
```

导出的 OpenAPI：

```text
properties = {}
```

且：

```text
ShipmentDetailDto
```

没有进入：

```text
components.schemas
```

导致：

```text
openapi:export
↓
api-client:generate
```

无法真实反映 Response DTO 契约变化。

---

# 3. P0目标

修复 NestJS Swagger Response DTO 描述链路。

要求：

```text
Controller
↓
Response DTO
↓
Swagger/OpenAPI
↓
components.schemas
↓
@wcies/api-client
```

必须真实贯通。

不得通过：

前端继续手写重复interface

来绕开。

---

# 4. 修复范围

先审计当前：

```text
Success Envelope DTO
Paged Envelope DTO
ShipmentEnvelopeDto
ShipmentDetailDto
```

以及 Sprint 0 建立的统一：

```text
{
  success: true,
  data: ...
}
```

Response机制。

重点确认：

- `@ApiProperty`
- `@ApiExtraModels`
- `getSchemaPath`
- Generic Envelope
- Pagination Envelope

是否正确描述。

可以建立统一 Swagger Helper。

但不得因此重构整个 API Response体系。

---

# 5. P0验收

修复后至少验证：

```text
ShipmentDetailDto
SyncJobDto
StoreDto
OrderDetailDto
```

均真实存在于：

```text
openapi.json → components.schemas
```

并且 Response：

能引用真实 DTO Schema。

必须增加自动化检查。

例如：

```text
openapi:export
↓
verify-openapi-schema
```

至少断言：

```text
ShipmentDetailDto
```

存在。

---

# 6. Architecture / CI建议

新增：

```text
scripts/check-openapi.ts
```

或等价检查。

至少检查：

- 核心 Response DTO 不为空；
- 指定核心 DTO 存在；
- API Client生成无错误。

并接入：

```text
CI
```

建议流程：

```text
lint
typecheck
check:arch
test
build
openapi:export
check:openapi
```

不要让 OpenAPI 契约再次静默失效。

---

# 7. 当前测试基线更新

Sprint 5 开始时当前基线为：

```text
Unit:
73 passed

Integration:
117 passed
```

因此 Sprint 5 最终回归：

不得低于当前基线，

除非测试被明确替换并说明原因。

---

# 8. 当前 Migration 基线

VOIDED 改造 migration：

```text
20260910_010
20260910_011
```

已经：

- 在 `wcies_dev` 执行；
- 在 `wcies_test` 空库重建验证；
- 尚未进入共享/生产环境。

Sprint 5：

不得修改已经提交的 migration 010/011。

如果发现问题：

新增 migration 修复。

---

# 9. 当前 Git基线

Sprint 5 从以下提交之后开始：

```text
c158565
c68f8a0
4bdc7e8
```

开始前：

```bash
git status --short
```

应确认没有已跟踪文件修改。

当前存在以下无关未跟踪文件：

```text
WCIES_Agent_Task_—_Sprint_3_Order_Core_&_Picking_Workflow.md
WCIES_Agent_Task_—_Sprint_4_Shipment_&_Interception.md
gui-test-screenshots/
handoff/wcies-void-refactor-handoff.md
show-me-wcies-sprint1.html
```

Sprint 5：

不要顺手提交、删除或修改这些文件，

除非用户明确要求。

---

# 10. Sprint 5仍然坚持 Read-First

原任务书关于真实 OZON 操作的限制保持不变。

Sprint 5允许：

```text
Credential Validation
Fetch Listings
Fetch Orders
Read-only API
```

禁止：

```text
Push Inventory
Update Price
Update Product
Cancel Platform Order
Platform Shipment Write
```

真实 OZON Read-only Smoke Test：

仍然必须在自动化 Mock / Fixture 测试全部通过后，

再向用户申请明确批准。

不得自行执行。

---

# 11. OpenAPI修复完成后才进入 OZON 主体

Sprint 5实施顺序调整为：

```text
S5-P0
OpenAPI Response Schema修复

↓

Platform Contract

↓

Adapter Registry

↓

OzonClient

↓

OzonMapper

↓

OzonAdapter

↓

Sync Core

↓

Listing Sync

↓

Order Sync

↓

Webhook / Polling能力确认

↓

Frontend Sync Center

↓

Mock / Fixture Full Test

↓

向用户申请 Real OZON Read-only Smoke Test
```

不得跳过 P0。

---

# 12. Sprint 5最终完成定义追加

除原任务书完成定义外，

新增：

```text
OpenAPI Response DTO契约正确
ShipmentDetailDto存在于components.schemas
Sprint 5核心DTO存在于components.schemas
api-client真实生成Response类型
check:openapi自动验证通过
```

否则 Sprint 5 不得标记完成。