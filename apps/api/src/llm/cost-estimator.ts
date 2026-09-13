import { Injectable, Logger } from '@nestjs/common';
import { businessDayRange } from '@writeback/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const TOKENS_PER_PRICE_UNIT = 1_000_000;

/** Design §11 cost model + daily budget warning. */
@Injectable()
export class CostEstimator {
  private readonly logger = new Logger(CostEstimator.name);

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  estimateUsd(inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens / TOKENS_PER_PRICE_UNIT) * this.config.openaiPriceInPerMillion +
      (outputTokens / TOKENS_PER_PRICE_UNIT) * this.config.openaiPriceOutPerMillion
    );
  }

  /** Logs `ai_budget_exceeded` when today's summed cost passes `DAILY_AI_BUDGET_USD`. */
  async checkDailyBudget(now: Date, tx: Tx = this.prisma): Promise<void> {
    const { start, end } = businessDayRange(now, this.config.businessTz);
    const aggregate = await tx.rewriteAttempt.aggregate({
      _sum: { costEstimateUsd: true },
      where: { scoredAt: { gte: start, lt: end } },
    });
    const total = Number(aggregate._sum.costEstimateUsd ?? 0);
    if (total > this.config.dailyAiBudgetUsd) {
      this.logger.warn(
        JSON.stringify({
          event: 'ai_budget_exceeded',
          total_cost_usd: total,
          budget_usd: this.config.dailyAiBudgetUsd,
        }),
      );
    }
  }
}
