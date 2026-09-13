import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { CostEstimator } from './cost-estimator';
import { FakeScoringProvider } from './fake-scoring.provider';
import { OpenAiScoringProvider } from './openai-scoring.provider';
import { SCORING_PROVIDER, type ScoringProvider } from './scoring-provider';

@Module({
  providers: [
    CostEstimator,
    {
      provide: SCORING_PROVIDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig): ScoringProvider =>
        config.useRealScoringProvider
          ? new OpenAiScoringProvider(config)
          : new FakeScoringProvider(),
    },
  ],
  exports: [SCORING_PROVIDER, CostEstimator],
})
export class LlmModule {}
