import { describe, expect, it } from 'vitest';

import { builtinEffects } from '../src/effects/builtin/index.js';
import { detectLocale, effectText, translate } from '../src/i18n/index.js';

describe('translate', () => {
  it('passes plain strings through', () => {
    expect(translate('hello')).toBe('hello');
  });

  it('prefers an exact locale match', () => {
    expect(translate({ en: 'Melt', zh: '像素融化' }, 'zh')).toBe('像素融化');
  });

  it('falls back to the base language', () => {
    expect(translate({ en: 'Melt', zh: '像素融化' }, 'zh-Hans-CN')).toBe('像素融化');
  });

  it('falls back to English, then to any value', () => {
    expect(translate({ en: 'Melt', de: 'Schmelzen' }, 'fr')).toBe('Melt');
    expect(translate({ de: 'Schmelzen' }, 'fr')).toBe('Schmelzen');
  });

  it('returns an empty string for missing text', () => {
    expect(translate(undefined)).toBe('');
    expect(translate({})).toBe('');
  });
});

describe('effectText', () => {
  it('resolves the built-in labels in English and Chinese', () => {
    const square = builtinEffects.find((effect) => effect.name === 'square')!;
    expect(effectText(square, 'en').name).toBe('Melt');
    expect(effectText(square, 'zh').name).toBe('像素融化');
    expect(effectText(square, 'en').description).toBe('Blocks sharpen out of a soft blur');
  });

  it('falls back to the effect name when unlabelled', () => {
    const text = effectText({ name: 'custom', create: () => () => {} }, 'en');
    expect(text.name).toBe('custom');
    expect(text.description).toBe('');
  });

  it('has both locales for every built-in effect', () => {
    for (const effect of builtinEffects) {
      expect(effectText(effect, 'en').name, effect.name).not.toBe(effect.name);
      expect(effectText(effect, 'zh').name, effect.name).not.toBe('');
      expect(effectText(effect, 'zh-Hant').name, effect.name).not.toBe('');
    }
  });
});

describe('detectLocale', () => {
  it('always returns a non-empty string', () => {
    expect(typeof detectLocale()).toBe('string');
    expect(detectLocale().length).toBeGreaterThan(0);
  });
});
