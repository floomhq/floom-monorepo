/**
 * Public detect entry point.
 *
 * Imports the main rules module and re-exports a clean API:
 *   import { detect } from './detect';
 *   const result = detect(repoSnapshot);
 */
export { detect } from './rules.js';
export type { DetectResult, RepoSnapshot } from './rules.js';
export type { Runtime } from './types.js';
export type { FileEntry } from './workdir.js';
export { detectWorkdir } from './workdir.js';
export { detectPnpm } from './pnpm-detect.js';
export { detectUv } from './uv-detect.js';
export { detectSrcLayout } from './src-layout.js';
export { detectPhpExtensions, EXT_TO_APT } from './php-ext.js';
