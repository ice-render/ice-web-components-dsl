# ice-web-components-dsl — 给 Agent 的工作说明

这个包是 `ice-web-components` 的 **Agent 面向层**：一份 JSON 声明 → 一张真表单。
改之前先读 `README.md`（口径与边界）与 `skills/ice-web-components-dsl/SKILL.md`（完整规范）。

---

## 1. 硬约束

1. **不改上游仓库。** `ice-web-components` / `ice-render` 是同级目录里的独立仓库。
   发现缺陷时写进 issue 或本地记录，不要顺手改。
2. **校验器不许抛异常。** `validateFormDsl()` 对**任何**输入都要返回结果 ——
   它是给 agent 做自修复的反馈通道。抛异常意味着模型只拿到"你错了"。
   新增诊断时必须给**可操作的替代信息**（可用类型 / 可用字段名 / 可用取值），
   只报"你写错了"没有价值。
3. **DSL 里不放坐标。** 没有 `left` / `top`，布局由 `layout` 与引擎的箱式布局决定。
   放开坐标 = 模型会产出互相重叠的控件。
4. **只收 JSON 能表达的东西。** 函数（`validator` / `asyncValidator` / `format`）不进 DSL，
   留在第 10 节说的"逃生舱"里。原生的 `ICESelectOption.label` 是必填、DSL 里可省 ——
   这类差异在**编译期**归一化（`normalizeOptions`），别让它漏到运行时。
5. **白名单必须与编译器同步。** `validate.ts` 的 `TYPE_FIELD_KEYS` 是这个包"字段表封闭"
   的落点。加一个字段类型或属性时，**三处一起改**：`types.ts` 的枚举、
   `TYPE_FIELD_KEYS`、`compiler/formDslToForm.ts` 的 `createControl`。
   漏了编译器那一处，校验器就会放行一个编译不了的字段。
   **再加一处**：`tools/gen-catalog.mjs` 的 `INPUT_ANNOTATIONS` ——
   每个已实现的类型都要有组件认领，`tests/catalog.test.ts` 会守着这条。

---

## 2. 目录

| 要改什么 | 改哪儿 |
|---|---|
| DSL 文档类型 / 字段枚举 | `src/types.ts` |
| 诊断规则（**核心**） | `src/validate.ts` |
| DSL → 组件树 | `src/compiler/formDslToForm.ts` |
| 一步到位的渲染入口 | `src/runtime/renderFormDsl.ts` |
| 组件清单生成器（**手写的标注在这里**） | `tools/gen-catalog.mjs` |
| 组件清单产物（生成物，别手改） | `catalog/components.json` |
| Agent 的说明书 | `skills/ice-web-components-dsl/SKILL.md`（§7 是生成的，别手改）、`prompts/agent-prompt.md` |
| 示例页 | `examples/form-dsl.html` |

---

## 3. 验证

```bash
npm run verify        # types:check + catalog + build + jest
npm run verify:full   # 上面 + playwright
npm run catalog       # 只重生成组件清单与 SKILL §7
```

- `tests/validate.test.ts` —— 诊断逐条钉住（含"任何输入都不抛"）
- `tests/compile.test.ts` —— 编译器，重点在**「一处声明两处生效」**与**宽度**
- `tests/catalog.test.ts` —— 组件清单：与上游同步 / 解析没漏 / 标注双向自洽 / 值形状
- `tests/doc-examples.test.ts` —— **文档里的 JSON 例子必须能跑**
  （改了 SKILL / 提示词 / README 里的示例就靠它把关；它还有一条防"测试空转"的用例）

e2e 的判据不是"按钮存在"，而是画布上真的有墨、**真实点中画布上的提交按钮**能走完
校验 → 提交这条链；表单宽度那两例量的是**着墨包围盒**（"画了"不等于"排得好"）。
canvas 里没有 DOM 目标，定位靠 `state.absoluteOrigin`
（示例页把编译产物挂在 `window.__form` 上供测试用）。

---

## 4. 端口

**8101**。家族端口一仓一个，权威表在 `ice-render/AGENTS.md`；
`reuseExistingServer` 一律 `false` —— 端口被占时响亮失败，不要静默复用别人的服务。
