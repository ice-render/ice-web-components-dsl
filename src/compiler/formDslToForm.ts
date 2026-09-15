/**
 * 编译：表单 DSL → 一棵真实的 `ice-web-components` 组件树。
 *
 * 产物就是普通的引擎组件（`ICEPanel` + `ICEForm` + `ICEFormItem` + 具体控件），
 * 所以下游一切照旧：命中测试、键盘导航、无障碍镜像、主题、序列化都不受影响
 * —— 这一点跟 `ice-chart-dsl` 编译出普通 `ChartOption` 是同一个口径。
 *
 * **不做坐标摆位**：DSL 里根本没有 `left` / `top`，纵向堆叠交给引擎的箱式布局。
 * 一旦放开坐标，模型就会产出互相重叠的控件。
 */
import { ICEBoxLayout, ICEGroup } from 'ice-render';
import {
  ICEAutoComplete,
  ICEButton,
  ICECascader,
  ICECheckBox,
  ICECheckboxGroup,
  ICEColorPicker,
  ICEDatePicker,
  ICEDateRangePicker,
  ICEForm,
  ICEFormItem,
  ICEInputNumber,
  ICEPasswordField,
  ICERadioGroup,
  ICERate,
  ICESegmented,
  ICESelect,
  ICESlider,
  ICESwitch,
  ICETextArea,
  ICETextField,
  ICETimePicker,
  ICETransfer,
  ICETreeSelect,
  ICETypography,
  type ICEFormModel,
} from 'ice-web-components';
import type { FormDslDocument, FormDslField, FormDslFieldType, FormDslRule } from '../types';
import { formatDiagnostics, validateFormDsl } from '../validate';

/** 校验没过时抛这个（带结构化诊断，便于回灌给 agent 自修复）。 */
export class FormDslCompileError extends Error {
  constructor(
    message: string,
    readonly diagnostics: ReturnType<typeof validateFormDsl>
  ) {
    super(message);
    this.name = 'FormDslCompileError';
  }
}

export interface CompiledForm {
  /** 外层容器（标题 + 说明 + 表单 + 提交按钮）。把它 `ice.addChild()` 进去。 */
  container: ICEGroup;
  form: ICEForm;
  model: ICEFormModel;
  /** `submitText: null` 时为 null（宿主自己接管提交）。 */
  submitButton: ICEButton | null;
  /** 字段名，按声明顺序。 */
  fieldNames: string[];

  getValues(): Record<string, any>;
  setValues(values: Record<string, any>): void;
  reset(): void;
  /**
   * 把表单与所有控件重新对齐到一个新宽度（宿主容器尺寸变了时调）。
   * 逐字段显式写了 `width` 的字段不跟着变 —— 那是显式意图。
   */
  setWidth(width: number): void;
  /** 同步提交：校验不过返回 false，不触发 `onSubmit`。 */
  submit(): boolean;
  /** 异步提交：先同步规则、后 asyncValidator。 */
  submitAsync(): Promise<boolean>;
  /** 注册提交回调（校验通过才回调）。返回取消订阅的函数。 */
  onSubmit(listener: (values: Record<string, any>) => void): () => void;
  destroy(): void;
}

/**
 * 选项 → **裸取值数组**。
 *
 * 有几个控件的选项就是"一串取值"而不是"取值 + 文案"：
 * `ICEColorPicker` 的 `colors: string[]`（每个元素是要画的颜色）、
 * `ICEAutoComplete` 的 `options: string[]`（候选就是文本本身）。
 *
 * **这两个不能走 `normalizeOptions`** —— 那会把元素变成 `{value,label}` 对象，
 * 而组件拿到对象时不会报错：色块会画成**空白**、候选会显示成 `[object Object]`。
 * 这个 bug 是靠**真去浏览器里看**才发现的（README 里"文档即契约"那套测试抓不到 ——
 * 它们只验 DSL 合法，不验画出来是什么）。
 *
 * DSL 侧两种写法都收（`["#fff"]` 或 `[{value:"#fff",label:"白"}]`），
 * 对象写法取 `value`，这样模型不必为这个差别换写法。
 */
function toValueList(field: FormDslField): string[] | undefined {
  if (!Array.isArray(field.options)) return undefined;
  return field.options
    .map((option) => (typeof option === 'string' ? option : (option as any)?.value))
    .filter((v): v is string => typeof v === 'string');
}

/**
 * 选项归一化。三件事，都是"agent 不该知道"的差别：
 *
 * 1. **裸字符串 → `{value, label}`**。库里不同控件要的形状不一样：
 *    `ICESelect` 要 `{value,label}[]`、`ICESegmented` 要 `{value,label}[]`、
 *    `ICETreeSelect` 要 `{key,label}[]`。要让模型记住哪个是哪个，就是在收"它记不住"的税。
 * 2. **`label` 兜底成 `value`**：`ICESelectOption.label` 是必填，DSL 里可省。
 * 3. **递归 `children`**：级联 / 树的选项是嵌套的，每层都要归一化。
 *
 * 注意**"一串取值"型的不走这里**（`ICEColorPicker.colors` / `ICEAutoComplete.options`）——
 * 见 `toValueList()`。
 */
function normalizeOptions(field: FormDslField): any[] | undefined {
  if (!Array.isArray(field.options)) return undefined;
  return field.options.map((option) => {
    // 裸字符串写法：`"options": ["#61D9FB", "#fff"]`
    if (typeof option === 'string') return { value: option, label: option };
    const { children, ...rest } = option as any;
    return {
      ...rest,
      label: rest.label ?? rest.value,
      ...(Array.isArray(children) ? { children: normalizeOptions({ options: children } as any) } : {}),
    };
  });
}

/**
 * 选项树 → `ICETreeNode[]`（`ICETreeSelect` 用）。
 *
 * 键名差别：`value` → **`key`**，`label` 保持 `label`。
 * 这层映射就是"让 DSL 只有一种选项形状"的代价 —— 值得，
 * 因为它换来的是模型不必知道"这个控件管取值叫 value、那个叫 key"。
 */
function toTreeNodes(options: any[] | undefined): any[] | undefined {
  if (!options) return undefined;
  return options.map((o) => ({
    key: o.value,
    label: o.label ?? o.value,
    ...(o.disabled !== undefined ? { disabled: o.disabled } : {}),
    ...(Array.isArray(o.children) ? { children: toTreeNodes(o.children) } : {}),
  }));
}

/**
 * 选项 → `ICETransferItem[]`（`ICETransfer` 用）。
 *
 * 这个的键名**又不一样**：`value` → `key`，而 `label` → **`title`**
 * （条目还有 `description`）。第一版我用 `toTreeNodes` 代它，结果穿梭框里
 * **只有复选框、没有文字** —— 不报错，因为 `title: undefined` 是合法的。
 * 这种"键名对不上但类型不报错"的错，只有真去看画出来什么才会发现。
 */
function toTransferItems(options: any[] | undefined): any[] | undefined {
  if (!options) return undefined;
  return options.map((o) => ({
    key: o.value,
    title: o.label ?? o.value,
    ...(o.disabled !== undefined ? { disabled: o.disabled } : {}),
  }));
}

/** 校验 shorthand → 一条规则。原生 `ICEFormRule` 本来就允许一条规则带多个约束。 */
function shorthandRule(field: FormDslField): FormDslRule | null {
  const rule: FormDslRule = {};
  if (field.required) rule.required = true;
  if (typeof field.min === 'number') rule.min = field.min;
  if (typeof field.max === 'number') rule.max = field.max;
  if (typeof field.minLength === 'number') rule.minLength = field.minLength;
  // 文本类字段的 maxLength 同时限制输入长度，见 createControl()
  if (field.maxLength !== undefined) rule.maxLength = field.maxLength;
  if (typeof field.pattern === 'string') rule.pattern = field.pattern;
  if (typeof field.message === 'string') rule.message = field.message;
  return Object.keys(rule).length > 0 ? rule : null;
}

/** 规则的 `pattern` 在原生侧要的是 `RegExp`，DSL 里是字符串。 */
function toNativeRules(field: FormDslField): any[] {
  const rules: any[] = [];
  const shorthand = shorthandRule(field);
  if (shorthand) {
    const native: any = { ...shorthand };
    if (typeof shorthand.pattern === 'string') native.pattern = new RegExp(shorthand.pattern);
    else delete native.pattern;
    rules.push(native);
  }
  for (const rule of field.rules || []) {
    const native: any = { ...rule };
    if (typeof rule.pattern === 'string') native.pattern = new RegExp(rule.pattern);
    else delete native.pattern;
    rules.push(native);
  }
  return rules;
}

/**
 * 哪些字段类型**不**跟着表单宽度拉伸。两种情形，含义不同：
 *
 * - **给一个数字**：控件有宽度、但拉伸它就难看了。`ICEInputNumber` 把减号摆最左、
 *   数值居中，宽度一拉大这两样就天各一方（实测 890px 时看着像坏了）。固定 200。
 * - **`null`**：控件**根本没有宽度这个概念**。`ICERate` 是一排固定大小的星星
 *   （它只有 `count` / `size`，没有 `width`）—— 传宽度不是"拉伸它"，是传一个它不认识的键。
 *
 * 其余类型都必须拉伸，因为它们的出厂默认是**退化的**：
 * `slider` 默认 10px、`checkbox` 默认 0px、`radio-group` 默认 35px ——
 * 不给宽度就会画出一个看不见的控件（实测：不拉伸时滑块只有 10px 宽）。
 */
const FIXED_WIDTH_TYPES: Partial<Record<FormDslFieldType, number | null>> = {
  number: 200,
  rate: null,
};

/**
 * 一个字段 → 一个控件实例。
 *
 * **所有分支的第一件事都是展开 `...base`。** 这曾经是个真事故：`base` 装的是
 * 通用键（`placeholder` / 初值 / `width` / `props` 透传），而有 6 个老分支
 * （`checkbox` / `switch` / `radio-group` / `checkbox-group` / `select` / `date`）
 * 写的是 `...passthrough, width, …` —— 于是 **`placeholder` 从来没传给过它们**，
 * 而且 TypeScript 抓不到（`placeholder` 在这些 Options 接口里都是可选的）。
 * 症状是"下拉框、日期框的占位文案不显示"，直到 2026-09-15 在浏览器里看原型才发现。
 * `tests/control-options.test.ts` 现在对**每一个**类型守这条不变量。
 *
 * 少数派键名（`checkbox`/`switch` 的 `selected`、`transfer` 的 `targetKeys`）
 * 需要把 `base` 里的 `value` 摘掉再补自己的键。
 *
 * 这里就是"一处声明、两处生效"落地的地方：
 * - `number` / `slider` / `rate` 的 `min` / `max` 既进控件（步进夹取 / 满分星数），
 *   也进规则（校验）；
 * - 文本类的 `maxLength` 既限制输入长度，也进规则。
 * 原生路径这两件事互不相干，模型只会写其中一个。
 *
 * 宽度同理，也是"一处声明两处生效"的一种：不写宽度时按**类型**给意图级默认，
 * 而不是让每个控件落到各自的出厂默认（ICETextField 200、ICEInputNumber 140、
 * ICESelect 200…）—— 实测那样同一张表单里几个控件宽度互不相同，右边能空掉 74%。
 * `field.width` 仍然可以逐字段覆盖。
 */
function createControl(field: FormDslField, stretchWidth: number): any {
  const fixed = FIXED_WIDTH_TYPES[field.type];
  const width = field.width ?? (fixed === undefined ? stretchWidth : fixed);
  /** 控件不认宽度（`rate`）时不传这个键 —— 传了不是拉伸，是塞一个它没有的属性。 */
  const widthProp = width === null ? {} : { width };
  const passthrough = field.props || {};
  const base: Record<string, any> = { value: undefined, ...widthProp, ...passthrough };
  if (field.placeholder !== undefined) base.placeholder = field.placeholder;
  if (field.default !== undefined) base.value = field.default;

  const type: FormDslFieldType = field.type;

  switch (type) {
    case 'text':
    case 'textarea': {
      const Control = type === 'textarea' ? ICETextArea : ICETextField;
      return new Control({
        ...base,
        ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
        ...(field.allowClear !== undefined ? { allowClear: field.allowClear } : {}),
        ...(field.showCount !== undefined ? { showCount: field.showCount } : {}),
      });
    }
    case 'password':
      return new ICEPasswordField({
        ...base,
        ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
        ...(field.allowClear !== undefined ? { allowClear: field.allowClear } : {}),
        ...(field.showCount !== undefined ? { showCount: field.showCount } : {}),
      });
    case 'number':
      return new ICEInputNumber({
        ...base,
        ...(field.min !== undefined ? { min: field.min } : {}),
        ...(field.max !== undefined ? { max: field.max } : {}),
        ...(field.step !== undefined ? { step: field.step } : {}),
        ...(field.precision !== undefined ? { precision: field.precision } : {}),
      });
    case 'slider':
      return new ICESlider({
        ...base,
        ...(field.min !== undefined ? { min: field.min } : {}),
        ...(field.max !== undefined ? { max: field.max } : {}),
        ...(field.step !== undefined ? { step: field.step } : {}),
        ...(field.range !== undefined ? { range: field.range } : {}),
      });
    case 'checkbox':
    case 'switch': {
      // 勾选态的初值键名是 **`selected`** 而不是 `value` —— 与 `transfer` 的
      // `targetKeys` 同类（少数派键名）。所以要摘掉 `base` 里的 `value`。
      const { value: _dropValue, ...baseNoValue } = base;
      const Control = type === 'checkbox' ? ICECheckBox : ICESwitch;
      return new Control({
        ...baseNoValue,
        ...(field.default !== undefined ? { selected: field.default } : {}),
      });
    }
    case 'radio-group':
      return new ICERadioGroup({
        ...base,
        options: normalizeOptions(field),
        ...(field.direction !== undefined ? { direction: field.direction } : {}),
      });
    case 'checkbox-group':
      return new ICECheckboxGroup({
        ...base,
        options: normalizeOptions(field),
        ...(field.direction !== undefined ? { direction: field.direction } : {}),
        ...(field.maxChecked !== undefined ? { max: field.maxChecked } : {}),
      });
    case 'select':
      return new ICESelect({
        ...base,
        options: normalizeOptions(field),
        // `mode` 在 DSL 里是 string、由 validate.ts 的 MODE_VALUES 按类型校验
        // （`select` 有 tags、`tree-select` 没有）。就地把关一次交给严格类型。
        ...(field.mode !== undefined ? { mode: field.mode as any } : {}),
        ...(field.showSearch !== undefined ? { showSearch: field.showSearch } : {}),
      });
    case 'date':
      return new ICEDatePicker({
        ...base,
        // `placement` 在 DSL 类型里是 string、由 validate.ts 按白名单校验
        // （对 agent 来说"诊断里列出合法值"比 TS 联合类型有用，也避免与上游漂移）。
        // 这里是唯一一处需要把它交给严格类型的地方，所以就地断言一次。
        ...(field.placement !== undefined ? { placement: field.placement as any } : {}),
      });

    // ---------------------------------------------------------------------
    // 第二批（0.3.0）。分成三组看：值的形状决定要额外操心什么。
    // 值形状是「类型 + 属性」的函数，见 types.ts 的 fieldValueShape()。
    // ---------------------------------------------------------------------

    // ---- 值是标量、选项形状与 `{value,label}` 同形 ----
    //
    // **每个分支都必须先展开 `...base`**：它装着 `placeholder` / `value`（初值）/
    // `width` / `props` 透传。第一版这 9 个分支我写成了 `...passthrough, width, …`，
    // 结果 `placeholder` **全部被静默丢掉** —— 而 TypeScript 抓不到，
    // 因为 `placeholder` 在所有这些 Options 接口里都是可选的。
    // 症状是"级联 / 树选择 / 自动完成的占位文案不显示"，只有真去看画出来什么才会发现。
    case 'segmented':
      return new ICESegmented({
        ...base,
        options: normalizeOptions(field),
        ...(field.block !== undefined ? { block: field.block } : {}),
      });
    case 'color':
      // 两处差别：键名叫 `colors`（不是 `options`），而且元素是**裸颜色字符串**
      // 而不是 `{value,label}` —— 传对象进去色块会画成空白，不报错。
      return new ICEColorPicker({
        ...base,
        ...(field.options !== undefined ? { colors: toValueList(field) ?? [] } : {}),
      });
    case 'autocomplete':
      // 同理：候选就是文本本身（`options: string[]`），不是 `{value,label}`
      return new ICEAutoComplete({
        ...base,
        options: toValueList(field) ?? [],
      });
    case 'cascader':
      // 值是最深一层的 `value`；选项是嵌套的，`children` 已在归一化里递归处理
      return new ICECascader({
        ...base,
        options: normalizeOptions(field),
        ...(field.separator !== undefined ? { separator: field.separator } : {}),
      });
    case 'rate':
      // `max` 在 DSL 里是"满分几颗星"→ 映射到组件的 `count`；
      // **同时**它已经进了规则（`shorthandRule` 里的 `max`），所以"给 6 星"会被拦下。
      // 这正是"一处声明、两处生效"在第二批上的延续。
      return new ICERate({
        ...base,
        ...(field.max !== undefined ? { count: field.max } : {}),
      });
    case 'time':
      return new ICETimePicker({
        ...base,
        // `format` 在 `ICETimePicker` 上恰好是**字符串**联合（不是函数），
        // 所以这个能进 DSL —— 跟 `date` 的 `format` 正好相反（那是函数，进不来）。
        ...(field.format !== undefined ? { format: field.format } : {}),
      });
    case 'tree-select':
      // `nodes` 的键名是 `key` 而不是 `value`，映射一次（`toTreeNodes`）
      return new ICETreeSelect({
        ...base,
        nodes: toTreeNodes(normalizeOptions(field)),
        // `mode` 在 DSL 类型里是 string、由 validate.ts 按**类型**白名单校验：
        // `tree-select` 只认 single/multiple，`select` 还多一个 tags。
        // 让 TS 联合去管这件事的话，错误会出现在这里（"tags 不能赋给 tree-select"），
        // 而 agent 需要的是诊断里说清"这个类型可用哪些取值"。
        ...(field.mode !== undefined ? { mode: field.mode as any } : {}),
        ...(field.showSearch !== undefined ? { showSearch: field.showSearch } : {}),
      });

    // ---- 值是数组 ----
    case 'transfer': {
      // 候选池是 `dataSource`（`{key,title}`），而**值的键名是 `targetKeys`** ——
      // 它是唯一一个初值不走 `value` 的类型（清单里的 `initKey` 记着这件事）。
      // 所以这里要把 `base` 里的 `value` 摘掉，否则会同时塞进一个没人认的 `value`。
      const { value: _dropValue, ...baseNoValue } = base;
      return new ICETransfer({
        ...baseNoValue,
        dataSource: toTransferItems(normalizeOptions(field)),
        ...(field.default !== undefined ? { targetKeys: field.default } : {}),
      });
    }

    // ---- 值是元组 ----
    case 'date-range':
      // 值形状是 `[起, 止]`，且允许一头是 null（"只选了一头"= 进行中）。
      // `required` 的语义**在这里定案**：两头都在才算填完 —— 校验由
      // `ICEFormModel` 的 required 判定负责，它判空数组 / 空串 / null；
      // 而 `setFormValue` 对不完整区间会回落成 `[null, null]`
      // （见 tests/field-values.test.ts 的运行时证据），所以"只选一头"等价于没填。
      return new ICEDateRangePicker({
        ...base,
      });

    default: {
      // 类型已经过校验，走到这里说明 validate 与 compiler 不同步了 —— 响亮失败
      throw new FormDslCompileError(
        `[ice-web-components-dsl] 编译器没有实现字段类型「${String(type)}」`,
        validateFormDsl(field)
      );
    }
  }
}

/**
 * 编译表单 DSL。
 *
 * 校验不通过会抛 `FormDslCompileError`（带结构化诊断）。
 * 想「先看诊断再决定要不要画」就先调 `validateFormDsl`。
 */
export interface CompileFormOptions {
  /**
   * 宿主能给的宽度（CSS 像素）。
   *
   * 不传就用 `dsl.width`，再退回 360。**宿主应该传** —— 表单多宽取决于它被放哪儿，
   * 而 DSL 不知道这件事。
   */
  width?: number;
  /**
   * 表单能用的**最大**宽度，默认 640（也可以用 `dsl.maxWidth` 声明）。
   *
   * 宿主给的宽度会被它夹住：一个 896 宽的抽屉里不该出现 896 宽的输入框。
   * 传 `Infinity` 就是不设上限。
   */
  maxWidth?: number;
}

/** 表单宽度的上限：一行文本没人读得过来。 */
export const DEFAULT_FORM_MAX_WIDTH = 640;
/** 再窄也要能放下一个输入框。 */
const MIN_FORM_WIDTH = 240;

/** 正数才算数（0 / NaN / 负数当成"没给"）。`Infinity` 是合法的 —— 表示"不设上限"。 */
function pickPositive(value: number | undefined): number | undefined {
  if (value === Infinity) return Infinity;
  return typeof value === 'number' && isFinite(value) && value > 0 ? value : undefined;
}

/** 把"宿主能给的宽度"夹到 `[MIN_FORM_WIDTH, maxWidth]`。 */
function clampWidth(width: number, maxWidth: number): number {
  const w = pickPositive(width) ?? MIN_FORM_WIDTH;
  const upper = Math.max(MIN_FORM_WIDTH, maxWidth);
  return Math.min(Math.max(w, MIN_FORM_WIDTH), upper);
}

export function compileFormDsl(dsl: FormDslDocument, options: CompileFormOptions = {}): CompiledForm {
  const diagnostics = validateFormDsl(dsl);
  if (!diagnostics.valid) {
    throw new FormDslCompileError(
      `表单 DSL 校验不通过：\n${formatDiagnostics(diagnostics)}`,
      diagnostics
    );
  }

  const gap = dsl.gap ?? 12;
  const maxWidth = pickPositive(options.maxWidth) ?? pickPositive(dsl.maxWidth) ?? DEFAULT_FORM_MAX_WIDTH;
  const formWidth = clampWidth(options.width ?? dsl.width ?? 360, maxWidth);
  const layout = dsl.layout ?? 'vertical';
  // 横向布局时标签占左边，控件区要相应让出来（80 是 ICEFormItem 的默认 labelWidth）
  const LABEL_WIDTH = 80;
  const stretchWidth = (w: number) =>
    layout === 'horizontal' ? Math.max(120, w - LABEL_WIDTH) : w;
  const fieldNames: string[] = [];
  /** 显式写了 `width` 的字段名：`setWidth` 时不动它们。 */
  const explicitWidths = new Set(dsl.fields.filter((f) => f.width !== undefined).map((f) => f.name));
  /**
   * 字段名 → 它的控件是不是"跟着表单宽度拉伸"的那一类。
   *
   * `setWidth` 要按同一套判据走，所以编译期就得记下来 —— 靠 `field.type` 现算也行，
   * 但那样两处判据会各自漂移，而漂移的症状是"编译时对、resize 之后错"，最难查。
   */
  const stretchByName = new Map<string, boolean>(
    dsl.fields.map((f) => [f.name, FIXED_WIDTH_TYPES[f.type] === undefined])
  );

  const form = new ICEForm({ width: formWidth, gap });
  const items = dsl.fields.map((field) => {
    fieldNames.push(field.name);
    return new ICEFormItem({
      name: field.name,
      label: field.label ?? field.name,
      control: createControl(field, stretchWidth(formWidth)),
      rules: toNativeRules(field),
      ...(field.dependencies ? { dependencies: field.dependencies } : {}),
      // 表单项的宽度显式给：不给的话 ICEFormItem 会从控件自己的宽度反推（`max(控件宽, 120)`），
      // 而 ICEForm 的 align:'stretch' 只拉表单项、不拉控件 —— 于是"拉满"对视觉结果没有作用。
      width: formWidth,
      layout,
    });
  });
  form.addItems(items);

  // ---- 外层容器：标题 / 说明 / 表单 / 提交按钮，纵向堆叠 ----
  //
  // 用 `ICEGroup` 而不是 `ICEPanel`：Panel 是"卡片底座"，它会**强制** fill + stroke + 阴影，
  // 而它自己的高度默认很小 —— 于是那块背景会被画成压在第一个子节点身后的一条横杠
  // （smoke 时肉眼可见）。这里的容器是**纯布局容器**，外观交给宿主（比如冰蓝竖线那种外框）。
  const container = new ICEGroup({ width: formWidth });
  container.setLayout(new ICEBoxLayout({ axis: 'y', gap }));
  const titleNode = dsl.title ? new ICETypography({ text: dsl.title, level: 4, width: formWidth }) : null;
  const descNode = dsl.description
    ? new ICETypography({ text: dsl.description, type: 'secondary', width: formWidth })
    : null;
  if (titleNode) container.addChild(titleNode);
  if (descNode) container.addChild(descNode);
  container.addChild(form);

  const submitText = dsl.submitText === undefined ? '提交' : dsl.submitText;
  let submitButton: ICEButton | null = null;
  if (submitText !== null) {
    submitButton = new ICEButton({ text: submitText, variant: 'primary', width: 112, height: 32 });
    // 用 submitAsync：先同步规则、后 asyncValidator。DSL 表达不了异步校验，
    // 但宿主可以在拿到 model 之后自己 push 一条 asyncValidator —— 这里先把路留通。
    submitButton.on('click', () => {
      void form.submitAsync();
    });
    container.addChild(submitButton);
  }

  const listeners: Array<(values: Record<string, any>) => void> = [];
  form.onSubmit((values) => {
    for (const listener of listeners) listener(values);
  });

  return {
    container,
    form,
    model: form.getModel(),
    submitButton,
    fieldNames,
    getValues: () => form.getValues(),
    setValues: (values) => {
      form.setValues(values);
    },
    reset: () => {
      form.reset();
    },
    submit: () => form.submit(),
    submitAsync: () => form.submitAsync(),
    onSubmit(listener) {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    /**
     * 把表单与控件重新对齐到一个新宽度。
     *
     * `width` 是**宿主能给多少**，不是最终宽度 —— 还会被 `maxWidth` 夹住（见
     * `compileFormDsl` 的注释）。夹这一步必须在这里也做一遍，否则宿主 resize 一放大，
     * 编译期刚夹好的上限就被冲掉了。
     *
     * 之所以要一层层写下去：宽度在 ICE 里是每个组件自己的属性，没有"父级拉满"的自动传导，
     * 所以必须显式对齐整棵树。而对齐的**范围**同样要按类型区分：只有拉伸型的控件跟着变，
     * 数值/开关/选择组保持自己的尺寸（理由见 `STRETCH_TYPES`）。
     */
    setWidth(width: number) {
      // 非法值**什么都不做**（而不是夹到下限去）。两种情形不一样：
      // 编译期必须选一个尺寸（容器 0 宽时用 `MIN_FORM_WIDTH` 兜底），
      // 而 setWidth 是"容器尺寸变了"的通知 —— 尺寸为 0 通常是页签隐藏、布局还没就绪，
      // 那时候最该做的是**别动**，等真的有尺寸了再调一次。
      const requested = pickPositive(width);
      if (requested === undefined) return;
      const next = clampWidth(requested, maxWidth);
      const nextStretch = stretchWidth(next);
      container.setState({ width: next });
      form.setState({ width: next });
      titleNode?.setState({ width: next });
      descNode?.setState({ width: next });
      for (const item of form.getItems() as any[]) {
        item.setState({ width: next });
        const name = item.getName?.() ?? '';
        // 逐字段覆盖过宽度的（`field.width`）不跟着变 —— 那是显式意图
        if (explicitWidths.has(name)) continue;
        if (!stretchByName.get(name)) continue;
        item.getControl?.()?.setState({ width: nextStretch });
      }
      form.doLayout();
      container.doLayout();
    },
    destroy() {
      listeners.length = 0;
      container.destroy();
    },
  };
}
