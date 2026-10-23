import { PDFDocument } from 'pdf-lib';

/**
 * 面单 PDF 的合并 / 拆分工具。
 *
 * 为什么集中在 common：platform adapter（批量取面单要拆页）和 shipment /
 * sync（批量打印要合并）都要用，放在任一侧都会让 integration ↔ shipment
 * 互相 import。
 *
 * 为什么需要合并：平台面单（OZON 实测 57.9mm × 40mm）自带纸张尺寸，嵌套在
 * HTML 打印页里会被缩放成 A4。合并成一个 PDF 后交给浏览器**原生 PDF
 * 查看器**打印，每页保留各自的 MediaBox，尺寸即为平台原尺寸。
 *
 * `copyPages` 复制页面对象（含 MediaBox / 旋转），不重排内容；因此混合尺寸
 * 的面单也能逐页保持原样。
 */
export async function mergePdfs(
  buffers: readonly Uint8Array[],
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const merged = await PDFDocument.create();
  let pageCount = 0;
  for (const buffer of buffers) {
    // 面单是平台生成的可信 PDF；ignoreEncryption 只用于容忍带空权限标记的文件。
    const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
      pageCount += 1;
    }
  }
  return { bytes: await merged.save(), pageCount };
}

/** 热敏面单纸张：58×40mm（WB 贴纸与 Yandex A9 同尺寸）。 */
const LABEL_WIDTH_PT = (58 / 25.4) * 72;
const LABEL_HEIGHT_PT = (40 / 25.4) * 72;

/**
 * PNG 贴纸 → 单页 PDF（2026-10-22）。
 *
 * WB 的**通用**贴纸接口只给 PNG（跨境接口给 PDF），而批量打印把多张面单合并成
 * 一个 PDF 交给浏览器原生打印。混进一张 PNG 会让 `mergePdfs` 直接失败，前端
 * 只能退回「逐张打印」。这里在取单时就转成 PDF，导出链路因此只认 PDF。
 */
export async function pngToPdfPage(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(bytes);
  const page = doc.addPage([LABEL_WIDTH_PT, LABEL_HEIGHT_PT]);
  page.drawImage(image, { x: 0, y: 0, width: LABEL_WIDTH_PT, height: LABEL_HEIGHT_PT });
  return doc.save();
}

/**
 * 把一份多页面单 PDF 按页拆成多个单页 PDF（批量取面单用，用户指示 2026-10-21）。
 *
 * 平台的批量面单接口（OZON `package-label` 传 posting_number 数组，≤20 单）
 * **一次请求返回一个 PDF**，页面顺序与请求顺序一致。只有页数恰好等于单数时
 * 才能安全地一页对一单；调用方负责校验页数，不匹配就降级为逐单请求
 * （不猜测平台的分页规则）。
 */
export async function splitPdfPages(buffer: Uint8Array): Promise<Uint8Array[]> {
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages: Uint8Array[] = [];
  for (const index of source.getPageIndices()) {
    const single = await PDFDocument.create();
    const [page] = await single.copyPages(source, [index]);
    single.addPage(page);
    pages.push(await single.save());
  }
  return pages;
}
