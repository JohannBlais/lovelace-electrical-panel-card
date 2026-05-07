import type { Translations } from './en.js';

export const ru: Translations = {
  card: {
    total: 'Всего',
    grid: 'Сеть',
  },
  confirm: {
    toggle: 'Вы уверены, что хотите переключить «{name}»?',
  },
  dialog: {
    group_title: 'УЗО {id}',
    circuit_title: 'Цепь {id}',
    close: 'Закрыть',
    fields: {
      label: 'Метка',
      type: 'Тип',
      phases: 'Фазы',
      rating: 'Номинальный ток',
      sensitivity: 'Чувствительность',
      poles: 'Полюса',
      class: 'Класс',
      power: 'Мощность',
      cross_section: 'Сечение',
      conductors: 'Жилы',
      points: 'Точки',
    },
  },
};
