import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { LLM, scoringOutputSchema } from '@writeback/shared';
import OpenAI, { APIConnectionTimeoutError, APIError } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { AppConfig } from '../config/app-config';
import {
  ScoringProviderError,
  type ScoringInput,
  type ScoringProvider,
  type ScoringResult,
} from './scoring-provider';

const SCHEMA_NAME = 'scoring_output';
const SERVER_ERROR_MIN_STATUS = 500;

/** OpenAI structured-output scoring (design §11): one call, strict schema, no SDK retries. */
@Injectable()
export class OpenAiScoringProvider implements ScoringProvider {
  private readonly client: OpenAI;
  private readonly systemPrompt: string;

  constructor(private readonly config: AppConfig) {
    if (config.openaiApiKey === null) {
      throw new Error('OPENAI_API_KEY is required for OpenAiScoringProvider');
    }
    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
      timeout: LLM.TIMEOUT_MS,
      maxRetries: 0,
    });
    this.systemPrompt = readFileSync(
      join(__dirname, 'prompts', `${config.scoringPromptVersion}.txt`),
      'utf8',
    );
  }

  async score(input: ScoringInput): Promise<ScoringResult> {
    const startedAt = Date.now();
    try {
      const completion = await this.client.chat.completions.create({
        model: this.config.openaiModel,
        temperature: 0,
        max_tokens: this.config.openaiMaxOutputTokens,
        response_format: zodResponseFormat(scoringOutputSchema, SCHEMA_NAME),
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: buildUserMessage(input) },
        ],
      });
      const content = completion.choices[0]?.message.content ?? '';
      return {
        raw: parseJsonOrNull(content),
        model: completion.model,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      if (error instanceof APIConnectionTimeoutError) {
        throw new ScoringProviderError('timeout', 'OpenAI request timed out');
      }
      if (error instanceof APIError && (error.status ?? 0) >= SERVER_ERROR_MIN_STATUS) {
        throw new ScoringProviderError('provider_5xx', `OpenAI responded ${error.status}`);
      }
      throw error;
    }
  }
}

function buildUserMessage(input: ScoringInput): string {
  const words = input.requiredWords
    .map((word) => `- ${word.headword}${word.pos ? ` (${word.pos})` : ''}: ${word.senseVi}`)
    .join('\n');
  return [
    `TEXT_VI:\n${input.textVi}`,
    `REQUIRED_WORDS:\n${words}`,
    `SAMPLE_EN (reference only):\n${input.sampleEn}`,
    `<<<USER_EN_BEGIN>>>\n${input.userEn}\n<<<USER_EN_END>>>`,
  ].join('\n\n');
}

function parseJsonOrNull(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}
