#!/usr/bin/env node
/**
 * 直接问库：这 11 个候选控件，`getFormValue()` 到底返回什么、能不能往返？
 *
 * 为什么不在脚本里读文档推断：文档只能告诉我"有哪些方法"，而 `getFormValue` 是
 * `ICEWidget` **基类**实现的 —— 每个控件都有，压根不是判别信号。
 * 「能不能当字段」的真问题是**值能不能经 JSON 往返**，那只有真调一次才知道。
 *
 * 用法：node tools/probe-field-values.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const lib = require(path.resolve(HERE, '../../ice-web-components/dist/index.cjs'));

/** 每个候选的最小构造参数（照各组件自己的 `ICExxxOptions` 给）。 */
const CASES = [
  { name: 'ICEColorPicker', opts: { colors: ['#61D9FB', '#ffffff', '#000000'] } },
  { name: 'ICERate', opts: {} },
  { name: 'ICETimePicker', opts: {} },
  { name: 'ICESegmented', opts: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } },
  { name: 'ICECascader', opts: { options: [{ value: 'zj', label: '浙江', children: [{ value: 'hz', label: '杭州' }] }] } },
  { name: 'ICEAutoComplete', opts: { options: ['alpha', 'beta'] } },
  { name: 'ICEDateRangePicker', opts: {} },
  { name: 'ICETreeSelect', opts: { nodes: [{ key: 'zj', label: '浙江', children: [{ key: 'hz', label: '杭州' }] }] } },
  { name: 'ICETransfer', opts: { targetKeys: ['b'], dataSource: [{ key: 'a', label: '甲' }, { key: 'b', label: '乙' }] } },
  { name: 'ICERadioButton', opts: { label: '选项甲', value: 'a' } },
  { name: 'ICEUpload', opts: {} },
  // 已经在用的，做对照组
  { name: 'ICETextField', opts: { value: 'hi' } },
  { name: 'ICECheckboxGroup', opts: { options: [{ value: 'a', label: 'A' }] } },
];

/** 尝试用几种常见形状设值，看哪种能往返。 */
const CANDIDATE_VALUES = ['x', 3, true, ['a', 'b'], ['2026-09-01', '2026-09-15'], { a: 1 }];

function show(v) {
  if (v === undefined) return 'undefined';
  if (typeof v === 'function') return 'function';
  if (v && typeof v === 'object' && typeof v.length === 'number') return `[${Array.from(v).map((x) => show(x)).join(', ')}]`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

let bad = 0;
for (const { name, opts } of CASES) {
  const Ctor = lib[name];
  if (typeof Ctor !== 'function') {
    console.log(`${name.padEnd(19)} ✗ 不是构造函数`);
    bad++;
    continue;
  }

  let inst;
  try {
    inst = new Ctor(opts);
  } catch (err) {
    console.log(`${name.padEnd(19)} ✗ 构造失败：${err.message}`);
    bad++;
    continue;
  }

  const initial = typeof inst.getFormValue === 'function' ? inst.getFormValue() : '(无 getFormValue)';
  const lines = [`${name.padEnd(19)} 初始 getFormValue() = ${show(initial)}`];

  if (typeof inst.setFormValue === 'function' && typeof inst.getFormValue === 'function') {
    const rode = [];
    for (const v of CANDIDATE_VALUES) {
      try {
        inst.setFormValue(v);
        const back = inst.getFormValue();
        const ok = JSON.stringify(back) === JSON.stringify(v);
        rode.push(`${show(v)}${ok ? '✓' : '→' + show(back)}`);
      } catch (err) {
        rode.push(`${show(v)}✗`);
      }
    }
    lines.push(`${''.padEnd(19)} 往返 setFormValue→getFormValue: ${rode.join('  ')}`);
  }

  console.log(lines.join('\n'));
}

console.log();
console.log(bad ? `${bad} 个有问题` : '全部可构造');
