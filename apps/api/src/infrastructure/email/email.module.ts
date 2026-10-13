import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/** Transactional email transport (Feishu SMTP), globally available. */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
