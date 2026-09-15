# Changelog

## 0.1.3 - 2026-09-15

### 修复

- **0.1.2 的"铺满宽度"矫枉过正 —— 加上 `maxWidth`，并按类型区分拉伸。**

  0.1.2 让**所有**控件都跟着表单宽度走，于是 896 宽的卡片里出现了一个 896 宽的
  「目标流量」输入框：减号贴最左端、数值浮在正中间，看着像坏了。
  把 896 全铺满不是"排满了"，是难看 —— 一行文本没人读得过来。

  两条规则：

  1. **`maxWidth`**（默认 640，也支持 `dsl.maxWidth` / `options.maxWidth`，`Infinity` = 不设上限）：
     宿主给的宽度会被夹住，`setWidth()` 也吃同一条上限（否则宿主一放大就把编译期夹好的冲掉了）。
     下限 240，避免容器还没就绪时把表单压塌。
  2. **按类型区分**：只有 `number` **不**拉伸、固定 200；其余类型都拉伸。

  第 2 条是实测出来的，我第一版猜反了：原以为"数值/开关/单选组用组件自己的默认宽度"，
  结果 **`slider` 默认 10px、`checkbox` 默认 0px、`radio-group` 默认 35px** ——
  不拉伸就会画出一个看不见的控件。所以例外只能是 `number`，其余"出厂默认退化"的必须拉伸。

### 新增

- **`RenderFormDslResult.width`** —— 表单**最终**宽度（已夹过 `maxWidth`）的取值器。
  宿主需要它来决定画布/容器多宽：拿自己传进去的宽度去定画布，就会在 640 上限生效时
  宽出一截、右边空一块，看起来跟没修一样。
- `CompileFormOptions.maxWidth` / `RenderFormDslOptions.maxWidth`；`FormDslDocument.maxWidth`
  （已进 `ROOT_FIELDS` 白名单与 JSON schema）。
- `setWidth()` 对非法值（0 / NaN / 负数）**什么都不做**，而不是夹到下限 ——
  尺寸为 0 通常是页签隐藏、布局还没就绪，那时最该做的是别动，等真有尺寸了再调一次。
  （编译期不一样：那里必须选一个尺寸，所以用 240 兜底。）
- 导出常量 `DEFAULT_FORM_MAX_WIDTH`（640）。

### 验证

- **77 单测**（3 套件）+ **10 e2e** 全绿（`npm run verify:full`）。「宽度」一组共 15 例，
  覆盖：按类型给默认 / 出厂默认退化（slider 10px、checkbox 0px）/ `dsl.width` 与 360 兜底 /
  `options.width` 优先 / `maxWidth` 默认与自定义（含 `dsl.maxWidth`、选项优先、`Infinity`）/
  下限 240 / 表单项占满一行 / `field.width` 覆盖 / `setWidth` 重排但不碰显式宽度与数值类 /
  `setWidth` 也吃 `maxWidth` / 非法值不动作 / 标题说明一起对齐 / horizontal 让出标签与保底。
- 示例页新增 1 例 e2e：「宽屏上表单停在 `maxWidth`，画布跟表单一样宽」——
  同时守 `maxWidth` 与 `result.width` 两件事（画布若用宿主宽度就会 889 ≠ 640 而红）。
- 下游 `ice-agent-console` 的两例 e2e 相应改成**两边都判**：
  「不缩成一小块」**且**「不拉满整张卡片」。
  只判下界是不够的 —— "占画布 x%" 这类单边判据对"把 896 全铺满"照样成立，
  这一点是 A/B 时发现的：故意传 `maxWidth: Infinity` 之后用例居然是绿的。
  另外「跟着重新对齐」那例改成**从窄到宽**：缩窄方向表单会被画布裁掉，
  "跟着缩了"和"没缩但被裁了"在像素上完全一样，测不出来。

## 0.1.2 - 2026-09-15

### 新增

- **宽度：`compileFormDsl(dsl, { width })` 与 `renderFormDsl(target, dsl, { width })`。**
  宿主把"我能给多宽"传进来，表单与**所有控件**一起对齐到它。
  不传则退回 `dsl.width`，再退回 360。
  之所以要宿主传：表单多宽取决于它被放在哪儿，而 DSL 不知道这件事。
- **`CompiledForm.setWidth(width)` / `RenderFormDslResult.setWidth(width)`。**
  容器尺寸变了时调它，整棵树重新对齐。**画布尺寸用 `resize()`，内容对齐宽度用 `setWidth()`**
  —— 这是两件事，宿主两个都要调。（`setWidth` 只动宽度，不动高度；
  高度仍由 `measureContentHeight()` 决定。）

### 修复

- **表单排不满，右侧空掉一大片。** 实测：宿主容器 896 宽时，表单只在左边画了 229px，
  **右边空 667px（74%）**。

  根因不在渲染器，在 DSL：宽度在 ICE 里是**每个组件自己的属性，没有"父级拉满"的自动传导**。
  `ICEForm` 用的 `ICEBoxLayout({ axis: 'y', align: 'stretch' })` 拉的是 `ICEFormItem`，
  **不拉控件**；而 `ICEFormItem.doLayout` 是拿 `control.state.width`（缺省 `200`）来定位控件、
  不负责改变它。于是 `stretch` 对视觉结果完全没有作用，每个控件落到各自的出厂默认 ——
  `ICETextField` 200、`ICEInputNumber` 140、`ICESelect` 200、提交按钮 112 ——
  同一张表单里几个控件宽度还互不相同。

  两处改动：

  1. **意图级默认宽度**：竖向布局下控件默认取表单宽度（`field.width` 仍可逐字段覆盖）；
     横向布局下让出标签那一条（`ICEFormItem` 默认 `labelWidth` 80，并保底 120）。
  2. **表单项的宽度显式给**：不给的话 `ICEFormItem` 会从控件宽度反推 `max(控件宽, 120)`，
     那才是"拉不满"的直接原因。

  显式写了 `width` 的字段在 `setWidth()` 时**不跟着变** —— 那是显式意图，重排不该抹掉它。

### 验证

- 70 单测（3 套件）+ 9 e2e 全绿（`npm run verify:full`）。其中 `tests/compile.test.ts` 增 9 例
  「宽度对齐」：默认宽度 / `options.width` 优先于 `dsl.width` / 表单项占满一行 /
  `field.width` 覆盖不被吃掉 / `setWidth` 重排但不碰显式宽度 / 非法宽度不动作 /
  标题说明一起对齐 / 横向布局让出标签 / 让完不把控件压到负宽以下。
- 示例页（`examples/form-dsl.html`）改成**按容器宽度渲染**并接上 `window.resize`，
  成为 §8.1 那条契约的活样本；e2e 增 2 例按**着墨包围盒**断言排布
  （修复前 `widthRatio` ≈ 0.26 → 现在 > 0.9），每例都单独验证过去掉对应改动就会失败。
- 端到端回归在下游 `ice-agent-console` 也补了同形两例（卡片里的表单）。
- 顺带在引擎侧逼出一个真缺陷并已修（`ice-render` 2.12.1）：`fitCanvasToDisplaySize()`
  改完尺寸不置脏，空闲停帧状态下 resize 会**静默白屏**。
- 示例页 e2e 里一处**既有竞态**被这次改动暴露并修掉：`render()` 返回时画面还没落到画布上，
  原来直接读一次着墨量就断言，靠"尺寸没变所以不需要重排"这个巧合才稳定；
  现在改成轮询等待（`waitForInk`）。

## 0.1.1 - 2026-09-15

### 修复

- **容器不再画出一条压在标题身后的灰杠**。`compileFormDsl()` 原先用 `ICEPanel` 当外层容器
  （标题 / 说明 / 表单 / 提交按钮都挂在它上面），但 `ICEPanel` 是"卡片底座"，
  它会**强制** `fill: true` + `stroke: true` + 阴影，而它自己的高度默认只有控件那么高 ——
  于是那块背景被画成了压在第一个子节点身后的一条横杠。在 `ice-agent-console` 的卡片里
  肉眼可见（smoke 时发现）。
  改用 `ICEGroup`（纯布局容器，带全套 `setLayout` / `doLayout` / `getPreferredSize`），
  外观交给宿主。**类型相应变化**：`CompiledForm.container` 由 `ICEPanel` 变为 `ICEGroup`
  —— 后者是前者的基类且布局 API 更全，所以只是放宽，不损失能力。
- **`measureContentHeight()` 现在量得准**。原先用 `getMinBoundingBox()`，在容器高度被
  撑满时返回的是容器自身高度，于是宿主按它调整画布高度会留下一大片空白。
  改成先问布局器的 `getPreferredSize()`，答不上来再按子节点下沿自己算 ——
  **应用层不该去猜 `ICEFormItem` 的标签行高与间距**，那是上游的排版逻辑。

### 验证

- 61 单测（3 套件）+ 7 e2e 全绿（`npm run verify:full`）。
- 下游回归：`ice-agent-console` 的表单卡按新高度渲染，空白消失（真机截图确认）。

## 0.1.0 - 2026-09-15

首个版本。`kind: 'form'`，11 种字段类型，38 个错误码 + 6 个警告码。

四个导出：`validateFormDsl` / `compileFormDsl` / `renderFormDsl` / `formatDiagnostics`。
设计取向见 README 开头：**不是「把 `new ICEForm(...)` 换个写法」**，
补的是三层构造不做、而模型最容易写错的三件事（扁平字段表、一处声明两处生效、结构化诊断）。
