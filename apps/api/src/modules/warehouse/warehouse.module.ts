import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { StoreModule } from '../store/store.module';
import { WarehouseEntity } from './entities/warehouse.entity';
import { WarehouseBinEntity } from './entities/warehouse-bin.entity';
import { StoreWarehouseBindingEntity } from './entities/store-warehouse-binding.entity';
import { WarehouseRepository } from './repositories/warehouse.repository';
import { WarehouseService } from './services/warehouse.service';
import { WarehouseBinService } from './services/warehouse-bin.service';
import { StoreWarehouseBindingService } from './services/store-warehouse-binding.service';
import {
  StoreWarehouseBindingController,
  WarehouseBinController,
  WarehouseController,
} from './controllers/warehouse.controller';

/** Warehouse + bins + store bindings (spec §95 module layout). */
@Module({
  imports: [
    TypeOrmModule.forFeature([WarehouseEntity, WarehouseBinEntity, StoreWarehouseBindingEntity]),
    StoreModule,
    OperationLogModule,
  ],
  controllers: [WarehouseController, WarehouseBinController, StoreWarehouseBindingController],
  providers: [
    WarehouseService,
    WarehouseBinService,
    StoreWarehouseBindingService,
    WarehouseRepository,
  ],
  exports: [WarehouseService, WarehouseBinService, StoreWarehouseBindingService],
})
export class WarehouseModule {}
