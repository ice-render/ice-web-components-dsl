/**
 * 校验器：**这是整个包最重要的部分**。
 *
 * 这个包的卖点不是"能声明表单"（原生也能），而是**模型写错时能拿到可操作的反馈**。
 * 所以这里逐条钉住诊断：不只是"报错了"，而是"报的错里带了可用替代"——
 * 类型不认识要列出可用类型、字段属性不认识要列出它接受哪些、
 * 依赖指错要列出可用字段名。
 *
 * 最后一条用例单独盯"任何输入都不抛异常"：它是一份**反馈通道**，
 * 抛异常意味着模型只拿到"你错了"。
 */
import { validateFormDsl, formatDiagnostics } from '../src/validate';

/** 一份合法的底稿，各用例在它上面改坏一处。 */
function good(overrides: any = {}) {
  return {
    schemaVersion: 1,
    kind: 'form',
    title: '泵站参数',
    fields: [
      { name: 'station', type: 'text', label: '泵站名称', required: true },
      { name: 'mode', type: 'select', label: '运行模式', options: [{ value: 'auto' }, { value: 'manual' }] },
    ],
    ...overrides,
  };
}

function codes(result: { errors: any[]; warnings: any[] }) {
  return [...result.errors, ...result.warnings].map((d) => d.code);
}

describe('根节点', () => {
  it('非对象根节点直接报 invalid-root', () => {
    for (const junk of [null, undefined, 42, 'x', [], true]) {
      const result = validateFormDsl(junk as any);
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('invalid-root');
    }
  });

  it('schemaVersion 不支持时报错', () => {
    const result = validateFormDsl(good({ schemaVersion: 99 }));
    expect(codes(result)).toContain('unsupported-schema-version');
    expect(result.errors[0].message).toContain('99');
  });

  it('缺 kind 时列出可用 kind', () => {
    const result = validateFormDsl(good({ kind: undefined }));
    expect(result.errors[0].code).toBe('missing-kind');
    expect(result.errors[0].message).toContain('form');
  });

  it('kind 不认识时列出可用 kind', () => {
    const result = validateFormDsl(good({ kind: 'card' }));
    expect(result.errors[0].code).toBe('unsupported-kind');
    expect(result.errors[0].message).toContain('可用类型：form');
  });

  it('未知根字段是警告（不是错误），并列出可用字段', () => {
    const result = validateFormDsl(good({ whatever: 1 }));
    expect(result.valid).toBe(true);
    const warning = result.warnings.find((w) => w.code === 'unknown-field')!;
    expect(warning.path).toBe('whatever');
    expect(warning.message).toContain('可用字段：');
  });

  it('layout / width / gap / submitText 的非法值', () => {
    expect(codes(validateFormDsl(good({ layout: 'diagonal' })))).toContain('invalid-layout');
    expect(codes(validateFormDsl(good({ width: -1 })))).toContain('invalid-number');
    expect(codes(validateFormDsl(good({ submitText: 42 })))).toContain('invalid-submit-text');
  });
});

describe('fields', () => {
  it('缺 fields / 非数组 / 空数组', () => {
    expect(codes(validateFormDsl(good({ fields: undefined })))).toContain('missing-fields');
    expect(codes(validateFormDsl(good({ fields: {} })))).toContain('invalid-fields');
    expect(codes(validateFormDsl(good({ fields: [] })))).toContain('empty-fields');
  });

  it('字段不是对象时报错并列出可用类型', () => {
    const result = validateFormDsl(good({ fields: ['文本'] }));
    expect(result.errors[0].code).toBe('field-not-object');
    expect(result.errors[0].message).toContain('可用类型：text');
  });

  it('缺 name 报错（说明它是取值键）', () => {
    const result = validateFormDsl(good({ fields: [{ type: 'text' }] }));
    expect(result.errors[0].code).toBe('missing-name');
    expect(result.errors[0].message).toContain('dependencies');
  });

  it('name 重复时指出跟第几个冲突', () => {
    const result = validateFormDsl(
      good({
        fields: [
          { name: 'a', type: 'text' },
          { name: 'a', type: 'text' },
        ],
      })
    );
    const dup = result.errors.find((e) => e.code === 'duplicate-name')!;
    expect(dup.path).toBe('fields[1].name');
    expect(dup.message).toContain('第 0 个字段');
  });

  it('缺 type / type 不认识', () => {
    expect(codes(validateFormDsl(good({ fields: [{ name: 'a' }] })))).toContain('missing-type');
    const result = validateFormDsl(good({ fields: [{ name: 'a', type: 'richtext' }] }));
    const bad = result.errors.find((e) => e.code === 'unsupported-field-type')!;
    expect(bad.message).toContain('richtext');
    expect(bad.message).toContain('可用类型：text');
  });

  it('白名单外的属性是警告，并把这个类型接受什么列出来', () => {
    const result = validateFormDsl(
      good({ fields: [{ name: 'n', type: 'number', options: [{ value: 'a' }] }] })
    );
    // options 给非选项型字段：单独的警告
    const optWarning = result.warnings.find((w) => w.code === 'options-not-allowed')!;
    expect(optWarning.message).toContain('选项型字段');
    expect(optWarning.message).toContain('radio-group');

    const unknown = validateFormDsl(good({ fields: [{ name: 'n', type: 'number', nope: 1 }] }));
    const w = unknown.warnings.find((x) => x.code === 'unknown-field')!;
    expect(w.path).toBe('fields[0].nope');
    expect(w.message).toContain('nope');
    expect(w.message).toContain('它接受：step / precision');
  });
});

describe('options', () => {
  it('选项型字段缺 options', () => {
    for (const type of ['select', 'radio-group', 'checkbox-group']) {
      const result = validateFormDsl(good({ fields: [{ name: 'x', type }] }));
      const err = result.errors.find((e) => e.code === 'options-required')!;
      expect(err.path).toBe('fields[0].options');
      expect(err.message).toContain('选项型字段');
    }
  });

  it('options 非数组 / 空数组', () => {
    expect(codes(validateFormDsl(good({ fields: [{ name: 'x', type: 'select', options: {} }] })))).toContain(
      'invalid-options'
    );
    expect(codes(validateFormDsl(good({ fields: [{ name: 'x', type: 'select', options: [] }] })))).toContain('empty-options');
  });

  it('选项缺 value / value 非字符串 / value 重复', () => {
    const missing = validateFormDsl(good({ fields: [{ name: 'x', type: 'select', options: [{ label: '甲' }] }] }));
    expect(codes(missing)).toContain('option-missing-value');

    const notString = validateFormDsl(good({ fields: [{ name: 'x', type: 'select', options: [{ value: 1 }] }] }));
    expect(codes(notString)).toContain('option-value-not-string');

    const dup = validateFormDsl(
      good({ fields: [{ name: 'x', type: 'select', options: [{ value: 'a' }, { value: 'a' }] }] })
    );
    const err = dup.errors.find((e) => e.code === 'duplicate-option-value')!;
    expect(err.path).toBe('fields[0].options[1]');
    expect(err.message).toContain('第 0 项');
  });
});

describe('default', () => {
  it('类型与字段类型不匹配时报错', () => {
    expect(codes(validateFormDsl(good({ fields: [{ name: 'n', type: 'number', default: 'x' }] })))).toContain(
      'default-type-mismatch'
    );
    expect(codes(validateFormDsl(good({ fields: [{ name: 'b', type: 'switch', default: 'yes' }] })))).toContain(
      'default-type-mismatch'
    );
    expect(codes(validateFormDsl(good({ fields: [{ name: 't', type: 'text', default: 1 }] })))).toContain(
      'default-type-mismatch'
    );
  });

  it('默认值不在 options 里时**列出可用取值**', () => {
    const result = validateFormDsl(
      good({
        fields: [
          {
            name: 'x',
            type: 'select',
            default: 'auto',
            options: [{ value: 'on' }, { value: 'off' }],
          },
        ],
      })
    );
    const err = result.errors.find((e) => e.code === 'default-not-in-options')!;
    expect(err.message).toContain('auto');
    expect(err.message).toContain('on / off');
  });
});

describe('dependencies（跨字段）', () => {
  it('指向不存在的字段时报错，并**列出可用字段名**', () => {
    const result = validateFormDsl(
      good({
        fields: [
          { name: 'password', type: 'password' },
          { name: 'confirm', type: 'password', dependencies: ['passwrod'] }, // 拼错
        ],
      })
    );
    const err = result.errors.find((e) => e.code === 'unknown-dependency')!;
    expect(err.path).toBe('fields[1].dependencies[0]');
    expect(err.message).toContain('passwrod');
    expect(err.message).toContain('password / confirm');
  });

  it('**前向引用不算错**（依赖声明在后面字段上）', () => {
    const result = validateFormDsl(
      good({
        fields: [
          { name: 'confirm', type: 'password', dependencies: ['password'] },
          { name: 'password', type: 'password' },
        ],
      })
    );
    expect(result.valid).toBe(true);
  });

  it('自依赖与非法形状', () => {
    expect(codes(validateFormDsl(good({ fields: [{ name: 'a', type: 'text', dependencies: ['a'] }] })))).toContain(
      'self-dependency'
    );
    expect(codes(validateFormDsl(good({ fields: [{ name: 'a', type: 'text', dependencies: 'b' }] })))).toContain(
      'invalid-dependencies'
    );
    expect(codes(validateFormDsl(good({ fields: [{ name: 'a', type: 'text', dependencies: [42] }] })))).toContain(
      'invalid-dependency'
    );
  });
});

describe('规则形状', () => {
  it('required 非布尔', () => {
    expect(codes(validateFormDsl(good({ fields: [{ name: 'a', type: 'text', required: 'yes' }] })))).toContain(
      'required-not-boolean'
    );
  });

  it('min 大于 max 时报错', () => {
    const result = validateFormDsl(good({ fields: [{ name: 'n', type: 'number', min: 10, max: 5 }] }));
    expect(codes(result)).toContain('range-inverted');
  });

  it('minLength 大于 maxLength 时报错', () => {
    expect(codes(validateFormDsl(good({ fields: [{ name: 't', type: 'text', minLength: 9, maxLength: 3 }] })))).toContain(
      'length-range-inverted'
    );
  });

  it('pattern 非法正则时报错并带原因', () => {
    const result = validateFormDsl(good({ fields: [{ name: 't', type: 'text', pattern: '[a-' }] }));
    const err = result.errors.find((e) => e.code === 'invalid-pattern')!;
    expect(err.path).toBe('fields[0]（校验 shorthand）.pattern');
    expect(err.message).toContain('不是合法正则');
  });

  it('pattern 非字符串时报错（JSON 里写不出正则字面量）', () => {
    const result = validateFormDsl(good({ fields: [{ name: 't', type: 'text', pattern: /x/ }] }));
    const err = result.errors.find((e) => e.code === 'invalid-pattern')!;
    expect(err.message).toContain('必须是字符串');
  });

  it('长度类规则写在数值字段上是警告（多数是把 min 与 minLength 弄混）', () => {
    const result = validateFormDsl(good({ fields: [{ name: 'n', type: 'number', minLength: 3 }] }));
    expect(result.valid).toBe(true);
    const warning = result.warnings.find((w) => w.code === 'rule-not-applicable')!;
    expect(warning.message).toContain('min / max');
  });

  it('rules 非数组 / 项非对象 / 未知键', () => {
    expect(codes(validateFormDsl(good({ fields: [{ name: 't', type: 'text', rules: {} }] })))).toContain('invalid-rules');
    expect(codes(validateFormDsl(good({ fields: [{ name: 't', type: 'text', rules: ['x'] }] })))).toContain('invalid-rule');
    const result = validateFormDsl(good({ fields: [{ name: 't', type: 'text', rules: [{ maxlength: 3 }] }] }));
    const w = result.warnings.find((x) => x.code === 'unknown-rule-key')!;
    expect(w.message).toContain('maxlength');
    expect(w.message).toContain('maxLength');
  });
});

describe('枚举型属性', () => {
  it('date 的 placement 白名单', () => {
    const bad = validateFormDsl(good({ fields: [{ name: 'd', type: 'date', placement: 'middle' }] }));
    const err = bad.errors.find((e) => e.code === 'invalid-placement')!;
    expect(err.message).toContain('middle');
    expect(err.message).toContain('topLeft');

    const ok = validateFormDsl(good({ fields: [{ name: 'd', type: 'date', placement: 'bottomLeft' }] }));
    expect(ok.valid).toBe(true);
  });

  it('select 的 mode 与 group 的 direction', () => {
    expect(
      codes(validateFormDsl(good({ fields: [{ name: 's', type: 'select', mode: 'many', options: [{ value: 'a' }] }] })))
    ).toContain('invalid-mode');
    expect(
      codes(
        validateFormDsl(
          good({ fields: [{ name: 'r', type: 'radio-group', direction: 'diagonal', options: [{ value: 'a' }] }] })
        )
      )
    ).toContain('invalid-direction');
  });
});

describe('契约：任何输入都不抛异常', () => {
  it('各种垃圾输入都返回结果而不是抛错', () => {
    const junk = [
      null,
      undefined,
      0,
      '',
      'abc',
      [],
      [1, 2],
      {},
      { kind: 'form' },
      { kind: 'form', fields: null },
      { kind: 'form', fields: [null] },
      { kind: 'form', fields: [{ name: null, type: {} }] },
      { kind: 'form', fields: [{ name: 'a', type: 'text', rules: [null] }] },
      { kind: 'form', fields: [{ name: 'a', type: 'text', dependencies: [null] }] },
      { kind: 'form', fields: [{ name: 'a', type: 'select', options: [null] }] },
      new Date(),
      () => {},
      Symbol('x'),
      NaN,
    ];
    for (const value of junk) {
      expect(() => validateFormDsl(value as any)).not.toThrow();
      const result = validateFormDsl(value as any);
      expect(typeof result.valid).toBe('boolean');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });

  it('合法文档通过且没有错误', () => {
    const result = validateFormDsl(good());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('formatDiagnostics 能格式化错误、警告与通过三种情况', () => {
    expect(formatDiagnostics(validateFormDsl(good()))).toBe('✓ DSL 校验通过');
    const withWarning = formatDiagnostics(validateFormDsl(good({ whatever: 1 })));
    expect(withWarning).toContain('[警告]');
    const withError = formatDiagnostics(validateFormDsl(good({ kind: 'card' })));
    expect(withError).toContain('[错误]');
    expect(withError).toContain('（kind）');
  });
});
