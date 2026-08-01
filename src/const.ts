// All four values are rewritten by rollup.config.mjs before this file is
// compiled.
//
// CARD_VERSION is injected from package.json on every build — the placeholder
// below never ships, and editing it achieves nothing. package.json is where
// the version lives.
//
// The first three are additionally suffixed when DEV_TAG is set, so a dev build
// can be registered in Home Assistant alongside the released one without the
// two fighting over the same custom-element name.
export const CARD_TAG = 'electrical-panel-card';
export const EDITOR_TAG = 'electrical-panel-card-editor';
export const CARD_NAME = 'Electrical Panel Card';
export const CARD_VERSION = '0.0.0-unbuilt';
