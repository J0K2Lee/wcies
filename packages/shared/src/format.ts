/**
 * 数量显示规则（用户决策 2026-10-26）：**数量按整数显示**，只有确实是小数时
 * 保留最多 3 位。数据库 numeric 以字符串返回（"1.000" / "0.300"），精度尾部
 * 不能泄漏到界面或消息文案里。
 *
 * 放在 shared 是因为前端表格与后端生成的文案（通知正文、飞书卡片）必须同一套
 * 规则，否则同一条数据在两个地方显示不一致。
 */
export function formatQtyText(value: string | number): string {
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num)) {
    return String(value);
  }
  return num.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(num) ? 0 : 3,
  });
}
