import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/** Keys that must never reach analytics (design §7.7). */
const FORBIDDEN_PROP_KEYS = new Set(['user_en', 'sample_en', 'email', 'userEn', 'sampleEn']);

export type AnalyticsProps = Record<string, string | number | boolean | null>;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async track(
    name: string,
    userId: string | null,
    props: AnalyticsProps,
    requestId: string | null,
    tx: Tx = this.prisma,
  ): Promise<void> {
    const offending = Object.keys(props).filter((key) => FORBIDDEN_PROP_KEYS.has(key));
    if (offending.length > 0) {
      throw new Error(`analytics props contain forbidden keys: ${offending.join(', ')}`);
    }
    await tx.analyticsEvent.create({
      data: { name, userId, props: props as Prisma.InputJsonObject, requestId },
    });
  }
}
