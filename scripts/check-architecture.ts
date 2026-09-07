/**
 * Architecture guard (Sprint 0 task §34 / AGENTS.md §81).
 *
 * Fails (exit code 1) when a rule is violated:
 *   Rule 1: Controllers must not import repositories.
 *   Rule 2: Web must not import backend entities / @wcies/api.
 *   Rule 3: Integration code must not import inventory repositories
 *           (inventory module arrives in a later sprint; the rule stands
 *           ready so it cannot be violated from day one).
 *   Rule 4: A business module must not import another module's internal
 *           repositories/entities directory.
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
  for (const file of webFiles) {
    const specs = importSpecifiers(readFileSync(file, 'utf8'));
    for (const spec of specs) {
      if (
        spec.startsWith('@wcies/api/') ||
        spec.includes('apps/api/') ||
        /\.\.\/\.\.\/api\//.test(spec)
      ) {
        violations.push({
          rule: 'Rule 2: web must not import backend entities / api internals',
          file: relative(ROOT, file),
          detail: `import "${spec}"`,
        });
      }
    }
  }
}

function checkRule3(): void {
  // The integration module (platform adapters) arrives in a later sprint;
  // scan the whole api src so the rule also catches integration code living
  // anywhere outside modules/inventory.
  const apiFiles = listFiles(join(ROOT, 'apps/api/src'), ['.ts']);
  for (const file of apiFiles) {
    const normalized = file.split(sep).join('/');
    if (normalized.includes('modules/inventory/')) {
      continue;
    }
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (
        spec.includes('modules/inventory/repositories') ||
        spec.includes('modules/inventory/entities') ||
        spec.includes('modules/inventory/internal')
      ) {
        violations.push({
          rule: 'Rule 3: integration must not import inventory internals',
          file: relative(ROOT, file),
          detail: `import "${spec}"`,
        });
      }
    }
  }
}

function checkRule4(): void {
  const moduleFiles = listFiles(join(ROOT, 'apps/api/src/modules'), ['.ts']);
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

checkRule1();
checkRule2();
checkRule3();
checkRule4();

if (violations.length > 0) {
  console.error(`Architecture check FAILED with ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  [${v.rule}]\n    ${v.file}\n    -> ${v.detail}\n`);
  }
  process.exit(1);
}

console.log('Architecture check passed (4 rules evaluated).');
