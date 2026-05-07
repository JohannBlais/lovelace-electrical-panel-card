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
  dialog: {
    group_title: '漏电保护器 {id}',
    circuit_title: '回路 {id}',
    close: '关闭',
    more_info: '更多信息',

    fields: {
      label: '标签',
      type: '类型',
      phases: '相',
      rating: '额定电流',
      sensitivity: '灵敏度',
      poles: '极数',
      class: '等级',
      power: '功率',
      cross_section: '截面',
      conductors: '导体',
      points: '点数',
      floor: '楼层',
      critical: '关键',
    },
  },
};
