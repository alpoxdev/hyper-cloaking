// Naver provider metadata-only shim. The registry imports this module without
// loading actions; the full action stack lives under ./naver/.
export { naverProvider } from './naver/metadata.mjs';
