# ice-web-components-dsl

JSON-first DSL for AI agents to build forms with [`ice-web-components`](https://www.npmjs.com/package/ice-web-components).

`ice-web-components` 的表单是**三层**的：控件（`ICETextField` / `ICESelect` / `ICEInputNumber`…）
+ `ICEFormItem`（标签与错误排版）+ `ICEForm`（把控件与模型接起来）。每个字段要写三层构造，
而 `name` / `label` / `control` / `rules` 分散在两个对象里。

**所以这个包不是「把 `new ICEForm(...)` 换个写法」**。它补的是那三层不做、
而模型最容易写错的三件事：

| | 原生写法 | ice-web-components-dsl |
| --- | --- | --- |
| 输入 | 每个字段三层构造，`name`/`label`/`control`/`rules` 分散 | **一个扁平 `fields[]`**：`{ name, type, label, ... }` |
| 约束 | `new ICEInputNumber({ min: 18 })` 与 `rules: [{ min: 18 }]` **互不相干** | **写一次 `min: 18`，控件夹取与校验两处都有了** |
| 出错时 | 控件画出来了但行为不对，只能自己猜 | **结构化诊断**：类型不认识列出可用类型、依赖写错列出可用字段名 |

编译产物就是普通的 `ICEPanel` + `ICEForm` + `ICEFormItem` + 控件 —— 命中测试、键盘导航、
无障碍镜像、主题、序列化全部照旧。

## 1. 安装

```bash
npm install ice-web-components-dsl ice-web-components ice-render
```

## 2. 30 秒

```json
{
  "schemaVersion": 1,
  "kind": "form",
  "title": "泵站参数确认",
  "description": "这三项确认后才会下发控制指令。",
  "fields": [
    { "name": "station", "type": "text", "label": "泵站名称", "required": true, "maxLength": 20 },
    { "name": "mode", "type": "select", "label": "运行模式", "required": true, "default": "auto",
      "options": [{ "value": "auto", "label": "自动" }, { "value": "manual", "label": "手动" }] },
    { "name": "flow", "type": "number", "label": "目标流量 (m³/h)", "required": true, "min": 0, "max": 5000, "step": 10 }
  ],
  "submitText": "确认下发"
}
```

```ts
import { renderFormDsl, validateFormDsl, compileFormDsl } from 'ice-web-components-dsl';

const { compiled, diagnostics } = renderFormDsl('canvas-id', dsl, {
  onSubmit(values) {
    console.log(values); // { station: '一号泵站', mode: 'auto', flow: 800 }
  },
});

// 或者只要诊断（validate 不抛异常，任何输入都能吃）
const result = validateFormDsl(dsl);
if (!result.valid) console.log(result.errors.map((e) => e.message).join('\n'));

// 或者只要组件树（自己挂到已有的 ICE 实例上）
const { container, form, model } = compileFormDsl(dsl);
ice.addChild(container);
```

浏览器直接用（UMD，**注意顺序**）：

```html
<canvas id="form" width="440" height="500"></canvas>
<script src="https://unpkg.com/ice-render/dist/index.umd.js"></script>
<script src="https://unpkg.com/ice-web-components/dist/index.umd.js"></script>
<script src="https://unpkg.com/ice-web-components-dsl/dist/index.umd.js"></script>
<script>
  ICEWEBDSL.renderFormDsl('form', { kind: 'form', fields: [{ name: 'a', type: 'text' }] });
</script>
```

## 3. 四个导出

| 导出 | 说明 |
| --- | --- |
| `validateFormDsl(dsl)` | **任何输入都不抛异常**。返回 `{ valid, errors, warnings }`，每条诊断带 `severity` / `code` / `message` / `path` |
| `formatDiagnostics(result)` | 把校验结果转成可读文本 |
| `compileFormDsl(dsl, opts?)` | → `{ container, form, model, submitButton, fieldNames, getValues, setValues, reset, setWidth, submit, submitAsync, onSubmit, destroy }`。`opts.width` / `opts.maxWidth` 见 §8.1。校验不过抛 `FormDslCompileError`（带诊断） |
| `renderFormDsl(target, dsl, opts?)` | 一步到位：建 ICE 实例 + 挂组件 + 接提交。返回 `{ ice, compiled, diagnostics, width, resize, setWidth, measureContentHeight, destroy }`。`width` 是表单**最终**宽度（已夹过 `maxWidth`），见 §8.1 |

## 4. 字段类型与它们接受的属性

共 **20 个类型**（`FORM_DSL_FIELD_TYPES`）。加新类型的**硬条件**是"值能经 JSON 往返" ——
判据是运行时的，不是从文档看来的（见 §4.1）。

| `type` | 取值类型 | 该类型额外接受 |
| --- | --- | --- |
| `text` / `textarea` | string | `allowClear` `showCount` |
| `password` | string | `allowClear` `showCount` `showToggle` |
| `number` | number | `step` `precision` |
| `slider` | number | `step` `range` |
| `checkbox` / `switch` | boolean | — |
| `radio-group` / `checkbox-group` | string / string[] | `options` `direction`（多选组还有 `maxChecked`） |
| `select` | string（`mode: multiple` 时 string[]） | `options` `mode`（`single`/`multiple`/`tags`）`showSearch` |
| `date` | string（`YYYY-MM-DD`） | `placement` |
| `color` | string（hex） | `options`（色板） |
| `rate` | number | —（`max` = 满分几颗星） |
| `time` | string（`HH:mm:ss`） | `format`（`HH:mm:ss` / `HH:mm`） |
| `segmented` | string | `options` `block` |
| `autocomplete` | string | `options`（候选） |
| `cascader` | string（最深一层的叶子） | `options`（带 `children`）`separator` |
| `tree-select` | string（`mode: multiple` 时 string[]） | `options`（带 `children`）`mode` `showSearch` |
| `transfer` | string[] | `options`（候选池） |
| `date-range` | `[起, 止]` | —（`required` = 两头都在） |

所有类型都还接受：`name` `type` `label` `placeholder` `default` `required` `min` `max`
`minLength` `maxLength` `pattern` `message` `rules` `dependencies` `width` `props`。

**白名单之外的键会被忽略，并给出警告** —— 警告里会列出这个类型接受哪些键。这就是"字段表封闭"的好处：
模型不会静默地写一个不生效的属性。

**`options` 两种写法都收**：`[{ "value": "a", "label": "甲" }]` 或直接 `["a", "b"]`。
库里不同控件要的形状不一样（`colors: string[]` / `options: string[]` / `{value,label}[]` /
`nodes: {key,label}` / `dataSource: {key,title}`），**那些差别由编译期归一化** ——
否则就是在收"模型记不住哪个是哪个"的税。

### 4.1 判据是运行时的：值能不能经 JSON 往返

`ice-web-components` 有 84 个 UI 组件，但不是每个都能当字段。判据不是"有没有 `value` 构造参数"，
也不是"有没有 `getFormValue`"（那是 `ICEWidget` **基类**给的，人人都有），而是
**`setFormValue(v)` 之后 `getFormValue()` 还回不还得出同一个东西**：

| 组件 | 运行时表现 | 结论 |
| --- | --- | --- |
| `ICEColorPicker` | `3 → "3"`、`["a","b"] → "a,b"`（强制转字符串） | ✅ 真实现 |
| `ICEDateRangePicker` | 只认两头齐全的元组，其余回落成 `[null,null]` | ✅ 真实现 |
| `ICETransfer` | 只认 `string[]`，其余回落成 `[]`（按数据源过滤） | ✅ 真实现 |
| `ICERadioButton` | `getFormValue()` 返回**布尔**（只表示自己勾没勾，互斥要调用方维护） | ❌ 假单选 |
| `ICEUpload` | `setFormValue` **照收不误**（基类默认），组件本身不参与取值 | ❌ 没实现 |

证据在 `tests/field-values.test.ts`（构造出来真调一遍），`tools/probe-field-values.mjs`
是同一件事的交互版。`ICERadioButton` / `ICEUpload` 因此**不在**类型表里 ——
不是漏了，是判过不能用。

## 5. 一处声明、两处生效

```json
{
  "name": "age",
  "type": "number",
  "label": "年龄",
  "min": 18,
  "max": 65
}
```

`min` / `max` 会**同时**：

1. 传给 `ICEInputNumber`，约束步进按钮的夹取范围；
2. 生成 `ICEFormRule`，拦住用户手输的越界值。

原生路径这两件事是分开的：`new ICEInputNumber({ min: 18 })` 只影响步进按钮，
**手输 `10` 不会报错**，除非你再写一条 `rules: [{ min: 18 }]`。模型只会写其中一个。

文本类字段的 `maxLength` 同理：既限制输入长度，也生成校验规则。

## 6. 规则：shorthand 与 `rules`

| shorthand | 说明 |
| --- | --- |
| `required` | 必填；`null` / 空串 / 空数组 / `false` 都算缺失 |
| `min` / `max` | 数值上下界 |
| `minLength` / `maxLength` | 字符串或数组长度 |
| `pattern` | 正则**字符串**（JSON 里写不出正则字面量，编译时转 `RegExp`） |
| `message` | 自定义错误文案 |

shorthand 会合成**一条**规则（原生 `ICEFormRule` 本来就允许一条规则带多个约束）。
需要多条独立规则时用 `rules`，按数组顺序接在 shorthand 之后：

```json
{
  "name": "code",
  "type": "text",
  "required": true,
  "rules": [{ "minLength": 4 }, { "pattern": "^[A-Z0-9-]+$", "message": "只能是大写字母、数字与连字符" }]
}
```

`validator` / `asyncValidator` 是函数，JSON 表达不了，**不收**（写了会被 `unknown-rule-key` 告警拦下）。

## 7. 跨字段依赖

```json
{
  "name": "confirm",
  "type": "password",
  "label": "确认密码",
  "required": true,
  "dependencies": ["password"]
}
```

被依赖字段一变，本字段立刻重算 —— 不用等用户再动本字段一次。
依赖名写错会被拦下，**诊断里列出可用字段名**（含前向引用正确、后向引用也正确）。

## 8. 布局：为什么没有坐标

DSL 里**不可表达** `left` / `top`。字段纵向堆叠交给 `ICEForm` 的箱式布局，
标签在上还是左侧由顶层 `layout` 决定。

理由很实际：`ice-web-components` 有 84 个组件，一旦放开坐标，模型就会产出互相重叠的控件 ——
"让它自己摆"是唯一可行的口径。

宿主负责的是**画布多大**（`renderFormDsl` 的 `resize(w, h)`，内部走引擎的
`ICE.fitCanvasToDisplaySize()`），而不是每个控件摆在哪。

### 8.1 宽度：宿主说了算，但必须显式告诉它

宽度不在 DSL 里定，因为**表单多宽取决于它被放在哪儿**，而 DSL 不知道这件事。
宿主通过 `width` 传进来：

```js
const result = renderFormDsl(canvas, dsl, { width: card.clientWidth });
// 或者只要组件树
const compiled = compileFormDsl(dsl, { width: card.clientWidth });
```

不传则退回 `dsl.width`，再退回 `360`。宿主给的宽度会被 **`maxWidth`（默认 640）** 夹住 ——
把 896 全铺满不是"排满了"，是难看：一行 896 宽的输入框没人读得过来。
（`maxWidth: Infinity` 就是不设上限；也可以用 `dsl.maxWidth` 在文档里声明。）

**表单最终多宽**读 `result.width` —— 宿主需要它来决定画布/容器多宽。
拿自己传进去的宽度去定画布就会宽出一截、右边空一块，看起来跟没修一样。

容器尺寸变了要调 `setWidth()` —— **`resize()` 管画布，`setWidth()` 管内容**，两件事都要做：

```js
window.addEventListener('resize', () => {
  result.setWidth(card.clientWidth);   // 表单与控件重新对齐（同样会被 maxWidth 夹住）
  result.resize(result.width, height); // 画布跟**表单实际宽度**，不是容器宽度
});
```

**为什么宽度要一层层显式写下去**：宽度在 ICE 里是每个组件自己的属性，
**没有"父级拉满"的自动传导**。`ICEForm` 的 `ICEBoxLayout({ align: 'stretch' })` 拉的是
`ICEFormItem`，不拉控件；而 `ICEFormItem.doLayout` 只按 `control.state.width`
（缺省 `200`）**定位**控件，不改变它。所以只写 `align: 'stretch'` 对视觉结果完全没有作用，
每个控件会落到自己的出厂默认 —— `ICETextField` 200、`ICEInputNumber` 140、`ICESelect` 200，
同一张表单里几个控件宽度还互不相同（实测宿主 896 宽时右侧空掉 667px，74%）。

编译期给的默认规则：

| 字段类型 | 控件宽度 |
| --- | --- |
| 除 `number` 以外全部 | 表单宽度（`horizontal` 布局下是 `max(120, 表单宽度 - 80)`，那 80 是 `ICEFormItem` 的默认 `labelWidth`，让给标签） |
| `number` | **200，不拉伸** |

`number` 是唯一的例外，理由是 `ICEInputNumber` 自己的内部布局：减号贴最左端、数值居中，
宽度一拉大这两样就天各一方（实测 890px 时看着像坏了）。

反过来，其余类型**必须**拉伸，因为它们的出厂默认是**退化的**：
`slider` 默认 10px、`checkbox` 默认 0px、`radio-group` 默认 35px ——
不给宽度就会画出一个看不见的控件。（这一条是实测出来的：第一版只让"文本类"拉伸，
结果滑块变成 10px 宽的一条。）

逐字段写的 `width` 优先级最高，且 `setWidth()` **不会**动它 —— 显式意图不该被重排抹掉。

## 9. 诊断码

`validate` 返回的每条诊断都带 `code` 与 `path`，便于程序化处理与回灌给 agent。
共 **38 个错误码 + 6 个警告码**。

**错误**（会导致不渲染）：

`default-not-in-options` · `default-type-mismatch` · `duplicate-name` · `duplicate-option-value` · `empty-fields` ·
`empty-options` · `field-constraint-not-number` · `field-not-object` · `invalid-dependencies` · `invalid-dependency` ·
`invalid-direction` · `invalid-fields` · `invalid-layout` · `invalid-mode` · `invalid-name` ·
`invalid-options` · `invalid-pattern` · `invalid-placement` · `invalid-root` · `invalid-rule` ·
`invalid-rules` · `length-range-inverted` · `missing-fields` · `missing-kind` · `missing-name` ·
`missing-type` · `option-invalid` · `option-missing-value` · `option-value-not-string` · `options-required` ·
`range-inverted` · `required-not-boolean` · `rule-value-not-number` · `self-dependency` · `unknown-dependency` ·
`unsupported-field-type` · `unsupported-kind` · `unsupported-schema-version`。

**警告**（会渲染，但值得看一眼）：

`invalid-number` · `invalid-submit-text` · `options-not-allowed` · `rule-not-applicable` · `unknown-field` ·
`unknown-rule-key`。

每条错误都尽量带上**可操作的替代信息**：

```
[错误] 不支持的字段类型「richtext」。可用类型：text / textarea / password / number / slider / …（fields[0].type）
[错误] 依赖的字段「passwrod」不存在。可用字段：password / confirm。（fields[1].dependencies[0]）
[错误] 默认值「auto」不在 options 里。可用取值：on / off。（fields[0].default）
[警告] 「number」不认识字段属性「nope」会被忽略。它接受：step / precision，以及通用属性 name / type / …
```

## 10. 逃生舱

DSL 只覆盖能写成 JSON 的部分。需要更强的东西时，**在编译产物上继续做**：

```ts
const { model, form } = compileFormDsl(dsl);

// 自定义同步校验
model.getField('name')!.rules!.push({
  validator: (value) => (value === 'admin' ? '这个名字被占用了' : null),
});

// 异步校验（DSL 表达不了；按钮走 submitAsync，会先同步后异步）
model.getField('name')!.rules!.push({
  asyncValidator: (value) => fetch('/api/check?name=' + value).then((r) => r.json()).then((d) => (d.taken ? '已占用' : null)),
});

// 换个日期显示格式（原生的 format 是函数）
form.getItems()[3].getControl().setFormat((v) => v.replace(/-/g, '/'));
```

字段上的 `props` 也直通控件构造函数（内容不校验）。

## 11. Agent 发现路径

Agent 可以通过这几处使用本项目：

1. npm 包导出（`validateFormDsl` / `compileFormDsl` / `renderFormDsl`）
2. `AGENTS.md`
3. `skills/ice-web-components-dsl/SKILL.md` —— 完整规范（§7「库里还有什么」由清单自动生成）
4. `prompts/agent-prompt.md` —— 短版系统提示词（输出契约 + 自检清单）
5. `src/schema/form-dsl.schema.json` —— JSON Schema
6. **`catalog/components.json` —— 组件清单**（机器可读，见 §11.1）

> README、SKILL 与提示词里的 JSON 例子由 `tests/doc-examples.test.ts` 自动校验：
> 示例一旦不合法（类型写错、依赖悬空、选项为空），测试就红 —— 保证 Agent 照抄的是"能跑的文档"。

示例页：`examples/form-dsl.html`（带 JSON 编辑器与诊断面板，含四个预设：合法 / 类型写错 /
选项有问题 / 依赖指向空）。

### 11.1 组件清单：让 agent 知道"库里还有什么"

这份 DSL 只覆盖 11 个字段类型，而 `ice-web-components` 有 84 个 UI 组件。
**agent 的真正瓶颈不是画布，是它不知道自己有什么可选** —— 之前 SKILL 里只有那 11 行表，
剩下的它看不见，于是"要个日期区间"也只能退回两个 `date` 字段。

`catalog/components.json`（`npm run catalog` 生成）把整库摊开：分组、摘要、构造参数、
方法、**值的形状**，以及本包加的标注 —— 哪些已接入、哪些能接但还没接、哪些根本不是字段。

三条边界，都不是随手定的：

1. **分组与摘要来自上游的生成产物，不是我自己列的。**
   上游 `scripts/gen-docs.mjs` 已经有一套抽取器，而且有 `docs:check` 门禁保证
   "每个组件都被登记过"。本包再写一个 TypeScript 解析器就是第二份抽取器，
   两份会各自漂移，而漂移的症状是"清单里少了个字段"这种没人会发现的形态。
   所以这里**只做搬运与重组**（用法见 `tools/gen-catalog.mjs` 顶部注释）。
2. **"能不能当字段"是手写的** —— 那是编辑判断，源码里推不出来。
   但两侧都有门禁：标注里的组件名要真实存在、`fieldType` 要合法，
   **且每个已实现的类型都必须有组件认领**（加了类型却忘了说它由谁实现 → 测试红）。
3. **清单自己知道缺什么。** `gaps` 一节列出"构造参数没进生成文档的类"（48/113，含
   `ICEButton` / `ICETextField` 这些最常用的 —— 它们继承基类的 Options，或构造函数就是
   `props?: any`）和"上游没写类注释的条目"。空数组不等于"没有参数"，
   所以宁可把缺口列出来，也不糊一个 `[]` 过去。

SKILL 的 §7 由同一份清单生成（标记块 `<!-- catalog:start -->`）。
`npm run verify` 里带 `catalog` 重生成 + `tests/catalog.test.ts` 的同步门禁 ——
**上游一改、或本包标注一改而忘了重生成，测试就红**。

## 12. 验证

```bash
npm run verify        # types:check + build + jest
npm run verify:full   # 上面 + playwright（示例页真机冒烟）
```

当前规模：**128 单测 / 6 套件**，**10 e2e / 1 spec**，**20 个字段类型**，清单覆盖 **84 个 UI 组件**（9 组 / 185 个条目）。

示例页 e2e 的判据不是"按钮存在"，而是：画布上真的有墨、
**真实点中画布上的提交按钮**能走完校验 → 提交这条链、诊断里带可操作的替代信息。

其中三例按**着墨包围盒**判排布（"表单铺满内容宽度" / "宽屏上停在 maxWidth" /
"窗口变窄后跟着重新对齐"）—— `countInk` 那类"画了没有"的断言抓不到
"画出来了但只占左边一小块"：着墨量照样几千。这一组是实测缺陷的回归，见 §8.1。

> 判据要**两边都判**。"占画布 x%" 这类单边判据对"把整张卡片全铺满"照样成立，
> 所以那两条用例同时断言"不缩成一小块"**和**"不拉满整张卡片"。
> 这一点是 A/B 时发现的：故意把 `maxWidth` 传成 `Infinity`，用例居然还是绿的。

> 知道这个数字从哪来很重要：宽度这条链上没有一处会**报错**。
> 修复前宿主 896 宽、表单只画了 229px —— 校验通过、编译通过、渲染成功，
> 只有人会看出"右边怎么空了那么多"。

## 13. 与家族其它包的关系

| 包 | 面向 | 补的是什么 |
| --- | --- | --- |
| `ice-chart-dsl` | Agent 画图 | 一张表 + `encoding`；轴/图例/提示框的意图级默认 |
| `ice-render-dsl` | Agent 画图形 | 节点/连线 DSL + 编排 |
| `ice-entity-designer-dsl` | Agent 建数据模型 | 实体/关系 DSL |
| **`ice-web-components-dsl`** | **Agent 收集输入** | 扁平字段表；约束"写一次两处生效"；表单诊断 |

四个 DSL 是同一套口径：**JSON 输入、编译成原生产物、诊断可回灌**。
它们与 MCP / AG-UI 的关系是"同一份声明，两条通道" —— MCP 让 agent 能生成，
AG-UI 把生成结果送到用户屏幕上。

## 14. 许可

MIT
