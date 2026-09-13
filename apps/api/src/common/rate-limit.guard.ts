import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfig } from '../config/app-config';
import { RedisService } from '../redis/redis.service';
import { appError } from './app-error';
import { CLOCK, type Clock } from './clock';
import type { AppRequest } from './request-context';

export type RateLimitName = 'start' | 'submit';
const RATE_LIMIT_KEY = 'rate_limit_name';
const WINDOW_SECONDS = 60;
const MS_PER_SECOND = 1000;

export const RateLimit = (name: RateLimitName): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, name);

/** Redis INCR+EXPIRE per-minute window keyed `rl:{name}:{userId}:{windowStart}` (design §5.4). */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const name = this.reflector.get<RateLimitName | undefined>(RATE_LIMIT_KEY, context.getHandler());
    if (name === undefined) {
      return true;
    }
    const req = context.switchToHttp().getRequest<AppRequest>();
    const userId = req.principal?.user.id;
    if (userId === undefined) {
      throw appError('UNAUTHENTICATED');
    }
    const windowStart = Math.floor(this.clock.now().getTime() / MS_PER_SECOND / WINDOW_SECONDS);
    const count = await this.redis.incrementWithTtl(
      `rl:${name}:${userId}:${windowStart}`,
      WINDOW_SECONDS,
    );
    const limit = name === 'start' ? this.config.rateLimitStartPerMin : this.config.rateLimitSubmitPerMin;
    if (count > limit) {
      throw appError('RATE_LIMITED');
    }
    return true;
  }
}
