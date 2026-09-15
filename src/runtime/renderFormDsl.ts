/**
 * 运行时：一块画布 + 一份表单 DSL → 屏幕上真的一张表单。
 *
 * 一次性便利函数，跟 `ice-chart-dsl` 的 `renderChartDsl` 同形。
 * 需要复用同一个 ICE 实例（比如表单要跟别的东西共处一张画布）时，
 * 直接用 `compileFormDsl()` 拿组件树，自己 `ice.addChild()`。
 */
import { ICE } from 'ice-render';
import type { FormDslDocument, FormDslValidationResult } from '../types';
import { validateFormDsl } from '../validate';
import { compileFormDsl, type CompiledForm } from '../compiler/formDslToForm';

export interface RenderFormDslOptions {
  /** 提交回调（校验通过才触发）。等价于 `compiled.onSubmit`。 */
  onSubmit?: (values: Record<string, any>) => void;
  /** 设备像素比。默认取 `devicePixelRatio`。 */
  dpr?: number;
  /**
   * 宿主能给的宽度（CSS 像素）。
   *
   * **建议传**：表单多宽取决于它被放哪儿，而 DSL 不知道这件事。不传就用 `dsl.width`
   * 再退回 360 —— 那时如果宿主容器比它宽，右边会空出一大片。
   */
  width?: number;
  /** 表单能用的**最大**宽度，默认 640（也可以用 `dsl.maxWidth` 声明）。至少比 `width` 大才有意义。 */
  maxWidth?: number;
}

export interface RenderFormDslResult {
  ice: ICE;
  compiled: CompiledForm;
  /**
   * 表单**实际**用的宽度（CSS 像素）—— 已经被 `maxWidth` 夹过。
   *
   * 宿主拿它来决定"画布/容器该多宽"。不提供这个值的话，宿主只能用自己给的宽度去定画布，
   * 而 DSL 悄悄夹到了 640 —— 于是画布比表单宽出一截，看起来像右边空了一块。
   * 是个取值器：`setWidth()` 之后读到的就是新值。
   */
  readonly width: number;
  /** 校验结果（含 warning）：编译能过但值得提醒的地方都在这里。 */
  diagnostics: FormDslValidationResult;
  /**
   * 按新的显示尺寸重排。
   *
   * 尺寸契约交给引擎的 `ICE.fitCanvasToDisplaySize()`（ice-render 2.12.0 起）——
   * 应用层不要自己写 `canvasWidth` / `canvasHeight`，那是最容易漏掉 dpr 的地方。
   */
  resize(cssWidth: number, cssHeight: number): void;
  /**
   * 把表单对齐到一个新宽度（画布尺寸用 `resize`，这一条管内容）。
   * 宿主容器变宽时两个都要调。
   */
  setWidth(width: number): void;
  /** 内容实际需要的高度（给宿主用来决定画布该多高）。布局未完成时返回 0。 */
  measureContentHeight(): number;
  destroy(): void;
}

/**
 * 渲染一份表单 DSL。
 *
 * 校验不通过会抛 `FormDslCompileError`（带结构化诊断）。
 * 想「先看诊断再决定要不要画」就先调 `validateFormDsl`。
 */
export function renderFormDsl(
  target: string | HTMLCanvasElement,
  dsl: FormDslDocument,
  options: RenderFormDslOptions = {}
): RenderFormDslResult {
  const diagnostics = validateFormDsl(dsl);
  const compiled = compileFormDsl(dsl, { width: options.width, maxWidth: options.maxWidth });

  const ice = new ICE();
  ice.init(target as any, { dpr: options.dpr ?? (globalThis as any).devicePixelRatio ?? 1 });
  ice.addChild(compiled.container);

  if (options.onSubmit) compiled.onSubmit(options.onSubmit);

  return {
    ice,
    compiled,
    diagnostics,
    get width() {
      return Number((compiled.container as any)?.state?.width) || 0;
    },
    resize(cssWidth, cssHeight) {
      ice.fitCanvasToDisplaySize(cssWidth, cssHeight);
    },
    /** 表单本身的对齐宽度（与画布尺寸是两件事）。 */
    setWidth(width) {
      compiled.setWidth(width);
    },
    /**
     * 内容实际需要的高度。
     *
     * 先问布局器（`getPreferredSize`），它答不上来就按子节点的下沿自己算 ——
     * 应用层不该去猜 `ICEFormItem` 的标签行高与间距，那是上游的排版逻辑。
     */
    measureContentHeight() {
      const container: any = compiled.container;
      const preferred = container.getPreferredSize?.();
      if (Array.isArray(preferred) && isFinite(preferred[1]) && preferred[1] > 0) {
        return preferred[1];
      }
      let bottom = 0;
      for (const child of container.childNodes || []) {
        const top = Number(child?.state?.top) || 0;
        const height = Number(child?.state?.height) || 0;
        bottom = Math.max(bottom, top + height);
      }
      return bottom;
    },
    destroy() {
      compiled.destroy();
      ice.destroy();
    },
  };
}
