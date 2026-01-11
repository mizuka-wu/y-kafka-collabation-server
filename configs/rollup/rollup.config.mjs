import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
// import commonjs from '@rollup/plugin-commonjs';

const shouldIgnoreCircular = (warning) => {
  if (warning.code !== 'CIRCULAR_DEPENDENCY') {
    return false;
  }

  if (warning.ids?.some((id) => id.includes('@y/y'))) {
    return true;
  }

  return warning.importer?.includes('@y/y') ?? false;
};

/**
 * @param {import('rollup').RollupOptions} options
 * @returns {import('rollup').RollupOptions}
 */
export const config = (options = {}) => {
  const { onwarn, ...rest } = options;

  return {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/index.mjs',
        format: 'es',
        sourcemap: true,
      },
    ],
    onwarn(warning, warn) {
      if (shouldIgnoreCircular(warning)) {
        return;
      }

      if (typeof onwarn === 'function') {
        onwarn(warning, warn);
        return;
      }

      warn(warning);
    },
    plugins: [
      resolve(
        {
          preferBuiltins: true
        }
      ),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: true,
        declarationDir: 'dist',
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'bundler',
        },
      }),
    ],
    ...rest,
  };
};
