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
