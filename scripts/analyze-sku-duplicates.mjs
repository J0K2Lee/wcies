import pg from 'pg';
import {
  SKU_CATEGORY_WORDS,
  compareSkuNames,
  skuNameSignature,
} from '../packages/shared/dist/index.js';

/**
 * 只读分析：在真实库中找出大概率属于「同一事实 SKU」的档案组。
 * 不写任何数据。输出 markdown 报告到 stdout。
 *
 * 规则与线上「映射 / 建档」的重复提示**同一实现**（@wcies/shared 的
 * sku-match）：归一化、名称签名、配色/型号/档位/代际的硬反证都在那里，
 * 本脚本只负责取数、分档与输出，避免线上口径与审计口径漂移。
 *
 * 用法（需要先构建 shared：pnpm --filter @wcies/shared build）：
 *   node --env-file=.env scripts/analyze-sku-duplicates.mjs > report.md
 */
async function main() {
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

  // ---- 签名（规则来自 @wcies/shared，脚本不再自带一份） -------------------
  const signatureOf = (row) => skuNameSignature(row.name_zh, row.brand);
  const signatureKey = (signature) => [...signature].sort().join('+');

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
    s.signature = signatureOf(s);
    s.coreKey = signatureKey(s.signature);
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
  function classify(a, b) {
    const notes = [];
    const hard = [];
    let tier = null;

    const keyOf = (r) => `${r.store_id}|${r.platform_sku_id ?? ''}|${r.offer_id ?? ''}`;
    const aKeys = new Set(a.refs.map(keyOf));
    const sharedRef = b.refs.find((r) => aKeys.has(keyOf(r)));
    if (sharedRef !== undefined) {
      notes.push(`同店同平台变体（${sharedRef.store_code}/${sharedRef.platform} ${sharedRef.platform_sku_id}）`);
      tier = 'A';
    }
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

    const sameBrand = (a.brand ?? '') !== '' && a.brand === b.brand;
    const sameCategory = (a.category ?? '') !== '' && a.category === b.category;
    if (sameBrand) notes.push(`同品牌 ${a.brand}`);
    if (sameCategory) notes.push(`同分类 ${a.category}`);

    const comparison = compareSkuNames(
      { name: a.name_zh, brandName: a.brand },
      { name: b.name_zh, brandName: b.brand },
    );
    const relation = comparison.relation;
    notes.push(`名称签名 ${relation === 'SAME' ? '一致' : relation === 'CONTAINED' ? '包含' : '相似'}`
      + `（${a.signature.join('-')} / ${b.signature.join('-')}，${Math.round(comparison.similarity * 100)}%）`);
    hard.push(...comparison.conflicts);
    if (a.bc.length > 0 && b.bc.length > 0 && sharedBarcode === undefined) {
      notes.push('条码互不相同（弱反证）');
    }
    if (a.brand !== null && b.brand !== null && a.brand !== b.brand) {
      hard.push(`品牌不同（${a.brand} / ${b.brand}）`);
    }

    if (hard.length > 0) {
      return tier === 'A' ? { tier: 'A', score: 100, notes, hard } : null;
    }
    if (tier === 'A') return { tier: 'A', score: 100, notes, hard };
    if (relation === 'SAME' && (sameBrand || sameCategory)) return { tier: 'B', score: 85, notes, hard };
    if (relation === 'SAME' || (sharedId !== undefined && relation === 'CONTAINED')) {
      return { tier: 'B', score: 80, notes, hard };
    }
    if (relation === 'CONTAINED' && sameBrand) return { tier: 'C', score: 55, notes, hard };
    if (relation === 'CONTAINED') return { tier: 'D', score: 45, notes, hard };
    if (comparison.sameModelDifferentVariant || hard.length > 0) return null;
    if (relation === 'SIMILAR' && comparison.similarity >= 0.8 && sameBrand && sameCategory) {
      return { tier: 'D', score: 40, notes, hard };
    }
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
}

void main();
