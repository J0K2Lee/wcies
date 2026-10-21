/**
 * 条码校验（共享：API 与前端同一份规则，避免两处判定漂移）。
 *
 * 「69 码」指以 69 开头的中国商品条码，按定义是 EAN-13：13 位数字，末位为
 * 校验位（前 12 位按「奇数位 ×1、偶数位 ×3」求和，校验位 = (10 - sum % 10) % 10）。
 *
 * 校验范围刻意只覆盖 69 码：
 * - 以 69 开头但不是 13 位数字 → 非法（69 码按定义就是 13 位）；
 * - 以 69 开头的 13 位数字 → 按 EAN-13 校验位验证，错误则拒绝；
 * - 其余条码（内部 6 位码 W00000001、厂商码、Code128 等）一律放行。
 *
 * 不做 trim/补零：条码是扫描或录入的事实值，静默改写比拒绝更危险。
 */

export interface BarcodeValidationResult {
  readonly ok: boolean;
  /** 仅在不通过时存在，可直接展示给操作人。 */
  readonly message?: string;
  /** 69 码校验位错误时给出正确末位，便于操作人核对。 */
  readonly expectedCheckDigit?: string;
}

/** EAN-13 校验位：传入前 12 位数字，返回 1 位校验字符。 */
export function ean13CheckDigit(first12: string): string {
  let sum = 0;
  for (let index = 0; index < first12.length; index += 1) {
    const digit = Number(first12[index]);
    // 位置 1 起算：奇数位 ×1，偶数位 ×3。
    sum += index % 2 === 0 ? digit : digit * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

/** 13 位数字是否为合法 EAN-13（含校验位）。 */
export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) {
    return false;
  }
  return value[12] === ean13CheckDigit(value.slice(0, 12));
}

/**
 * 校验「69 码」；非 69 开头的值直接放行（由条码类型决定，不在这里猜）。
 */
export function validate69Barcode(value: string): BarcodeValidationResult {
  if (!value.startsWith('69')) {
    return { ok: true };
  }
  if (!/^\d{13}$/.test(value)) {
    return {
      ok: false,
      message: '69 码必须是 13 位数字（EAN-13），请检查是否漏扫或多扫',
    };
  }
  const expected = ean13CheckDigit(value.slice(0, 12));
  if (value[12] !== expected) {
    return {
      ok: false,
      message: `69 码校验位错误：末位应为 ${expected}，当前为 ${value[12]}，请核对条码`,
      expectedCheckDigit: expected,
    };
  }
  return { ok: true };
}
