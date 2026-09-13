import { ONBOARDING } from '@writeback/shared';
import { z } from 'zod';

export const acceptTosSchema = z
  .object({ accept: z.literal(true), ageAttested: z.literal(true) })
  .strict();
export type AcceptTosBody = z.infer<typeof acceptTosSchema>;

export const onboardingSchema = z
  .object({
    topicIds: z
      .array(z.string().uuid())
      .min(ONBOARDING.MIN_TOPICS)
      .max(ONBOARDING.MAX_TOPICS)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'topicIds must be distinct' }),
  })
  .strict();
export type OnboardingBody = z.infer<typeof onboardingSchema>;
