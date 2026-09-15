import { createRequire } from 'module';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import nodeResolve from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const env = process.env.NODE_ENV;
const extensions = ['.js', '.jsx', '.ts', '.tsx'];

// 控件库与引擎都必须是 peer：同一个页面上多张画布要共享同一个引擎实例池，
// 而且控件库自己 peer 依赖 ice-render —— 打进来会出两份引擎实例（typeId 注册表错位）。
// UMD 全局名对齐各自的产物：ice-web-components 用 ICEWEB，ice-render 用 ICE。
const external = ['ice-web-components', 'ice-render'];
const globals = { 'ice-web-components': 'ICEWEB', 'ice-render': 'ICE' };

const plugins = [
  json(),
  nodeResolve({ extensions }),
  commonjs(),
  babel({ extensions, babelHelpers: 'bundled', include: ['src/**/*'] }),
  env === 'production' && terser({ keep_classnames: true, keep_fnames: true }),
].filter(Boolean);

export default [
  {
    input: 'src/index.ts',
    external,
    output: { file: pkg.main, format: 'cjs', globals },
    plugins,
  },
  {
    input: 'src/index.ts',
    external,
    output: { file: pkg.module, format: 'esm', globals },
    plugins,
  },
  {
    input: 'src/index.ts',
    external,
    output: { name: 'ICEWEBDSL', file: pkg.browser, format: 'umd', globals },
    plugins,
  },
];
