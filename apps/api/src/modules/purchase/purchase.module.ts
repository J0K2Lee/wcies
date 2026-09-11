import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { SupplierEntity } from './entities/supplier.entity';
import { SupplierRepository } from './repositories/supplier.repository';
import { SupplierService } from './services/supplier.service';
import { SupplierController } from './controllers/supplier.controller';

/**
 * Purchase module (Sprint 7): suppliers, purchase orders (registration of
 * intent) and purchase receipts (irreversible stock facts, decision 0013).
 * Stock is ONLY touched through the exported Inventory services.
 * BusinessCodeService arrives via the global BusinessCodeModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SupplierEntity]), OperationLogModule],
  controllers: [SupplierController],
  providers: [SupplierService, SupplierRepository],
  exports: [SupplierService],
})
export class PurchaseModule {}
