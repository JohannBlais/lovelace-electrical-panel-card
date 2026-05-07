import type { Translations } from './en.js';

export const uk: Translations = {
  card: {
    total: 'Усього',
    grid: 'Мережа',
  },
  confirm: {
    toggle: 'Ви впевнені, що хочете перемкнути «{name}»?',
  },
  dialog: {
    group_title: 'ПЗВ {id}',
    circuit_title: 'Коло {id}',
    close: 'Закрити',
    more_info: 'Докладніше',

    fields: {
      label: 'Мітка',
      type: 'Тип',
      phases: 'Фази',
      rating: 'Номінальний струм',
      sensitivity: 'Чутливість',
      poles: 'Полюси',
      class: 'Клас',
      power: 'Потужність',
      cross_section: 'Переріз',
      conductors: 'Жили',
      points: 'Точки',
    },
  },
};
