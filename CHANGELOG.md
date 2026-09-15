# Changelog

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
