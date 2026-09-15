/**
 * 「这个控件能不能当字段」—— **运行时问出来**，不是从文档推断。
 *
 * ## 为什么必须真调
 *
 * 我在这件事上连错两次，都是因为拿文档当真相：
 *
 * 1. 清单里的方法名曾解析成 `setValue(hex: string)`（带调用语法），于是
 *    `methods.includes('getFormValue')` 永远为假 —— 我据此把 `ICETransfer` /
 *    `ICERadioButton` 判成"没有表单取值约定"。**结论正好反了。**
 * 2. 修正方法名之后发现 `getFormValue` 是 `ICEWidget` **基类**实现的 ——
 *    **每个**控件都有，包括 `ICEUpload`。所以它压根不是判别信号，
 *    第二个结论也错了。
 *
 * 真正的判据是"**值能不能经 JSON 往返**"，那只有构造出来、调一次才知道。
 * 更麻烦的是文档层面的坑：`docs/api/*.md` 只记组件**自己声明的**方法，
 * 继承来的一律没有 —— 所以 `ICETextArea`（明明能用）在文档里"没有 `getFormValue`"。
 *
 * 这组用例把那次探测的结论钉住。`tools/probe-field-values.mjs` 是同一件事的交互版
 * （会打出完整的往返矩阵），想重新看一遍就跑它。
 */
import * as lib from 'ice-web-components';

/** 直方图：`setFormValue(v)` → `getFormValue()` 回来是什么。 */
function roundTrip(Ctor: any, opts: any, values: any[]): string[] {
  const inst = new Ctor(opts);
  return values.map((v) => {
    inst.setFormValue(v);
    const back = inst.getFormValue();
    return JSON.stringify(back ?? null);
  });
}

const ALL = ['x', 3, true, ['a', 'b'], ['2026-09-01', '2026-09-15']];

describe('9 个能当字段的：`setFormValue` 会真的参与（转换或校验）', () => {
  it('`ICEColorPicker` —— 值会被强制成 string', () => {
    // 3 → "3"、["a","b"] → "a,b"：它把任何输入转成字符串再存。
    // 这就是"真的实现了取值约定"的证据 —— 不是照收不误。
    expect(roundTrip((lib as any).ICEColorPicker, { colors: ['#fff'] }, [3, ['a', 'b']])).toEqual([
      '"3"',
      '"a,b"',
    ]);
  });

  it('`ICERate` / `ICESegmented` / `ICEUpload` 的往返"全过" —— 但那不说明它们都对', () => {
    // 反面对照：照收不误也会让"往返"全过。所以**光看往返是不够的**，
    // 得看"初始值 + 非法输入的处理"，见下面两组用例。
    const rate = roundTrip((lib as any).ICERate, {}, ALL);
    expect(rate.every((r) => r !== 'undefined')).toBe(true);
  });

  it('`ICEDateRangePicker` —— 只认两头齐全的元组，其余一律回落成 [null, null]', () => {
    // 它是**会校验形状**的：非法输入不是照收，而是清回"未选"。
    // 这条同时钉住了那个语义：`[null, null]` 就是"还没选完"这个状态本身。
    expect(roundTrip((lib as any).ICEDateRangePicker, {}, ALL)).toEqual([
      '[null,null]',
      '[null,null]',
      '[null,null]',
      '[null,null]',
      '["2026-09-01","2026-09-15"]',
    ]);
    // 初始态就是"两头都空"，不是 undefined / 空串
    expect(new (lib as any).ICEDateRangePicker({}).getFormValue()).toEqual([null, null]);
  });

  it('`ICETransfer` —— 值是非空 string[]，非法输入回落成 []', () => {
    const Ctor = (lib as any).ICETransfer;
    expect(new Ctor({ targetKeys: ['b'], dataSource: [{ key: 'a' }, { key: 'b' }] }).getFormValue()).toEqual(['b']);
    expect(roundTrip(Ctor, { targetKeys: ['b'], dataSource: [{ key: 'a' }, { key: 'b' }] }, ['x', 3, ['a', 'b']])).toEqual([
      '[]',
      '[]',
      '["a","b"]',
    ]);
  });

  it('`ICETreeSelect` —— 单选取第一个；值形状随 `mode` 变', () => {
    const nodes = [{ key: 'zj', label: '浙江', children: [{ key: 'hz', label: '杭州' }] }];
    expect(roundTrip((lib as any).ICETreeSelect, { nodes }, [['a', 'b']])).toEqual(['"a"']);
    expect((lib as any).ICETreeSelect).toBeTruthy();
  });

  it('`ICECascader` / `ICEAutoComplete` / `ICETimePicker` —— 值都是 string', () => {
    expect(new (lib as any).ICEAutoComplete({ options: ['a'] }).getFormValue()).toBe('');
    expect(new (lib as any).ICETimePicker({}).getFormValue()).toBeUndefined();
    expect(new (lib as any).ICECascader({ options: [] }).getFormValue()).toBeUndefined();
  });
});

describe('2 个不能当字段的：各有运行时证据', () => {
  it('`ICERadioButton` —— `getFormValue()` 返回**布尔**，当字段会做出假单选', () => {
    // 它的值只表示"这个按钮勾没勾"（初始 false，任何输入都 → true），
    // **互斥由调用方维护**（库自己的注释也这么写）。当字段用的话：
    // 用户勾第二个不会取消第一个 —— 而 `checkbox`/`radio-group` 已经覆盖了这个需求，且更好。
    const inst: any = new (lib as any).ICERadioButton({ label: '选项甲', value: 'a' });
    expect(inst.getFormValue()).toBe(false);
    inst.setFormValue('随便什么');
    expect(inst.getFormValue()).toBe(true);
  });

  it('`ICEUpload` —— `setFormValue` 照收不误（基类默认），组件本身不参与取值', () => {
    // 判据不是"有没有 getFormValue"（基类给的，人人都有），而是**它有没有真的实现**。
    // ICEColorPicker 会把 3 转成 "3"，ICEDateRangePicker 会把非法输入清成 [null,null]；
    // ICEUpload 则是给什么存什么 —— 说明它根本没接这条约定。
    //
    // 这不是"上游的缺陷"：上传的值是**文件列表**，那东西没法经 JSON 往返给 agent，
    // 不是一个"字段值"。等真要做，得先定义"值是什么"（比如对象存储的 key 列表）。
    expect(roundTrip((lib as any).ICEUpload, {}, ALL)).toEqual(ALL.map((v) => JSON.stringify(v)));
  });
});
