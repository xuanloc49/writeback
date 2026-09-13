/** Source of randomness; `next()` returns a float in [0, 1). */
export interface Random {
  next(): number;
}

export const RANDOM = Symbol('RANDOM');

export class MathRandom implements Random {
  next(): number {
    return Math.random();
  }
}
