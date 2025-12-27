import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

/**
 * @param {import('rollup').RollupOptions} options
 * @returns {import('rollup').RollupOptions}
 */
export const config = (options) => {
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
    plugins: [
      resolve(
        {
          preferBuiltins: true
        }
      ),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: true,
        declarationDir: 'dist',
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'node',
        },
      }),
    ],
    ...options,
  };
};
