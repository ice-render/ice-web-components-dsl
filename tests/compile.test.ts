/**
 * 编译器：DSL → 真组件树。
 *
 * 这里最要紧的一组用例是**「一处声明、两处生效」**——那是这个 DSL 相对原生 API
 * 最实在的一处改进：原生路径 `new ICEInputNumber({ min: 18 })`（限制步进）与
 * `rules: [{ min: 18 }]`（校验）互不相干，模型只会写其中一个，
 * 然后"填了 10 却不报错"。DSL 里写一次 `min: 18` 两边都有。
 */
import { compileFormDsl, FormDslCompileError } from '../src/compiler/formDslToForm';
import type { FormDslDocument } from '../src/types';

function doc(overrides: Partial<FormDslDocument> = {}): FormDslDocument {
  return {
    schemaVersion: 1,
    kind: 'form',
    title: '泵站参数确认',
    fields: [
      { name: 'station', type: 'text', label: '泵站名称', required: true, maxLength: 20 },
      { name: 'mode', type: 'select', label: '运行模式', options: [{ value: 'auto' }, { value: 'manual' }], default: 'auto' },
      { name: 'flow', type: 'number', label: '目标流量', min: 0, max: 5000, step: 10 },
    ],
    ...overrides,
  } as FormDslDocument;
}

/**
 * 取某个字段的控件（`ICEForm.getItems()` 的顺序与声明一致）。
 *
 * 走 `getControl()` —— `ICEFormItem` 的 `control` 是私有的，绕过封装直接读字段
 * 能跑但不对（上游一改名就静默失效）。
 */
function controlOf(compiled: any, index: number): any {
  return compiled.form.getItems()[index].getControl();
}

/** 取某个字段的 `ICEFormItem`。 */
function itemOf(compiled: any, index: number): any {
  return compiled.form.getItems()[index];
}

describe('编译产物形状', () => {
  it('返回容器 / 表单 / 模型 / 提交按钮 / 字段名', () => {
    const compiled = compileFormDsl(doc());

    expect(compiled.container).toBeTruthy();
    expect(compiled.form).toBeTruthy();
    expect(compiled.model).toBeTruthy();
    expect(compiled.submitButton).toBeTruthy();
    expect(compiled.fieldNames).toEqual(['station', 'mode', 'flow']);

    compiled.destroy();
  });

  it('标题与说明进容器；submitText: null 时不生成提交按钮', () => {
    const withSubmit = compileFormDsl(doc());
    expect(withSubmit.submitButton).not.toBeNull();
    withSubmit.destroy();

    const without = compileFormDsl(doc({ submitText: null }));
    expect(without.submitButton).toBeNull();
    without.destroy();
  });

  it('校验不过时抛 FormDslCompileError，且带上结构化诊断', () => {
    expect(() => compileFormDsl(doc({ fields: [{ name: 'x', type: 'select' }] as any }))).toThrow(FormDslCompileError);

    try {
      compileFormDsl(doc({ fields: [{ name: 'x', type: 'select' }] as any }));
    } catch (err) {
      const e = err as FormDslCompileError;
      expect(e.diagnostics.valid).toBe(false);
      expect(e.diagnostics.errors.map((d) => d.code)).toContain('options-required');
      expect(e.message).toContain('options-required'.length ? '选项型字段' : '');
    }
  });
});

describe('一处声明、两处生效（这个 DSL 的核心价值）', () => {
  it('number 的 min/max **同时**进控件与规则', () => {
    const compiled = compileFormDsl(doc({ fields: [{ name: 'n', type: 'number', min: 18, max: 65 }] as any }));

    // 控件侧：步进夹取（ICEInputNumber 把约束存在**顶层字段**上，不在 state 里）
    const control = controlOf(compiled, 0);
    expect(control.min).toBe(18);
    expect(control.max).toBe(65);

    // 规则侧：校验
    const rules = compiled.model.getField('n')!.rules!;
    expect(rules[0].min).toBe(18);
    expect(rules[0].max).toBe(65);

    compiled.destroy();
  });

  it('这一处声明真的会拦住非法值（不只写进了字段里）', () => {
    const compiled = compileFormDsl(doc({ fields: [{ name: 'n', type: 'number', min: 18 }] as any }));
    compiled.setValues({ n: 10 });
    expect(compiled.model.validate()).toBe(false);
    expect(compiled.model.getError('n')).toBeTruthy();

    compiled.setValues({ n: 20 });
    expect(compiled.model.validate()).toBe(true);
    compiled.destroy();
  });

  it('文本类字段的 maxLength 同时限制输入长度与生成规则', () => {
    const compiled = compileFormDsl(doc({ fields: [{ name: 't', type: 'text', maxLength: 5 }] as any }));

    // 控件侧：ICETextField 把 maxLength 放进 state
    expect(controlOf(compiled, 0).state.maxLength).toBe(5);
    // 规则侧
    expect(compiled.model.getField('t')!.rules![0].maxLength).toBe(5);

    compiled.setValues({ t: 'abcdef' });
    expect(compiled.model.validate()).toBe(false);
    compiled.destroy();
  });
});

describe('规则合成', () => {
  it('shorthand 合成**一条**规则（原生允许一条规则带多个约束）', () => {
    const compiled = compileFormDsl(
      doc({ fields: [{ name: 't', type: 'text', required: true, minLength: 2, maxLength: 8, message: '长度不对' }] as any })
    );
    const rules = compiled.model.getField('t')!.rules!;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ required: true, minLength: 2, maxLength: 8, message: '长度不对' });
    compiled.destroy();
  });

  it('rules[] 按顺序追加在 shorthand 之后', () => {
    const compiled = compileFormDsl(
      doc({ fields: [{ name: 't', type: 'text', required: true, rules: [{ minLength: 4 }, { pattern: '^a' }] }] as any })
    );
    const rules = compiled.model.getField('t')!.rules!;
    expect(rules).toHaveLength(3);
    expect(rules[0].required).toBe(true);
    expect(rules[1].minLength).toBe(4);
    expect(rules[2].pattern).toBeInstanceOf(RegExp);
    compiled.destroy();
  });

  it('pattern 字符串编译成 RegExp（原生规则要的是正则对象）', () => {
    const compiled = compileFormDsl(doc({ fields: [{ name: 't', type: 'text', pattern: '^[a-z]+$' }] as any }));
    const rule = compiled.model.getField('t')!.rules![0];
    expect(rule.pattern).toBeInstanceOf(RegExp);
    expect(rule.pattern!.test('abc')).toBe(true);
    expect(rule.pattern!.test('A1')).toBe(false);
    compiled.destroy();
  });
});

describe('意图级默认', () => {
  it('label 缺省时用 name', () => {
    const compiled = compileFormDsl(doc({ fields: [{ name: 'projectId', type: 'text' }] as any }));
    // ICEFormItem 的公开入口是 getLabel()（label 不是公开字段）
    expect(String(itemOf(compiled, 0).getLabel())).toContain('projectId');
    compiled.destroy();
  });

  it('选项的 label 缺省时用 value（原生的 ICESelectOption.label 是必填）', () => {
    const compiled = compileFormDsl(
      doc({ fields: [{ name: 'm', type: 'select', options: [{ value: 'auto' }, { value: 'manual', label: '手动' }] }] as any })
    );
    const options = controlOf(compiled, 0).options as any[];
    expect(options[0].label).toBe('auto');
    expect(options[1].label).toBe('手动');
    compiled.destroy();
  });
});

/**
 * 宽度。
 *
 * 这一组是**实测缺陷的回归**：宿主容器 896 宽时表单只在左边画了 229px，右边空掉 667px（74%）。
 * 根因不是渲染器画错，是宽度在 ICE 里没有"父级拉满"的自动传导 ——
 * `ICEForm` 的 `ICEBoxLayout({align:'stretch'})` 只拉 `ICEFormItem`，**不拉控件**；
 * 而 `ICEFormItem.doLayout` 只按 `control.state.width`（缺省 `200`）**定位**控件。
 * 于是 `stretch` 对视觉结果完全没有作用，每个控件落到各自的出厂默认
 * （`ICETextField` 200、`ICEInputNumber` 140、`ICESelect` 200…），同一张表单里还互不相同。
 *
 * 所以 DSL 这边要提供三样东西：
 *   1. 按**类型**给意图级默认宽度（而不是让控件各自退到出厂默认）；
 *   2. `maxWidth` —— 宿主给的宽度要夹住，896 宽的一张卡片不该出现 896 宽的输入框；
 *   3. `setWidth()` —— 宿主容器尺寸变了要能整棵树重新对齐。
 */
describe('宽度', () => {
  /** 宽度存在各组件的 `state` 上（`form.width` / `item.width` 都是 undefined）。 */
  const w = (node: any): number | undefined => node?.state?.width;
  /** 文档里 `flow` 是 number，其余是 text / select。 */
  const isNumberField = (index: number) => index === 2;

  it('不写宽度时按类型给默认：文本类跟着表单走，数值类保持自己的尺寸', () => {
    const compiled = compileFormDsl(doc({ width: 420 } as any));

    expect(w(compiled.container)).toBe(420);
    expect(w(compiled.form)).toBe(420);
    // 关键：不是 200 / 140 / 200 各回各家
    expect(w(controlOf(compiled, 0))).toBe(420); // station: text
    expect(w(controlOf(compiled, 1))).toBe(420); // mode: select
    // 数值类**故意**不跟着拉伸：ICEInputNumber 把减号摆最左、数值居中，
    // 宽度一大这两样就天各一方（890px 时看着像坏了）
    expect(w(controlOf(compiled, 2))).toBe(200); // flow: number
    compiled.destroy();
  });

  it('宽度退化会画出看不见的控件 —— 所以除了数值都要拉伸', () => {
    // 这是"为什么不能简单地把宽度留给组件出厂默认"的实证：
    // slider 默认 10px、checkbox 默认 0px、radio-group 默认 35px。
    const compiled = compileFormDsl(
      doc({
        fields: [
          { name: 's', type: 'slider' },
          { name: 'c', type: 'checkbox' },
          { name: 'r', type: 'radio-group', options: [{ value: 'x' }] },
        ],
      } as any),
      { width: 600 }
    );
    expect([0, 1, 2].map((i) => w(controlOf(compiled, i)))).toEqual([600, 600, 600]);
    compiled.destroy();
  });

  it('不传 width 时用 dsl.width，再退回 360', () => {
    const fromDsl = compileFormDsl(doc({ width: 420 } as any));
    expect(w(fromDsl.form)).toBe(420);
    fromDsl.destroy();

    const fallback = compileFormDsl(doc());
    expect(w(fallback.form)).toBe(360);
    expect(w(controlOf(fallback, 0))).toBe(360);
    fallback.destroy();
  });

  it('options.width 优先于 dsl.width（宿主说了算：表单多宽取决于它被放哪儿）', () => {
    const compiled = compileFormDsl(doc({ width: 420 } as any), { width: 600 });
    expect(w(compiled.container)).toBe(600);
    expect(w(compiled.form)).toBe(600);
    expect(w(controlOf(compiled, 0))).toBe(600);
    compiled.destroy();
  });

  it('宿主给的宽度被 maxWidth 夹住（默认 640）—— 排满不等于拉到抽屉那么宽', () => {
    const compiled = compileFormDsl(doc(), { width: 896 });

    // 896 的卡片里表单是 640，不是 896：一行 896 宽的输入框没人读得过来
    expect(w(compiled.form)).toBe(640);
    expect(w(compiled.container)).toBe(640);
    expect(w(controlOf(compiled, 0))).toBe(640);
    compiled.destroy();
  });

  it('maxWidth 可以自己声明：`dsl.maxWidth` 与 `options.maxWidth` 都能用，选项优先', () => {
    const fromDsl = compileFormDsl(doc({ maxWidth: 480 } as any), { width: 896 });
    expect(w(fromDsl.form)).toBe(480);
    fromDsl.destroy();

    const fromOptions = compileFormDsl(doc({ maxWidth: 480 } as any), { width: 896, maxWidth: 520 });
    expect(w(fromOptions.form)).toBe(520);
    fromOptions.destroy();
  });

  it('maxWidth: Infinity 就是不设上限（宿主自己知道该多宽时用）', () => {
    const compiled = compileFormDsl(doc(), { width: 896, maxWidth: Infinity });
    expect(w(compiled.form)).toBe(896);
    expect(w(controlOf(compiled, 0))).toBe(896);
    compiled.destroy();
  });

  it('太窄的宿主不会把表单压塌（下限 240）', () => {
    const compiled = compileFormDsl(doc(), { width: 100 });
    expect(w(compiled.form)).toBe(240);
    compiled.destroy();
  });

  it('表单项始终占满一行（`stretch` 拉的是它，所以它的宽度必须显式给）', () => {
    const compiled = compileFormDsl(doc(), { width: 600 });
    // 不给的话 ICEFormItem 会从控件宽度反推 `max(控件宽, 120)` —— 那才是"拉不满"的直接原因
    expect([0, 1, 2].map((i) => w(itemOf(compiled, i)))).toEqual([600, 600, 600]);
    compiled.destroy();
  });

  it('field.width 逐字段覆盖仍然生效（显式意图不被默认值吃掉）', () => {
    const compiled = compileFormDsl(
      doc({
        fields: [
          { name: 'full', type: 'text' },
          { name: 'narrow', type: 'number', width: 120 },
        ],
      } as any),
      { width: 600 }
    );
    expect(w(controlOf(compiled, 0))).toBe(600);
    expect(w(controlOf(compiled, 1))).toBe(120); // 我写的 120，不是数值类的默认 200
    // 但它所在的行还是满宽 —— 行宽是布局，控件宽是控件自己的事，两者不冲突
    expect(w(itemOf(compiled, 1))).toBe(600);
    compiled.destroy();
  });

  it('setWidth 重新对齐，但**不动**显式写宽的字段、也不动数值类', () => {
    const compiled = compileFormDsl(
      doc({
        fields: [
          { name: 'a', type: 'text' },
          { name: 'pinned', type: 'text', width: 130 },
          { name: 'n', type: 'number' },
        ],
      } as any),
      { width: 600 }
    );

    compiled.setWidth(500);

    expect(w(compiled.container)).toBe(500);
    expect(w(compiled.form)).toBe(500);
    expect(w(itemOf(compiled, 0))).toBe(500);
    expect(w(controlOf(compiled, 0))).toBe(500);
    // 显式宽度是意图，重排时不该被抹掉
    expect(w(controlOf(compiled, 1))).toBe(130);
    expect(w(itemOf(compiled, 1))).toBe(500);
    // 数值类不跟着拉伸 —— 编译期与重排期必须用同一套判据，否则"编译时对、resize 后错"
    expect(w(controlOf(compiled, 2))).toBe(200);
    expect(w(itemOf(compiled, 2))).toBe(500);
    compiled.destroy();
  });

  it('setWidth 也吃 maxWidth（否则宿主一放大就把编译期夹好的上限冲掉了）', () => {
    const compiled = compileFormDsl(doc(), { width: 600 });
    compiled.setWidth(3000);
    expect(w(compiled.form)).toBe(640);
    expect(w(controlOf(compiled, 0))).toBe(640);
    compiled.destroy();
  });

  it('setWidth 对非法值不做事（不把布局弄崩）', () => {
    const compiled = compileFormDsl(doc(), { width: 600 });
    compiled.setWidth(0);
    compiled.setWidth(NaN);
    compiled.setWidth(-10);
    expect(w(compiled.form)).toBe(600);
    compiled.destroy();
  });

  it('标题与说明跟着一起对齐（它们是容器的子节点，不跟会冒出去）', () => {
    const compiled = compileFormDsl(doc(), { width: 800, maxWidth: Infinity });
    // ICEGroup 暴露的是 childNodes（没有 getChildren）；顺序：标题、说明、表单、提交按钮
    const kids = (compiled.container as any).childNodes;
    expect(w(kids[0])).toBe(800);
    compiled.setWidth(640);
    expect(w(kids[0])).toBe(640);
    compiled.destroy();
  });

  it('horizontal 布局要让出标签那一条（否则控件把标签挤没）', () => {
    const compiled = compileFormDsl(doc({ layout: 'horizontal' } as any), { width: 600, maxWidth: Infinity });
    // ICEFormItem 默认 labelWidth 80
    expect(w(controlOf(compiled, 0))).toBe(520);
    expect(w(itemOf(compiled, 0))).toBe(600);

    compiled.setWidth(400);
    expect(w(controlOf(compiled, 0))).toBe(320);
    compiled.destroy();
  });

  it('horizontal 下让完标签也不会把控件压到负/零宽', () => {
    // 宽度 100 → 表单被抬到下限 240 → 控件 240 - 80 = 160
    // （`maxWidth` 小于下限时也被抬到下限，所以控件宽度在这条路径上恒 ≥ 160，
    //   代码里那个 `Math.max(120, …)` 是防"以后有人把下限调小"的保险，走不到）
    const narrow = compileFormDsl(doc({ layout: 'horizontal' } as any), { width: 100 });
    expect(w(narrow.form)).toBe(240);
    expect(w(controlOf(narrow, 0))).toBe(160);
    narrow.destroy();
  });
});

describe('表单行为', () => {
  it('getValues / setValues / reset', () => {
    const compiled = compileFormDsl(doc());
    compiled.setValues({ station: '一号泵站', flow: 800 });
    expect(compiled.getValues()).toMatchObject({ station: '一号泵站', flow: 800 });

    compiled.reset();
    expect(compiled.getValues().station === '' || compiled.getValues().station === undefined).toBe(true);
    compiled.destroy();
  });

  it('必填没填时 submit 返回 false，且**不触发** onSubmit', () => {
    const compiled = compileFormDsl(doc());
    const seen: any[] = [];
    compiled.onSubmit((values) => seen.push(values));

    expect(compiled.submit()).toBe(false);
    expect(seen).toEqual([]);
    compiled.destroy();
  });

  it('校验通过后 submit 触发 onSubmit，值带出来', () => {
    const compiled = compileFormDsl(doc());
    const seen: any[] = [];
    compiled.onSubmit((values) => seen.push(values));

    compiled.setValues({ station: '一号泵站', mode: 'manual', flow: 1200 });
    expect(compiled.submit()).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ station: '一号泵站', mode: 'manual', flow: 1200 });
    compiled.destroy();
  });

  it('submitAsync 等价路径也能过', async () => {
    const compiled = compileFormDsl(doc());
    compiled.setValues({ station: '二号泵站' });
    await expect(compiled.submitAsync()).resolves.toBe(true);
    compiled.destroy();
  });

  it('跨字段依赖：被依赖字段变化会立刻重算本字段', () => {
    const compiled = compileFormDsl(
      doc({
        fields: [
          { name: 'password', type: 'password', required: true },
          {
            name: 'confirm',
            type: 'password',
            required: true,
            dependencies: ['password'],
            rules: [{ pattern: '^.{0}$', message: '这只是为了让本字段必然失败' }],
          },
        ],
      } as any)
    );

    compiled.setValues({ confirm: 'x' });
    // confirm 自身的规则必然失败
    expect(compiled.model.getError('confirm')).toBeTruthy();
    // password 变了 → 依赖它的 confirm 重新算过（错误仍在，但重算发生过）
    compiled.setValues({ password: 'abc' });
    expect(compiled.model.getDependents('password')).toEqual(['confirm']);
    compiled.destroy();
  });

  it('onSubmit 返回的取消订阅生效', () => {
    const compiled = compileFormDsl(doc());
    const seen: any[] = [];
    const off = compiled.onSubmit((v) => seen.push(v));
    off();
    compiled.setValues({ station: '一号泵站' });
    compiled.submit();
    expect(seen).toEqual([]);
    compiled.destroy();
  });
});
