/**
 * QAPINDA — Shared domain layer.
 *
 * This folder is the single source of truth for the rules of the business. It
 * is copied verbatim into `src/shared` (the web app) and `functions/src/shared`
 * (the server) by `npm run sync:shared`, because Firebase only uploads what
 * lives under `functions/`.
 *
 * Never edit the copies. Edit here, then run the sync.
 */

export * from './enums';
export * from './models';
export * from './collections';
export * from './regions';
export * from './errors';
export * from './permissions';
export * from './orderState';
export * from './geo';
export * from './courier';
export * from './supportState';
export * from './supportTemplates';
export * from './feedback';
export * from './faq';
export * from './profanity';
export * from './pricing';
export * from './phone';
export * from './payments';
export * from './bank';
export * from './categories';
export * from './upsell';
export * from './reset';
export * from './maintenance';
