export const en = {
  card: {
    total: 'Total',
    grid: 'Grid',
  },
  confirm: {
    // {name} is replaced with the zone label at runtime.
    toggle: 'Are you sure you want to toggle "{name}"?',
  },
  dialog: {
    // {id} is replaced with the group / circuit identifier at runtime.
    group_title: 'RCD {id}',
    circuit_title: 'Circuit {id}',
    close: 'Close',
    more_info: 'More info',

    fields: {
      label: 'Label',
      type: 'Type',
      phases: 'Phases',
      rating: 'Rating',
      sensitivity: 'Sensitivity',
      poles: 'Poles',
      class: 'Class',
      power: 'Power',
      cross_section: 'Cross-section',
      conductors: 'Conductors',
      points: 'Points',
    },
  },
};

export type Translations = typeof en;
