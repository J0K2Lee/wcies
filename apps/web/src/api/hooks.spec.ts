import { describe, expect, it } from 'vitest';
import { normalizeEnvelope } from './hooks';

/**
 * 信封归一化（2026-10-26 修复）：后端有些列表把页级聚合放在信封根部
 * （例如通知列表的 `unreadTotal`），归一化时不能丢掉，否则页面会静默显示 0，
 * 而每一行依旧是未读。
 */
describe('normalizeEnvelope', () => {
  it('保留根部聚合字段', () => {
    const result = normalizeEnvelope<{
      data: unknown[];
      meta: { total: number };
      unreadTotal: number;
    }>({
      success: true,
      data: [{ id: 'a' }],
      meta: { page: 1, pageSize: 20, total: 1 },
      unreadTotal: 2,
    });

    expect(result.unreadTotal).toBe(2);
    expect(result.meta.total).toBe(1);
    expect(result.data).toHaveLength(1);
  });

  it('没有 meta 时用数组长度兜底', () => {
    const result = normalizeEnvelope<{ data: unknown[]; meta: { total: number } }>({
      success: true,
      data: [1, 2, 3],
    });

    expect(result.meta.total).toBe(3);
  });
});
