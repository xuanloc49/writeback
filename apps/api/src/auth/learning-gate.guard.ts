import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { appError } from '../common/app-error';
import type { AppRequest } from '../common/request-context';
import { LearningGateService } from './learning-gate.service';

/** Design §6.1 gates for learning APIs; requires `SessionGuard` to run first. */
@Injectable()
export class LearningGateGuard implements CanActivate {
  constructor(private readonly gate: LearningGateService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (req.principal === undefined) {
      throw appError('UNAUTHENTICATED');
    }
    const result = await this.gate.evaluate(req.principal.user);
    if (result.blocked && result.reason !== null) {
      throw appError(result.reason);
    }
    return true;
  }
}
