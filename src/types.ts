/**
 * 表单 DSL 的类型定义。
 *
 * ## 这个 DSL 不是「把 `new ICEForm(...)` 换个写法」
 *
 * `ice-web-components` 的表单是三层的：控件（`ICETextField`/`ICESelect`…）+ `ICEFormItem`
 * （标签/错误排版）+ `ICEForm`（把控件与模型接起来）。**每个字段要写三层构造**，
 * 而且 `name` / `label` / `control` / `rules` 分散在两个对象里。这个 DSL 补的是
 * 那三层不做、**而模型最容易写错**的三件事：
 *
 * 1. **输入形态**：一个扁平的 `fields[]`，每项只要 `{ name, type, label, ... }`。
 *    控件实例、FormItem、模型注册、`change` 接线全部由编译器生成。
 *    这是 `ice-chart-dsl` 里「一张表 + `encoding`」的对偶物。
 *
 * 2. **一处声明、两处生效**：`min`/`max` 在 `number`/`slider` 上**同时**约束控件
 *    （步进夹取）和生成校验规则；`maxLength` 在 `text` 上同时限制输入长度与校验。
 *    原生路径这两件事是分开的 —— `new ICEInputNumber({ min: 18 })` 与
 *    `rules: [{ min: 18 }]` 互不相干，模型只会写其中一个，然后"填了 10 却不报错"。
 *
 * 3. **结构化诊断**：字段类型不认识、选项型字段缺 `options`、
 *    `dependencies` 指向不存在的字段 —— 都能带着位置返回给调用方去自修复。
 *
 * ## 布局在 DSL 里**不可表达**
 *
 * 没有 `left` / `top`。表单的排布由 `layout` 决定，字段的纵向堆叠交给 `ICEForm` 的箱式布局。
 * 一旦放开坐标，模型就会产出互相重叠的控件 —— 控件库有 84 个组件，
 * "让它自己摆"是唯一可行的口径。
 */

export const FORM_DSL_SCHEMA_VERSION = 1;

/**
 * 支持的文档类型。
 *
 * v1 只有 `form`。加新 kind 的条件是「字段表封闭 + 意图明确 + 往返语义唯一」——
 * `card` 之所以还没做，就是因为它的 body 装什么立刻又变成开放问题。
 */
export const FORM_DSL_KINDS = ['form'] as const;
export type FormDslKind = (typeof FORM_DSL_KINDS)[number];

/**
 * 字段类型。每个对应 `ice-web-components` 的一个录入控件。
 *
 * 加新类型的**硬条件**是"值能经 JSON 往返"—— 也就是 `setFormValue(v)` 之后
 * `getFormValue()` 得能给出同一个东西。这条不是纸上标准：
 * `ICEUpload` 的 `setFormValue` 是基类默认的照收不误、组件本身不参与取值，
 * `ICERadioButton` 的 `getFormValue()` 返回的是**布尔**（只表示自己勾没勾，
 * 互斥要调用方维护），两个都不满足，所以都**不在**这张表里。
 * 证据在 `tests/field-values.test.ts`。
 */
export const FORM_DSL_FIELD_TYPES = [
  // ---- 第一批：纯输入 ----
  'text',
  'textarea',
  'password',
  'number',
  'slider',
  'checkbox',
  'switch',
  'radio-group',
  'checkbox-group',
  'select',
  'date',
  // ---- 第二批 ----
  'color',
  'rate',
  'time',
  'segmented',
  'autocomplete',
  'cascader',
  'tree-select',
  'transfer',
  'date-range',
] as const;
export type FormDslFieldType = (typeof FORM_DSL_FIELD_TYPES)[number];

/** 选项型字段：必须提供 `options`。 */
export const OPTION_FIELD_TYPES: FormDslFieldType[] = [
  'radio-group',
  'checkbox-group',
  'select',
  'color',
  'segmented',
  'autocomplete',
  'cascader',
  'tree-select',
  'transfer',
];

/** `options` 允许嵌套 `children` 的类型（级联 / 树）。 */
export const TREE_OPTION_FIELD_TYPES: FormDslFieldType[] = ['cascader', 'tree-select'];

/** 数值型字段：`min` / `max` 会**同时**约束控件与生成校验规则。 */
export const NUMERIC_FIELD_TYPES: FormDslFieldType[] = ['number', 'slider', 'rate'];

/** 文本型字段：`maxLength` 会**同时**限制输入长度与生成校验规则。 */
export const TEXT_FIELD_TYPES: FormDslFieldType[] = ['text', 'textarea', 'password'];

/** 取值为布尔（真/假）的字段类型。 */
export const BOOLEAN_FIELD_TYPES: FormDslFieldType[] = ['checkbox', 'switch'];

/**
 * 值形状：**它是「类型 + 属性」的函数，不是「类型」的函数**。
 *
 * 之前这里是个 `ARRAY_FIELD_TYPES = ['checkbox-group']` 的常量 —— 那是死代码，
 * 而且口径装不下事实：`select` / `tree-select` 的值是标量还是数组**取决于 `mode`**，
 * `date-range` 是元组。按类型列表建模永远差这一块。
 *
 * 现在它有了真实用处：**校验 `default` 的形状**（`date-range` 的 `default` 必须是
 * 两头齐全的数组，`transfer` / 多选的 `select` 必须是数组）。这是 agent 最容易写错的
 * 地方之一，而报错时能说清"你这个类型期望什么形状"正是本包的价值。
 */
export type FormDslValueShape = 'scalar' | 'array' | 'tuple';

export function fieldValueShape(field: Pick<FormDslField, 'type' | 'mode'>): FormDslValueShape {
  if (field.type === 'date-range') return 'tuple';
  if (field.type === 'transfer') return 'array';
  if (field.type === 'checkbox-group') return 'array';
  // 值形状随 `mode` 变的那两个：只有多选才是数组
  if ((field.type === 'select' || field.type === 'tree-select') && field.mode === 'multiple') return 'array';
  return 'scalar';
}

/** 一个选项。`value` 是取值，`label` 只是显示。 */
export interface FormDslOption {
  value: string;
  label?: string;
  disabled?: boolean;
  /** 级联 / 树：下层选项（仅 `cascader` / `tree-select` 用）。 */
  children?: FormDslOption[];
}

/**
 * 声明式规则子集。
 *
 * 只覆盖能写成 JSON 的部分 —— `validator` / `asyncValidator` 是函数，DSL 里表达不了
 * （给了也只能忽略，所以干脆不收）。要自定义校验就在编译产物上自己 push 规则，
 * 见 README「逃生舱」那一节。
 */
export interface FormDslRule {
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  /** 正则**字符串**（`pattern` 的正则字面量在 JSON 里写不出来）。编译时编译成 `RegExp`。 */
  pattern?: string;
  /** 自定义错误文案；不传由 `ICEFormModel` 出默认文案。 */
  message?: string;
}

/** 一个字段。 */
export interface FormDslField {
  /** 取值键。也是 `dependencies` 引用的名字 —— 必须唯一。 */
  name: string;
  type: FormDslFieldType;
  /** 标签。不给则用 `name`。 */
  label?: string;
  placeholder?: string;
  /** 初始值。类型要与字段类型匹配。 */
  default?: any;

  // ---- 校验 shorthand（会与 rules 合并，shorthand 在前）----
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  message?: string;

  /** 追加的声明式规则，按数组顺序接在 shorthand 之后。 */
  rules?: FormDslRule[];

  /** 依赖的字段名。被依赖字段变化时本字段立刻重算（「确认密码」这类）。 */
  dependencies?: string[];

  // ---- 选项型字段 ----
  /**
   * 候选项。
   *
   * **两种写法都收**：`[{ "value": "a", "label": "甲" }]` 或直接 `["a", "b"]`。
   * 后者归一化成 `{ value: s, label: s }`。
   *
   * 之所以要收裸字符串：库里不同的组件要的形状不一样 —— `ICEColorPicker` 要
   * `colors: string[]`、`ICEAutoComplete` 要 `options: string[]`、
   * `ICESelect` 要 `options: {value,label}[]`。**agent 不该知道这些差别**，
   * 那是本包该归一化掉的事（跟 `ICESelectOption.label` 必填一样）。
   *
   * `cascader` / `tree-select` 可以在项上写 `children` 往下嵌。
   */
  options?: FormDslOption[] | string[];

  // ---- 各类型自己的属性（白名单见 validate.ts 的 TYPE_FIELD_KEYS）----
  /** `number` / `slider` / `rate`：步进。`rate` 用不到。 */
  step?: number;
  /** `number`：小数位 */
  precision?: number;
  /** `slider`：区间双滑块 */
  range?: boolean;
  /**
   * `select` / `tree-select`：选择模式。
   *
   * 类型写 `string` 而不是联合 —— 合法取值**按字段类型不同**（`tree-select` 没有 `tags`），
   * 交给 `validate.ts` 的白名单去管：对 agent 来说"诊断里列出这个类型可用哪些取值"
   * 比 TS 报一句"tags 不能赋给 tree-select"有用得多。跟 `placement` 同一个口径。
   */
  mode?: string;
  /** `select` / `tree-select`：可搜索。 */
  showSearch?: boolean;
  /**
   * `date`：浮层位置。
   *
   * 注意 date 没有 `format` —— 原生的 `ICEDatePickerOptions.format` 是
   * `(value: string) => string`，**函数在 JSON 里表达不了**，所以不收。
   * 要自定义显示格式就在编译产物上 `setFormat()`。
   */
  placement?: string;
  /** `radio-group` / `checkbox-group`：排布方向 */
  direction?: 'horizontal' | 'vertical';
  /** `checkbox-group`：最多勾选数 */
  maxChecked?: number;
  /** `text` / `textarea`：可清除、显示字数 */
  allowClear?: boolean;
  showCount?: boolean;

  /**
   * `time`：值格式。`ICETimePickerOptions.format` 恰好是个**字符串**联合
   * （不是函数），所以这个能进 DSL —— 跟 `date` 正好相反。
   */
  format?: 'HH:mm:ss' | 'HH:mm';
  /** `cascader`：已选路径的显示分隔符。 */
  separator?: string;
  /** `segmented`：各段等宽铺满整条（默认 true）。 */
  block?: boolean;

  /** 控件宽度（CSS 像素）。不给则由表单布局决定。 */
  width?: number;

  /**
   * 逃生舱：直接透传给控件构造函数的键。
   * **内容不做校验** —— 白名单之外的键用 `props` 传会静默生效，写错了不报错。
   * 优先用上面的具名属性。
   */
  props?: Record<string, any>;
}

/** 表单 DSL 文档。 */
export interface FormDslDocument {
  schemaVersion?: number;
  kind: FormDslKind;
  title?: string;
  /** 标题下的一句话说明（Agent 常用来解释"为什么要你填这些"）。 */
  description?: string;
  /** 标签在字段上方（默认）还是左侧。 */
  layout?: 'vertical' | 'horizontal';
  /** 表单宽度（CSS 像素）。不给则由宿主决定（见 `maxWidth`）。 */
  width?: number;
  /**
   * 表单**最大**宽度（CSS 像素），默认 640。
   *
   * 宿主给的宽度会被它夹住。为什么需要：稿子里的卡片可能有 896 宽，但一个 896 宽的
   * 「泵站名称」输入框不是"排满了"，是难看 —— 一行文本没人读得过来。
   * 表单该填满的是**内容区**，不是一个抽屉的物理宽度。
   */
  maxWidth?: number;
  /** 字段之间的间距。 */
  gap?: number;
  fields: FormDslField[];
  /**
   * 提交按钮文案。默认「提交」。
   * 传 `null` 表示**不生成**提交按钮（宿主自己接管提交动作）。
   */
  submitText?: string | null;
}

export interface FormDslDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** 出问题的位置，如 `fields[2].options` / `fields[0].dependencies`。 */
  path?: string;
}

export interface FormDslValidationResult {
  valid: boolean;
  errors: FormDslDiagnostic[];
  warnings: FormDslDiagnostic[];
}
