/**
 * Minimal localisation helpers.
 *
 * The library only needs to resolve `LocalizedText` values (effect labels,
 * descriptions). UI strings live with the UI.
 */

import type { EffectDefinition, LocalizedText } from '../types.js';

export const FALLBACK_LOCALE = 'en';

/** Resolve a `LocalizedText` for a locale, falling back to English then any value. */
export function translate(
  text: LocalizedText | undefined,
  locale: string = FALLBACK_LOCALE,
): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  const direct = text[locale];
  if (typeof direct === 'string') return direct;
  // Try a language-only match, e.g. 'zh-Hans-CN' -> 'zh'.
  const language = locale.split('-')[0];
  if (language && typeof text[language] === 'string') return text[language]!;
  const fallback = text[FALLBACK_LOCALE];
  if (typeof fallback === 'string') return fallback;
  const first = Object.values(text)[0];
  return typeof first === 'string' ? first : '';
}

export interface EffectText {
  name: string;
  description: string;
}

/** Resolved display strings for an effect. */
export function effectText(effect: EffectDefinition, locale?: string): EffectText {
  return {
    name: translate(effect.label, locale) || effect.name,
    description: translate(effect.description, locale),
  };
}

/** Best-effort locale from the environment, e.g. `'en'`, `'zh'`. */
export function detectLocale(): string {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    return navigator.language;
  }
  return FALLBACK_LOCALE;
}
