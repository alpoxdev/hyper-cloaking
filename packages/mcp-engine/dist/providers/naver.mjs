/**
 * Public Naver provider entry point.
 * Exposes registry metadata without eagerly loading action implementations.
 * @module providers/naver
 */

// Naver provider metadata-only shim. The registry imports this module without
// loading actions; the full action stack lives under ./naver/.
export { naverProvider } from './naver/metadata.mjs';
