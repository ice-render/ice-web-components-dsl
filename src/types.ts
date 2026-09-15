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

/** 字段类型。每个对应 `ice-web-components` 的一个录入控件。 */
export const FORM_DSL_FIELD_TYPES = [
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
] as const;
export type FormDslFieldType = (typeof FORM_DSL_FIELD_TYPES)[number];

/** 选项型字段：必须提供 `options`。 */
export const OPTION_FIELD_TYPES: FormDslFieldType[] = ['radio-group', 'checkbox-group', 'select'];

/** 数值型字段：`min` / `max` 会**同时**约束控件与生成校验规则。 */
export const NUMERIC_FIELD_TYPES: FormDslFieldType[] = ['number', 'slider'];

/** 文本型字段：`maxLength` 会**同时**限制输入长度与生成校验规则。 */
export const TEXT_FIELD_TYPES: FormDslFieldType[] = ['text', 'textarea', 'password'];

/** 取值为布尔（真/假）的字段类型。 */
export const BOOLEAN_FIELD_TYPES: FormDslFieldType[] = ['checkbox', 'switch'];

/** 取值为字符串数组的字段类型。 */
export const ARRAY_FIELD_TYPES: FormDslFieldType[] = ['checkbox-group'];

/** 一个选项。`value` 是取值，`label` 只是显示 —— 跟 `ICESelect` 的选项同形。 */
export interface FormDslOption {
  value: string;
  label?: string;
  disabled?: boolean;
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
  options?: FormDslOption[];

  // ---- 各类型自己的属性（白名单见 validate.ts 的 FIELD_PROP_WHITELIST）----
  /** `number` / `slider`：步进 */
  step?: number;
  /** `number`：小数位 */
  precision?: number;
  /** `slider`：区间双滑块 */
  range?: boolean;
  /** `select`：`single` / `multiple` / `tags` */
  mode?: 'single' | 'multiple' | 'tags';
  /** `select`：可搜索。 */
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
  /** 表单宽度（CSS 像素）。不给则由宿主决定。 */
  width?: number;
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
