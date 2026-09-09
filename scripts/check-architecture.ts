/**
 * Architecture guard (Sprint 0 task §34 / AGENTS.md §81).
 *
 * Fails (exit code 1) when a rule is violated:
 *   Rule 1: Controllers must not import repositories.
 *   Rule 2: Web must not import backend entities / @wcies/api.
 *   Rule 3: Code outside modules/inventory must not import inventory
 *           repositories/entities/internal (Sprint 2 task §49) -
 *           relative imports are resolved so deep paths are caught.
 *   Rule 4: A business module must not import another module's internal
 *           repositories/entities directory.
 *   Rule 5 (Sprint 5 §61): external platform API hosts/endpoints may only
 *           appear inside modules/integration - platform calls must never
 *           leak into core business modules.
 *
 * Architecture discipline cannot rely on memory alone (AGENTS.md §81).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

interface Violation {
  rule: string;
  file: string;
  detail: string;
}

function listFiles(dir: string, extensions: string[]): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re =
    /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec !== undefined) {
      specs.push(spec);
    }
  }
  return specs;
}

const violations: Violation[] = [];

function checkRule1(): void {
  const controllers = listFiles(join(ROOT, 'apps/api/src/modules'), ['.ts']).filter((f) =>
    f.includes(`${sep}controllers${sep}`),
  );
  for (const file of controllers) {
    const specs = importSpecifiers(readFileSync(file, 'utf8'));
    for (const spec of specs) {
      if (
        spec.includes('/repositories/') ||
        /^[./]*..*repositories\//.test(spec) ||
        /repository$/i.test(spec)
      ) {
        violations.push({
          rule: 'Rule 1: controllers must not import repositories',
          file: relative(ROOT, file),
          detail: `import "${spec}"`,
        });
      }
    }
  }
}

function checkRule2(): void {
  const webFiles = listFiles(join(ROOT, 'apps/web/src'), ['.ts', '.tsx']);
  const webRoot = join(ROOT, 'apps/web');
  const backendApiRoot = join(ROOT, 'apps', 'api');
  for (const file of webFiles) {
    const specs = importSpecifiers(readFileSync(file, 'utf-8'));
    for (const spec of specs) {
      if (spec.startsWith('@wcies/api/')) {
        violations.push({
          rule: 'Rule 2: web must not import backend entities / api internals',
          file: relative(ROOT, file),
          detail: `import "${spec}"`,
        });
        continue;
      }
      if (spec.startsWith('.')) {
        // Resolve the relative import and flag only paths that LEAVE apps/web
        // (e.g. reach apps/api). A raw "../../api/" string pattern also
        // matched the web app's own src/api folder - a false positive.
        const resolved = resolve(file, '..', spec);
        const insideWeb = resolved.startsWith(webRoot);
        const reachesBackendApi = resolved.startsWith(backendApiRoot);
        if (!insideWeb || reachesBackendApi) {
          violations.push({
            rule: 'Rule 2: web must not import backend entities / api internals',
            file: relative(ROOT, file),
            detail: `import "${spec}"`,
          });
        }
      }
    }
  }
}

function checkRule3(): void {
  // Sprint 2 (task §49): the inventory module now exists; nothing outside it
  // may import inventory repositories/entities/internal - cross-module reads
  // and writes go through the exported Inventory services only
  // (AGENTS.md §10/§19). Both package-style and relative imports are
  // resolved so '../../inventory/repositories/...' is caught too.
  const apiFiles = listFiles(join(ROOT, 'apps/api/src'), ['.ts']);
  for (const file of apiFiles) {
    const normalized = file.split(sep).join('/');
    if (normalized.includes('modules/inventory/')) {
      continue;
    }
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      const target = spec.startsWith('.') ? resolve(file, '..', spec).split(sep).join('/') : spec;
      if (
        target.includes('modules/inventory/repositories') ||
        target.includes('modules/inventory/entities') ||
        target.includes('modules/inventory/internal') ||
        spec.includes('modules/inventory/repositories') ||
        spec.includes('modules/inventory/entities') ||
        spec.includes('modules/inventory/internal')
      ) {
        violations.push({
          rule: 'Rule 3: non-inventory code must not import inventory internals',
          file: relative(ROOT, file),
          detail: `import "${spec}"`,
        });
      }
    }
  }
}

function checkRule4(): void {
  const moduleFiles = listFiles(join(ROOT, 'apps/api/src/modules'), ['.ts']).filter(
    // Test code is exempt from module boundaries (dependency-rules.md §4).
    (file) => !file.endsWith('.spec.ts') && !file.endsWith('.test.ts'),
  );
  for (const file of moduleFiles) {
    const normalized = file.split(sep).join('/');
    const ownMatch = /\/modules\/([^/]+)\//.exec(normalized);
    const ownModule = ownMatch?.[1];
    if (ownModule === undefined) {
      continue;
    }
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) {
        continue; // cross-module imports inside the app are always relative
      }
      const target = resolve(file, '..', spec).split(sep).join('/');
      const targetMatch = /\/modules\/([^/]+)\/(repositories|entities|internal)\//.exec(target);
      if (targetMatch?.[1] !== undefined && targetMatch[1] !== ownModule) {
        violations.push({
          rule: `Rule 4: module "${ownModule}" imports internals of module "${targetMatch[1]}"`,
          file: relative(ROOT, file),
          detail: `import "${spec}"`,
        });
      }
    }
  }
}

/**
 * Rule 5 (Sprint 5 task §61): real platform endpoints live only in the
 * integration layer (Adapter/Client). Core modules must stay ignorant of
 * which HTTP API a platform speaks.
 */
function checkRule5(): void {
  const apiFiles = listFiles(join(ROOT, 'apps/api/src'), ['.ts']);
  const PLATFORM_URL_PATTERN =
    /api-seller\.ozon\.ru|seller-api\.wildberries\.ru|api\.market\.yandex\.net/i;
  for (const file of apiFiles) {
    const normalized = file.split(sep).join('/');
    if (normalized.includes('modules/integration/')) {
      continue; // the only sanctioned home for platform endpoints
    }
    const source = readFileSync(file, 'utf8');
    const match = PLATFORM_URL_PATTERN.exec(source);
    if (match !== null) {
      violations.push({
        rule: 'Rule 5: platform API endpoints only inside modules/integration',
        file: relative(ROOT, file),
        detail: `found "${match[0]}"`,
      });
    }
  }
}

checkRule1();
checkRule2();
checkRule3();
checkRule4();
checkRule5();

if (violations.length > 0) {
  console.error(`Architecture check FAILED with ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  [${v.rule}]\n    ${v.file}\n    -> ${v.detail}\n`);
  }
  process.exit(1);
}

console.log('Architecture check passed (5 rules evaluated).');
