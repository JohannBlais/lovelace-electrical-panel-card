import { en, type Translations } from './en.js';
import { fr } from './fr.js';

const DICTS: Record<string, Translations> = { en, fr };
const DEFAULT_LANG = 'en';

/**
 * Pick the best dictionary for the given Home Assistant locale.
 * Falls back to English if the language is unknown or undefined.
 * Accepts BCP 47 codes (e.g. 'fr', 'fr-BE', 'en-US') and matches on the
 * primary subtag.
 */
export function pickLanguage(haLang?: string | null): string {
  if (!haLang) return DEFAULT_LANG;
  const primary = haLang.toLowerCase().split('-')[0];
  return primary in DICTS ? primary : DEFAULT_LANG;
}

export function getDict(lang: string): Translations {
  return DICTS[lang] ?? en;
}

export function format(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

export type { Translations };
