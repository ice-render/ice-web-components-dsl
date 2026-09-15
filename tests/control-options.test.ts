/**
 * **跨类型不变量：通用键必须到达每一个控件。**
 *
 * 这一条是被一个真实事故逼出来的。给 9 个新类型写 `createControl` 分支时，
 * 我写成了 `...passthrough, width, options…`，**漏了展开 `base`** ——
 * 而 `base` 才是装通用键（`placeholder` / `value` / `width` / `props` 透传）的地方。
 * 结果这 9 个类型的 `placeholder` **全部被静默丢掉**，TypeScript 抓不到：
 * `placeholder` 在所有这些 Options 接口里都是**可选**的。
 *
 * 症状是"级联 / 树选择 / 自动完成的占位文案不显示" —— 只有真去浏览器里看才发现。
 *
 * ## 为什么要拦截构造函数，而不是读控件的字段
 *
 * 试过读 `control.state.placeholder`：18/20 个类型报 `undefined`，连明确能用的
 * `select` 也是 —— 因为**占位文案没有统一的存放/读取点**（有的直接画在字段上，
 * 有的叫 `fieldText`，`cascader` / `tree-select` 连公开取值器都没有）。
 * 拿一个"每个组件各不相同"的地方当探针，测出来的是组件的内部布局，
 * 不是"DSL 有没有把键传下去"。
 *
 * 所以这里换个位置：**在构造函数的入口拦一道**。那正是编译器与组件之间的边界，
 * 也是这件事真正该被保证的地方。顺带覆盖了 `props` 透传与 `default`（初值）。
 */
const captured: Array<{ name: string; options: any }> = [];

jest.mock('ice-web-components', () => {
  const actual = jest.requireActual('ice-web-components');
  const out: Record<string, any> = { ...actual };
  // 每个控件类都换成一个"记下参数再交给真货"的壳。
  // 只包 `ICE` 开头的构造函数（常量 `ICEMessage` 之类要原样留着）。
  for (const key of Object.keys(actual)) {
    const original = actual[key];
    if (typeof original !== 'function' || !/^ICE/.test(key)) continue;
    out[key] = class extends original {
      constructor(options: any) {
        super(options);
        captured.push({ name: key, options });
      }
    };
    // 静态属性（有些组件把工厂放在类上）要一并带过来
    Object.setPrototypeOf(out[key], original);
    for (const stat of Object.getOwnPropertyNames(original)) {
      if (['length', 'name', 'prototype'].includes(stat)) continue;
      try {
        out[key][stat] = original[stat];
      } catch {
        /* 只读的就算了 */
      }
    }
  }
  return out;
});

import { compileFormDsl } from '../src/compiler/formDslToForm';
import { FORM_DSL_FIELD_TYPES, type FormDslFieldType } from '../src/types';

/** 每个类型的最小可用声明。加类型时**必须**在这里补一条。 */
const MINIMAL: Record<string, any> = {
  text: {},
  textarea: {},
  password: {},
  number: {},
  slider: {},
  checkbox: {},
  switch: {},
  'radio-group': { options: [{ value: 'a' }] },
  'checkbox-group': { options: [{ value: 'a' }] },
  select: { options: [{ value: 'a' }] },
  date: {},
  color: { options: ['#fff'] },
  rate: {},
  time: {},
  segmented: { options: [{ value: 'a' }] },
  autocomplete: { options: ['a'] },
  cascader: { options: [{ value: 'a' }] },
  'tree-select': { options: [{ value: 'a' }] },
  transfer: { options: ['a'] },
  'date-range': {},
};

const PLACEHOLDER = '占位文案-探针';
const STATION = 'prop-探针';

/**
 * 一个类型的字段 → 它的**控件**（不是 `ICEForm` / `ICEFormItem` / 容器那些）。
 *
 * 构造顺序是实测出来的（`tests/__order` 那种探针跑出来的）：
 *
 *     ICEForm → 控件 → ICEFormItem → …（控件自己的子件，比如 segmented 的 ICEButton）
 *
 * 所以控件是 **`ICEForm` 之后的那个**。不能取 `captured[0]`（那是 `ICEForm` 自己，
 * 拿它的参数去断言会得到"width=400、placeholder=undefined"这种看着像 bug 的假象 ——
 * 第一版就是这么写错的），也不能取最后一个（那是子件）。
 */
function compileOne(type: FormDslFieldType, extra: Record<string, any> = {}) {
  captured.length = 0;
  const compiled: any = compileFormDsl(
    {
      schemaVersion: 1,
      kind: 'form',
      fields: [{ name: 'f', type, placeholder: PLACEHOLDER, ...extra, ...MINIMAL[type] }],
    } as any,
    { width: 400 }
  );
  const formIdx = captured.findIndex((c) => c.name === 'ICEForm');
  const control = formIdx >= 0 ? captured[formIdx + 1] : undefined;
  compiled.destroy();
  return control;
}

describe('通用键必须到达每一个控件（跨类型不变量）', () => {
  it('每个已实现的类型都有最小声明（漏一条就等于静默不测那个类型）', () => {
    expect(Object.keys(MINIMAL).sort()).toEqual([...FORM_DSL_FIELD_TYPES].sort());
  });

  it('每个类型都收到 `placeholder`', () => {
    const missing: string[] = [];
    for (const type of FORM_DSL_FIELD_TYPES) {
      const control = compileOne(type);
      if (!control) {
        missing.push(`${type}（压根没构造出控件）`);
        continue;
      }
      if (control.options?.placeholder !== PLACEHOLDER) {
        missing.push(`${type} → ${control.name}：${JSON.stringify(control.options?.placeholder)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('每个类型都收到 `props` 逃生舱里的键', () => {
    // `props` 与 `placeholder` 走的是同一条路（都在 `base` 里），
    // 但它更值得单独守：它是**唯一的逃生舱**，被吞掉就等于"能配的键配不了"，
    // 而且它**不做校验**，吞了连警告都没有。
    const missing: string[] = [];
    for (const type of FORM_DSL_FIELD_TYPES) {
      const control = compileOne(type, { props: { focusable: STATION } } as any);
      if (!control || control.options?.focusable !== STATION) {
        missing.push(`${type} → ${control?.name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('`default` 变成初值 —— 但 `transfer` 走的是 `targetKeys`（清单里的 initKey）', () => {
    // 值形状是"类型 + 属性"的函数，初值的**键名**也是（`transfer` 不用 `value`）。
    const scalar: any = { text: 'hi', number: 3, rate: 3, time: '08:30' };
    for (const [type, value] of Object.entries(scalar)) {
      const control = compileOne(type as FormDslFieldType, { default: value });
      expect({ type, value: control?.options?.value }).toEqual({ type, value });
    }
    const transfer = compileOne('transfer', { default: ['a'] });
    expect(transfer?.options?.targetKeys).toEqual(['a']);
    expect(transfer?.options?.value).toBeUndefined(); // 不该同时塞一个没人认的 value
  });

  it('宽度按 `FIXED_WIDTH_TYPES` 走：`rate` 不传、`number` 固定、其余拉伸', () => {
    expect(compileOne('rate')?.options?.width).toBeUndefined();
    expect(compileOne('number')?.options?.width).toBe(200);
    expect(compileOne('text')?.options?.width).toBe(400);
    // 逐字段覆盖优先
    expect(compileOne('text', { width: 123 })?.options?.width).toBe(123);
  });
});
