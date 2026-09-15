#!/usr/bin/env node
/**
 * 从 `ice-web-components` 的**产物**生成机器可读的组件清单（`catalog/components.json`）。
 *
 * ## 为什么读上游的文档产物，而不是自己去解 `.d.ts`
 *
 * 上游已经有一套成熟的抽取器（`scripts/gen-docs.mjs`）：它把每个组件的类注释首段、
 * 构造参数表、方法表抽成 `docs/api/*.md`，并且有 `docs:check` 门禁保证
 * **每个组件都被登记过**。我在 DSL 这边再写一个 TypeScript 解析器，就是第二份抽取器 ——
 * 两份会各自漂移，而且漂移的症状是"清单里少了个字段"这种没人会发现的形态。
 *
 * 所以这里**只做搬运和重组**：分组来自 `gen-docs.mjs` 的 `GROUPS`（同一个源），
 * 摘要与 props 来自它产出的 markdown。上游改格式 → 下面的门禁会红，
 * 而不是静默产出一张空表。
 *
 * ## 为什么还要一份手写标注
 *
 * 「这个组件能不能当表单字段、对应 DSL 的哪个 type」**不是从源码能推出来的**，
 * 那是本包的编辑判断。所以它手写在这里 —— 但两侧都有门禁：
 * 标注里的组件名必须真实存在，标注里的 `fieldType` 必须是合法类型，
 * 反过来每个已实现的类型也必须有组件认领（见 `tests/catalog.test.ts`）。
 *
 * 用法：
 *   node tools/gen-catalog.mjs            # 生成
 *   node tools/gen-catalog.mjs --check    # 只检查是否与磁盘上的一致（门禁用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DSL_ROOT = path.resolve(HERE, '..');
const UPSTREAM = path.resolve(DSL_ROOT, '../ice-web-components');
const OUT_FILE = path.join(DSL_ROOT, 'catalog/components.json');

const CHECK = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// 手写标注：组件 → DSL 字段类型（或"不能作字段"的理由）
// ---------------------------------------------------------------------------

/**
 * `数据录入` / `数据录入（浮层类）` 这两组里的组件，逐个说明它在 DSL 里的位置。
 *
 * - `fieldType` —— 已经能用（`FORM_DSL_FIELD_TYPES` 里有）。
 * - `planned` —— 可以作字段，但 DSL 还没接。值形状见 `note`。
 * - `notField` —— **不是**字段，附理由。
 *
 * 其余分组（数据展示 / 反馈与状态 / 导航 / 核心与布局）一律不是字段 ——
 * 那是分组的定义决定的，不需要逐条标注。
 */
const INPUT_ANNOTATIONS = {
  // ---- 已接入（11 个类型对应 12 个组件）----
  ICETextField: { fieldType: 'text' },
  ICETextArea: { fieldType: 'textarea' },
  ICEPasswordField: { fieldType: 'password' },
  ICEInputNumber: { fieldType: 'number' },
  ICESlider: { fieldType: 'slider' },
  ICECheckBox: { fieldType: 'checkbox' },
  ICESwitch: { fieldType: 'switch' },
  ICERadioGroup: { fieldType: 'radio-group' },
  ICECheckboxGroup: { fieldType: 'checkbox-group' },
  ICESelect: {
    fieldType: 'select',
    note: '值形状**取决于 `mode`**：single/tags → string，multiple → string[]。DSL 没有把这条建模进去（见 types.ts 的 ARRAY_FIELD_TYPES）。',
  },
  ICEDatePicker: { fieldType: 'date' },

  // ---- 可以作字段、还没接 ----
  ICEAutoComplete: { planned: 'autocomplete', note: '值是 string，但 `options` 是 `string[]` 而不是 `{value,label}[]`，与现有选项模型不同形。' },
  ICECascader: { planned: 'cascader', note: '值是**最深一层的 string**，但 `options` 是树；`getPath()` 才能回显上级 —— 往返语义不唯一，要设计。' },
  ICEColorPicker: { planned: 'color', note: '值是 string（hex），形状干净。' },
  ICEDateRangePicker: {
    planned: 'date-range',
    note: '值是**元组** `[string|null, string|null]`，且允许"只选了一头"的进行中状态 —— `required` 该表示"两头都在"还是"至少一头"是一个**语义决策**，不是实现问题。',
  },
  ICETimePicker: { planned: 'time', note: '值是 string（HH:mm[:ss]）。' },
  ICERate: { planned: 'rate', note: '值是 number。' },
  ICESegmented: { planned: 'segmented', note: '值是 string，需要 `options`。' },
  ICERadioButton: { planned: 'radio-button', note: '注意：单个按钮**不管互斥**（互斥由 ICERadioGroup 维护），直接当字段会做出"两个都能选上"的假单选。' },
  ICETreeSelect: { planned: 'tree-select', note: '值形状同样取决于 `mode`；且 `nodes` 是树而不是 `options`。' },
  ICETransfer: { planned: 'transfer', note: '**没有 `value`**，只有 `targetKeys: string[]` —— 要先把"值"定义出来才谈得上校验。' },
  ICEUpload: { planned: 'upload', note: '**没有 `value`**，是文件选择器 —— 值该是文件列表，`required` 的含义要重新定义。' },

  // ---- 在"数据录入"组里，但不是字段 ----
  ICEFormList: { notField: '重复行组（`initialRows` + `renderRow`）—— 它是"一个字段"的**复数形式**，形状是数组套字段，不是字段表能表达的。要做得新开一个 kind。' },
  ICEForm: { notField: '表单容器本身（DSL 的产物），不是字段。' },
  ICEFormItem: { notField: '表单项容器（DSL 的产物），不是字段。' },
};

/** 不是字段的分组：一句话说明它们在 DSL 里的位置。 */
const NON_FIELD_GROUPS = {
  basic: '基础组件 —— 基类与最小构件（面板 / 按钮 / 文本 / 图标）。DSL 的表单**用**它们，但它们是"画出来的东西"，不是"被填的字段"。',
  'data-display': '数据展示 —— 这些是**另一种卡**（表格卡 / 指标卡 / 时间线卡），属于新 kind，不是字段。',
  feedback: '反馈与状态 —— 浮层类（Modal / Drawer / Popover / Tooltip）在 ICE 里画在**同一张画布**上靠 zIndex 命中，跟"两块并排画布"的卡片结构会打架；其余是页面级状态。',
  navigation: '导航 —— 页面级结构（菜单 / 面包屑 / 分页），卡片里没有意义。',
  core: '核心与布局 —— 基类、管理器与布局骨架，不直接出现在业务页面里。',
};

// ---------------------------------------------------------------------------
// 读上游
// ---------------------------------------------------------------------------

function readUpstreamVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(UPSTREAM, 'package.json'), 'utf8'));
  return pkg.version;
}

/**
 * 取 `GROUPS` 数组。
 *
 * 用"求值那个数组字面量"而不是解析 markdown 表格：markdown 里分组名只出现在每组第一行
 * （后续行首单元格是空的），得靠"记住上一个分组"来还原，脆弱且不好报错。
 * 这里直接拿 `gen-docs.mjs` 自己用的那一份数据，两侧不可能对不上。
 */
function readGroups() {
  const src = fs.readFileSync(path.join(UPSTREAM, 'scripts/gen-docs.mjs'), 'utf8');
  const start = src.indexOf('const GROUPS = [');
  if (start < 0) {
    throw new Error('gen-docs.mjs 里找不到 `const GROUPS = [` —— 上游改名了，本脚本要跟着改');
  }
  // 从 `[` 开始做括号配平，取到配对的 `]`
  const open = src.indexOf('[', start + 'const GROUPS ='.length);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    // 这个数组里只有字符串，没有注释与模板串，所以不必考虑引号
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('GROUPS 数组没有配平的 `]`');

  const literal = src.slice(open, end + 1);
  // eslint-disable-next-line no-new-func
  const groups = new Function(`return ${literal}`)();
  if (!Array.isArray(groups) || !groups.length) throw new Error('GROUPS 求值出来不是非空数组');
  return groups;
}

/** 一个分组 → markdown 文件内容。 */
function readGroupDoc(file) {
  const p = path.join(UPSTREAM, 'docs/api', `${file}.md`);
  if (!fs.existsSync(p)) {
    throw new Error(`找不到上游文档 ${p} —— 先在上游跑 \`npm run docs:api\``);
  }
  return fs.readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------------------
// 解析 markdown
// ---------------------------------------------------------------------------

/**
 * 表格行 `| a | b | c |` → 单元格数组。非表格行返回 null。
 *
 * **必须只在未被转义的 `|` 上切**：类型串里的联合类型是 `string \| string[]`，
 * 上游把竖线转义了（否则它会把 markdown 表格切断）。按裸 `|` 切会让
 * `[string \| null, string \| null]` 断成三截，而值的形状正是从类型串推出来的 ——
 * 静默推错形状比报错难查得多。
 */
function parseRow(line) {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return null;
  const cells = t
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
  return cells.length ? cells : null;
}

/** 去掉 markdown 的行内标记与转义，留下可读文本。 */
function plain(text) {
  return text
    .replace(/\\\|/g, '|') // 先还原被转义的竖线，再交给下面的规则
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\([\\.*_])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 把一份分组文档切成 `条目名 → { kind, summary, props, methods }`。
 *
 * 依赖的版式（由 `gen-docs.mjs` 产出，且它有 `docs:check` 守着）：
 *
 *     ## `ICEXxx`
 *     <摘要段>
 *     源码：[`src/...`](...)
 *     **构造参数** `ICEXxxOptions`
 *     | 参数 | 类型 | 说明 |
 *     **方法**
 *     | 方法 | 返回 | 说明 |
 *
 *     ### `ICEMessage` — 常量          ← 常量 / 函数用三级标题
 *     <摘要段>
 *     | 方法 | 返回 | 说明 |
 *
 * 注意**一个分组里混着三种条目**：组件类（`## \``）、函数与常量（`### \`X\` — 函数|常量`）。
 * 实测来源：`ICEMessage` / `ICENotification` 是 `ICEMessageManager.ts` 里的
 * `export const` 便捷入口，不是组件 —— 只认 `## ` 的话它们会"凭空消失"，
 * 而分组表里明明列着（这个不一致是门禁逼出来的，见 commit）。
 *
 * 版式一变，`tests/catalog.test.ts` 的"每条都要有摘要 / 类条目要有 props"会红 ——
 * 那正是要的效果：宁可响亮地失败，也不要静默产出半张清单。
 */
function parseGroupDoc(markdown) {
  const out = new Map();
  const chunks = markdown.split(/^#{2,3} /m).slice(1); // 第 0 段是文件头

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const heading = lines[0].trim();
    // `ICEXxx` / `ICEXxx` — 函数 / `ICEXxx` — 常量
    const m = heading.match(/^`([A-Za-z0-9_]+)`(?:\s*—\s*(.+))?$/);
    if (!m) continue;
    const name = m[1];
    const suffix = (m[2] || '').trim();
    const kind = suffix === '函数' ? 'function' : suffix === '常量' ? 'const' : 'class';

    // 摘要取**第一段**，两个边界都要：
    //   1. 空行 —— 段落边界（有些条目的 JSDoc 分了好几段）
    //   2. 代码围栏 —— 有些条目的说明里嵌了示例代码
    //
    // 注意这两条的**形态都不一样**：上游把第一段压成了一行（换行只剩两个空格），
    // 所以段落边界得靠"空行"而不是"行首缩进"；而代码围栏是**行内的**
    // （`用法： ```ts const list = …`），按行首 ` ``` ` 切切不到 ——
    // `ICEFormList` 就是这么把整段示例吞进摘要的。
    const body = lines.slice(1);
    const srcIdx = body.findIndex((l) => l.startsWith('源码：'));
    const region = srcIdx >= 0 ? body.slice(0, srcIdx) : body;
    const paraLines = [];
    for (const line of region) {
      if (!line.trim()) {
        if (paraLines.length) break;
        continue;
      }
      paraLines.push(line.trim());
    }
    let text = paraLines.join(' ');
    const fenceAt = text.indexOf('```');
    if (fenceAt >= 0) text = text.slice(0, fenceAt);
    // 切掉代码块之后常留下"…。 用法："这种**引子**（它本来是引出下面那段代码的），
    // 留在摘要末尾就是个断句。只删这一个固定形态，不做通用截断。
    text = text.replace(/[，。；\s]*用法[：:]\s*$/, '');
    const summary = plain(text);

    // props / methods：两张表，按"表头 + 分隔行 + 数据行"认
    const props = [];
    const methods = [];
    let table = null;
    let sawHeader = false;
    for (let i = 0; i < lines.length; i++) {
      const row = parseRow(lines[i]);
      if (!row) {
        table = null;
        sawHeader = false;
        continue;
      }
      if (row[0] === '参数' || row[0] === '方法') {
        table = row[0] === '参数' ? props : methods;
        sawHeader = false;
        continue;
      }
      if (!table) continue;
      if (!sawHeader) {
        sawHeader = true; // 这一行是 `---` 分隔行
        continue;
      }
      const [nameCell, typeCell, docCell] = row;
      // `optional` 必须从**去掉反引号之后**的名字判 —— 原始单元格是 `` `value?` ``，
      // 末尾是反引号不是问号（第一版就是这么把所有字段都标成必填的）
      const propName = plain(nameCell).replace(/\?$/, '');
      const optional = plain(nameCell).endsWith('?');
      if (!propName) continue;
      if (table === props) {
        props.push({
          name: propName,
          type: plain(typeCell || ''),
          optional,
          doc: plain(docCell || ''),
        });
      } else {
        methods.push(propName);
      }
    }

    out.set(name, { name, kind, summary, props, methods });
  }

  return out;
}

// ---------------------------------------------------------------------------
// 值形状
// ---------------------------------------------------------------------------

/**
 * 从 `value` 的类型串推"值的形状"。这是清单里最有用的一列 ——
 * 它直接决定 `required` / `minLength` / `pattern` 落在什么上面。
 *
 * 注意 `unknown` 与 `none` **不是一回事**，别混：
 * - `unknown` —— 这个类的构造参数压根没进生成文档（见 `gaps.propsMissing`），所以推不出来；
 * - `none` —— 声明了构造参数，但里面**没有 `value`**：要么用了别的键表示值
 *   （`ICETransfer` 用 `targetKeys`），要么真是个选择器（`ICEUpload`）。
 *   这两种都要人来看，不能猜。
 */
function deriveValueShape(props) {
  if (!props.length) return { kind: 'unknown', type: null };
  const valueProp = props.find((p) => p.name === 'value');
  if (!valueProp) return { kind: 'none', type: null };
  const t = valueProp.type.replace(/\s/g, '');
  if (/^\[.*\]$/.test(t)) return { kind: 'tuple', type: t };
  if (t.includes('|') && t.includes('[]')) return { kind: 'union', type: t };
  if (t.endsWith('[]')) return { kind: 'array', type: t };
  return { kind: 'scalar', type: t };
}

// ---------------------------------------------------------------------------
// 生成 SKILL 里的那一节
// ---------------------------------------------------------------------------

const SKILL_FILE = path.join(DSL_ROOT, 'skills/ice-web-components-dsl/SKILL.md');
const MARK_START = '<!-- catalog:start -->';
const MARK_END = '<!-- catalog:end -->';

/** 渲染 SKILL 里那一节。内容全部来自清单，**没有一句是手写的**。 */
function renderSkillSection(cat) {
  const all = Object.values(cat.components);
  const byType = (type) => all.find((c) => c.role.kind === 'field' && c.role.fieldType === type);
  const packedTypes = all.filter((c) => c.role.kind === 'field').map((c) => c.role.fieldType).sort();
  const planned = all.filter((c) => c.role.kind === 'planned').sort((a, b) => a.name.localeCompare(b.name));

  const groups = cat.groups.filter((g) => !['models', 'helpers'].includes(g.file));

  const lines = [];
  lines.push(MARK_START);
  lines.push('## 7. 库里还有什么（以及为什么不让你用）');
  lines.push('');
  lines.push(
    `> 由 \`node tools/gen-catalog.mjs\` 从 \`ice-web-components\` **${cat.from.version}** 的生成文档自动写出，不要手改。`
  );
  lines.push(
    `> 数据源：${cat.groups.length} 组 / ${cat.counts.components} 个条目（其中组件类 ${cat.counts.classes} 个）。`
  );
  lines.push('');
  lines.push('### 7.1 每个 `type` 背后是哪个组件');
  lines.push('');
  lines.push('（值的形状见 §7.4 —— 那是**本包**的知识，`ice-web-components` 的文档里推不出来。）');
  lines.push('');
  lines.push('| `type` | 组件 |');
  lines.push('|---|---|');
  for (const type of packedTypes) {
    const c = byType(type);
    lines.push(`| \`${type}\` | \`${c.name}\` |`);
  }
  lines.push('');

  lines.push('### 7.2 能当字段、但 DSL 还没接的');
  lines.push('');
  lines.push('| 组件 | 建议的 `type` | 说明 |');
  lines.push('|---|---|---|');
  for (const c of planned) {
    lines.push(`| \`${c.name}\` | \`${c.role.plannedType}\` | ${c.note} |`);
  }
  lines.push('');
  lines.push(
    '**这些都别写进 DSL** —— 会被 `unsupported-field-type` 拦下。那是设计如此（宁可拦下也不要静默不生效），不是漏了。'
  );
  lines.push('');

  lines.push('### 7.3 不是字段的（别往字段表里塞）');
  lines.push('');
  lines.push('| 分组 | 不是字段的那些 | 为什么 |');
  lines.push('|---|---|---|');
  for (const g of groups) {
    // 只列 **role 说它不是字段** 的那些 —— 把整组倒出来会把 `ICETextField` 这种
    // "已接入的字段"也列进"不是字段"里，读的人会以为是矛盾（第一版就是这么错的）。
    const notFields = g.components
      .map((n) => cat.components[n])
      .filter((c) => c.role.kind === 'not-field' || c.role.kind === 'not-component');
    if (!notFields.length) continue;
    // **按理由分组**，一条理由一行 —— 一组里可以有不同的理由
    // （`数据录入` 里 `ICEFormItem`/`ICEForm` 是"DSL 的产物"，而 `ICEFormList` 是
    //  "重复行组"，硬合并成一行会让读者以为 `ICEFormList` 也是个容器）。
    const byReason = new Map();
    for (const c of notFields) {
      const r = c.role.reason || '';
      if (!byReason.has(r)) byReason.set(r, []);
      byReason.get(r).push(c.name);
    }
    for (const [reason, names] of byReason) {
      lines.push(`| ${g.title} | ${names.map((n) => `\`${n}\``).join(' ')} | ${reason} |`);
    }
  }
  lines.push('');

  lines.push('### 7.4 值的形状：`required` / `minLength` 落在什么上面');
  lines.push('');
  const arrayish = all.filter((c) => c.role.kind === 'field' && c.value.kind === 'array');
  const unions = all.filter((c) => c.role.kind === 'field' && c.value.kind === 'union');
  lines.push(
    `- **标量**（文本 / 数值 / 布尔）：\`required\` 判空、\`minLength\`/\`maxLength\` 判**长度**、\`pattern\` 判格式，都按直觉走。`
  );
  if (arrayish.length) {
    lines.push(
      `- **数组**（${arrayish.map((c) => `\`${c.role.fieldType}\``).join(' / ')}）：` +
        '`required: true` 表示"至少选一项"，`minLength: 2` 表示"**至少选 2 项**"（判的是数组长度，不是字符串长度）。'
    );
  }
  for (const c of unions) {
    lines.push(
      `- **值形状随 \`mode\` 变**（\`${c.role.fieldType}\` → \`${c.name}\`，类型是 \`${c.value.type}\`）：` +
        '`mode: "multiple"` 时值是数组，其余是字符串 —— 写 `default` 与 `required` 时先确认 `mode`。'
    );
  }
  const tuples = all.filter((c) => c.role.kind === 'planned' && c.value.kind === 'tuple');
  for (const c of tuples) {
    lines.push(`- **元组**（将来的 \`${c.role.plannedType}\` → \`${c.name}\`，类型是 \`${c.value.type}\`）：${c.note}`);
  }
  lines.push('');

  lines.push('### 7.5 这份清单自己缺什么');
  lines.push('');
  lines.push(
    `- **构造参数只覆盖了 ${cat.counts.classes - cat.gaps.propsMissing.length}/${cat.counts.classes} 个类**：` +
      `${cat.gaps.propsMissing.length} 个类的构造参数**没进生成文档**（它们继承基类的 Options，或构造函数就是 \`props?: any\`），` +
      '`ICEButton` / `ICETextField` / `ICECheckBox` 这些最常用的都在里面。'
  );
  lines.push(
    `- **${cat.gaps.summaryMissing.length} 个条目上游没写类注释**（多为 model 与工具函数）。`
  );
  lines.push(
    '- 所以：**"清单里没看到某个键"不等于"这个键不能用"**。拿不准就 `validateFormDsl()` 看诊断，' +
      '或者用 `props` 逃生舱 —— 代价是 `props` 里的键**不做校验**，写错了静默生效。'
  );
  lines.push(MARK_END);

  return `${lines.join('\n')}\n`;
}

/** 把生成的那一节替换进 SKILL.md。返回新内容；找不到标记就抛（别静默不更新）。 */
function spliceSkillSection(skillSource, section) {
  const start = skillSource.indexOf(MARK_START);
  const end = skillSource.indexOf(MARK_END);
  if (start < 0 || end < 0) {
    throw new Error(
      `SKILL.md 里找不到 ${MARK_START} / ${MARK_END} 标记 —— 手工删了标记就会静默不再更新，所以这里直接抛`
    );
  }
  return skillSource.slice(0, start) + section.trimEnd() + skillSource.slice(end + MARK_END.length);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function build() {
  const groups = readGroups();
  const components = {};
  const groupList = [];

  for (const group of groups) {
    const doc = readGroupDoc(group.file);
    const parsed = parseGroupDoc(doc);
    groupList.push({
      file: group.file,
      title: group.title,
      intro: plain(group.intro),
      components: [...group.entries],
    });

    for (const name of group.entries) {
      const info = parsed.get(name);
      if (!info) {
        throw new Error(`上游文档 docs/api/${group.file}.md 里没有 \`${name}\`（GROUPS 说它在 ${group.title}）`);
      }
      const shape = deriveValueShape(info.props);
      const annotation = INPUT_ANNOTATIONS[name] || null;
      const isInputGroup = group.file === 'data-entry' || group.file === 'data-entry-popups';

      let role;
      if (info.kind !== 'class') {
        // 分组表里也列着函数 / 常量（`ICEMessage.success(ice, '已保存')` 这类便捷入口）。
        // 把它们标出来而不是当组件 —— 否则清单会让人以为库里有个 ICEMessage 组件。
        role = { kind: 'not-component', reason: `不是组件类，是${info.kind === 'const' ? '常量' : '函数'}便捷入口。` };
      } else if (annotation?.fieldType) role = { kind: 'field', fieldType: annotation.fieldType };
      else if (annotation?.planned) role = { kind: 'planned', plannedType: annotation.planned };
      else if (annotation?.notField) role = { kind: 'not-field', reason: annotation.notField };
      else if (isInputGroup) {
        throw new Error(`「${group.title}」里的 ${name} 没有标注 —— 加进这个组就得说清它在 DSL 里的位置`);
      } else {
        role = { kind: 'not-field', reason: NON_FIELD_GROUPS[group.file] || '不在录入组里，不是字段。' };
      }

      components[name] = {
        name,
        kind: info.kind,
        group: group.file,
        groupTitle: group.title,
        summary: info.summary,
        props: info.props,
        methods: info.methods,
        value: shape,
        role,
        ...(annotation?.note ? { note: annotation.note } : {}),
      };
    }
  }

  return {
    $generated: 'node tools/gen-catalog.mjs —— 不要手改这个文件',
    from: {
      package: 'ice-web-components',
      version: readUpstreamVersion(),
      groups: 'scripts/gen-docs.mjs 的 GROUPS',
      detail: 'docs/api/*.md',
    },
    counts: {
      groups: groupList.length,
      components: Object.keys(components).length,
      classes: Object.values(components).filter((c) => c.kind === 'class').length,
      fieldCapable: Object.values(components).filter((c) => c.role.kind === 'field').length,
      planned: Object.values(components).filter((c) => c.role.kind === 'planned').length,
    },
    /**
     * 清单**自己知道缺什么** —— 这一节是刻意的。
     *
     * `docs/api/*.md` 只记组件**自己声明的** `ICEXxxOptions`，所以"构造参数"这一列
     * 对**继承来的 / 未类型化的**组件是空的（`ICETextField` 的构造函数就是 `props?: any`）。
     * 48/113 个类落在这里面，而且恰好是 `ICEButton` / `ICETextField` / `ICECheckBox`
     * 这些最常用的。
     *
     * 与其把空数组糊过去（读的人分不清"没有参数"和"没抽到"），不如把名字列出来：
     * 想给这些组件生成"能传哪些键"的清单，得再加一层（读 `src` 的 JSDoc，
     * 或运行时把组件造出来读 state）。
     */
    gaps: {
      propsMissing: Object.values(components)
        .filter((c) => c.kind === 'class' && c.props.length === 0)
        .map((c) => c.name)
        .sort(),
      propsMissingNote:
        '这些类的构造参数没进生成文档：它们要么继承基类的 Options、要么构造函数就是 `props?: any`。清单只报"声明了什么"，不猜。',
      /**
       * 上游自己就没写说明的条目。
       *
       * 单独列出来是为了让上面那条"摘要"门禁能定一个**上限**而不是要求"全都有"：
       * 少数条目在源码里确实没有类注释，那是上游的待补项；
       * 而**版式漂移**会让摘要**大面积**变空（185 个一起空）—— 两种情形必须能区分。
       */
      summaryMissing: Object.values(components)
        .filter((c) => !c.summary)
        .map((c) => c.name)
        .sort(),
      summaryMissingNote: '上游文档里没有类注释首段。真要补得去改上游源码的 JSDoc，本包不猜。',
    },
    groups: groupList,
    components,
  };
}

const catalog = build();
const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
const skillSource = fs.readFileSync(SKILL_FILE, 'utf8');
const skillNext = spliceSkillSection(skillSource, renderSkillSection(catalog));

const SUMMARY =
  `ice-web-components ${catalog.from.version}，` +
  `${catalog.counts.groups} 组 / ${catalog.counts.components} 个条目（类 ${catalog.counts.classes}），` +
  `已接入 ${catalog.counts.fieldCapable}，待接 ${catalog.counts.planned}`;

if (CHECK) {
  const problems = [];
  if (!fs.existsSync(OUT_FILE)) {
    problems.push('catalog/components.json 不存在');
  } else if (fs.readFileSync(OUT_FILE, 'utf8') !== serialized) {
    problems.push('catalog/components.json 与上游 / 标注不一致');
  }
  if (skillNext !== skillSource) {
    problems.push('SKILL.md 的 §7 与清单不一致');
  }
  if (problems.length) {
    console.error('✗ 清单没跟上上游：');
    for (const p of problems) console.error(`    ${p}`);
    console.error('  → 跑 `npm run catalog` 重生成');
    process.exit(1);
  }
  console.log(`✓ 清单与 SKILL 都跟得上上游（${SUMMARY}）`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, serialized, 'utf8');
if (skillNext !== skillSource) {
  fs.writeFileSync(SKILL_FILE, skillNext, 'utf8');
}
console.log(`✓ 已生成 catalog/components.json 与 SKILL.md §7 —— ${SUMMARY}`);
