import { en, type Translations } from './en.js';
import { fr } from './fr.js';
import { de } from './de.js';
import { es } from './es.js';
import { it } from './it.js';
import { pt } from './pt.js';
import { nl } from './nl.js';
import { pl } from './pl.js';
import { sv } from './sv.js';
import { da } from './da.js';
import { nb } from './nb.js';
import { fi } from './fi.js';
import { cs } from './cs.js';
import { ru } from './ru.js';
import { uk } from './uk.js';
import { ja } from './ja.js';
import { zh } from './zh.js';
import { ko } from './ko.js';

const DICTS: Record<string, Translations> = {
  en,
  fr,
  de,
  es,
  it,
  pt,
  nl,
  pl,
  sv,
  da,
  nb,
  // Legacy / generic Norwegian code maps to Bokmål.
  no: nb,
  fi,
  cs,
  ru,
  uk,
  ja,
  zh,
  ko,
};
const DEFAULT_LANG = 'en';

/**
 * Pick the best dictionary for the given Home Assistant locale.
 * Falls back to English if the language is unknown or undefined.
 * Accepts BCP 47 codes (e.g. 'fr', 'fr-BE', 'en-US') and matches on the
 * primary subtag (so 'pt-BR' → 'pt', 'zh-Hans' → 'zh', etc.).
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

/** Sorted list of supported language codes (handy for docs / UI). */
export const SUPPORTED_LANGUAGES: readonly string[] = Object.keys(DICTS).sort();

export type { Translations };
