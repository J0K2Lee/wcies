import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemExceptionEntity } from './entities/system-exception.entity';
import { SystemExceptionRepository } from './repositories/system-exception.repository';
import { ExceptionService } from './services/exception.service';
import { ExceptionController } from './controllers/exception.controller';

/**
 * Minimal exception center (Sprint 3 task §25-§27). Cross-module creation
 * goes through ExceptionService.create / createInTx; rows are never deleted.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SystemExceptionEntity])],
  controllers: [ExceptionController],
  providers: [SystemExceptionRepository, ExceptionService],
  exports: [ExceptionService],
})
export class ExceptionModule {}
