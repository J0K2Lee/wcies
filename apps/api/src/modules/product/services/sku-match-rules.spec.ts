import { describe, expect, it } from 'vitest';
import {
  compareSkuNames,
  normalizeSkuName,
  skuNameNarrowToken,
  skuNameSignature,
} from '@wcies/shared';

/**
 * 重复档案判定的规则层（2026-10-24）：线上「映射 / 建档」提示与离线审计脚本
 * 共用这一份实现，所以规则必须单独锁死。
 *
 * 关键不是「像不像」，而是「是不是同一件货」：
 * - 品类词、品牌前缀、分隔符、全角半角、大小写都不构成差异；
 * - `+` 是型号的一部分（TURBO vs TURBO+）；
 * - 配色/型号/档位/代际不同 = 硬反证，不能提示合并。
 */
describe('normalizeSkuName / skuNameSignature', () => {
  it('吃掉分隔符、全角与大小写，但保留型号里的 +', () => {
    expect(normalizeSkuName('迈从-A7 V3 Ultra＋-鼠标-黑金')).toBe(
      '迈从 a7 v3 ultra plus 鼠标 黑金',
    );
    expect(normalizeSkuName('  V9   TURBO+ ')).toBe('v9 turbo plus');
    expect(normalizeSkuName('浅紫-1.18L_ob_IW4N1')).toBe('浅紫 1.18l');
  });

  it('签名去掉品类词与品牌前缀（含粘在型号上的品牌）', () => {
    expect(skuNameSignature('迈从-V9 TURBO+耳机-白银', '迈从')).toEqual([
      'v9',
      'turbo',
      'plus',
      '白银',
    ]);
    expect(skuNameSignature('迈从V9 TURBO+-白银', '迈从')).toEqual(['v9', 'turbo', 'plus', '白银']);
  });

  it('narrow token 取原文里最长的非品类词元（用于 SQL 窄化）', () => {
    expect(skuNameNarrowToken('迈从-V9 TURBO+耳机-白银')).toBe('turbo');
    expect(skuNameNarrowToken('耳机')).toBeNull();
  });
});

describe('compareSkuNames', () => {
  const compare = (a: string, b: string, brandName: string | null = '迈从') =>
    compareSkuNames({ name: a, brandName }, { name: b, brandName });

  it('品类词与分隔符不同 → SAME', () => {
    expect(compare('迈从-V9 TURBO+耳机-白银', '迈从V9 TURBO+-白银').relation).toBe('SAME');
  });

  it('多一个系列前缀 → CONTAINED（同品牌下可提示复用）', () => {
    const result = compareSkuNames(
      { name: 'BUNNY DSP【TYPE C接口】', brandName: '天使吉米' },
      { name: '兔几-BUNNY DSP【TYPE C接口】', brandName: '天使吉米' },
    );
    expect(result.relation).toBe('CONTAINED');
    expect(result.conflicts).toEqual([]);
  });

  it('配色不同 → 硬反证且标记为「同型号另一变体」', () => {
    const result = compare('迈从-V9 TURBO+耳机-玄影', '迈从-V9 TURBO+耳机-流影');
    expect(result.relation).toBe('SIMILAR');
    expect(result.conflicts.join('；')).toContain('配色');
    expect(result.sameModelDifferentVariant).toBe(true);
  });

  it('型号不同（A5 / A7）→ 不是变体，不产生「同型号」标记', () => {
    const result = compare('迈从-A5 V3 Ultra+-鼠标-白色', '迈从-A7 V3 Ultra+-鼠标-白色');
    expect(result.conflicts.join('；')).toContain('型号不同');
    expect(result.sameModelDifferentVariant).toBe(false);
  });

  it('档位不同（TURBO / TURBO+）→ 硬反证', () => {
    const result = compare('迈从-V9 TURBO-耳机-白金', '迈从-V9 TURBO+-白金');
    expect(result.conflicts.join('；')).toContain('型号代际不同');
    expect(result.sameModelDifferentVariant).toBe(false);
  });

  it('代际不同（V9 Pro / V9 Pro 2）→ 硬反证', () => {
    const result = compare('迈从-V9 Pro-耳机-粉色', '迈从-V9 Pro 2-粉色');
    expect(result.conflicts.join('；')).toContain('型号代际不同');
  });
});
