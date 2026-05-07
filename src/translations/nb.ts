import type { Translations } from './en.js';

// Norwegian Bokmål — also registered under `no` for legacy locale codes.
export const nb: Translations = {
  card: {
    total: 'Total',
    grid: 'Nett',
  },
  confirm: {
    toggle: 'Er du sikker på at du vil veksle «{name}»?',
  },
  dialog: {
    group_title: 'Jordfeilbryter {id}',
    circuit_title: 'Krets {id}',
    close: 'Lukk',
    fields: {
      label: 'Etikett',
      type: 'Type',
      phases: 'Faser',
      rating: 'Merkestrøm',
      sensitivity: 'Følsomhet',
      poles: 'Poler',
      class: 'Klasse',
      power: 'Effekt',
      cross_section: 'Tverrsnitt',
      conductors: 'Ledere',
      points: 'Punkter',
    },
  },
};
