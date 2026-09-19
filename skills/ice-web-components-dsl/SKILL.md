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
| `width` / `maxWidth` | 否 | 宽度（CSS 像素）。**一般不用写** —— 见下面的说明 |
| `gap` | 否 | 字段间距，默认 12 |
| `fields` | **是** | 字段数组，**不能为空** |
| `submitText` | 否 | 提交按钮文案，默认「提交」。传 `null` 表示不生成提交按钮 |

> **别写 `width` / `maxWidth`。** 表单多宽取决于宿主把它放在哪儿（卡片多宽、面板多宽），
> 宿主会通过 `renderFormDsl(target, dsl, { width })` 告诉渲染器 —— 你写的值会被覆盖。
> 留空即可：控件会跟着表单铺满内容宽度（默认上限 640，由渲染器夹住）。
> 只有"某个字段就该比别的窄"这种**逐字段**的意图才值得写 `fields[n].width`。

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
| `select` | 下拉选择 | string（`mode: "multiple"` 时 string[]） | `options` `mode` `showSearch` |
| `date` | 日期选择 | string（`YYYY-MM-DD`） | `placement` |
| `color` | 颜色选择 | string（hex） | `options`（色板，也可写裸字符串） |
| `rate` | 评分 | number | —（`max` = 满分几颗星） |
| `time` | 时间选择 | string（`HH:mm:ss`） | `format`（`HH:mm:ss` / `HH:mm`） |
| `segmented` | 分段控制器 | string | `options` `block` |
| `autocomplete` | 自动完成 | string | `options`（候选，可写裸字符串） |
| `cascader` | 级联选择 | string（最深一层的叶子） | `options`（带 `children`）`separator` |
| `tree-select` | 树选择 | string（`mode: "multiple"` 时 string[]） | `options`（带 `children`）`mode` `showSearch` |
| `transfer` | 穿梭框 | string[] | `options`（候选池） |
| `date-range` | 区间日期 | `[起, 止]` | —（`required` = 两头都在） |

所有类型都还接受：`name` `type` `label` `placeholder` `default` `required`
`min` `max` `minLength` `maxLength` `pattern` `message` `rules` `dependencies` `width` `props`。

> 白名单之外的键会被**忽略并给出警告**，警告里会列出这个类型接受哪些键。
> `props` 是逃生舱（内容不校验），优先用具名属性。

> **`options` 两种写法都行**：`[{ "value": "a", "label": "甲" }]` 或直接 `["a", "b"]`。
> 库里不同控件要的形状不一样（`string[]` / `{value,label}[]` / `colors` / `nodes` / `dataSource`）——
> 那些差别**由渲染器归一化**，你只管写 `options`。
> `cascader` / `tree-select` 可以在项上写 `children` 往下嵌。

> 上面 20 个类型就是全部。库里**不是**字段的组件（以及为什么）见 **§7** ——
> 那一节由清单自动生成，不用记，用到再翻。

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

---

<!-- catalog:start -->
## 7. 库里还有什么（以及为什么不让你用）

> 由 `node tools/gen-catalog.mjs` 从 `ice-web-components` **1.22.0** 的生成文档自动写出，不要手改。
> 数据源：9 组 / 185 个条目（其中组件类 113 个）。

### 7.1 每个 `type` 背后是哪个组件

（值的形状见 §7.4 —— 那是**本包**的知识，`ice-web-components` 的文档里推不出来。）

| `type` | 组件 |
|---|---|
| `autocomplete` | `ICEAutoComplete` |
| `cascader` | `ICECascader` |
| `checkbox` | `ICECheckBox` |
| `checkbox-group` | `ICECheckboxGroup` |
| `color` | `ICEColorPicker` |
| `date` | `ICEDatePicker` |
| `date-range` | `ICEDateRangePicker` |
| `number` | `ICEInputNumber` |
| `password` | `ICEPasswordField` |
| `radio-group` | `ICERadioGroup` |
| `rate` | `ICERate` |
| `segmented` | `ICESegmented` |
| `select` | `ICESelect` |
| `slider` | `ICESlider` |
| `switch` | `ICESwitch` |
| `text` | `ICETextField` |
| `textarea` | `ICETextArea` |
| `time` | `ICETimePicker` |
| `transfer` | `ICETransfer` |
| `tree-select` | `ICETreeSelect` |

### 7.3 不是字段的（别往字段表里塞）

| 分组 | 不是字段的那些 | 为什么 |
|---|---|---|
| 基础组件 | `ICEWidget` `ICEContainer` `ICEPanel` `ICESpace` `ICEGrid` `ICEGridCol` `ICEButton` `ICELabel` `ICETypography` `ICEIcon` `ICESvgIcon` `ICEIconTile` `ICESeparator` | 基础组件 —— 基类与最小构件（面板 / 按钮 / 文本 / 图标）。DSL 的表单**用**它们，但它们是"画出来的东西"，不是"被填的字段"。 |
| 数据录入 | `ICERadioButton` | `getFormValue()` 返回的是**布尔**（只表示自己勾没勾），而**互斥要调用方维护** —— 当字段用会做出"两个都能选上"的假单选，而 `radio-group` / `checkbox` 已经覆盖这个需求且更好。证据：`tests/field-values.test.ts`。 |
| 数据录入 | `ICEUpload` | `setFormValue` 是基类默认的**照收不误**（给什么存什么），组件本身不参与取值 —— 说明它没实现这条约定。而且上传的值是**文件列表**，那东西没法经 JSON 往返给 agent，不是一个"字段值"。要做得多先定义"值是什么"。证据：`tests/field-values.test.ts`。 |
| 数据录入 | `ICEFormItem` | 表单项容器（DSL 的产物），不是字段。 |
| 数据录入 | `ICEForm` | 表单容器本身（DSL 的产物），不是字段。 |
| 数据录入 | `ICEFormList` | 重复行组（`initialRows` + `renderRow`）—— 它是"一个字段"的**复数形式**，形状是数组套字段，不是字段表能表达的。要做得新开一个 kind。 |
| 数据展示 | `ICETable` `ICEList` `ICETree` `ICECard` `ICEStatCard` `ICEStatistic` `ICEDescriptions` `ICETimeline` `ICEProgressBar` `ICEImageView` `ICEImagePreview` `ICECalendar` `ICEAvatar` `ICEAvatarGroup` `ICETag` `ICEBadge` `ICECarousel` `ICECollapse` `ICEComment` `ICEWatermark` `ICETileMap` `ICEVirtualList` `ICEKanban` | 数据展示 —— 这些是**另一种卡**（表格卡 / 指标卡 / 时间线卡），属于新 kind，不是字段。 |
| 反馈与状态 | `ICEAlert` `ICEModal` `ICEDrawer` `ICETooltip` `ICEPopover` `ICEPopconfirm` `ICEResult` `ICEEmpty` `ICESkeleton` `ICESpin` `ICESteps` `ICETour` `ICEFloatButton` | 反馈与状态 —— 浮层类（Modal / Drawer / Popover / Tooltip）在 ICE 里画在**同一张画布**上靠 zIndex 命中，跟"两块并排画布"的卡片结构会打架；其余是页面级状态。 |
| 反馈与状态 | `ICEMessage` `ICENotification` | 不是组件类，是常量便捷入口。 |
| 导航 | `ICEMenu` `ICEBreadcrumb` `ICEAnchor` `ICEBackTop` `ICEDropdown` `ICEPagination` `ICETabs` | 导航 —— 页面级结构（菜单 / 面包屑 / 分页），卡片里没有意义。 |
| 核心与布局 | `ICEScrollPane` `ICEAffix` `ICELayout` `ICESplitter` `ICEWindow` `ICEOverlayManager` `ICEFocusManager` `ICEHoverManager` `ICEMessageManager` `ICEManager` | 核心与布局 —— 基类、管理器与布局骨架，不直接出现在业务页面里。 |

### 7.4 值的形状：`required` / `minLength` 落在什么上面

- **标量**（文本 / 数值 / 布尔）：`required` 判空、`minLength`/`maxLength` 判**长度**、`pattern` 判格式，都按直觉走。
- **数组**（`checkbox-group`）：`required: true` 表示"至少选一项"，`minLength: 2` 表示"**至少选 2 项**"（判的是数组长度，不是字符串长度）。
- **值形状随 `mode` 变**（`select` → `ICESelect`，类型是 `string|string[]`）：`mode: "multiple"` 时值是数组，其余是字符串 —— 写 `default` 与 `required` 时先确认 `mode`。
- **值形状随 `mode` 变**（`tree-select` → `ICETreeSelect`，类型是 `string|string[]`）：`mode: "multiple"` 时值是数组，其余是字符串 —— 写 `default` 与 `required` 时先确认 `mode`。

### 7.5 这份清单自己缺什么

- **构造参数只覆盖了 65/113 个类**：48 个类的构造参数**没进生成文档**（它们继承基类的 Options，或构造函数就是 `props?: any`），`ICEButton` / `ICETextField` / `ICECheckBox` 这些最常用的都在里面。
- **27 个条目上游没写类注释**（多为 model 与工具函数）。
- 所以：**"清单里没看到某个键"不等于"这个键不能用"**。拿不准就 `validateFormDsl()` 看诊断，或者用 `props` 逃生舱 —— 代价是 `props` 里的键**不做校验**，写错了静默生效。
<!-- catalog:end -->
