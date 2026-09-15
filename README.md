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
| `compileFormDsl(dsl)` | → `{ container, form, model, submitButton, fieldNames, getValues, setValues, reset, submit, submitAsync, onSubmit, destroy }`。校验不过抛 `FormDslCompileError`（带诊断） |
| `renderFormDsl(target, dsl, opts)` | 一步到位：建 ICE 实例 + 挂组件 + 接提交。返回 `{ ice, compiled, diagnostics, resize, measureContentHeight, destroy }` |

## 4. 字段类型与它们接受的属性

| `type` | 取值类型 | 该类型额外接受 |
| --- | --- | --- |
| `text` / `textarea` | string | `allowClear` `showCount` |
| `password` | string | `allowClear` `showCount` `showToggle` |
| `number` | number | `step` `precision` |
| `slider` | number | `step` `range` |
| `checkbox` / `switch` | boolean | — |
| `radio-group` / `checkbox-group` | string / string[] | `options` `direction`（多选组还有 `maxChecked`） |
| `select` | string | `options` `mode`（`single`/`multiple`/`tags`）`showSearch` |
| `date` | string | `placement` |

所有类型都还接受：`name` `type` `label` `placeholder` `default` `required` `min` `max`
`minLength` `maxLength` `pattern` `message` `rules` `dependencies` `width` `props`。

**白名单之外的键会被忽略，并给出警告** —— 警告里会列出这个类型接受哪些键。这就是"字段表封闭"的好处：
模型不会静默地写一个不生效的属性。

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
3. `skills/ice-web-components-dsl/SKILL.md` —— 完整规范
4. `prompts/agent-prompt.md` —— 短版系统提示词（输出契约 + 自检清单）
5. `src/schema/form-dsl.schema.json` —— JSON Schema

> README、SKILL 与提示词里的 JSON 例子由 `tests/doc-examples.test.ts` 自动校验：
> 示例一旦不合法（类型写错、依赖悬空、选项为空），测试就红 —— 保证 Agent 照抄的是"能跑的文档"。

示例页：`examples/form-dsl.html`（带 JSON 编辑器与诊断面板，含四个预设：合法 / 类型写错 /
选项有问题 / 依赖指向空）。

## 12. 验证

```bash
npm run verify        # types:check + build + jest
npm run verify:full   # 上面 + playwright（示例页真机冒烟）
```

示例页 e2e 的判据不是"按钮存在"，而是：画布上真的有墨、
**真实点中画布上的提交按钮**能走完校验 → 提交这条链、诊断里带可操作的替代信息。

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
