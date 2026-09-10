import { Global, Module } from '@nestjs/common';
import { BusinessCodeService } from './business-code.service';

/**
 * Cross-cutting business-code numbering (decision 0001). Global so every
 * master-data module can take codes without importing wiring of its own;
 * modules must use BusinessCodeService and never query the table directly.
 */
@Global()
@Module({
  providers: [BusinessCodeService],
  exports: [BusinessCodeService],
})
export class BusinessCodeModule {}
