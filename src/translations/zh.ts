import type { Translations } from './en.js';

// Simplified Chinese (zh-Hans / zh-CN). Primary subtag matching means this
// dictionary is also picked for users with `zh-Hant` / `zh-TW` — characters
// like 总计 / 电网 differ from Traditional usage; users wanting Traditional
// can supply their own dictionary or override via `language` config.
export const zh: Translations = {
  card: {
    total: '总计',
    grid: '电网',
  },
  confirm: {
    toggle: '确定要切换"{name}"吗？',
  },
};
