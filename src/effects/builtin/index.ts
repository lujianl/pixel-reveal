/**
 * Built-in effects, in the order they should be presented in a UI.
 * Importing this module does not register anything — `src/effects/index.ts`
 * handles registration — so you can cherry-pick individual effects.
 */

import type { EffectDefinition } from '../../types.js';
import { bloom } from './bloom.js';
import { diagonal } from './diagonal.js';
import { expand } from './expand.js';
import { luminance } from './luminance.js';
import { rain } from './rain.js';
import { ripple } from './ripple.js';
import { scatter } from './scatter.js';
import { spiral } from './spiral.js';
import { square } from './square.js';

export { bloom, diagonal, expand, luminance, rain, ripple, scatter, spiral, square };

export const builtinEffects: readonly EffectDefinition[] = [
  square,
  scatter,
  diagonal,
  rain,
  luminance,
  expand,
  spiral,
  ripple,
  bloom,
];
