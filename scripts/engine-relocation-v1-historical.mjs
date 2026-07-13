/**
 * Named boundary for immutable v1 relocation evidence.
 *
 * The compatibility exports are historical-only: they replay committed fixtures
 * and reject all live topology operations after the v2 migration.
 */
export * from './engine-relocation-manifest.mjs';
