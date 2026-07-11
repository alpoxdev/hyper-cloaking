/**
 * Compatibility entry point for the X provider metadata.
 *
 * The action stack lives under `./x/`; this module preserves the flat import
 * path used by the provider registry.
 */
export { xProvider } from './x/metadata.mjs';
