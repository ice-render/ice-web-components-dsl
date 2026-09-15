/**
 * 结构化校验。
 *
 * **任何输入都不抛异常**（包括 `null` / 数组 / 乱七八糟的对象），因为它是给 agent 做自修复
 * 用的反馈通道 —— 抛异常意味着模型只拿到"你错了"，而不是"错在哪、可以改成什么"。
 *
 * 每条错误都尽量带上**可操作的替代信息**：
 * - 类型不认识 → 列出可用类型
 * - 选项型字段缺 `options` → 说明这个类型需要选项
 * - `dependencies` 指向不存在的字段 → **列出可用字段名**
 * - 某类型不认这个键 → **列出它认哪些键**
 *
 * 最后一条尤其重要：它把"你写错了"变成"这个类型接受的是这些"。`ice-chart-dsl` 的
 * 列名诊断（`列「销售额」不存在。可用列：月份 / 销量 / 渠道。`）就是这个口径。
 */
import {
  BOOLEAN_FIELD_TYPES,
  FORM_DSL_FIELD_TYPES,
  FORM_DSL_KINDS,
  FORM_DSL_SCHEMA_VERSION,
  NUMERIC_FIELD_TYPES,
  OPTION_FIELD_TYPES,
  TEXT_FIELD_TYPES,
  type FormDslDiagnostic,
  type FormDslFieldType,
  type FormDslValidationResult,
} from './types';

const ROOT_FIELDS = [
  'schemaVersion',
  'kind',
  'title',
  'description',
  'layout',
  'width',
  'gap',
  'fields',
  'submitText',
];

/** 所有字段类型都接受的键。 */
const COMMON_FIELD_KEYS = [
  'name',
  'type',
  'label',
  'placeholder',
  'default',
  'required',
  'min',
  'max',
  'minLength',
  'maxLength',
  'pattern',
  'message',
  'rules',
  'dependencies',
  'width',
  'props',
];

/** 各类型自己额外接受的键（白名单之外的键会被忽略并给警告）。 */
const TYPE_FIELD_KEYS: Record<FormDslFieldType, string[]> = {
  text: ['allowClear', 'showCount'],
  textarea: ['allowClear', 'showCount'],
  password: ['allowClear', 'showCount', 'showToggle'],
  number: ['step', 'precision'],
  slider: ['step', 'range'],
  checkbox: [],
  switch: [],
  'radio-group': ['options', 'direction'],
  'checkbox-group': ['options', 'direction', 'maxChecked'],
  select: ['options', 'mode', 'showSearch'],
  date: ['placement'],
};

/** 浮层位置。与 `ICEOverlayPlacement` 保持一致 —— 在这里校验而不是重新声明联合类型，
 *  这样漂移会被诊断抓到，而且报错信息能直接把合法值列给模型。 */
const OVERLAY_PLACEMENTS = [
  'top', 'topLeft', 'topRight',
  'bottom', 'bottomLeft', 'bottomRight',
  'left', 'leftTop', 'leftBottom',
  'right', 'rightTop', 'rightBottom',
];

const RULE_KEYS = ['required', 'min', 'max', 'minLength', 'maxLength', 'pattern', 'message'];

function isPlainObject(value: any): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: any): boolean {
  return typeof value === 'number' && isFinite(value);
}

/** 编译正则；失败返回错误信息（`pattern` 在 JSON 里是字符串，得在这里编译）。 */
function compilePattern(pattern: any): { re?: RegExp; error?: string } {
  if (typeof pattern !== 'string') {
    return { error: `pattern 必须是字符串（JSON 里写不出正则字面量），当前是 ${typeof pattern}。` };
  }
  try {
    return { re: new RegExp(pattern) };
  } catch (err) {
    return { error: `pattern 不是合法正则：${(err as Error).message}` };
  }
}

/** 校验一个“规则对象”（shorthand 或 `rules[]` 里的一项）的声明式形状。 */
function checkRuleObject(
  rule: any,
  path: string,
  fieldType: FormDslFieldType | null,
  fail: (code: string, message: string, path?: string) => void,
  warn: (code: string, message: string, path?: string) => void
): void {
  if (!isPlainObject(rule)) {
    fail('invalid-rule', `规则必须是对象。可用键：${RULE_KEYS.join(' / ')}。`, path);
    return;
  }
  for (const key of Object.keys(rule)) {
    if (!RULE_KEYS.includes(key)) {
      warn('unknown-rule-key', `规则里不认识「${key}」会被忽略。可用键：${RULE_KEYS.join(' / ')}。`, `${path}.${key}`);
    }
  }
  for (const key of ['min', 'max', 'minLength', 'maxLength'] as const) {
    if (rule[key] !== undefined && !isFiniteNumber(rule[key])) {
      fail('rule-value-not-number', `规则「${key}」必须是数字。`, `${path}.${key}`);
    }
  }
  if (rule.min !== undefined && rule.max !== undefined && isFiniteNumber(rule.min) && isFiniteNumber(rule.max) && rule.min > rule.max) {
    fail('range-inverted', `规则 min（${rule.min}）不能大于 max（${rule.max}）。`, path);
  }
  if (
    rule.minLength !== undefined &&
    rule.maxLength !== undefined &&
    isFiniteNumber(rule.minLength) &&
    isFiniteNumber(rule.maxLength) &&
    rule.minLength > rule.maxLength
  ) {
    fail('length-range-inverted', `规则 minLength（${rule.minLength}）不能大于 maxLength（${rule.maxLength}）。`, path);
  }
  if (rule.pattern !== undefined) {
    const compiled = compilePattern(rule.pattern);
    if (compiled.error) {
      fail('invalid-pattern', compiled.error, `${path}.pattern`);
    }
  }
  // 长度类规则只对字符串/数组有意义；写在数值字段上几乎一定是把 min 与 minLength 弄混了
  if (
    fieldType &&
    (NUMERIC_FIELD_TYPES.includes(fieldType) || BOOLEAN_FIELD_TYPES.includes(fieldType)) &&
    (rule.minLength !== undefined || rule.maxLength !== undefined)
  ) {
    warn(
      'rule-not-applicable',
      `「${fieldType}」的取值不是字符串/数组，minLength / maxLength 不会生效` +
        `（数值范围要用 min / max）。`,
      path
    );
  }
}

/** 校验一个字段。 */
function checkField(
  field: any,
  index: number,
  names: Map<string, number>,
  fail: (code: string, message: string, path?: string) => void,
  warn: (code: string, message: string, path?: string) => void
): void {
  const at = `fields[${index}]`;

  if (!isPlainObject(field)) {
    fail('field-not-object', `字段必须是对象。可用类型：${FORM_DSL_FIELD_TYPES.join(' / ')}。`, at);
    return;
  }

  // ---- name ----
  if (field.name === undefined || field.name === null || field.name === '') {
    fail('missing-name', '字段缺少 name —— 它是取值键，也是 dependencies 引用的名字。', at);
  } else if (typeof field.name !== 'string') {
    fail('invalid-name', `name 必须是字符串，当前是 ${typeof field.name}。`, `${at}.name`);
  } else if (names.has(field.name)) {
    fail(
      'duplicate-name',
      `name「${field.name}」重复了（第 ${names.get(field.name)} 个字段已经用过）。` +
        '每个字段的 name 必须唯一，否则取值会互相覆盖。',
      `${at}.name`
    );
  } else {
    names.set(field.name, index);
  }

  // ---- type ----
  const type = field.type;
  if (type === undefined || type === null) {
    fail('missing-type', `字段缺少 type。可用类型：${FORM_DSL_FIELD_TYPES.join(' / ')}。`, at);
  } else if (typeof type !== 'string' || !FORM_DSL_FIELD_TYPES.includes(type as FormDslFieldType)) {
    fail(
      'unsupported-field-type',
      `不支持的字段类型「${String(type)}」。可用类型：${FORM_DSL_FIELD_TYPES.join(' / ')}。`,
      `${at}.type`
    );
  }
  const knownType = typeof type === 'string' && FORM_DSL_FIELD_TYPES.includes(type as FormDslFieldType);

  // ---- 白名单外的键 ----
  if (knownType) {
    const allowed = COMMON_FIELD_KEYS.concat(TYPE_FIELD_KEYS[type as FormDslFieldType]);
    const unknown = Object.keys(field).filter((key) => !allowed.includes(key));
    for (const key of unknown) {
      warn(
        'unknown-field',
        `「${type}」不认识字段属性「${key}」会被忽略。它接受：` +
          `${TYPE_FIELD_KEYS[type as FormDslFieldType].join(' / ') || '（没有专属属性）'}` +
          `，以及通用属性 ${COMMON_FIELD_KEYS.join(' / ')}。`,
        `${at}.${key}`
      );
    }
  }

  // ---- options ----
  const needsOptions = knownType && OPTION_FIELD_TYPES.includes(type as FormDslFieldType);
  if (needsOptions) {
    if (field.options === undefined) {
      fail(
        'options-required',
        `「${type}」是选项型字段，必须提供 options（形如 [{ value, label }]）。`,
        `${at}.options`
      );
    } else if (!Array.isArray(field.options)) {
      fail('invalid-options', `options 必须是数组（形如 [{ value, label }]）。`, `${at}.options`);
    } else if (field.options.length === 0) {
      fail('empty-options', `「${type}」的 options 不能为空数组 —— 没有选项就没得选。`, `${at}.options`);
    } else {
      const seen = new Map<string, number>();
      field.options.forEach((option: any, i: number) => {
        const optionAt = `${at}.options[${i}]`;
        if (!isPlainObject(option)) {
          fail('option-invalid', '选项必须是对象（形如 { value, label }）。', optionAt);
          return;
        }
        if (option.value === undefined || option.value === null || option.value === '') {
          fail('option-missing-value', '选项缺少 value。', optionAt);
          return;
        }
        if (typeof option.value !== 'string') {
          fail('option-value-not-string', `选项的 value 必须是字符串（控件取值按字符串比对），当前是 ${typeof option.value}。`, optionAt);
          return;
        }
        if (seen.has(option.value)) {
          fail('duplicate-option-value', `选项 value「${option.value}」重复了（第 ${seen.get(option.value)} 项已经用过）。`, optionAt);
        } else {
          seen.set(option.value, i);
        }
      });
    }
  } else if (field.options !== undefined && knownType) {
    warn(
      'options-not-allowed',
      `「${type}」不是选项型字段，options 会被忽略` +
        `（需要选项的类型：${OPTION_FIELD_TYPES.join(' / ')}）。`,
      `${at}.options`
    );
  }

  // ---- default ----
  if (field.default !== undefined && knownType) {
    const t = type as FormDslFieldType;
    if (BOOLEAN_FIELD_TYPES.includes(t) && typeof field.default !== 'boolean') {
      fail('default-type-mismatch', `「${t}」的默认值必须是布尔（true / false），当前是 ${typeof field.default}。`, `${at}.default`);
    } else if (NUMERIC_FIELD_TYPES.includes(t) && !isFiniteNumber(field.default)) {
      fail('default-type-mismatch', `「${t}」的默认值必须是数字，当前是 ${typeof field.default}。`, `${at}.default`);
    } else if (TEXT_FIELD_TYPES.includes(t) && typeof field.default !== 'string') {
      fail('default-type-mismatch', `「${t}」的默认值必须是字符串，当前是 ${typeof field.default}。`, `${at}.default`);
    } else if (OPTION_FIELD_TYPES.includes(t) && typeof field.default !== 'string') {
      fail(
        'default-type-mismatch',
        t === 'checkbox-group'
          ? `「${t}」的默认值必须是字符串数组（形如 ["a","b"]）。`
          : `「${t}」的默认值必须是某个选项的 value（字符串）。`,
        `${at}.default`
      );
    }
    // 默认值必须落在 options 里
    if (
      knownType &&
      typeof field.default === 'string' &&
      Array.isArray(field.options) &&
      field.options.length > 0 &&
      t !== 'date'
    ) {
      const values = field.options.filter(isPlainObject).map((o: any) => o.value);
      if (values.length && !values.includes(field.default)) {
        fail(
          'default-not-in-options',
          `默认值「${field.default}」不在 options 里。可用取值：${values.join(' / ')}。`,
          `${at}.default`
        );
      }
    }
  }

  // ---- dependencies ----
  if (field.dependencies !== undefined) {
    if (!Array.isArray(field.dependencies)) {
      fail('invalid-dependencies', 'dependencies 必须是字段名数组（形如 ["password"]）。', `${at}.dependencies`);
    } else {
      field.dependencies.forEach((dep: any, i: number) => {
        const depAt = `${at}.dependencies[${i}]`;
        if (typeof dep !== 'string') {
          fail('invalid-dependency', `依赖项必须是字段名（字符串），当前是 ${typeof dep}。`, depAt);
          return;
        }
        if (dep === field.name) {
          fail('self-dependency', `字段不能依赖自己（「${dep}」）。`, depAt);
        }
      });
    }
  }

  // ---- 校验 shorthand ----
  const shorthand: any = {};
  for (const key of ['required', 'min', 'max', 'minLength', 'maxLength', 'pattern', 'message'] as const) {
    if (field[key] !== undefined) shorthand[key] = field[key];
  }
  if (Object.keys(shorthand).length > 0) {
    checkRuleObject(shorthand, `${at}（校验 shorthand）`, knownType ? (type as FormDslFieldType) : null, fail, warn);
    if (shorthand.required !== undefined && typeof shorthand.required !== 'boolean') {
      fail('required-not-boolean', `required 必须是布尔（true / false），当前是 ${typeof shorthand.required}。`, `${at}.required`);
    }
  }
  // 数值字段的 min/max 会同时约束控件；控件侧要求有限数字
  if (knownType && NUMERIC_FIELD_TYPES.includes(type as FormDslFieldType)) {
    for (const key of ['min', 'max'] as const) {
      if (field[key] !== undefined && !isFiniteNumber(field[key])) {
        fail('field-constraint-not-number', `「${type}」的 ${key} 必须是数字（它同时用于控件夹取与校验）。`, `${at}.${key}`);
      }
    }
  }

  // ---- 各类型的枚举型属性 ----
  if (knownType && type === 'date' && field.placement !== undefined && !OVERLAY_PLACEMENTS.includes(field.placement)) {
    fail(
      'invalid-placement',
      `placement「${String(field.placement)}」不是合法的浮层位置。可用值：${OVERLAY_PLACEMENTS.join(' / ')}。`,
      `${at}.placement`
    );
  }
  if (knownType && type === 'select' && field.mode !== undefined && !['single', 'multiple', 'tags'].includes(field.mode)) {
    fail('invalid-mode', `mode「${String(field.mode)}」不合法。可用值：single / multiple / tags。`, `${at}.mode`);
  }
  if (knownType && (type === 'radio-group' || type === 'checkbox-group') && field.direction !== undefined && !['horizontal', 'vertical'].includes(field.direction)) {
    fail('invalid-direction', `direction「${String(field.direction)}」不合法。可用值：horizontal / vertical。`, `${at}.direction`);
  }

  // ---- rules[] ----
  if (field.rules !== undefined) {
    if (!Array.isArray(field.rules)) {
      fail('invalid-rules', 'rules 必须是数组（形如 [{ minLength: 6 }]）。', `${at}.rules`);
    } else {
      field.rules.forEach((rule: any, i: number) => {
        checkRuleObject(rule, `${at}.rules[${i}]`, knownType ? (type as FormDslFieldType) : null, fail, warn);
      });
    }
  }
}

/**
 * 校验表单 DSL。
 *
 * @returns `{ valid, errors, warnings }` —— **不抛异常**。
 */
export function validateFormDsl(dsl: any): FormDslValidationResult {
  const errors: FormDslDiagnostic[] = [];
  const warnings: FormDslDiagnostic[] = [];
  const fail = (code: string, message: string, path?: string) => errors.push({ severity: 'error', code, message, path });
  const warn = (code: string, message: string, path?: string) => warnings.push({ severity: 'warning', code, message, path });
  const finish = (): FormDslValidationResult => ({ valid: errors.length === 0, errors, warnings });

  if (!isPlainObject(dsl)) {
    fail('invalid-root', 'DSL 根节点必须是一个对象。');
    return finish();
  }

  if (dsl.schemaVersion !== undefined && dsl.schemaVersion !== FORM_DSL_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      `不支持的 schemaVersion：${String(dsl.schemaVersion)}（当前是 ${FORM_DSL_SCHEMA_VERSION}）。`,
      'schemaVersion'
    );
  }

  if (!dsl.kind) {
    fail('missing-kind', `缺少 kind。可用类型：${FORM_DSL_KINDS.join(' / ')}。`, 'kind');
  } else if (!FORM_DSL_KINDS.includes(dsl.kind)) {
    fail('unsupported-kind', `不支持的 kind「${String(dsl.kind)}」。可用类型：${FORM_DSL_KINDS.join(' / ')}。`, 'kind');
  }

  for (const key of Object.keys(dsl)) {
    if (!ROOT_FIELDS.includes(key)) {
      warn('unknown-field', `未知字段「${key}」会被忽略。可用字段：${ROOT_FIELDS.join(' / ')}。`, key);
    }
  }

  if (dsl.layout !== undefined && dsl.layout !== 'vertical' && dsl.layout !== 'horizontal') {
    fail('invalid-layout', `layout 只能是 'vertical' 或 'horizontal'，当前是「${String(dsl.layout)}」。`, 'layout');
  }
  for (const key of ['width', 'gap'] as const) {
    if (dsl[key] !== undefined && !(isFiniteNumber(dsl[key]) && dsl[key] > 0)) {
      warn('invalid-number', `${key} 应该是正数，当前是「${String(dsl[key])}」会被忽略。`, key);
    }
  }
  if (dsl.submitText !== undefined && dsl.submitText !== null && typeof dsl.submitText !== 'string') {
    warn('invalid-submit-text', `submitText 应该是字符串或 null，当前是 ${typeof dsl.submitText}。`, 'submitText');
  }

  if (dsl.fields === undefined) {
    fail('missing-fields', '缺少 fields —— 表单至少要有一个字段。');
  } else if (!Array.isArray(dsl.fields)) {
    fail('invalid-fields', 'fields 必须是数组。', 'fields');
  } else if (dsl.fields.length === 0) {
    fail('empty-fields', 'fields 不能为空数组 —— 空表单没有意义。', 'fields');
  } else {
    const names = new Map<string, number>();
    dsl.fields.forEach((field: any, index: number) => checkField(field, index, names, fail, warn));

    // 依赖必须指向存在的字段。**必须放在字段都收完名字之后**，否则前向引用会被误判。
    const available = Array.from(names.keys());
    dsl.fields.forEach((field: any, index: number) => {
      if (!isPlainObject(field) || !Array.isArray(field.dependencies)) return;
      field.dependencies.forEach((dep: any, i: number) => {
        if (typeof dep !== 'string') return;
        if (dep !== field.name && !names.has(dep)) {
          fail(
            'unknown-dependency',
            `依赖的字段「${dep}」不存在。可用字段：${available.join(' / ')}。`,
            `fields[${index}].dependencies[${i}]`
          );
        }
      });
    });
  }

  return finish();
}

/** 把校验结果格式化成可读文本（`renderFormDsl` 抛错时也用它）。 */
export function formatDiagnostics(result: FormDslValidationResult): string {
  const lines = [...result.errors, ...result.warnings].map((item) => {
    const tag = item.severity === 'error' ? '错误' : '警告';
    const at = item.path ? `（${item.path}）` : '';
    return `[${tag}] ${item.message}${at}`;
  });
  return lines.length ? lines.join('\n') : '✓ DSL 校验通过';
}
