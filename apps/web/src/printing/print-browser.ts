import { barsOf, encodeCode128B } from './code128';
import { PrintTask } from './print-contract';

/**
 * Browser consumer of PrintTasks (Sprint 7 T6.1): renders labels as SVG
 * (Code128) inside a dedicated print window and triggers window.print().
 * CSS @page + @media print control the layout; label paper sizing stays a
 * manual printer setting for now (the local agent will own that later).
 */

const MODULE_WIDTH = 2; // px per module at screen scale; prints scale with it
const BAR_HEIGHT = 56;
const QUIET_MODULES = 10; // mandatory quiet zone on both sides

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function labelSvg(value: string, opts: { title?: string; subtitle?: string }): string {
  const { bits } = encodeCode128B(value);
  const bars = barsOf(bits);
  const width = (bits.length + QUIET_MODULES * 2) * MODULE_WIDTH;
  const barLeft = QUIET_MODULES * MODULE_WIDTH;
  const rectsWithOffset = bars
    .map(
      (bar) =>
        `<rect x="${barLeft + bar.x * MODULE_WIDTH}" y="0" width="${bar.width * MODULE_WIDTH}" height="${BAR_HEIGHT}" fill="#000"/>`,
    )
    .join('');
  const title = opts.title === undefined ? '' : `<div class="t">${escapeHtml(opts.title)}</div>`;
  const subtitle =
    opts.subtitle === undefined ? '' : `<div class="s">${escapeHtml(opts.subtitle)}</div>`;
  return `<div class="label">
  ${title}${subtitle}
  <svg width="${width}" height="${BAR_HEIGHT}" viewBox="0 0 ${width} ${BAR_HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="barcode ${escapeHtml(value)}">
    <rect width="${width}" height="${BAR_HEIGHT}" fill="#fff"/>
    ${rectsWithOffset}
  </svg>
  <div class="code">${escapeHtml(value)}</div>
</div>`;
}

/** Renders and prints the given tasks in a new window. */
export function printTasksBrowser(tasks: readonly PrintTask[]): void {
  const bodyParts: string[] = [];
  for (const task of tasks) {
    if (task.type === 'SKU_LABEL') {
      for (let copy = 0; copy < task.payload.copies; copy += 1) {
        bodyParts.push(
          labelSvg(task.payload.barcode, {
            title: task.payload.skuCode,
            subtitle: task.payload.skuName,
          }),
        );
      }
    } else if (task.type === 'BIN_LABEL') {
      for (let copy = 0; copy < task.payload.copies; copy += 1) {
        bodyParts.push(
          labelSvg(task.payload.binCode, {
            title: task.payload.binCode,
            subtitle: task.payload.warehouseCode,
          }),
        );
      }
    } else {
      // SHIPPING_LABEL: the PDF opens in its own tab (signed URL); copies
      // remain a printer-dialog setting for PDFs.
      window.open(task.payload.url, '_blank', 'noopener');
    }
  }
  if (bodyParts.length === 0) {
    return;
  }
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>WCIES 标签打印</title>
<style>
  body { margin: 0; font-family: "Microsoft YaHei", Arial, sans-serif; background: #fff; }
  .sheet { padding: 8mm; }
  .label { page-break-inside: avoid; text-align: center; margin-bottom: 6mm; }
  .label .t { font-size: 13px; font-weight: 700; }
  .label .s { font-size: 11px; color: #333; max-width: 60mm; margin: 0 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .label .code { font-family: "Courier New", monospace; font-size: 13px; letter-spacing: 1px; }
  svg { display: block; margin: 2px auto; }
  @media print {
    .sheet { padding: 0; }
    .label { margin-bottom: 4mm; }
  }
</style>
</head>
<body><div class="sheet">${bodyParts.join('\n')}</div></body>
</html>`;
  // NOTE: do NOT pass 'noopener' here - with it window.open() returns null,
  // so the handle is lost, document.write never runs and the user is left
  // with a blank tab (exactly the bug this fixed). The opener link is
  // severed manually right after opening instead.
  const printWindow = window.open('', '_blank');
  if (printWindow === null) {
    return;
  }
  printWindow.opener = null;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  // Let the SVG paint before the dialog opens.
  printWindow.setTimeout(() => printWindow.print(), 150);
}
