import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLogEntity } from './entities/operation-log.entity';
import { OperationLogRepository } from './repositories/operation-log.repository';
import { OperationLogService } from './operation-log.service';

/**
 * Cross-cutting audit trail. Exported for every master-data module; no
 * controller of its own in Sprint 1 (querying via a future admin UI).
 */
@Module({
  imports: [TypeOrmModule.forFeature([OperationLogEntity])],
  providers: [OperationLogService, OperationLogRepository],
  exports: [OperationLogService],
})
export class OperationLogModule {}
