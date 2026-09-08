/**
 * Safe string coercion for raw QueryBuilder rows (values arrive as
 * `unknown` from getRawAndEntities); avoids `[object Object]` surprises.
 */
export function rawStr(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}
