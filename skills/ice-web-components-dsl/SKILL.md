---
name: ice-web-components-dsl
description: 用 JSON 声明一张表单并渲染到 canvas（ice-web-components 的 Agent 面向层）。当需要让用户填参数、做确认、走人机回环时使用。
---

# ice-web-components-dsl

用一份 JSON 声明一张表单，渲染到一张 canvas 上。**你只写声明，不写坐标、不写控件实例。**

包里有三个东西你会用到：

| 导出 | 用途 |
|---|---|
| `validateFormDsl(dsl)` | 校验。**任何输入都不抛异常**，返回 `{ valid, errors, warnings }` |
| `compileFormDsl(dsl)` | 编译成 `{ container, form, model, submitButton, ... }`，自己挂到已有的 ICE 实例上 |
| `renderFormDsl(target, dsl, opts)` | 一步到位：建 ICE 实例 + 渲染 + 接提交回调 |
| `formatDiagnostics(result)` | 把校验结果转成可读文本 |

---

## 1. 顶层结构

```json
{
  "schemaVersion": 1,
  "kind": "form",
  "title": "泵站参数确认",
  "description": "这三项确认后才会下发控制指令。",
  "layout": "vertical",
  "width": 360,
  "gap": 12,
  "submitText": "确认下发",
  "fields": [{ "name": "station", "type": "text", "label": "泵站名称", "required": true }]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 否 | 当前是 `1`。写错会被校验拦下 |
| `kind` | **是** | 当前只支持 `"form"` |
| `title` / `description` | 否 | 标题与副标题。`description` 用来解释"为什么要填这些" |
| `layout` | 否 | `"vertical"`（默认，标签在上）或 `"horizontal"`（标签在左） |
| `width` | 否 | 表单宽度（CSS 像素），默认 360 |
| `gap` | 否 | 字段间距，默认 12 |
| `fields` | **是** | 字段数组，**不能为空** |
| `submitText` | 否 | 提交按钮文案，默认「提交」。传 `null` 表示不生成提交按钮 |

> **没有 `left` / `top`。** 布局由 `layout` 与引擎的箱式布局决定 —— 一旦放开坐标，
> 控件就会互相重叠。

---

## 2. 字段

每个字段至少要有 `name` 与 `type`。`name` 是取值键，必须唯一。

```json
{
  "name": "flow",
  "type": "number",
  "label": "目标流量 (m³/h)",
  "placeholder": "请输入",
  "default": 800,
  "required": true,
  "min": 0,
  "max": 5000,
  "step": 10
}
```

### 2.1 字段类型

| `type` | 对应控件 | 取值类型 | 该类型额外接受的属性 |
|---|---|---|---|
| `text` | 单行文本 | string | `allowClear` `showCount` |
| `textarea` | 多行文本 | string | `allowClear` `showCount` |
| `password` | 密码框 | string | `allowClear` `showCount` `showToggle` |
| `number` | 数字输入（带步进） | number | `step` `precision` |
| `slider` | 滑块 | number | `step` `range` |
| `checkbox` | 复选框 | boolean | — |
| `switch` | 开关 | boolean | — |
| `radio-group` | 单选组 | string | `options` `direction` |
| `checkbox-group` | 多选组 | string[] | `options` `direction` `maxChecked` |
| `select` | 下拉选择 | string | `options` `mode` `showSearch` |
| `date` | 日期选择 | string | `placement` |

所有类型都还接受：`name` `type` `label` `placeholder` `default` `required`
`min` `max` `minLength` `maxLength` `pattern` `message` `rules` `dependencies` `width` `props`。

> 白名单之外的键会被**忽略并给出警告**，警告里会列出这个类型接受哪些键。
> `props` 是逃生舱（内容不校验），优先用具名属性。

`options` 的形状（`select` / `radio-group` / `checkbox-group` 必需）：

```json
{
  "name": "mode",
  "type": "select",
  "label": "运行模式",
  "default": "auto",
  "options": [
    { "value": "auto", "label": "自动" },
    { "value": "manual", "label": "手动" }
  ]
}
```

`label` 可以省略，编译时用 `value` 兜底。

---

## 3. 校验规则：写一次，两处生效

这是这个 DSL 相对直接写控件最实在的一处改进，**务必用 shorthand**：

```json
{
  "name": "age",
  "type": "number",
  "label": "年龄",
  "min": 18,
  "max": 65
}
```

`min` / `max` 会**同时**：① 约束数字控件的步进夹取；② 生成校验规则。
直接写控件的话这两件事互不相干（`new ICEInputNumber({min:18})` 不会拦住用户手输 `10`），
你只会写其中一个，然后"填了 10 却不报错"。

同理，文本类字段的 `maxLength` 同时限制输入长度与生成校验。

### 3.1 shorthand 与 `rules`

| shorthand | 含义 |
|---|---|
| `required: true` | 必填（`null` / 空串 / 空数组 / `false` 都算缺失） |
| `min` / `max` | 数值上下界 |
| `minLength` / `maxLength` | 字符串或数组长度 |
| `pattern` | 正则**字符串**（JSON 里写不出正则字面量） |
| `message` | 自定义错误文案 |

需要多条独立规则时用 `rules`（按顺序接在 shorthand 之后）：

```json
{
  "name": "code",
  "type": "text",
  "required": true,
  "rules": [{ "minLength": 4 }, { "pattern": "^[A-Z0-9-]+$", "message": "只能是大写字母、数字与连字符" }]
}
```

`validator` / `asyncValidator` 是函数，**JSON 里表达不了**，别写。

### 3.2 跨字段依赖

「确认密码」这类规则要声明 `dependencies`，被依赖字段一变本字段立刻重算：

```json
{
  "name": "confirm",
  "type": "password",
  "label": "确认密码",
  "required": true,
  "dependencies": ["password"]
}
```

`dependencies` 里写错字段名会被拦下，**诊断里会列出可用字段名**。

---

## 4. 提交

- 默认生成一个提交按钮，点它走「先同步校验、再异步校验」，**通过才回调**。
- 宿主拿到 `compiled.onSubmit(values => ...)` 或 `renderFormDsl(..., { onSubmit })`。
- `submitText: null` 表示不生成按钮，由宿主自己接管提交。

---

## 5. 完整示例

一份带跨字段校验的表单：

```json
{
  "schemaVersion": 1,
  "kind": "form",
  "title": "新建巡检任务",
  "description": "填完这些我就把任务派下去。",
  "fields": [
    { "name": "device", "type": "select", "label": "设备", "required": true, "options": [{ "value": "pump-1", "label": "一号泵" }, { "value": "pump-2", "label": "二号泵" }] },
    { "name": "date", "type": "date", "label": "计划日期", "required": true },
    { "name": "level", "type": "radio-group", "label": "优先级", "default": "normal", "options": [{ "value": "low", "label": "低" }, { "value": "normal", "label": "中" }, { "value": "high", "label": "高" }] },
    { "name": "note", "type": "textarea", "label": "备注", "maxLength": 200, "placeholder": "选填" }
  ],
  "submitText": "派发"
}
```

一份只要一个参数的确认表单（不要提交按钮时由宿主接管）：

```json
{
  "schemaVersion": 1,
  "kind": "form",
  "title": "确认",
  "fields": [
    { "name": "reason", "type": "text", "label": "原因", "required": true, "maxLength": 50 }
  ]
}
```

---

## 6. 自检清单（输出前逐条过）

1. 顶层有 `kind: "form"` 与**非空**的 `fields`。
2. 每个字段有 `name` 与 `type`，**`name` 互不重复**。
3. 每个 `type` 都在 §2.1 的表里。
4. 用了 `select` / `radio-group` / `checkbox-group` 的字段**都给了 `options`**，且每项都有 `value`。
5. 选项型字段的 `default`（如果有）**一定是某个选项的 `value`**。
6. `number` / `slider` 的 `default` 是数字，`checkbox` / `switch` 的是布尔，文本类的是字符串。
7. `pattern` 写的是**字符串**，且是合法正则。
8. `dependencies` 里引用的字段名**在本表单里存在**，且不是自己。
9. `min <= max`、`minLength <= maxLength`。
10. 字段上没写这个类型不接受的属性（不确定就别写，校验器会告警）。

**拿不准就调 `validateFormDsl()` 看一眼**：它对任何输入都不抛异常，而且诊断里会给出可用替代。
