import { Global, Module } from '@nestjs/common';
import { CLOCK, SystemClock } from './clock';
import { MathRandom, RANDOM } from './random';

@Global()
@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: RANDOM, useClass: MathRandom },
  ],
  exports: [CLOCK, RANDOM],
})
export class CommonModule {}
