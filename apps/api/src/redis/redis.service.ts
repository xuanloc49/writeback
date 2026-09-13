import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../config/app-config';

/** Thin ioredis wrapper (rate-limit windows + readiness ping). */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: AppConfig) {
    this.client = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  /** Increments `key`, setting `ttlSeconds` on first hit; returns the new count. */
  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return count;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
