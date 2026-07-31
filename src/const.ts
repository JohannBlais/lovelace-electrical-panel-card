// These four values are rewritten at build time when DEV_TAG is set, so a dev
// build can be registered in Home Assistant alongside the released one without
// the two fighting over the same custom-element name. See rollup.config.mjs.
export const CARD_TAG = 'electrical-panel-card';
export const EDITOR_TAG = 'electrical-panel-card-editor';
export const CARD_NAME = 'Electrical Panel Card';
export const CARD_VERSION = '0.17.5';
