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

describe('fmtMoney（货币：两位小数）', () => {
  it('4 位小数的成本收敛到 2 位', () => {
    expect(fmtMoney('320.5500', 'CNY')).toBe('¥320.55');
    expect(fmtMoney('0.0000', 'CNY')).toBe('¥0.00');
  });

  it('number 入参同样格式化为两位', () => {
    expect(fmtMoney(323, 'CNY')).toBe('¥323.00');
    expect(fmtMoney(323.5, 'CNY')).toBe('¥323.50');
  });

  it('非 CNY 币种把代码放在金额后面', () => {
    expect(fmtMoney('5879.0000', 'RUB')).toBe('5,879.00 RUB');
  });

  it('缺失值显示长破折号', () => {
    expect(fmtMoney(null, 'CNY')).toBe('—');
  });
});
