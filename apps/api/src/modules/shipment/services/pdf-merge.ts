import { PDFDocument } from 'pdf-lib';

/**
 * 把多张面单 PDF 合并成一个文件（用户指示 2026-10-17）。
 *
 * 为什么需要它：平台面单（OZON 实测 57.9mm × 40mm）自带纸张尺寸，嵌套在
 * HTML 打印页里会被缩放成 A4，打印尺寸错误。合并成一个 PDF 后交给浏览器
 * **原生 PDF 查看器**打印，每页保留各自的 MediaBox，尺寸即为平台原尺寸。
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
