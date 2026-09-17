import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { StoreModule } from '../store/store.module';
import { WarehouseEntity } from './entities/warehouse.entity';
import { WarehouseBinEntity } from './entities/warehouse-bin.entity';
import { WarehousePlatformBindingEntity } from './entities/warehouse-platform-binding.entity';
import { WarehouseRepository } from './repositories/warehouse.repository';
import { WarehouseService } from './services/warehouse.service';
import { WarehouseBinService } from './services/warehouse-bin.service';
import { WarehousePlatformBindingService } from './services/warehouse-platform-binding.service';
import {
  WarehouseBinController,
  WarehouseController,
  WarehousePlatformBindingController,
} from './controllers/warehouse.controller';

/** Warehouse + bins + platform warehouse bindings (spec §95; 用户指示 2026-09-17). */
@Module({
  imports: [
    TypeOrmModule.forFeature([WarehouseEntity, WarehouseBinEntity, WarehousePlatformBindingEntity]),
    StoreModule,
    OperationLogModule,
  ],
  controllers: [WarehouseController, WarehouseBinController, WarehousePlatformBindingController],
  providers: [
    WarehouseService,
    WarehouseBinService,
    WarehousePlatformBindingService,
    WarehouseRepository,
  ],
  exports: [WarehouseService, WarehouseBinService, WarehousePlatformBindingService],
})
export class WarehouseModule {}
