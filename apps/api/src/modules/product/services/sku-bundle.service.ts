import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DomainError } from '../../../common/errors/domain.error';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { SkuBundleComponentEntity } from '../entities/sku-bundle-component.entity';
import { SkuNotFoundError } from '../errors/sku-errors';
import { SkuRepository } from '../repositories/sku.repository';

/** Task §56: bundle != component, quantity > 0, no recursive bundles. */
export class BundleConstraintInvalidError extends DomainError {
  readonly code = 'SKU_BUNDLE_CONSTRAINT_INVALID';
  readonly httpStatus = 422;

  constructor(message: string) {
    super(message);
  }
}

/**
 * Minimal bundle structure management (task §55): schema + basic service
 * constraints only. No UI, no un-bundling business logic in Sprint 1.
 */
@Injectable()
export class SkuBundleService {
  constructor(
    @InjectRepository(SkuBundleComponentEntity)
    private readonly repository: Repository<SkuBundleComponentEntity>,
    private readonly skuRepository: SkuRepository,
    private readonly operationLog: OperationLogService,
  ) {}

  async listComponents(bundleSkuId: string): Promise<SkuBundleComponentEntity[]> {
    return this.repository.find({ where: { bundleSkuId }, order: { createdAt: 'ASC' } });
  }

  async addComponent(
    bundleSkuId: string,
    componentSkuId: string,
    quantity: number,
    operator: OperatorContext,
  ): Promise<SkuBundleComponentEntity> {
    if (quantity <= 0) {
      throw new BundleConstraintInvalidError('quantity must be > 0');
    }
    if (bundleSkuId === componentSkuId) {
      throw new BundleConstraintInvalidError('bundle_sku_id must differ from component_sku_id');
    }
    const bundle = await this.skuRepository.findById(bundleSkuId);
    if (bundle === null) {
      throw new SkuNotFoundError(bundleSkuId);
    }
    const component = await this.skuRepository.findById(componentSkuId);
    if (component === null) {
      throw new SkuNotFoundError(componentSkuId);
    }
    // No recursive bundles: the component must not already be a bundle.
    const componentIsBundle = await this.repository.findOneBy({ bundleSkuId: componentSkuId });
    if (componentIsBundle !== null) {
      throw new BundleConstraintInvalidError('component SKU is itself a bundle (no recursion)');
    }

    const created = await this.repository.save(
      this.repository.create({ bundleSkuId, componentSkuId, quantity }),
    );
    await this.operationLog.record({
      entityType: 'SKU_BUNDLE_COMPONENT',
      entityId: created.id,
      entityCode: `${bundle.skuCode}+${component.skuCode}x${quantity}`,
      action: 'CREATE',
      changes: { quantity: { from: null, to: quantity } },
      operator,
    });
    return created;
  }

  async removeComponent(id: string, operator: OperatorContext): Promise<void> {
    await this.repository.delete({ id });
    await this.operationLog.record({
      entityType: 'SKU_BUNDLE_COMPONENT',
      entityId: id,
      entityCode: null,
      action: 'DELETE',
      changes: {},
      operator,
    });
  }
}
