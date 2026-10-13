import { describe, expect, it, vi } from 'vitest';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { BarcodeController } from '../controllers/barcode.controller';
import { SkuBarcodeEntity } from '../entities/sku-barcode.entity';
import { SkuEntity } from '../entities/sku.entity';
import { BarcodeTypeInvalidError } from '../errors/barcode-errors';
import { SkuBarcodeRepository } from '../repositories/sku-barcode.repository';
import { SkuRepository } from '../repositories/sku.repository';
import { BarcodeService } from './barcode.service';

const BARCODE = '6971234567890';
const OPERATOR = { userId: null, username: 'test' };

function build() {
  const sku = Object.assign(new SkuEntity(), {
    id: 'sku-1',
    skuCode: 'SKU000003001',
    nameZh: '测试商品',
    serialTracking: true,
    movingAverageCost: '12.3400',
    latestPurchasePrice: '99.0000',
  });
  const barcode: SkuBarcodeEntity = {
    id: 'barcode-1',
    skuId: sku.id,
    barcode: BARCODE,
    barcodeType: 'EAN',
    isPrimary: true,
    status: 'ACTIVE',
    createdAt: new Date('2026-09-17T00:00:00Z'),
  };
  const repository = {
    findByBarcode: vi.fn().mockResolvedValue(barcode),
    nextInternalBarcode: vi.fn().mockResolvedValue('000001'),
    insertWithPrimaryHandling: vi.fn(),
  };
  const skuRepository = { findById: vi.fn().mockResolvedValue(sku), update: vi.fn() };
  const operationLog = { record: vi.fn() };
  const service = new BarcodeService(
    repository as unknown as SkuBarcodeRepository,
    skuRepository as unknown as SkuRepository,
    operationLog as unknown as OperationLogService,
  );
  return { service, sku, barcode, repository, skuRepository, operationLog };
}

describe('BarcodeService.resolveBarcode', () => {
  it.each(['12.3400', '0.0000', '99999999999999.9999'])(
    'preserves all existing fields and suggests exact NUMERIC string %s without writes',
    async (cost) => {
      const ctx = build();
      ctx.sku.movingAverageCost = cost;
      const resolved = await ctx.service.resolveBarcode(BARCODE);
      expect(resolved).toEqual({
        skuId: 'sku-1',
        skuCode: 'SKU000003001',
        skuName: '测试商品',
        matchedBarcode: BARCODE,
        barcodeType: 'EAN',
        serialTracking: true,
        suggestedUnitCost: cost,
        suggestedUnitCostSource: 'MOVING_AVERAGE',
      });
      expect(ctx.repository.findByBarcode).toHaveBeenCalledWith(BARCODE);
      expect(ctx.skuRepository.findById).toHaveBeenCalledWith('sku-1');
      expect(ctx.skuRepository.update).not.toHaveBeenCalled();
      expect(ctx.operationLog.record).not.toHaveBeenCalled();
    },
  );

  it.each([null, undefined])(
    'returns null suggestions for unknown cost %s without fallback',
    async (cost) => {
      const ctx = build();
      // Simulate both database NULL and an older partial mock with the field absent.
      const { movingAverageCost: _cost, ...skuWithoutCost } = ctx.sku;
      ctx.skuRepository.findById.mockResolvedValue(
        cost === undefined ? skuWithoutCost : { ...skuWithoutCost, movingAverageCost: null },
      );
      expect(await ctx.service.resolveBarcode(BARCODE)).toMatchObject({
        suggestedUnitCost: null,
        suggestedUnitCostSource: null,
      });
    },
  );

  it('keeps returning null for an unknown barcode and does not look up a SKU', async () => {
    const ctx = build();
    ctx.repository.findByBarcode.mockResolvedValue(null);
    expect(await ctx.service.resolveBarcode('SKU000003001')).toBeNull();
    expect(ctx.skuRepository.findById).not.toHaveBeenCalled();
  });

  it('keeps returning null for an inactive barcode', async () => {
    const ctx = build();
    ctx.barcode.status = 'INACTIVE';
    expect(await ctx.service.resolveBarcode(BARCODE)).toBeNull();
    expect(ctx.skuRepository.findById).not.toHaveBeenCalled();
  });

  it('keeps returning null when the associated SKU does not exist', async () => {
    const ctx = build();
    ctx.skuRepository.findById.mockResolvedValue(null);
    expect(await ctx.service.resolveBarcode(BARCODE)).toBeNull();
  });

  it('passes the added fields through the existing controller success envelope', async () => {
    const ctx = build();
    const controller = new BarcodeController(ctx.service);
    expect(await controller.resolve(BARCODE)).toEqual({
      success: true,
      data: await ctx.service.resolveBarcode(BARCODE),
    });
  });

  it('returns actionable Chinese not-found guidance with the original code and details', async () => {
    const ctx = build();
    ctx.repository.findByBarcode.mockResolvedValue(null);
    const controller = new BarcodeController(ctx.service);
    await expect(controller.resolve('SKU000003001')).rejects.toMatchObject({
      code: 'SKU_BARCODE_NOT_FOUND',
      httpStatus: 404,
      message:
        '条码「SKU000003001」未绑定任何 SKU。提示：SKU 编码（如 SKU000001001）不是条码；请扫描商品实物条码，或改用搜索选择 SKU。',
      details: { id: 'SKU000003001' },
    });
  });
});

describe('Barcode user-facing errors', () => {
  it('localizes duplicate barcode errors without changing their code', async () => {
    const ctx = build();
    await expect(
      ctx.service.create('sku-1', { barcode: BARCODE, barcodeType: 'EAN' }, OPERATOR),
    ).rejects.toMatchObject({
      code: 'SKU_BARCODE_ALREADY_EXISTS',
      httpStatus: 409,
      message: `条码「${BARCODE}」已被绑定，请使用其他条码或查看已有绑定。`,
      details: { barcode: BARCODE },
    });
    expect(ctx.repository.insertWithPrimaryHandling).not.toHaveBeenCalled();
  });

  it('localizes invalid barcode types without changing their code', () => {
    expect(new BarcodeTypeInvalidError('INVALID')).toMatchObject({
      code: 'SKU_BARCODE_TYPE_INVALID',
      httpStatus: 422,
      message: '不支持的条码类型「INVALID」，请选择有效的条码类型。',
      details: { barcodeType: 'INVALID' },
    });
  });

  it('localizes missing SKU errors during internal barcode generation', async () => {
    const ctx = build();
    ctx.skuRepository.findById.mockResolvedValue(null);
    await expect(ctx.service.generateInternal('sku-1', OPERATOR)).rejects.toMatchObject({
      code: 'SKU_NOT_FOUND',
      httpStatus: 404,
      message: 'SKU「sku-1」不存在，请刷新后重新选择 SKU。',
      details: { id: 'sku-1' },
    });
    expect(ctx.repository.nextInternalBarcode).not.toHaveBeenCalled();
  });
});
