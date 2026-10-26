import { describe, expect, it } from 'vitest';
import {
  convertDraft,
  draftToMinutes,
  formatInterval,
  preferredUnit,
  toDraftInterval,
} from './sync-interval';

/**
 * 自动同步频率的「数字 + 单位」（用户 2026-10-26）：落库统一分钟，
 * 单位切换只换算、不改实际时长；下限/上限按业务类型夹取。
 */
describe('sync interval 单位换算', () => {
  it('按能整除的最大单位展示', () => {
    expect(toDraftInterval(5)).toEqual({ amount: 5, unit: 'MINUTE' });
    expect(toDraftInterval(120)).toEqual({ amount: 2, unit: 'HOUR' });
    expect(toDraftInterval(2_880)).toEqual({ amount: 2, unit: 'DAY' });
    expect(toDraftInterval(null)).toEqual({ amount: null, unit: 'MINUTE' });
    expect(preferredUnit(90)).toBe('MINUTE');
  });

  it('切单位不改变总时长', () => {
    expect(convertDraft({ amount: 90, unit: 'MINUTE' }, 'HOUR')).toEqual({
      amount: 1.5,
      unit: 'HOUR',
    });
    expect(convertDraft({ amount: 2, unit: 'DAY' }, 'MINUTE')).toEqual({
      amount: 2_880,
      unit: 'MINUTE',
    });
    expect(draftToMinutes({ amount: 1.5, unit: 'HOUR' }, 1)).toBe(90);
  });

  it('低于下限时夹到下限，空值不提交', () => {
    // 商品链接下限 5 分钟：填 3 分钟存 5。
    expect(draftToMinutes({ amount: 3, unit: 'MINUTE' }, 5)).toBe(5);
    expect(draftToMinutes({ amount: null, unit: 'MINUTE' }, 5)).toBeNull();
    expect(draftToMinutes({ amount: 0, unit: 'MINUTE' }, 5)).toBeNull();
  });

  it('生效文案用大单位表达', () => {
    expect(formatInterval(5)).toBe('每 5 分钟');
    expect(formatInterval(90)).toBe('每 1.5 小时');
    expect(formatInterval(120)).toBe('每 2 小时');
    expect(formatInterval(2_880)).toBe('每 2 天');
  });
});
