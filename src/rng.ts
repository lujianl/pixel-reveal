/**
 * Deterministic PRNG (mulberry32).
 *
 * Randomised effects (scatter, rain delays, bloom seeds) draw from this instead
 * of `Math.random`, so the same input + options always produce the same file.
 */

export type Random = () => number;

export function createRandom(seed: number): Random {
  let a = seed >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return function random(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle driven by a seeded `Random`. */
export function shuffled<T>(items: readonly T[], random: Random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
