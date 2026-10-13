/**
 * RFC4122 v4 UUID（2026-09-28 库存初始化报错修复）。
 *
 * `crypto.randomUUID` 只在安全上下文（https / localhost）暴露；用户经局域网
 * http 地址访问 Web 时该函数不存在，直接调用抛
 * `crypto.randomUUID is not a function`。这里优先用原生实现，否则退化为
 * getRandomValues（同样的安全上下文限制则再退化为 Math.random）手工拼 v4。
 */
export function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < 16; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  // Set version 4 (high nibble of byte 6) and variant 10x (top bits of byte 8).
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex
    .slice(8, 10)
    .join('')}-${hex.slice(10, 16).join('')}`;
}
