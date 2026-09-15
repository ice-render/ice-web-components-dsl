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
  TREE_OPTION_FIELD_TYPES,
  fieldValueShape,
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
  'maxWidth',
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
  // ---- 第二批 ----
  color: ['options'],
  /** `max` = 满分几颗星（会映射到组件的 `count`，同时也进规则）。 */
  rate: [],
  time: ['format'],
  segmented: ['options', 'block'],
  autocomplete: ['options'],
  cascader: ['options', 'separator'],
  'tree-select': ['options', 'mode', 'showSearch'],
  transfer: ['options'],
  'date-range': [],
};

/**
 * `mode` 的合法取值**按字段类型不同** —— 所以是一张表而不是一个联合类型。
 * `select` 多一个 `tags`（可以创造候选里没有的取值），`tree-select` 没有。
 */
const MODE_VALUES: Partial<Record<FormDslFieldType, string[]>> = {
  select: ['single', 'multiple', 'tags'],
  'tree-select': ['single', 'multiple'],
};

/** `time` 的 `format` 合法取值。 */
const TIME_FORMATS = ['HH:mm:ss', 'HH:mm'];

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

/**
 * 校验一份选项列表，并把**可选取值**收集进 `leafValues`。
 *
 * 两个容易搞错的点：
 *
 * 1. **裸字符串是合法的写法**：`"options": ["#61D9FB", "#fff"]`。库里不同控件要的形状
 *    不一样（`colors: string[]` / `options: string[]` / `{value,label}[]`），
 *    让模型记住哪个是哪个就是在收"它记不住"的税 —— 归一化由编译期做。
 * 2. **树的叶子与节点不是一回事**：`cascader` **只能选叶子**（点叶子才定值），
 *    而 `tree-select` **任何节点都能选**。所以 `leafValues` 要按类型决定收什么 ——
 *    否则诊断会说"可用取值：浙江"（那是个永远选不中的值）。
 */
function checkOptionList(
  options: any[],
  at: string,
  treeish: boolean,
  seen: Map<string, number>,
  leafValues: string[],
  fail: (code: string, message: string, path?: string) => void,
  warn: (code: string, message: string, path?: string) => void
): void {
  options.forEach((option: any, i: number) => {
    const optionAt = `${at}[${i}]`;
    if (typeof option === 'string') {
      if (option === '') {
        fail('option-missing-value', '选项不能是空字符串。', optionAt);
        return;
      }
      if (seen.has(option)) {
        fail('duplicate-option-value', `选项「${option}」重复了（第 ${seen.get(option)} 项已经用过）。`, optionAt);
      } else {
        seen.set(option, i);
      }
      leafValues.push(option);
      return;
    }
    if (!isPlainObject(option)) {
      fail('option-invalid', '选项必须是对象（形如 { value, label }）或字符串。', optionAt);
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

    const children = option.children;
    if (children !== undefined) {
      if (!treeish) {
        warn(
          'options-not-allowed',
          `「」的选项不支持 children（只有级联 / 树需要嵌套），这一层会被忽略。`.replace('「」', '本类型'),
          `${optionAt}.children`
        );
      } else if (!Array.isArray(children)) {
        fail('invalid-options', `children 必须是数组。`, `${optionAt}.children`);
      } else if (children.length === 0) {
        warn('empty-options', 'children 是空数组，这一项会被当成叶子。', `${optionAt}.children`);
      } else {
        checkOptionList(children, `${optionAt}.children`, true, seen, leafValues, fail, warn);
      }
    }

    // 叶子才收；cascader 只认叶子，tree-select 任何节点都能选 —— 后者在下面补
    if (!Array.isArray(children) || children.length === 0) leafValues.push(option.value);
    else if (!treeish) leafValues.push(option.value);
  });
}

/**
 * 一个字段的 `options` → **可选取值**列表（用于 `default` 的诊断文案）。
 * 树只收叶子（`cascader` 的语义），扁平列表全收。
 */
function optionValueList(options: any, type: FormDslFieldType): string[] {
  if (!Array.isArray(options)) return [];
  const out: string[] = [];
  const walk = (list: any[], leavesOnly: boolean) => {
    for (const o of list) {
      if (typeof o === 'string') {
        out.push(o);
        continue;
      }
      if (!isPlainObject(o) || typeof o.value !== 'string') continue;
      const hasChildren = Array.isArray(o.children) && o.children.length > 0;
      if (!leavesOnly || !hasChildren) out.push(o.value);
      if (hasChildren) walk(o.children, leavesOnly);
    }
  };
  walk(options, TREE_OPTION_FIELD_TYPES.includes(type));
  return out;
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
  const leafValues: string[] = [];
  if (needsOptions) {
    if (field.options === undefined) {
      fail(
        'options-required',
        `「${type}」是选项型字段，必须提供 options。` +
          '两种写法都行：[{ value, label }] 或直接 ["a", "b"]（后者显示文案就用取值本身）。',
        `${at}.options`
      );
    } else if (!Array.isArray(field.options)) {
      fail('invalid-options', 'options 必须是数组（[{ value, label }] 或 ["a", "b"]）。', `${at}.options`);
    } else if (field.options.length === 0) {
      fail('empty-options', `「${type}」的 options 不能为空数组 —— 没有选项就没得选。`, `${at}.options`);
    } else {
      const treeish = TREE_OPTION_FIELD_TYPES.includes(type as FormDslFieldType);
      checkOptionList(field.options, `${at}.options`, treeish, new Map(), leafValues, fail, warn);
    }
  } else if (field.options !== undefined && knownType) {
    warn(
      'options-not-allowed',
      `「${type}」不是选项型字段，options 会被忽略` +
        `（需要选项的类型：${OPTION_FIELD_TYPES.join(' / ')}）。`,
      `${at}.options`
    );
  }

  // ---- 类型专属属性的取值 ----
  if (knownType) {
    const t = type as FormDslFieldType;
    const allowedModes = MODE_VALUES[t];
    if (field.mode !== undefined) {
      if (!allowedModes) {
        warn('unknown-field', `「${t}」不认识 mode 会被忽略。`, `${at}.mode`);
      } else if (!allowedModes.includes(field.mode)) {
        fail(
          'invalid-mode',
          `「${t}」的 mode 只能是 ${allowedModes.join(' / ')}，当前是「${String(field.mode)}」。`,
          `${at}.mode`
        );
      }
    }
    if (field.format !== undefined && t === 'time' && !TIME_FORMATS.includes(field.format)) {
      fail(
        'invalid-format',
        `time 的 format 只能是 ${TIME_FORMATS.join(' / ')}，当前是「${String(field.format)}」。`,
        `${at}.format`
      );
    }
  }

  // ---- default ----
  //
  // 形状判据来自 `fieldValueShape()` —— 它是**「类型 + 属性」**的函数，不是类型的函数：
  // `select` / `tree-select` 的默认值是标量还是数组取决于 `mode`；
  // `checkbox-group` / `transfer` 是数组；`date-range` 是两头齐全的元组。
  //
  // 这里修掉过一个真 bug：原先对选项型字段一律要求 `typeof default === 'string'`，
  // 于是 `checkbox-group` 给一个**合法的数组默认值**会被拒 —— 而报错文案还写着
  // "必须是字符串数组"。多选组从来就设不了初值。
  if (field.default !== undefined && knownType) {
    const t = type as FormDslFieldType;
    const shape = fieldValueShape(field);
    const optionValues = optionValueList(field.options, t);
    const label = `可用取值：${optionValues.join(' / ')}。`;

    if (shape === 'array') {
      if (!Array.isArray(field.default)) {
        fail(
          'default-type-mismatch',
          `「${t}」的默认值是**数组**（形如 ["a","b"]）${t === 'select' || t === 'tree-select' ? ` —— 它现在是 mode: "${field.mode ?? 'multiple'}"` : ''}，当前是 ${typeof field.default}。`,
          `${at}.default`
        );
      } else {
        const bad = field.default.filter((v: any) => typeof v !== 'string');
        if (bad.length) {
          fail('default-type-mismatch', `「${t}」默认值的每一项都必须是字符串（选项的 value）。`, `${at}.default`);
        } else if (optionValues.length) {
          const missing = field.default.filter((v: string) => !optionValues.includes(v));
          if (missing.length) {
            fail('default-not-in-options', `默认值里的 ${missing.map((m: string) => `「${m}」`).join(' / ')} 不在 options 里。${label}`, `${at}.default`);
          }
        }
      }
      field.default = field.default; // 保持原样（数组），编译期直接交给组件
    } else if (shape === 'tuple') {
      // `date-range`：两头齐全才算数。只给一头 = 进行中，不是有效初值。
      const d = field.default;
      const okShape = Array.isArray(d) && d.length === 2 && d.every((v: any) => typeof v === 'string' || v === null);
      if (!okShape) {
        fail(
          'default-type-mismatch',
          `「${t}」的默认值必须是**两头**的数组（形如 ["2026-01-01","2026-01-31"]），当前是 ${JSON.stringify(d)}。` +
            '只给一头表示"还没选完"，不能作为初始值。',
          `${at}.default`
        );
      } else if (d.some((v: any) => v === null)) {
        fail(
          'default-type-mismatch',
          `「${t}」的默认值两头都要有日期（形如 ["2026-01-01","2026-01-31"]），当前是 ${JSON.stringify(d)}。`,
          `${at}.default`
        );
      }
    } else if (BOOLEAN_FIELD_TYPES.includes(t) && typeof field.default !== 'boolean') {
      fail('default-type-mismatch', `「${t}」的默认值必须是布尔（true / false），当前是 ${typeof field.default}。`, `${at}.default`);
    } else if (NUMERIC_FIELD_TYPES.includes(t) && !isFiniteNumber(field.default)) {
      fail('default-type-mismatch', `「${t}」的默认值必须是数字，当前是 ${typeof field.default}。`, `${at}.default`);
    } else if (TEXT_FIELD_TYPES.includes(t) && typeof field.default !== 'string') {
      fail('default-type-mismatch', `「${t}」的默认值必须是字符串，当前是 ${typeof field.default}。`, `${at}.default`);
    } else if (OPTION_FIELD_TYPES.includes(t) && typeof field.default !== 'string') {
      fail('default-type-mismatch', `「${t}」的默认值必须是某个选项的 value（字符串）。`, `${at}.default`);
    } else if (
      typeof field.default === 'string' &&
      optionValues.length &&
      !optionValues.includes(field.default)
    ) {
      fail('default-not-in-options', `默认值「${field.default}」不在 options 里。${label}`, `${at}.default`);
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
  for (const key of ['width', 'maxWidth', 'gap'] as const) {
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
