import pg from 'pg';

/**
 * 只读分析：在真实库中找出大概率属于「同一事实 SKU」的档案组。
 * 不写任何数据。输出 markdown 报告到 stdout。
 *
 * 用法（需要 node --env-file 或先导出 DATABASE_URL）：
 *   node --env-file=.env scripts/analyze-sku-duplicates.mjs > report.md
 *
 * 设计原则（宁可漏报，不可误报——误合并是不可逆的）：
 * - 只有「去品类词后的名称签名完全一致」才进入 B 档以上；
 * - 名称只差尾词（多为颜色/版本：黑金/白银/雾透白…）视为**不同变体**，
 *   直接排除，不做传递合并；
 * - 平台侧证据（同店同平台变体 / 同条码 / 同图片）单列最高档；
 * - 组只由强边（≥60）连通，弱边单列「人工核对」，避免 A→B→C 连锁误合并。
 */
const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === '') {
  throw new Error('需要 DATABASE_URL（只读分析脚本，不会写入任何数据）');
}
const c = new pg.Client({ connectionString });
await c.connect();

const skus = (
  await c.query(`
  SELECT s.id, s.sku_code, s.name_zh, s.name_ru, s.model, s.color, s.size,
         s.brand_id, b.name AS brand, s.category_id, cat.name_zh AS category,
         s.latest_purchase_price, s.created_at
    FROM skus s
    LEFT JOIN brands b ON b.id = s.brand_id
    LEFT JOIN categories cat ON cat.id = s.category_id
   WHERE s.status = 'ACTIVE'
   ORDER BY s.sku_code`)
).rows;

const barcodes = (await c.query(`SELECT sku_id, barcode FROM sku_barcodes`)).rows;
const images = (await c.query(`SELECT sku_id, object_key FROM sku_images`)).rows;
const refs = (
  await c.query(`
  SELECT ls.sku_id, l.store_id, st.store_code, p.code AS platform,
         ls.platform_sku_id, ls.offer_id, l.platform_product_id, l.title
    FROM platform_listing_skus ls
    JOIN platform_listings l ON l.id = ls.listing_id
    JOIN stores st ON st.id = l.store_id
    JOIN platforms p ON p.id = l.platform_id`)
).rows;
const demandRows = (
  await c.query(`
  SELECT i.sku_id, count(*)::int AS lines, COALESCE(SUM(i.quantity),0)::text AS qty
    FROM order_items i WHERE i.sku_id IS NOT NULL GROUP BY 1`)
).rows;
const balanceRows = (
  await c.query(`
  SELECT sku_id, SUM(on_hand_qty)::text AS on_hand, SUM(reserved_qty)::text AS reserved
    FROM inventory_balances GROUP BY 1`)
).rows;

// ---- 归一化 -------------------------------------------------------------
const CATEGORY_WORDS = [
  '键盘鼠标套装', '键盘、鼠标套装', '键鼠套装', '机械键盘', '游戏键盘',
  '电脑鼠标', '游戏鼠标', '无线鼠标', '鼠标垫', '鼠标', '键盘',
  '保温杯', '保暖杯', '浴帘', '积木', '小雕塑', '拼装模型', '耳机', '套装',
];
const SEP = /[\s\-_/\\|丨·•,，、;；:：+＋()（）【】\[\]{}<>《》"'“”‘’~～]+/gu;

function normalize(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/_ob_[a-z0-9]+/g, ' ')
    // `+` 属于型号（TURBO vs TURBO+、Ultra vs Ultra+），保留为独立词元，
    // 绝不能当分隔符丢掉——否则 TURBO 与 TURBO+ 会被误判为同一型号。
    .replace(/[+＋]/g, ' plus ')
    .replace(SEP, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const compact = (value) => normalize(value).replace(/\s+/g, '');
const tokens = (value) => normalize(value).split(' ').filter((t) => t.length > 0);

/**
 * 名称签名：去掉品类词与品牌前缀后的词元。
 * 品牌前缀可能粘在型号上（`迈从V9` vs `迈从-V9`），所以按 token 逐字剥前缀。
 */
function coreTokens(value, brand) {
  const brandTok = compact(brand);
  const out = [];
  for (const token of tokens(value)) {
    if (CATEGORY_WORDS.includes(token)) continue;
    let t = token;
    if (brandTok !== '' && compact(t).startsWith(brandTok)) {
      t = compact(t).slice(brandTok.length);
      if (t === '') continue;
    }
    out.push(t);
  }
  return out;
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  if (s.length === 1) out.set(s, 1);
  return out;
}
function dice(a, b) {
  if (a === b) return 1;
  if (a === '' || b === '') return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of ga) {
    total += n;
    inter += Math.min(n, gb.get(g) ?? 0);
  }
  for (const n of gb.values()) total += n;
  return (2 * inter) / total;
}

// ---- 索引 ---------------------------------------------------------------
const byId = new Map(skus.map((s) => [s.id, s]));
const bcOf = new Map();
for (const row of barcodes) bcOf.set(row.sku_id, [...(bcOf.get(row.sku_id) ?? []), row.barcode]);
const imgOf = new Map();
for (const row of images) imgOf.set(row.sku_id, new Set([...(imgOf.get(row.sku_id) ?? []), row.object_key]));
const refOf = new Map();
for (const row of refs) refOf.set(row.sku_id, [...(refOf.get(row.sku_id) ?? []), row]);
const demandOf = new Map(demandRows.map((r) => [r.sku_id, r]));
const balanceOf = new Map(balanceRows.map((r) => [r.sku_id, r]));

for (const s of skus) {
  s.core = coreTokens(s.name_zh, s.brand);
  s.coreKey = [...s.core].sort().join('+');
  s.bc = bcOf.get(s.id) ?? [];
  s.imgs = imgOf.get(s.id) ?? new Set();
  s.refs = refOf.get(s.id) ?? [];
  s.demand = demandOf.get(s.id) ?? { lines: 0, qty: '0' };
  s.balance = balanceOf.get(s.id) ?? { on_hand: '0', reserved: '0' };
}

function variantConflict(a, b) {
  const ta = a.core[a.core.length - 1] ?? '';
  const tb = b.core[b.core.length - 1] ?? '';
  if (ta === '' || tb === '') return false;
  if (ta === tb) return false;
  // 只差尾词且两边尾部都很短（颜色/版本词通常 ≤6 字）→ 不同变体
  return ta.length <= 6 && tb.length <= 6;
}

function conflicts(a, b) {
  const out = [];
  const n = (v) => normalize(v);
  if (n(a.brand) !== '' && n(b.brand) !== '' && n(a.brand) !== n(b.brand)) {
    out.push(`品牌 ${a.brand} / ${b.brand}`);
  }
  for (const f of ['model', 'color', 'size']) {
    const va = n(a[f]);
    const vb = n(b[f]);
    if (va !== '' && vb !== '' && va !== vb) out.push(`${f} ${a[f]} / ${b[f]}`);
  }
  return out;
}

// ---- 逐对打分 -----------------------------------------------------------
/**
 * 档位由证据类型决定，而不是靠分数阈值——阈值会把「颜色不同」这种
 * 反证和「名称一致」这种正证混在一个数字里。
 */
function classify(a, b) {
  const notes = [];
  const hard = [];
  let tier = null;

  // 1) 平台侧硬证据
  const keyOf = (r) => `${r.store_id}|${r.platform_sku_id ?? ''}|${r.offer_id ?? ''}`;
  const aKeys = new Set(a.refs.map(keyOf));
  const sharedRef = b.refs.find((r) => aKeys.has(keyOf(r)));
  if (sharedRef !== undefined) {
    notes.push(`同店同平台变体（${sharedRef.store_code}/${sharedRef.platform} ${sharedRef.platform_sku_id}）`);
    tier = 'A';
  }
  // 跨店铺的同名平台标识（offer_id / platform_sku_id）：运营把同一平台商品
  // 在两个店铺各建了一次档案的典型形状（名称关系另行校验）。
  const idsOf = (r) => [r.platform_sku_id, r.offer_id].filter((v) => v !== null && v !== '');
  const aIds = new Set(a.refs.flatMap(idsOf));
  const sharedId = b.refs.flatMap(idsOf).find((v) => aIds.has(v));
  if (sharedId !== undefined && sharedRef === undefined) {
    notes.push(`跨店铺同一平台标识 ${sharedId}`);
  }
  const sharedBarcode = a.bc.find((code) => b.bc.includes(code));
  if (sharedBarcode !== undefined) {
    notes.push(`同一条码 ${sharedBarcode}`);
    tier = 'A';
  }
  const sharedImage = [...a.imgs].find((k) => b.imgs.has(k));
  if (sharedImage !== undefined) {
    notes.push('同一张图片（同一实物影像）');
    tier = 'A';
  }

  // 2) 名称关系
  const sameSignature = a.coreKey !== '' && a.coreKey === b.coreKey;
  const contained =
    a.core.length > 0 && a.core.length < b.core.length && a.core.every((t) => b.core.includes(t));
  const containedRev =
    b.core.length > 0 && b.core.length < a.core.length && b.core.every((t) => a.core.includes(t));
  const sa = [...a.core].sort().join('');
  const sb = [...b.core].sort().join('');
  const sim = dice(sa, sb);

  if (sameSignature) notes.push(`名称签名一致（${a.core.join('-')}）`);
  else if (contained || containedRev) {
    const [short, long] = contained ? [a, b] : [b, a];
    notes.push(`名称签名包含（${short.core.join('-')} ⊂ ${long.core.join('-')}）`);
  } else notes.push(`名称签名相似 ${Math.round(sim * 100)}%（${a.core.join('-')} / ${b.core.join('-')}）`);

  // 3) 属性一致 / 冲突
  const sameBrand = normalize(a.brand) !== '' && normalize(a.brand) === normalize(b.brand);
  const sameCategory = normalize(a.category) !== '' && normalize(a.category) === normalize(b.category);
  if (sameBrand) notes.push(`同品牌 ${a.brand}`);
  if (sameCategory) notes.push(`同分类 ${a.category}`);
  for (const conflict of conflicts(a, b)) hard.push(conflict);
  // 词元差异 → 型号 / 颜色变体判定（这些是「不是同一实物」的硬反证）
  const onlyA = a.core.filter((t) => !b.core.includes(t));
  const onlyB = b.core.filter((t) => !a.core.includes(t));
  const COLOR_CHAR = /[黑白红粉蓝绿紫金银灰黄橙棕青]/u;
  const MODEL_LIKE = /^[a-z]{0,4}\d+$/u;
  if (onlyA.length === 1 && onlyB.length === 1) {
    const [ta, tb] = [onlyA[0], onlyB[0]];
    if (ta.length <= 6 && tb.length <= 6 && COLOR_CHAR.test(ta) && COLOR_CHAR.test(tb)) {
      hard.push(`颜色不同（${ta} / ${tb}）`);
    } else if (MODEL_LIKE.test(ta) && MODEL_LIKE.test(tb)) {
      hard.push(`型号不同（${ta} / ${tb}）`);
    } else if (ta === 'plus' || tb === 'plus' || ta === 'pro' || tb === 'pro') {
      hard.push(`型号档位不同（${ta} / ${tb}）`);
    } else if (ta.length <= 3 && tb.length <= 3) {
      // 同一位置上的短词元互换（迷雾/赵芸、玄影/流影…）= 配色或版本不同
      hard.push(`配色/版本词元不同（${ta} / ${tb}）`);
    }
  }
  const extraTokens = contained ? onlyB : containedRev ? onlyA : [];
  if (extraTokens.some((t) => /^\d+$/u.test(t) || t === 'plus' || t === 'pro')) {
    hard.push(`型号代际不同（多出 ${extraTokens.join('/')}）`);
  }
  if (!sameSignature && variantConflict(a, b)) {
    hard.push(`尾部不同（${a.core.at(-1) ?? '—'} / ${b.core.at(-1) ?? '—'}，疑似不同颜色或版本）`);
  }
  if (a.bc.length > 0 && b.bc.length > 0 && sharedBarcode === undefined) {
    notes.push('条码互不相同（弱反证）');
  }

  if (hard.length > 0) {
    // 有属性冲突：只有在平台侧证据下才值得人工看
    return tier === 'A' ? { tier: 'A', score: 100, notes, hard } : null;
  }
  if (tier === 'A') return { tier: 'A', score: 100, notes, hard };
  if (sameSignature && (sameBrand || sameCategory)) return { tier: 'B', score: 85, notes, hard };
  if (sharedId !== undefined && (sameSignature || contained || containedRev)) {
    return { tier: 'B', score: 80, notes, hard };
  }
  if (sameSignature) return { tier: 'C', score: 65, notes, hard };
  if ((contained || containedRev) && sameBrand) return { tier: 'C', score: 55, notes, hard };
  if ((contained || containedRev) && (sameBrand || sameCategory)) return { tier: 'D', score: 45, notes, hard };
  if (sim >= 0.8 && sameBrand && sameCategory) return { tier: 'D', score: 40, notes, hard };
  return null;
}

const pairs = [];
for (let i = 0; i < skus.length; i += 1) {
  for (let j = i + 1; j < skus.length; j += 1) {
    const result = classify(skus[i], skus[j]);
    if (result !== null) pairs.push({ a: skus[i], b: skus[j], ...result });
  }
}

// ---- 只沿 A/B 分组，C/D 单独列出 --------------------------------------
const GROUPABLE = new Set(['A', 'B']);
const parent = new Map(skus.map((s) => [s.id, s.id]));
function find(x) {
  let r = x;
  while (parent.get(r) !== r) r = parent.get(r);
  let cur = x;
  while (parent.get(cur) !== r) {
    const next = parent.get(cur);
    parent.set(cur, r);
    cur = next;
  }
  return r;
}
for (const p of pairs.filter((x) => GROUPABLE.has(x.tier))) {
  const ra = find(p.a.id);
  const rb = find(p.b.id);
  if (ra !== rb) parent.set(ra, rb);
}

const groups = new Map();
for (const p of pairs.filter((x) => GROUPABLE.has(x.tier))) {
  const root = find(p.a.id);
  const g = groups.get(root) ?? { ids: new Set(), pairs: [] };
  g.ids.add(p.a.id);
  g.ids.add(p.b.id);
  g.pairs.push(p);
  groups.set(root, g);
}

function tierOf(groupPairs) {
  return groupPairs.some((p) => p.tier === 'A') ? 'A' : 'B';
}

const report = [...groups.values()]
  .map((g) => ({ ids: [...g.ids], pairs: g.pairs.sort((x, y) => y.score - x.score) }))
  .sort(
    (x, y) =>
      Math.max(...y.pairs.map((p) => p.score)) - Math.max(...x.pairs.map((p) => p.score)),
  );

const describe = (s) => {
  const refsList = s.refs
    .map((r) => `${r.store_code}/${r.platform}:${r.platform_sku_id}`)
    .slice(0, 4)
    .join('，');
  return `${s.sku_code}｜${s.name_zh}｜${s.brand ?? '无品牌'}｜${s.category ?? '无分类'}｜订单 ${s.demand.lines} 行｜在库 ${s.balance.on_hand}｜映射 ${s.refs.length} 个${refsList === '' ? '' : `（${refsList}）`}`;
};

const out = [];
out.push('# SKU 档案疑似重复分析（2026-10-24，只读）');
out.push('');
out.push(`范围：库中 ${skus.length} 个 ACTIVE SKU 逐对比较，命中 ${pairs.length} 对。`);
out.push('');
out.push('## 置信度定义（宁可漏报，不可误报）');
out.push('');
out.push('| 档 | 判定依据 | 含义 |');
out.push('|---|---|---|');
out.push('| A | 同店同平台变体 / 同条码 / 同图片 | 平台侧或实物证据已指向同一件货 —— 几乎确定 |');
out.push('| B | 名称签名完全一致 + 同品牌或同分类；或跨店铺共用同一平台商品标识 + 名称签名一致 | 极可能同一实物 |');
out.push('| C | 名称签名包含关系（多出的词不是颜色/版本） | 两个档案的叫法一个比另一个更啰嗦 —— 很可能 |');
out.push('| D | 仅字符串相似 ≥80% | 只能当线索，不建议直接合并 |');
out.push('');
out.push('**硬反证（出现即不进 A/B/C）**：品牌不同、颜色词元不同、型号词元不同（`A5` vs `A7`、'
  + '`V9 Pro` vs `V9 Pro 2`、`TURBO` vs `TURBO+`）、model/color/size 字段不同。');
out.push('');
out.push(
  '**方法说明**：名称按 `-／空格／全角半角／大小写` 归一化（`+` 保留为型号词元，'
    + '所以 `TURBO` 与 `TURBO+` 不会被当成同一型号），去掉品类词（鼠标/键盘/耳机/保温杯…）'
    + '与品牌前缀后作为「名称签名」。同一位置上的短词元互换（迷雾/赵芸、玄影/流影）'
    + '视为配色不同而排除。分组只沿 A/B 证据连通（C/D 单列），避免 A≈B≈C 连锁误合并。',
);
out.push('');

let index = 0;
for (const g of report) {
  const members = g.ids.map((id) => byId.get(id));
  const tier = tierOf(g.pairs);
  index += 1;
  out.push(`## ${index}. [${tier}] ${members.map((m) => m.sku_code).join(' / ')}`);
  out.push('');
  for (const m of members) out.push(`- ${describe(m)}`);
  out.push('');
  for (const p of g.pairs) {
    const notes = [...p.notes, ...p.hard.map((h) => `✖ ${h}`)];
    out.push(`- ${p.a.sku_code} ↔ ${p.b.sku_code}：${notes.join('；')}`);
  }
  const weight = (m) => m.demand.lines * 10 + Number(m.balance.on_hand) + m.refs.length;
  const target = [...members].sort((x, y) => weight(y) - weight(x))[0];
  out.push('');
  out.push(`建议保留：**${target.sku_code}**（订单行/库存/平台映射最多），其余合并到它。`);
  out.push('');
}

const weak = pairs.filter((p) => !GROUPABLE.has(p.tier)).sort((x, y) => y.score - x.score);
const cPairs = weak.filter((p) => p.tier === 'C');
const dPairs = weak.filter((p) => p.tier === 'D');
if (cPairs.length > 0) {
  out.push(`## 待确认 · C 档（${cPairs.length} 对，很可能但未分组）`);
  out.push('');
}
for (const p of cPairs) {
  const notes = [...p.notes, ...p.hard.map((h) => `✖ ${h}`)];
  out.push(
    `- ${p.a.sku_code}（${p.a.name_zh}）↔ ${p.b.sku_code}（${p.b.name_zh}）：${notes.join('；')}`,
  );
}
if (dPairs.length > 0) {
  out.push('');
  out.push(`## 待核对 · D 档（${dPairs.length} 对，仅名称相似，不建议合并）`);
  out.push('');
}
for (const p of dPairs) {
  const notes = [...p.notes, ...p.hard.map((h) => `✖ ${h}`)];
  out.push(
    `- ${p.a.sku_code}（${p.a.name_zh}）↔ ${p.b.sku_code}（${p.b.name_zh}）：${notes.join('；')}`,
  );
}

console.log(out.join('\n'));
await c.end();
