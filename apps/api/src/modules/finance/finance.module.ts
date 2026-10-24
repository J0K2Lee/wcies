import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceTransactionEntity } from './entities/finance-transaction.entity';
import { FinancePayoutEntity } from './entities/finance-payout.entity';
import { OrderSettlementEntity } from './entities/order-settlement.entity';
import { OrderSettlementItemEntity } from './entities/order-settlement-item.entity';
import { FinanceTransactionRepository } from './repositories/finance-transaction.repository';
import { FinancePayoutRepository } from './repositories/finance-payout.repository';
import { OrderSettlementRepository } from './repositories/order-settlement.repository';
import { FinanceTransactionService } from './services/finance-transaction.service';
import { SkuReferenceRelinkService } from './services/sku-reference-relink.service';
import { FinancePayoutService } from './services/finance-payout.service';
import { OrderSettlementService } from './services/order-settlement.service';
import { FinanceReportService } from './services/finance-report.service';
import { FinanceController } from './controllers/finance.controller';
import { StoreModule } from '../store/store.module';
import { ProductModule } from '../product/product.module';
import { OrderModule } from '../order/order.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { OperationLogModule } from '../operation-log/operation-log.module';

/**
 * Finance module (Sprint 10, docs/business-rules/finance.md).
 *
 * Facts owned here: finance_transactions (append-only ledger),
 * finance_payouts, order_settlements(+items). Payable amounts are derived
 * from purchase module facts through its exported services (AGENTS.md §9).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FinanceTransactionEntity,
      FinancePayoutEntity,
      OrderSettlementEntity,
      OrderSettlementItemEntity,
    ]),
    StoreModule,
    ProductModule,
    OrderModule,
    PurchaseModule,
    OperationLogModule,
  ],
  controllers: [FinanceController],
  providers: [
    SkuReferenceRelinkService,
    FinanceTransactionRepository,
    FinancePayoutRepository,
    OrderSettlementRepository,
    FinanceTransactionService,
    FinancePayoutService,
    OrderSettlementService,
    FinanceReportService,
  ],
  exports: [FinanceTransactionService, FinanceReportService],
})
export class FinanceModule {}
