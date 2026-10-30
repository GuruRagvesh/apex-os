/**
 * Jest transformer for a repository whose NestJS packages are ES modules.
 *
 * NestJS 12 publishes ES modules only, while these suites run as CommonJS.
 * Package files under node_modules/@nestjs are transpiled to CommonJS here
 * (with esModuleInterop, because they default-import CommonJS packages, and
 * with `import.meta.url` swapped for the file's own URL). Everything else goes
 * through ts-jest with the project's own tsconfig, unchanged.
 */
const ts = require('typescript');
const { TsJestTransformer } = require('ts-jest');

const NEST_PACKAGE = /[\\/]node_modules[\\/]@nestjs[\\/].*\.js$/;

class NestEsmTransformer extends TsJestTransformer {
  getCacheKey(source, filePath, options) {
    const key = super.getCacheKey(source, filePath, options);
    return NEST_PACKAGE.test(filePath) ? `nest-esm:${key}` : key;
  }
  process(source, filePath, options) {
    if (!NEST_PACKAGE.test(filePath)) return super.process(source, filePath, options);
    const patched = source
      // CommonJS already provides `require`, relative to the file.
      .replace(/const require = createRequire\(import\.meta\.url\);?/g, '')
      .replace(/import\.meta\.url/g, "require('url').pathToFileURL(__filename).href");
    const { outputText } = ts.transpileModule(patched, {
      fileName: filePath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
        esModuleInterop: true,
        allowJs: true,
      },
    });
    return { code: outputText };
  }
}

module.exports = {
  createTransformer: (config) => new NestEsmTransformer(config),
};
