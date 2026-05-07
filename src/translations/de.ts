import type { Translations } from './en.js';

export const de: Translations = {
  card: {
    total: 'Gesamt',
    grid: 'Netz',
  },
  confirm: {
    toggle: 'Möchten Sie „{name}" wirklich umschalten?',
  },
  dialog: {
    group_title: 'FI-Schalter {id}',
    circuit_title: 'Stromkreis {id}',
    close: 'Schließen',
    more_info: 'Mehr Info',

    fields: {
      label: 'Bezeichnung',
      type: 'Typ',
      phases: 'Phasen',
      rating: 'Bemessungsstrom',
      sensitivity: 'Empfindlichkeit',
      poles: 'Pole',
      class: 'Klasse',
      power: 'Leistung',
      cross_section: 'Querschnitt',
      conductors: 'Leiter',
      points: 'Punkte',
    },
  },
};
