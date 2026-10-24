/**
 * SKU 名称同一性判定（2026-10-24）。
 *
 * 唯一事实源：订单页「映射 / 建档」的重复档案提示、以及离线审计脚本都调用这里，
 * 避免线上口径与审计口径漂移。
 *
 * 判定不是「字符串相似度」，而是「型号 + 配色」的结构化比较：
 * 1. 归一化：全角→半角、小写、分隔符（`-`/空格/括号…）折叠成空格；
 *    `+` 保留为型号词元（`TURBO` 与 `TURBO+` 是两个型号，不能混）；
 * 2. 名称签名 = 去掉品类词（鼠标/键盘/耳机/保温杯…）与品牌前缀后的词元；
 * 3. 词元差异决定结论：配色不同 / 型号不同 / 档位不同（plus、pro）/ 代际不同
 *    （多出数字）都视为**硬反证**——不同变体，不是同一事实。
 *
 * 本模块无框架、无业务依赖，可在 API 与脚本中共用。
 */

/** 品类词：名称里常见但**不区分具体商品**的后缀/中缀。 */
export const SKU_CATEGORY_WORDS: readonly string[] = [
  '键盘鼠标套装',
  '键盘、鼠标套装',
  '键鼠套装',
  '机械键盘',
  '游戏键盘',
  '电脑鼠标',
  '游戏鼠标',
  '无线鼠标',
  '鼠标垫',
  '鼠标',
  '键盘',
  '保温杯',
  '保暖杯',
  '浴帘',
  '积木',
  '小雕塑',
  '拼装模型',
  '耳机',
  '套装',
];

const SEPARATOR = /[\s\-_/\\|丨·•,，、;；:：()（）【】[\]{}<>《》"'“”‘’~～]+/gu;
const OFFER_NOISE = /_ob_[a-z0-9]+/g;
const COLOR_CHAR = /[黑白红粉蓝绿紫金银灰黄橙棕青]/u;
const MODEL_LIKE = /^[a-z]{0,4}\d+$/u;

/** 归一化：只保留比较需要的形态差异，不改变语义。 */
export function normalizeSkuName(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(OFFER_NOISE, ' ')
    .replace(/[+＋]/g, ' plus ')
    .replace(SEPARATOR, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function skuNameTokens(value: string | null | undefined): string[] {
  const normalized = normalizeSkuName(value);
  return normalized === '' ? [] : normalized.split(' ');
}

const compactText = (value: string): string => value.replace(/\s+/g, '');

/**
 * 名称签名：去掉品类词与品牌前缀后的词元。
 * 品牌前缀可能粘在型号上（`迈从V9` vs `迈从-V9`），所以按词元逐字剥前缀。
 */
export function skuNameSignature(
  name: string | null | undefined,
  brandName: string | null | undefined,
): string[] {
  const brandTok = compactText(normalizeSkuName(brandName));
  const out: string[] = [];
  for (const token of skuNameTokens(name)) {
    if (SKU_CATEGORY_WORDS.includes(token)) {
      continue;
    }
    let value = token;
    if (brandTok !== '' && compactText(value).startsWith(brandTok)) {
      value = compactText(value).slice(brandTok.length);
      if (value === '') {
        continue;
      }
    }
    out.push(value);
  }
  return out;
}

/** 顺序无关的签名键：`v9+白银+turbo+plus`。 */
export function skuSignatureKey(signature: readonly string[]): string {
  return [...signature].sort().join('+');
}

/**
 * 供 SQL 模糊 narrowing 用的词元：取名称里最长、且不可能是品类词的原文词元。
 * （`plus` 是归一化产物、未必出现在原文里，所以这里必须从原文词元取。）
 */
export function skuNameNarrowToken(name: string | null | undefined): string | null {
  const candidates = skuNameTokens(name).filter(
    (token) => !SKU_CATEGORY_WORDS.includes(token) && token.length >= 2 && !/^\d+$/u.test(token),
  );
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((longest, token) => (token.length > longest.length ? token : longest));
}

export type SkuNameRelation = 'SAME' | 'CONTAINED' | 'SIMILAR' | 'UNRELATED';

export interface SkuNameComparison {
  relation: SkuNameRelation;
  /** 签名 Dice 相似度 0..1（仅用于展示与排序，不作为分档唯一依据）。 */
  similarity: number;
  /** 硬反证：出现即说明不是同一实物（配色/型号/档位/代际不同）。 */
  conflicts: string[];
  /** 去掉差异尾词后签名一致 —— 同型号的其他配色/版本。 */
  sameModelDifferentVariant: boolean;
}

function bigrams(value: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index += 1) {
    const gram = value.slice(index, index + 2);
    out.set(gram, (out.get(gram) ?? 0) + 1);
  }
  if (value.length === 1) {
    out.set(value, 1);
  }
  return out;
}

function diceSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (a === '' || b === '') {
    return 0;
  }
  const left = bigrams(a);
  const right = bigrams(b);
  let intersection = 0;
  let total = 0;
  for (const [gram, count] of left) {
    total += count;
    intersection += Math.min(count, right.get(gram) ?? 0);
  }
  for (const count of right.values()) {
    total += count;
  }
  return (2 * intersection) / total;
}

const isColorish = (token: string): boolean => token.length <= 6 && COLOR_CHAR.test(token);

/**
 * 词元差异的结构化判定（配色/型号/档位/代际）。
 * `variantOnly` 只在「同型号、只是配色/版本不同」时为 true —— 这类才值得
 * 提示「同型号另一变体」；型号/档位/代际不同属于不同商品，不能当变体。
 */
function tokenConflicts(
  onlyA: readonly string[],
  onlyB: readonly string[],
): { conflicts: string[]; variantOnly: boolean } {
  const conflicts: string[] = [];
  let variantOnly = false;
  if (onlyA.length === 1 && onlyB.length === 1) {
    const [left, right] = [onlyA[0]!, onlyB[0]!];
    if (isColorish(left) && isColorish(right)) {
      conflicts.push(`配色不同（${left} / ${right}）`);
      variantOnly = true;
    } else if (MODEL_LIKE.test(left) && MODEL_LIKE.test(right)) {
      conflicts.push(`型号不同（${left} / ${right}）`);
    } else if (left === 'plus' || right === 'plus' || left === 'pro' || right === 'pro') {
      conflicts.push(`型号档位不同（${left} / ${right}）`);
    } else if (left.length <= 3 && right.length <= 3) {
      // 同一位置的短词元互换（迷雾/赵芸、玄影/流影…）= 配色或版本不同
      conflicts.push(`配色/版本词元不同（${left} / ${right}）`);
      variantOnly = true;
    }
  }
  // 包含关系里多出数字/plus/pro = 不同代际（`V9 Pro` vs `V9 Pro 2`、`TURBO` vs `TURBO+`）
  if (onlyA.length === 0 && onlyB.some((t) => /^\d+$/u.test(t) || t === 'plus' || t === 'pro')) {
    conflicts.push(`型号代际不同（多出 ${onlyB.join('/')}）`);
  }
  if (onlyB.length === 0 && onlyA.some((t) => /^\d+$/u.test(t) || t === 'plus' || t === 'pro')) {
    conflicts.push(`型号代际不同（多出 ${onlyA.join('/')}）`);
  }
  return { conflicts, variantOnly };
}

/** 比较两个名称（含各自品牌，用于剥品牌前缀）。 */
export function compareSkuNames(
  left: { name: string | null | undefined; brandName?: string | null | undefined },
  right: { name: string | null | undefined; brandName?: string | null | undefined },
): SkuNameComparison {
  const a = skuNameSignature(left.name, left.brandName ?? null);
  const b = skuNameSignature(right.name, right.brandName ?? null);
  const similarity = diceSimilarity([...a].sort().join(''), [...b].sort().join(''));
  if (a.length === 0 || b.length === 0) {
    return { relation: 'UNRELATED', similarity, conflicts: [], sameModelDifferentVariant: false };
  }
  const keyA = skuSignatureKey(a);
  const keyB = skuSignatureKey(b);
  const onlyA = a.filter((token) => !b.includes(token));
  const onlyB = b.filter((token) => !a.includes(token));
  const { conflicts, variantOnly } = tokenConflicts(onlyA, onlyB);
  const sameModelDifferentVariant = variantOnly && conflicts.length > 0;

  if (keyA === keyB) {
    return { relation: 'SAME', similarity: 1, conflicts, sameModelDifferentVariant: false };
  }
  const contains = onlyB.length === 0;
  const contained = onlyA.length === 0;
  if (contains || contained) {
    return {
      relation: conflicts.length > 0 ? 'SIMILAR' : 'CONTAINED',
      similarity,
      conflicts,
      sameModelDifferentVariant,
    };
  }
  return {
    relation: similarity >= 0.8 ? 'SIMILAR' : 'UNRELATED',
    similarity,
    conflicts,
    sameModelDifferentVariant,
  };
}
