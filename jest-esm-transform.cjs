/**
 * Jest transformer: compile TypeScript to ESM via esbuild (already a server dep).
 * Jest's VM loader does not honor Node `--import tsx` for source files.
 */
const { transformSync } = require('esbuild');

module.exports = {
  process(sourceText, sourcePath) {
    const result = transformSync(sourceText, {
      loader: sourcePath.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      target: 'node20',
      sourcemap: 'inline',
      sourcefile: sourcePath,
    });
    return { code: result.code };
  },
};
