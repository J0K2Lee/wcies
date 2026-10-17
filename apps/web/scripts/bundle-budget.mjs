/**
 * 构建体积预算告警（S0，2026-10-17 体检报告 §4.2）。
 *
 * 读取 vite build 的产物，打印分块清单与关键指标，并按预算告警。
 * **只告警、不阻断**：先建立可见性，等 S1 落地稳定后再考虑做成 CI 卡口。
 *
 * 「首屏」的口径很关键：路由级代码分割之后，**全部 chunk 之和不再是首屏代价**
 * ——用户打开一个页面只下载入口及其静态依赖。所以这里以 Vite 写进 index.html 的
 * `script[type=module]` + `link[rel=modulepreload]` 为准（那是构建器自己声明的
 * 首屏静态闭包），全量之和仅作为「浏览全站的总字节数」参考。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ASSETS = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const INDEX_HTML = fileURLToPath(new URL('../dist/index.html', import.meta.url));

const BUDGET_INITIAL_GZIP_KB = 350;
const BUDGET_SINGLE_CHUNK_KB = 300;

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
const gzipOf = (file) => gzipSync(readFileSync(file)).length;

let html;
try {
  html = readFileSync(INDEX_HTML, 'utf8');
} catch {
  console.error('[bundle-budget] 未找到 dist/index.html（先跑 vite build）');
  process.exit(0);
}

const allJs = readdirSync(ASSETS).filter((name) => name.endsWith('.js'));
if (allJs.length === 0) {
  console.error('[bundle-budget] dist/assets 下没有 JS 文件');
  process.exit(0);
}

/** 首屏静态闭包：入口脚本 + 全部 modulepreload。 */
const initialNames = [
  ...new Set(
    [...html.matchAll(/assets\/[A-Za-z0-9._-]+\.js/g)].map((match) =>
      match[0].replace(/^assets\//, ''),
    ),
  ),
];

const rows = allJs
  .map((name) => {
    const file = join(ASSETS, name);
    return {
      name,
      raw: statSync(file).size,
      gzip: gzipOf(file),
      initial: initialNames.includes(name),
    };
  })
  .sort((a, b) => b.gzip - a.gzip);

const initial = rows.filter((row) => row.initial);
const initialRaw = initial.reduce((sum, row) => sum + row.raw, 0);
const initialGzip = initial.reduce((sum, row) => sum + row.gzip, 0);
const totalRaw = rows.reduce((sum, row) => sum + row.raw, 0);
const totalGzip = rows.reduce((sum, row) => sum + row.gzip, 0);
const largest = rows[0];

console.log('\n[bundle-budget] 首屏静态闭包（index.html 声明的入口 + modulepreload）');
for (const row of initial.sort((a, b) => b.gzip - a.gzip)) {
  console.log(`  ${kb(row.gzip).padStart(10)} gzip ${kb(row.raw).padStart(10)} raw  ${row.name}`);
}

console.log('\n[bundle-budget] 按需 chunk（进入对应页面时才下载）');
const deferred = rows.filter((row) => !row.initial).slice(0, 10);
for (const row of deferred) {
  console.log(`  ${kb(row.gzip).padStart(10)} gzip ${kb(row.raw).padStart(10)} raw  ${row.name}`);
}
const deferredRest = rows.filter((row) => !row.initial).length - deferred.length;
if (deferredRest > 0) {
  console.log(`  …其余 ${deferredRest} 个按需分块`);
}

console.log('\n[bundle-budget] 汇总');
console.log(
  `  chunk 总数      : ${rows.length}（首屏 ${initial.length} / 按需 ${rows.length - initial.length}）`,
);
console.log(`  首屏 JS 原始    : ${kb(initialRaw)}`);
console.log(`  首屏 JS gzip    : ${kb(initialGzip)}   （预算 ≤ ${BUDGET_INITIAL_GZIP_KB} kB）`);
console.log(`  全站 JS gzip    : ${kb(totalGzip)}（浏览全部页面时的总下载量）`);
console.log(
  `  最大单 chunk    : ${kb(largest.gzip)} gzip  ${largest.name}   （预算 ≤ ${BUDGET_SINGLE_CHUNK_KB} kB）`,
);

const warnings = [];
if (initialGzip / 1024 > BUDGET_INITIAL_GZIP_KB) {
  warnings.push(
    `首屏 JS gzip ${kb(initialGzip)} 超出预算 ${BUDGET_INITIAL_GZIP_KB} kB（超出 ${kb(initialGzip - BUDGET_INITIAL_GZIP_KB * 1024)}）`,
  );
}
if (largest.gzip / 1024 > BUDGET_SINGLE_CHUNK_KB) {
  warnings.push(
    `最大单 chunk ${kb(largest.gzip)} 超出预算 ${BUDGET_SINGLE_CHUNK_KB} kB（${largest.name}）`,
  );
}
if (rows.length === 1) {
  warnings.push(
    '产物只有 1 个 JS chunk —— 路由级代码分割未生效，请检查是否所有页面仍是静态 import',
  );
}

if (warnings.length === 0) {
  console.log('\n[bundle-budget] 全部指标在预算内\n');
  process.exit(0);
}

console.log('\n[bundle-budget] 告警（不阻断构建）');
for (const warning of warnings) {
  console.log(`  ! ${warning}`);
}
console.log('');
