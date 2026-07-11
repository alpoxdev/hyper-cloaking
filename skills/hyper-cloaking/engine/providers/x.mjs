// X provider metadata re-export shim. The provider directory at ./x/ carries
// the full metadata + action stack; this flat module stays import-compatible
// for callers that only need the metadata-only template (e.g. the registry).
export { xProvider } from './x/metadata.mjs';
