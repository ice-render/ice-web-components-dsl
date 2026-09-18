# Changelog

## 0.4.0 - 2026-09-18

### 变更

- **peer 下限抬到 `ice-render@^2.16.0`**：本包生成的表单/控件最终由引擎渲染，2.16.0 修的是「连线横穿图面里的其他图元」。

  仍停在 2.14 / 2.15 的宿主装本版本会得到 npm 的 peer 冲突提示 —— 有意的：
  宁可响亮失败，也不要让它悄悄用老路由画出一堆穿线。

## 0.3.3 - 2026-09-18

### 变更

- **组件清单同步到 `ice-web-components 1.19.3` / `ice-render 2.15.0`**（`catalog/components.json`
  与 SKILL.md §7 重新生成）。这两份是**随包发布的给 Agent 看的组件清单**，而 npm 上 0.3.2 的
  产物里记的还是 `ice-web-components` **1.13.1** —— 落后六个版本，等于用户手里的清单描述的是旧库。
- peer / dev 依赖下限对齐到 `ice-render ^2.15.0`、`ice-web-components ^1.19.3`。
- 触发这次同步的是一条真问题：上游 `ICEForm` 的类文档**第一段会被摘成清单里的一条摘要**，
  而摘要**有 500 字上限**（`tests/catalog.test.ts` 守着）—— 上游 1.19.2 那段写得太长被门禁拦下，
  于是上游收短、本仓重新生成（上游侧记在它的 1.19.3 CHANGELOG 里）。

### 门禁

- types:check ✅、catalog:check ✅、build ✅、jest **7 套件 / 132 用例** ✅、真机 e2e **10/10** ✅。
- 依赖是**真装**的（不是只改 lock）：`node_modules` 里 `ice-web-components` 1.19.3 /
  `ice-render` 2.15.0，顺带验证了发布产物本身。踩到两个已知坑各一次：npm 传播延迟
  （刚发布的版本会先报 `notarget`）与 node_modules 陈旧副本（`npm ls` 报新版本、磁盘还是旧的，
  挪走重装才对）。

## 0.3.2 - 2026-09-17

### 文档

- **README 里的"当前规模"改成当天实测值**：`128 单测 / 6 套件` → **132 单测 / 7 套件**
  （2026-09-17 实测；另外三个数字 `10 e2e / 1 spec`、`20 个字段类型`、`84 个 UI 组件（9 组 /
  185 条目）`复核后不变）。README 属于本包的发布内容，所以发一次 patch。

### 变更

- **组件清单跟上 `ice-web-components` 1.13.1**：`catalog/components.json` 与 `SKILL.md §7` 里
  记录的**来源版本号**从 `1.13.0` 改成 `1.13.1`（清单内容本身没动：9 组 / 185 条目 / 类 113 /
  已接入 20 / 待接 0）。上游那个 patch 只有 README 改动，但清单记的是"从哪个版本生成"，
  `catalog:check` 会因为版本号不一致直接红 —— 这是门禁在正确工作，不是我漏了什么。
- devDependency `ice-web-components` `^1.13.0 → ^1.13.1`（peer 范围不变）。本仓有一条**不变量测试**
  要求"清单读的那份上游 == 测试跑的那份上游"（生成器读兄弟仓、jest 走 `node_modules`），
  所以 devDep 必须跟着抬 —— 不抬的话 `tests/catalog.test.ts` 会红，而且症状是"清单在描述一个
  测试从没跑过的版本"，很难从别的信号看出来。

### 说明

- **不含任何代码 / 运行时变更**：`dist/` 与 0.3.1 逐字节相同；tarball 的差异只有
  README 的计数、清单 / SKILL 里的来源版本号，以及版本号本身。

### 验证

- 2026-09-17 本机实跑 `verify:full`：types:check / catalog:check / jest **132** / build /
  真机 e2e **10/10**（含目录驱动的示例页冒烟）。

## 0.3.1 - 2026-09-17

### 修复

- **组件清单跟上 `ice-web-components` 1.13.0。** `catalog/components.json` 与 `SKILL.md §7` 是从上游产物
  生成的清单，此前一直停在记录 **1.11.2** 的状态 —— `catalog:check` 在本次发版后直接红。差异分两类：
  ① 上游 1.13.0 的变化（`ICEWidget` 新增 `onMount` / `onUnmount` / `onShow` / `onHide` / `onResize` /
  `initEvents`，`ICEContainer` 的摘要换成容器契约）；② **1.12.0 时期就漏掉的**某组件新增的 `height` ——
  也就是说这份清单在本次之前就已经漂移，只是没人跑这个门禁。重生成后：9 组 / 185 条目 / 类 113 /
  已接入 20 / 待接 0。
- devDependency `ice-web-components` `^1.11.2 → ^1.13.0`（peer 范围 `^1.11.0` 本来就覆盖，不动）。

### 文档 / 示例

- `examples/form-dsl.html` 按家族的示例页写法改成**一页一个类**（构造期建好、事件分组挂好）。
  这页的"变化"是**用户驱动**的（改 JSON / 换预设后点渲染），所以按约定不加 `onUpdate()`，
  刷新入口就是 `render()` 本身。

## 0.3.0 - 2026-09-15

### 新增

- **字段类型 11 → 20。** 一次接完清单里"能当字段"的全部组件：

  | 新类型 | 组件 | 值 |
  |---|---|---|
  | `color` | `ICEColorPicker` | string（hex） |
  | `rate` | `ICERate` | number（`max` = 满分几颗星） |
  | `time` | `ICETimePicker` | string（`HH:mm:ss`；`format` 是**字符串**联合，所以能进 DSL） |
  | `segmented` | `ICESegmented` | string |
  | `autocomplete` | `ICEAutoComplete` | string |
  | `cascader` | `ICECascader` | string（最深一层的叶子） |
  | `tree-select` | `ICETreeSelect` | string / string[]（随 `mode`） |
  | `transfer` | `ICETransfer` | string[] |
  | `date-range` | `ICEDateRangePicker` | `[起, 止]` 元组 |

- **`options` 两种写法都收**：`[{value,label}]` 或裸字符串 `["a","b"]`。
  库里不同控件要的形状不一样（`colors: string[]` / `options: string[]` / `{value,label}[]` /
  `nodes: {key,label}` / `dataSource: {key,title}`），**那些差别由编译期归一化**。
  逼出这条的直接原因：`color` / `autocomplete` 的选项**不能**归一化成 `{value,label}` ——
  传对象进去组件不报错，**色块画成空白**、候选显示成 `[object Object]`。
- **`options` 支持嵌套 `children`**（`cascader` / `tree-select`），逐层归一化。
- **`default` 的形状校验按「类型 + 属性」算**（`fieldValueShape()`）。
- 新增 `TREE_OPTION_FIELD_TYPES`、`fieldValueShape()`、`FormDslValueShape`；
  新增诊断码 `invalid-format`。

### 修复

- **`checkbox-group` 的数组默认值一直被拒。** 原先对选项型字段一律要求
  `typeof default === 'string'`，而报错文案还写着"必须是字符串数组" ——
  **多选组从来就设不了初值**。现在按 `fieldValueShape()` 判，数组/元组各按各的形状检。
- **`placeholder` 从来没传给过 6 个老类型**（`checkbox` / `switch` / `radio-group` /
  `checkbox-group` / `select` / `date`）。`createControl` 里那 6 个分支写的是
  `...passthrough, width, …`，而 `base` 才是装 `placeholder` / 初值 / 宽度 / `props` 的地方。
  TypeScript 抓不到 —— `placeholder` 在这些 Options 接口里都是**可选**的。
  症状是"下拉框、日期框的占位文案不显示"。
- **`ICERadioButton` / `ICEUpload` 不进 DSL。** 判据从"看文档"改成**运行时刻**：
  `ICERadioButton.getFormValue()` 返回的是**布尔**（只表示自己勾没勾，互斥要调用方维护）→
  当字段会做出"两个都能选上"的假单选；`ICEUpload.setFormValue` 是基类默认的**照收不误**、
  组件本身不参与取值 → 没实现这条约定。证据固化成 `tests/field-values.test.ts`。
  在此之前我在这件事上连错两次（都因为拿文档当真相）：
  清单的方法名曾解析成 `setValue(hex: string)`（带调用语法），于是
  `methods.includes('getFormValue')` 永远为假；修好之后又发现
  `getFormValue` 是 `ICEWidget` **基类**给的、人人都有，压根不是判别信号。
- `setFormValue` 的**事实**不再从文档推断：`docs/api/*.md` 只记组件**自己声明的**方法，
  继承来的一律没有（`ICETextArea` 明明能用，文档里却"没有 `getFormValue`"）。

### 验证

- **128 单测（6 套件）+ 12 e2e 全绿**（`npm run verify:full`）。
- 新增 `tests/field-values.test.ts`（运行时证据）、`tests/control-options.test.ts`（跨类型不变量）。
  后者在**构造函数入口**拦一道，逐一验证每个类型的 `placeholder` / `props` / `default` / `width`
  都到达了控件 —— 试过读 `state.placeholder`，18/20 个类型报 undefined（连明确能用的 `select` 也是），
  因为占位文案没有统一的存放点；**拿"每个组件各不相同"的地方当探针，
  测出来的是组件的内部布局，不是"DSL 有没有把键传下去"**。
- 下游 `ice-agent-console` 新增「看看新控件都能用吗」剧本（10 个字段各来一个）
  与 `e2e/showcase.spec.ts`。两条用例分别守：
  ①「色板真的有色」（在色板区域数**不同的色相**，≥5 种）与「占位文案真的有字」；
  ②「值真的进了取值回路」（往 10 个新控件写值，再从表单模型读回来）。
- 四条门禁各做过一次 A/B：把 `select` 分支退回 `...passthrough`（placeholder 门禁红）、
  把 `color` 退回 `normalizeOptions`（色板公开 API 断言红）。

### 说明

- `date-range` 的 `required` 语义**定案**：两头都在才算填完。理由是运行时的 ——
  `setFormValue` 对不完整区间会回落成 `[null, null]`，所以"只选一头"本来就等价于没填。
- `time` 的 `format` 是字符串联合（能进 DSL），而 `date` 的 `format` 是**函数**（进不了）——
  同一个名字、两种性质，这条差异在两边文档里都写明了。

## 0.2.0 - 2026-09-15

### 新增

- **组件清单 `catalog/components.json` + SKILL §7「库里还有什么」。**
  这个 DSL 只覆盖 11 个字段类型，而 `ice-web-components` 有 **84 个 UI 组件**。
  agent 的真正瓶颈不是画布，是**它不知道自己有什么可选** —— 之前 SKILL 里只有那 11 行表，
  剩下的它看不见，于是"要个日期区间"也只能退回两个 `date` 字段。

  清单把整库摊开：分组、摘要、构造参数、方法、**值的形状**，以及本包加的标注 ——
  哪些已接入、哪些能接但还没接（11 个）、哪些根本不是字段（附理由）。
  SKILL 的 §7 由同一份清单生成，`npm run catalog` 重生成。

- **`npm run catalog` / `npm run catalog:check`**，且 `npm run verify` 里带上了清单重生成。

### 三条边界（都不是随手定的）

1. **分组与摘要来自上游的生成产物，不是自己列的。**
   上游 `scripts/gen-docs.mjs` 已经有成熟的抽取器，还有 `docs:check` 门禁保证
   "每个组件都被登记过"。本包再写一个 TypeScript 解析器就是**第二份抽取器**，
   两份会各自漂移，而漂移的症状是"清单里少了个字段"这种没人会发现的形态。
   所以生成器只做搬运与重组（分组取 `gen-docs.mjs` 的 `GROUPS`，细节取 `docs/api/*.md`）。
2. **"能不能当字段"是手写的** —— 那是编辑判断，源码里推不出来。
   但两侧都有门禁：标注里的组件名要真实存在、`fieldType` 要合法，
   **且每个已实现的类型都必须有组件认领**。录入组里漏标一个组件，生成器直接抛。
3. **清单自己知道缺什么。** `gaps` 一节列出"构造参数没进生成文档的类"（**48/113**，
   含 `ICEButton` / `ICETextField` / `ICECheckBox` 这些最常用的 —— 它们继承基类的
   Options，或构造函数就是 `props?: any`）与"上游没写类注释的条目"（28）。
   空数组不等于"没有参数"，所以宁可把缺口列出来，也不糊一个 `[]` 过去。

### 过程中查实的东西（都是实测，不是推测）

- **上游分组表里混着"不是组件"的条目**：`ICEMessage` / `ICENotification` 是
  `ICEMessageManager.ts` 里的 `export const` 便捷入口。只认 `## \`X\`` 的话它们会凭空消失，
  而分组表里明明列着。现在按标题形态分出 `class` / `function` / `const`。
- **`docs/api/*.md` 只记组件自己声明的 `ICExxxOptions`**，继承来的一律没有 ——
  所以"构造参数"这一列对 48 个类是空的，而这恰好包含最常用的那些。
  清单把这件事**记成缺口**而不是糊过去。
- **上游把整段 JSDoc 压成了一行**，所以代码围栏是**行内的**（`用法： ```ts …`），
  按行首切切不到：`ICEFormList` 的摘要曾把整段示例代码吞进去（388 字）。
  两道边界都要（空行断段 + 切围栏），且门禁守着"摘要里不能剩代码块"。
- **`ICETextField` 之类的构造函数是 `props?: any`**，没有类型化的 Options ——
  所以"值形状"推不出来时标 `unknown` 而**不是** `none`：前者是"没抽到"，
  后者是"声明了参数但没有 `value` 这个键"（`ICEUpload` / `ICETransfer`）。
  混起来会让人以为某个组件"没有值"。
- **`select` 的取值类型在 SKILL §2.1 里被写成了 `string`** —— 漏了
  `mode: "multiple"` 时是数组。§7.4 正好生成这条，一并改掉了。
- **`src/types.ts` 的 `ARRAY_FIELD_TYPES` 是死代码，而且口径不全**：
  它只列了 `checkbox-group`，没算上 `select`（`mode: multiple`）与将来的 `tree-select`
  （值形状 `string | string[]` 取决于 `mode`）。**值形状不是"类型"的函数，是"类型 + 属性"的函数**，
  按类型列表建模本身就装不下。没有删它是因为这次不改 DSL 行为 —— 记在这里，
  等真接 `tree-select` 时它会挡路，那时应该换成按字段算的函数。

### 验证

- **98 单测（4 套件）+ 10 e2e 全绿**（`npm run verify:full`）。
  新增 `tests/catalog.test.ts` 21 例，每条都在守一种"静默地不完整"：
  与上游逐字节同步 / 每条都有摘要（版式漂移哨兵）/ `gaps` 两节自洽 /
  解析出来的类型串与 `optional` 真的对 / 标注双向自洽 / 值形状的已知事实。
- **四条门禁各做过一次 A/B，确认单独回退对应改动就会红**：
  改标注不重生成（同步门禁红）、把 `rate` 写进 `fieldType`（合法性与认领两条红）、
  去掉代码围栏切割（摘要残留代码块红）、录入组漏标一个组件（生成器直接抛）。

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
