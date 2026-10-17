import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mergePdfs } from './pdf-merge';

/** Builds a one-page PDF of the given millimetre size (label stock). */
async function makePdf(widthMm: number, heightMm: number, text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([(widthMm * 72) / 25.4, (heightMm * 72) / 25.4]);
  page.drawText(text, { x: 4, y: 4, size: 6 });
  return doc.save();
}

describe('mergePdfs (2026-10-17 批量打印面单)', () => {
  it('合并多页并**保留每页原始 MediaBox**（否则打印尺寸错误）', async () => {
    const label = await makePdf(57.9, 40, 'OZON label');
    const another = await makePdf(100, 150, 'other stock');

    const merged = await mergePdfs([label, another, label]);

    expect(merged.pageCount).toBe(3);
    const doc = await PDFDocument.load(merged.bytes);
    expect(doc.getPageCount()).toBe(3);

    const sizes = doc.getPages().map((page) => {
      const { width, height } = page.getSize();
      return `${((width / 72) * 25.4).toFixed(1)}x${((height / 72) * 25.4).toFixed(1)}`;
    });
    // 逐页保持各自纸张尺寸（混合尺寸也不被统一成 A4）。
    expect(sizes).toEqual(['57.9x40.0', '100.0x150.0', '57.9x40.0']);
  });
});
