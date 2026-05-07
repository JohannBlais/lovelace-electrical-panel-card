import type { Translations } from './en.js';

export const ko: Translations = {
  card: {
    total: '합계',
    grid: '전력망',
  },
  confirm: {
    toggle: '"{name}"을(를) 전환하시겠습니까?',
  },
  dialog: {
    group_title: '누전차단기 {id}',
    circuit_title: '회로 {id}',
    close: '닫기',
    more_info: '자세히',

    fields: {
      label: '라벨',
      type: '유형',
      phases: '상',
      rating: '정격전류',
      sensitivity: '감도',
      poles: '극수',
      class: '등급',
      power: '전력',
      cross_section: '단면적',
      conductors: '도체',
      points: '포인트',
      floor: '층',
      critical: '중요',
    },
  },
};
