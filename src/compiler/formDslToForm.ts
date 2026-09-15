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
import { ICEBoxLayout } from 'ice-render';
import {
  ICEButton,
  ICECheckBox,
  ICECheckboxGroup,
  ICEDatePicker,
  ICEForm,
  ICEFormItem,
  ICEInputNumber,
  ICEPanel,
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
  container: ICEPanel;
  form: ICEForm;
  model: ICEFormModel;
  /** `submitText: null` 时为 null（宿主自己接管提交）。 */
  submitButton: ICEButton | null;
  /** 字段名，按声明顺序。 */
  fieldNames: string[];

  getValues(): Record<string, any>;
  setValues(values: Record<string, any>): void;
  reset(): void;
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
 * 一个字段 → 一个控件实例。
 *
 * 这里就是"一处声明、两处生效"落地的地方：
 * - `number` / `slider` 的 `min` / `max` 既进控件（步进夹取），也进规则（校验）；
 * - 文本类的 `maxLength` 既限制输入长度，也进规则。
 * 原生路径这两件事互不相干，模型只会写其中一个。
 */
function createControl(field: FormDslField): any {
  const width = field.width;
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
export function compileFormDsl(dsl: FormDslDocument): CompiledForm {
  const diagnostics = validateFormDsl(dsl);
  if (!diagnostics.valid) {
    throw new FormDslCompileError(
      `表单 DSL 校验不通过：\n${formatDiagnostics(diagnostics)}`,
      diagnostics
    );
  }

  const gap = dsl.gap ?? 12;
  const formWidth = dsl.width ?? 360;
  const fieldNames: string[] = [];

  const form = new ICEForm({ width: formWidth, gap });
  const items = dsl.fields.map((field) => {
    fieldNames.push(field.name);
    return new ICEFormItem({
      name: field.name,
      label: field.label ?? field.name,
      control: createControl(field),
      rules: toNativeRules(field),
      ...(field.dependencies ? { dependencies: field.dependencies } : {}),
      ...(field.width !== undefined ? { width: field.width } : {}),
      layout: dsl.layout ?? 'vertical',
    });
  });
  form.addItems(items);

  // ---- 外层容器：标题 / 说明 / 表单 / 提交按钮，纵向堆叠 ----
  const container = new ICEPanel({ width: formWidth, fill: true });
  container.setLayout(new ICEBoxLayout({ axis: 'y', gap }));
  if (dsl.title) {
    container.addChild(new ICETypography({ text: dsl.title, level: 4, width: formWidth }));
  }
  if (dsl.description) {
    container.addChild(new ICETypography({ text: dsl.description, type: 'secondary', width: formWidth }));
  }
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
    destroy() {
      listeners.length = 0;
      container.destroy();
    },
  };
}
