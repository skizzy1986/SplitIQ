// Runtime copy of the identifier Vite bakes in as __APP_BUILD__ (#773).
/* global __APP_BUILD__ */

export const APP_BUILD =
  typeof __APP_BUILD__ === 'string' && __APP_BUILD__ ? __APP_BUILD__ : 'dev';
