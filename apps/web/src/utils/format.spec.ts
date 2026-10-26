import { describe, expect, it } from 'vitest';
import { fmtMoney, fmtQty } from './format';

/**
 * 数字显示规则（用户 2026-10-26）：**数量整数、货币两位小数**。
 * 后端 numeric 以字符串返回（"1.000" / "320.5500"），显示层负责收敛位数。
 */
describe('fmtQty（数量：整数）', () => {
  it('把 3 位小数的整数值收敛成整数', () => {
    expect(fmtQty('1.000')).toBe('1');
    expect(fmtQty('12.000')).toBe('12');
    expect(fmtQty(7)).toBe('7');
  });

  it('大的整数带千分位', () => {
    expect(fmtQty('1234.000')).toBe('1,234');
  });

  it('真的带小数时保留（最多 3 位），不静默四舍五入', () => {
    expect(fmtQty('1.500')).toBe('1.5');
    expect(fmtQty('0.125')).toBe('0.125');
  });

  it('缺失值显示长破折号，不显示 0', () => {
    expect(fmtQty(null)).toBe('—');
    expect(fmtQty(undefined)).toBe('—');
    expect(fmtQty('')).toBe('—');
  });
});

describe('fmtMoney（货币：两位小数 + 代码后缀，方案 B）', () => {
  it('人民币也用代码后缀，不再显示 ¥', () => {
    expect(fmtMoney('320.5500', 'CNY')).toBe('320.55 CNY');
    expect(fmtMoney('0.0000', 'CNY')).toBe('0.00 CNY');
  });

  it('number 入参同样格式化为两位', () => {
    expect(fmtMoney(323, 'CNY')).toBe('323.00 CNY');
    expect(fmtMoney(323.5, 'CNY')).toBe('323.50 CNY');
  });

  it('其它币种同一格式', () => {
    expect(fmtMoney('5879.0000', 'RUB')).toBe('5,879.00 RUB');
  });

  it('数字币种码与历史码在展示层归一化', () => {
    expect(fmtMoney('12.5', '643')).toBe('12.50 RUB');
    expect(fmtMoney('12.5', 'RUR')).toBe('12.50 RUB');
  });

  it('币种必填（显式传 null/undefined 表示未知），绝不默认人民币', () => {
    // 编译期强制：currency 是必填参数；运行时未知币种明确留标记
    expect(fmtMoney('320.55', null)).toBe('320.55 —');
    expect(fmtMoney('320.55', undefined)).toBe('320.55 —');
  });

  it('缺失值显示长破折号', () => {
    expect(fmtMoney(null, 'CNY')).toBe('—');
  });
});
