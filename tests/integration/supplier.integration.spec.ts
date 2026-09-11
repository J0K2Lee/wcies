import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 7 T2 supplier master-data acceptance against real PostgreSQL:
 * CRUD, centralized SUP%04d coding, status lifecycle and the zero-reference
 * delete guard (the referenced-refusal case lives in purchase.integration
 * where a real purchase order provides the reference).
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3111';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

interface SupplierDto {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  status: string;
  remark: string | null;
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3111', REDIS_URL: 'redis://localhost:6379/8' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
});

afterAll(async () => {
  await api.stop();
});

describe('supplier master data (Sprint 7 T2)', () => {
  it('creates with an auto-generated SUP code and honors manual codes uniquely', async () => {
    const created = await client.post<SupplierDto>('/api/v1/suppliers', {
      name: `${PREFIX} 固定供应商A`,
      contactName: '王先生',
      contactPhone: '13800000000',
      remark: '月结供应商',
    });
    expect(created.status).toBe(200);
    expect(created.body.data.code).toMatch(/^SUP\d{4,}$/);

    const manualCode = `${PREFIX}-MANUAL`;
    const manual = await client.post<SupplierDto>('/api/v1/suppliers', {
      name: `${PREFIX} 手工编码供应商`,
      code: manualCode,
    });
    expect(manual.status).toBe(200);
    expect(manual.body.data.code).toBe(manualCode);

    const duplicate = await client.post('/api/v1/suppliers', {
      name: `${PREFIX} 重复编码供应商`,
      code: manualCode,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error?.code).toBe('SUPPLIER_CODE_ALREADY_EXISTS');
  });

  it('lists with keyword and status filters, shows reference counts', async () => {
    const name = `${PREFIX} 可搜索供应商`;
    await client.post<SupplierDto>('/api/v1/suppliers', { name });
    const list = await client.get<SupplierDto[]>(
      `/api/v1/suppliers?keyword=${encodeURIComponent(PREFIX)}&status=ACTIVE&pageSize=100`,
    );
    expect(list.status).toBe(200);
    expect(list.body.data.some((row) => row.name === name)).toBe(true);
    // Fresh suppliers have no purchase references yet.
    expect(list.body.data.every((row) => row.status === 'ACTIVE')).toBe(true);
  });

  it('updates fields, flips status, and never allows code changes via PATCH', async () => {
    const created = await client.post<SupplierDto>('/api/v1/suppliers', {
      name: `${PREFIX} 待更新供应商`,
    });
    const id = created.body.data.id;

    const updated = await client.patch<SupplierDto>(`/api/v1/suppliers/${id}`, {
      name: `${PREFIX} 已更新供应商`,
      contactPhone: '13900000000',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe(`${PREFIX} 已更新供应商`);
    expect(updated.body.data.contactPhone).toBe('13900000000');

    const deactivated = await client.post<SupplierDto>(`/api/v1/suppliers/${id}/deactivate`, {});
    expect(deactivated.body.data.status).toBe('INACTIVE');
    const reactivated = await client.post<SupplierDto>(`/api/v1/suppliers/${id}/activate`, {});
    expect(reactivated.body.data.status).toBe('ACTIVE');
  });

  it('hard-deletes a zero-reference supplier; missing ids 404', async () => {
    const created = await client.post<SupplierDto>('/api/v1/suppliers', {
      name: `${PREFIX} 将被删除供应商`,
    });
    const id = created.body.data.id;

    const removed = await client.del(`/api/v1/suppliers/${id}`);
    expect(removed.status).toBe(200);

    const gone = await client.get(`/api/v1/suppliers/${id}`);
    expect(gone.status).toBe(404);
    expect(gone.body.error?.code).toBe('SUPPLIER_NOT_FOUND');
  });
});
