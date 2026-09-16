import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import {
  CreateFinancePayoutRequestDto,
  CreateFinanceTransactionRequestDto,
  FinancePayoutDto,
  FinancePayoutListQueryDto,
  FinancePayoutPreviewDto,
  FinanceSummaryQueryDto,
  FinanceSummaryResponseDto,
  FinanceTransactionDto,
  FinanceTransactionListQueryDto,
  GenerateOrderSettlementRequestDto,
  OrderSettlementDetailDto,
  OrderSettlementDto,
  OrderSettlementListQueryDto,
  PayableRowDto,
  PayablesQueryDto,
  SettlementGenerateMissingResultDto,
  UpdateOrderSettlementFeesRequestDto,
} from '../dto/finance.dto';
import { FinanceTransactionService } from '../services/finance-transaction.service';
import { FinancePayoutService } from '../services/finance-payout.service';
import { OrderSettlementService } from '../services/order-settlement.service';
import { FinanceReportService } from '../services/finance-report.service';

/** Finance HTTP surface (Sprint 10, finance.md). Thin controllers only. */
@ApiTags('finance')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly transactions: FinanceTransactionService,
    private readonly payouts: FinancePayoutService,
    private readonly settlements: OrderSettlementService,
    private readonly reports: FinanceReportService,
  ) {}

  // ---- transactions ------------------------------------------------------

  @Get('transactions')
  @ApiOperation({ summary: '收支流水列表' })
  @ApiOkPagedEnvelope(FinanceTransactionDto)
  async listTransactions(@Query() query: FinanceTransactionListQueryDto) {
    const result = await this.transactions.list(
      {
        keyword: query.keyword,
        direction: query.direction,
        category: query.category,
        storeId: query.storeId,
        supplierId: query.supplierId,
        orderId: query.orderId,
        purchaseOrderId: query.purchaseOrderId,
        payoutId: query.payoutId,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: query.to === undefined ? undefined : new Date(query.to),
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(result.items, result.meta);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: '收支流水详情' })
  @ApiOkEnvelope(FinanceTransactionDto)
  async getTransaction(@Param('id') id: string) {
    return ok(await this.transactions.getDetail(id));
  }

  @Post('transactions')
  @ApiOperation({ summary: '登记收支流水（追加型，不可修改；错账用冲正）' })
  @ApiOkEnvelope(FinanceTransactionDto)
  async createTransaction(
    @Body() body: CreateFinanceTransactionRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok(
      await this.transactions.create(
        {
          direction: body.direction as 'INCOME' | 'EXPENSE',
          category: body.category as never,
          amount: body.amount,
          currency: body.currency,
          occurredAt: body.occurredAt === undefined ? undefined : new Date(body.occurredAt),
          storeId: body.storeId,
          supplierId: body.supplierId,
          orderId: body.orderId,
          purchaseOrderId: body.purchaseOrderId,
          remark: body.remark,
        },
        operator,
      ),
    );
  }

  @Post('transactions/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '冲正流水（生成方向相反的成对凭证）' })
  @ApiOkEnvelope(FinanceTransactionDto)
  async reverseTransaction(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok(await this.transactions.reverse(id, operator));
  }

  // ---- payouts -----------------------------------------------------------

  @Get('payouts')
  @ApiOperation({ summary: '平台回款单列表' })
  @ApiOkPagedEnvelope(FinancePayoutDto)
  async listPayouts(@Query() query: FinancePayoutListQueryDto) {
    const result = await this.payouts.list(
      { keyword: query.keyword, storeId: query.storeId, status: query.status },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(result.items, result.meta);
  }

  @Get('payouts/:id')
  @ApiOperation({ summary: '平台回款单详情' })
  @ApiOkEnvelope(FinancePayoutDto)
  async getPayout(@Param('id') id: string) {
    return ok(await this.payouts.getDetail(id));
  }

  @Get('payouts/:id/preview')
  @ApiOperation({ summary: '回款对账预览（应计收入 vs 打款金额，人工判断）' })
  @ApiOkEnvelope(FinancePayoutPreviewDto)
  async previewPayout(@Param('id') id: string) {
    return ok(await this.payouts.preview(id));
  }

  @Post('payouts')
  @ApiOperation({ summary: '登记平台回款单（DRAFT）' })
  @ApiOkEnvelope(FinancePayoutDto)
  async createPayout(
    @Body() body: CreateFinancePayoutRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok(
      await this.payouts.create(
        {
          storeId: body.storeId,
          periodStart: new Date(body.periodStart),
          periodEnd: new Date(body.periodEnd),
          amount: body.amount,
          currency: body.currency,
          remark: body.remark,
        },
        operator,
      ),
    );
  }

  @Post('payouts/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '确认回款（自动生成销售收入流水，幂等）' })
  @ApiOkEnvelope(FinancePayoutDto)
  async confirmPayout(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok(await this.payouts.confirm(id, operator));
  }

  @Post('payouts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消回款（仅 DRAFT；确认后错账走冲正）' })
  @ApiOkEnvelope(FinancePayoutDto)
  async cancelPayout(@Param('id') id: string, @CurrentOperator() operator: OperatorContext) {
    return ok(await this.payouts.cancel(id, operator));
  }

  // ---- settlements -------------------------------------------------------

  @Get('settlements')
  @ApiOperation({ summary: '订单结算列表（收入/成本/毛利快照）' })
  @ApiOkPagedEnvelope(OrderSettlementDto)
  async listSettlements(@Query() query: OrderSettlementListQueryDto) {
    const result = await this.settlements.list(
      {
        keyword: query.keyword,
        storeId: query.storeId,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: query.to === undefined ? undefined : new Date(query.to),
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return okPage(result.items, result.meta);
  }

  @Get('settlements/:id')
  @ApiOperation({ summary: '订单结算详情（含行快照）' })
  @ApiOkEnvelope(OrderSettlementDetailDto)
  async getSettlement(@Param('id') id: string) {
    return ok(await this.settlements.getDetail(id));
  }

  @Post('settlements/generate')
  @ApiOperation({ summary: '生成单笔订单结算（仅已发货订单，幂等）' })
  @ApiOkEnvelope(OrderSettlementDto)
  async generateSettlement(
    @Body() body: GenerateOrderSettlementRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ) {
    return ok(await this.settlements.generateForOrder(body.orderId, operator));
  }

  @Post('settlements/generate-missing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '批量生成全部缺失结算（已发货未结算订单）' })
  @ApiOkEnvelope(SettlementGenerateMissingResultDto)
  async generateMissingSettlements(@CurrentOperator() operator: OperatorContext) {
    return ok(await this.settlements.generateMissing(operator));
  }

  @Patch('settlements/:id/fees')
  @ApiOperation({ summary: '修改结算费用（物流/其他，重算毛利；行快照不可改）' })
  @ApiOkEnvelope(OrderSettlementDto)
  async updateSettlementFees(
    @Param('id') id: string,
    @Body() body: UpdateOrderSettlementFeesRequestDto,
  ) {
    return ok(await this.settlements.updateFees(id, body));
  }

  // ---- payables & summary ------------------------------------------------

  @Get('payables')
  @ApiOperation({ summary: '采购应付列表（应付/已付/未付均为派生值）' })
  @ApiOkPagedEnvelope(PayableRowDto)
  async listPayables(@Query() query: PayablesQueryDto) {
    const result = await this.reports.listPayables({
      keyword: query.keyword,
      paymentState: query.paymentState,
      page: query.page,
      pageSize: query.pageSize,
    });
    return okPage(result.items, result.meta);
  }

  @Get('summary')
  @ApiOperation({ summary: '财务汇总（期间收支/毛利/应付/回款，全部派生）' })
  @ApiOkEnvelope(FinanceSummaryResponseDto)
  async summary(@Query() query: FinanceSummaryQueryDto) {
    return ok(
      await this.reports.summary(
        query.from === undefined ? undefined : new Date(query.from),
        query.to === undefined ? undefined : new Date(query.to),
      ),
    );
  }
}
