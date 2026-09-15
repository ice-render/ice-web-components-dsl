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
  ICEButton,
  ICECheckBox,
  ICECheckboxGroup,
  ICEDatePicker,
  ICEForm,
  ICEFormItem,
  ICEInputNumber,
  ICEPasswordField,
  ICERadioGroup,
  ICESelect,
  ICESlider,
  ICESwitch,
  ICETextArea,
  ICETextField,
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
 * 选项归一化：`ICESelectOption.label` 是**必填**，而 DSL 里允许不给。
 * 用 `value` 兜底 —— 这是"意图级默认"的一个小例子：模型只想给取值时，
 * 显示文案至少有东西可画，而不是报错。
 */
function normalizeOptions(field: FormDslField): any[] | undefined {
  if (!Array.isArray(field.options)) return undefined;
  return field.options.map((option) => ({
    ...option,
    label: option.label ?? option.value,
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
 * 哪些字段类型**不**跟着表单宽度拉伸，以及它们该多宽。
 *
 * **只有数值这一类**，理由是 `ICEInputNumber` 自己的内部布局：减号贴最左端、数值居中，
 * 宽度一拉大这两样就天各一方（实测 890px 时看着像坏了）—— 数值输入该是它自己那个尺寸。
 *
 * 反过来，其余类型都必须拉伸，因为它们的出厂默认是**退化的**：
 * `slider` 默认 10px、`checkbox` 默认 0px、`radio-group` 默认 35px ——
 * 不给宽度就会画出一个看不见的控件（实测：不拉伸时滑块只有 10px）。
 * 而文本类的输入框太窄本身就是问题：它装的是句子。
 *
 * 这就是"意图级默认"要编码的东西 —— 模型不该为这种事写宽度。
 */
const FIXED_WIDTH_TYPES: Partial<Record<FormDslFieldType, number>> = { number: 200 };

/**
 * 一个字段 → 一个控件实例。
 *
 * 这里就是"一处声明、两处生效"落地的地方：
 * - `number` / `slider` 的 `min` / `max` 既进控件（步进夹取），也进规则（校验）；
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
  const passthrough = field.props || {};
  const base: Record<string, any> = { value: undefined, width, ...passthrough };
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
      return new ICECheckBox({ ...passthrough, width, ...(field.default !== undefined ? { selected: field.default } : {}) });
    case 'switch':
      return new ICESwitch({ ...passthrough, width, ...(field.default !== undefined ? { selected: field.default } : {}) });
    case 'radio-group':
      return new ICERadioGroup({
        ...passthrough,
        width,
        options: normalizeOptions(field),
        ...(field.default !== undefined ? { value: field.default } : {}),
        ...(field.direction !== undefined ? { direction: field.direction } : {}),
      });
    case 'checkbox-group':
      return new ICECheckboxGroup({
        ...passthrough,
        width,
        options: normalizeOptions(field),
        ...(field.default !== undefined ? { value: field.default } : {}),
        ...(field.direction !== undefined ? { direction: field.direction } : {}),
        ...(field.maxChecked !== undefined ? { max: field.maxChecked } : {}),
      });
    case 'select':
      return new ICESelect({
        ...passthrough,
        width,
        options: normalizeOptions(field),
        ...(field.default !== undefined ? { value: field.default } : {}),
        ...(field.mode !== undefined ? { mode: field.mode } : {}),
        ...(field.showSearch !== undefined ? { showSearch: field.showSearch } : {}),
      });
    case 'date':
      return new ICEDatePicker({
        ...passthrough,
        width,
        ...(field.default !== undefined ? { value: field.default } : {}),
        // `placement` 在 DSL 类型里是 string、由 validate.ts 按白名单校验
        // （对 agent 来说"诊断里列出合法值"比 TS 联合类型有用，也避免与上游漂移）。
        // 这里是唯一一处需要把它交给严格类型的地方，所以就地断言一次。
        ...(field.placement !== undefined ? { placement: field.placement as any } : {}),
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
