import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { appError } from './app-error';

/** Parses a request body with a zod schema; failures become `VALIDATION` with issue details. */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw appError('VALIDATION', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
