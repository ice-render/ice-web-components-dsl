# Changelog

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
