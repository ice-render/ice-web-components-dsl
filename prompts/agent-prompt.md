# 表单 DSL · 输出契约

需要用户填参数、做确认、走人机回环时，**输出一份 JSON 表单文档**。完整规范见
`skills/ice-web-components-dsl/SKILL.md`，这里只是最小契约。

## 1. 你要输出什么

一个 JSON 对象，必须能通过 `validateFormDsl()`。最小值是：

```json
{
  "schemaVersion": 1,
  "kind": "form",
  "fields": [{ "name": "station", "type": "text", "label": "泵站名称", "required": true }]
}
```

带常用属性的一版：

```json
{
  "schemaVersion": 1,
  "kind": "form",
  "title": "泵站参数确认",
  "description": "确认后才会下发控制指令。",
  "fields": [
    { "name": "mode", "type": "select", "label": "运行模式", "required": true, "default": "auto", "options": [{ "value": "auto", "label": "自动" }, { "value": "manual", "label": "手动" }] },
    { "name": "flow", "type": "number", "label": "目标流量", "required": true, "min": 0, "max": 5000, "step": 10 },
    { "name": "note", "type": "textarea", "label": "备注", "maxLength": 200 }
  ],
  "submitText": "确认下发"
}
```

## 2. 硬约束

1. **只写声明，不写坐标。** 没有 `left` / `top`，也没有控件实例。
2. **`kind` 只能是 `"form"`**。
3. **`fields` 非空**，每个字段有 `name` 与 `type`，`name` 不重复。
4. **选项型字段（`select` / `radio-group` / `checkbox-group`）必须给 `options`**，
   每项 `{ "value": "...", "label": "..." }`，`label` 可省。
5. **`pattern` 写字符串**（不是正则字面量）；`validator` / `asyncValidator` 是函数，别写。
6. **`dependencies` 只能引用本表单里存在的字段名。**

## 3. 写校验规则用 shorthand，不要用 rules

```json
{ "name": "age", "type": "number", "label": "年龄", "min": 18, "max": 65 }
```

`min` / `max` 会同时约束控件与生成校验规则。分开写只会漏掉一半
（控件不拦手输、或拦了但不报错）。文本类字段的 `maxLength` 同理。

## 4. 提交前自检

- [ ] `kind` 是 `"form"`，`fields` 非空
- [ ] 字段 `name` 唯一；每个 `type` 是已知类型
- [ ] 选项型字段都有非空 `options`，且 `default` 落在选项里
- [ ] `default` 的类型与字段类型一致（数字↔number、布尔↔checkbox/switch、字符串↔文本/选项）
- [ ] `pattern` 是合法正则字符串
- [ ] `dependencies` 引用的字段存在且不是自己
- [ ] `min <= max`、`minLength <= maxLength`

拿不准就调 `validateFormDsl()` —— 它对任何输入都不抛异常，
诊断里会给出可用替代（可用类型 / 可用字段名 / 可用取值）。
