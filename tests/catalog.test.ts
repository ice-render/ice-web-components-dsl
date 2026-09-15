/**
 * 组件清单的门禁。
 *
 * 这份清单要回答的是"**库里有什么、哪些能当字段**"——它是 agent 唯一的发现入口
 * （`skills/` 与提示词都由它生成）。所以它最怕的不是"少几个组件"，是**静默地不完整**：
 * 上游改了文档版式、改了组件名、加了新组件，而清单看起来一切正常。
 *
 * 下面每一条都在守一种"静默"：
 *
 * 1. **同步**：清单文件与重新生成的结果必须逐字节一致（改了上游忘了重生成 → 红）。
 * 2. **版式**：每个条目都要解出摘要（markdown 版式变了 → 红，而不是产出一堆空条目）。
 * 3. **自洽**：`gaps.propsMissing` 必须真的等于"props 为空的那些类"（这节不能烂掉）。
 * 4. **标注双向**：标注里的组件与类型都得真实存在，**且每个已实现的类型都有组件认领**
 *    （加了新字段类型却忘了说它由哪个组件实现 → 红）。
 * 5. **值形状**：几条已知事实钉死（`deriveValueShape` 是会悄悄推错的那种代码）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FORM_DSL_FIELD_TYPES } from '../src/types';

const ROOT = path.resolve(__dirname, '..');
const CATALOG_FILE = path.join(ROOT, 'catalog/components.json');

interface CatalogEntry {
  name: string;
  kind: 'class' | 'function' | 'const';
  group: string;
  groupTitle: string;
  summary: string;
  props: Array<{ name: string; type: string; optional: boolean; doc: string }>;
  methods: string[];
  value: { kind: string; type: string | null };
  role: { kind: string; fieldType?: string; plannedType?: string; reason?: string };
  /** 初始值走哪个构造键（缺省 `value`；`ICETransfer` 是 `targetKeys`）。 */
  initKey: string;
  note?: string;
}

interface Catalog {
  from: { package: string; version: string; groups: string; detail: string };
  counts: Record<string, number>;
  gaps: { propsMissing: string[]; note: string };
  groups: Array<{ file: string; title: string; intro: string; components: string[] }>;
  components: Record<string, CatalogEntry>;
}

const catalog: Catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
const entries = Object.values(catalog.components);

describe('清单与上游同步', () => {
  it('磁盘上的 components.json 与重新生成的结果一致', () => {
    // 子进程跑 --check：它会重新读上游、重新算，再和磁盘上的比。
    // 放在子进程里是因为生成器是 ESM 脚本，且它自己会 process.exit。
    expect(() =>
      execFileSync(process.execPath, [path.join(ROOT, 'tools/gen-catalog.mjs'), '--check'], {
        cwd: ROOT,
        stdio: 'pipe',
      })
    ).not.toThrow();
  });

  it('清单记住了上游的版本（否则不知道是哪一版抽出来的）', () => {
    expect(catalog.from.package).toBe('ice-web-components');
    expect(catalog.from.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('清单读的那份上游 == 测试跑的那份上游（否则清单描述的不是被测物）', () => {
    // 生成器读**兄弟仓** `../ice-web-components`，而 jest 经 node_modules 解析到
    // **安装的那一份**。两者都是真实目录、不是软链 —— 版本一旦错开，清单就在描述
    // 一个测试从没跑过的东西，而且不会有任何症状。
    const installed = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'node_modules/ice-web-components/package.json'), 'utf8')
    );
    expect(catalog.from.version).toBe(installed.version);
  });

  it('分组与上游 GROUPS 一致，且每组都有条目', () => {
    expect(catalog.groups.length).toBeGreaterThanOrEqual(9);
    for (const g of catalog.groups) {
      expect(g.title).toBeTruthy();
      expect(g.intro).toBeTruthy();
      expect(g.components.length).toBeGreaterThan(0);
    }
  });

  it('分组表里出现的每个名字都在清单里（漏一个就说明解析漏了）', () => {
    const listed = new Set(catalog.groups.flatMap((g) => g.components));
    const missing = [...listed].filter((n) => !catalog.components[n]);
    expect(missing).toEqual([]);
    expect(listed.size).toBe(entries.length);
  });
});

describe('解析出来的条目是完整的', () => {
  /**
   * 摘要的完整性上限。
   *
   * 为什么是"上限"而不是"每个都要有"：少数条目在上游源码里**确实没有类注释**
   * （`ICEMenu` / `ICETabs` / 一批 model 与工具函数），那是上游的待补项，
   * 不是本包能猜的。
   *
   * 那这条门禁守什么？守**版式漂移**：上游一改文档版式，185 个摘要会**一起**变空。
   * 所以判据是"缺的不能超过这个数"—— 目前 28，留到 40 的都是"上游又少写了几条注释"，
   * 而版式一坏就是 185。两种情形必须能分开。
   */
  const MAX_MISSING_SUMMARY = 40;

  it('摘要不会大面积缺失（版式漂移的哨兵）', () => {
    expect(catalog.gaps.summaryMissing.length).toBeLessThanOrEqual(MAX_MISSING_SUMMARY);
  });

  it('`gaps.summaryMissing` 与"摘要为空的条目"完全一致（这一节不能烂掉）', () => {
    const actually = entries
      .filter((e) => !e.summary)
      .map((e) => e.name)
      .sort();
    expect(catalog.gaps.summaryMissing).toEqual(actually);
  });

  it('摘要里没有残留的代码块', () => {
    // 上游把整段 JSDoc 压成一行，所以代码围栏是**行内的**：
    // `ICEFormList` 的说明里嵌了一段 `用法：```ts …`，按行首切切不到，
    // 结果整段示例代码进了摘要。切掉之后这里守着别再回来。
    const withCode = entries.filter((e) => e.summary.includes('```') || e.summary.includes('const ')).map((e) => e.name);
    expect(withCode).toEqual([]);
  });

  it('摘要不该长到像一整节文档', () => {
    // 500 是**粗界**，不是文风规定：它只用来抓"把一整节吞进来了"。
    // 合法但偏长的（`ICE_CHIP8_KEYS` 405 字，那是一张键位表）允许过。
    const tooLong = entries.filter((e) => e.summary.length > 500).map((e) => e.name);
    expect(tooLong).toEqual([]);
  });

  it('组件类与"常量/函数便捷入口"要分得开', () => {
    // 实测来源：ICEMessage / ICENotification 是 ICEMessageManager 里的 export const，
    // 不是组件 —— 只认 `## ` 的话它们会凭空消失，而分组表里明明列着。
    expect(catalog.components.ICEMessage.kind).toBe('const');
    expect(catalog.components.ICEMessage.role.kind).toBe('not-component');
    expect(catalog.components.ICENotification.kind).toBe('const');
    expect(catalog.components.ICETextField.kind).toBe('class');
  });

  it('解出来的 props 是真的解析对了（类型串没被竖线切断、optional 认得出来）', () => {
    const select = catalog.components.ICESelect;
    expect(select.props.find((p) => p.name === 'options')!.type).toBe('ICESelectOption[]');
    expect(select.props.find((p) => p.name === 'options')!.optional).toBe(false); // options 是必填
    expect(select.props.find((p) => p.name === 'value')!.optional).toBe(true);
    // 联合类型里的 `\|` 是转义的竖线，不能被当成表格分隔符
    expect(select.props.find((p) => p.name === 'value')!.type).toBe('string | string[]');
  });

  it('方法名是**裸名**，不带调用语法', () => {
    // 第一版没切参数表，`methods` 里存的是 `setValue(hex: string)` ——
    // 于是 `methods.includes('getFormValue')` 永远为假，我把 ICETransfer / ICERadioButton
    // 判成了"没有表单取值约定"，结论正好反了。方法名必须是裸名。
    const color = catalog.components.ICEColorPicker;
    expect(color.methods).toContain('getValue');
    expect(color.methods).toContain('getFormValue');
    const withParens = entries.filter((e) => e.methods.some((m) => m.includes('(')));
    expect(withParens.map((e) => e.name)).toEqual([]);
  });

  it('`gaps.propsMissing` 与"props 为空的类"完全一致（这一节不能烂掉）', () => {
    const actually = entries
      .filter((e) => e.kind === 'class' && e.props.length === 0)
      .map((e) => e.name)
      .sort();
    expect(catalog.gaps.propsMissing).toEqual(actually);
    // 这个数字是刻意留着的：上游的生成文档只记"自己声明的 Options"，
    // 继承来的 / `props?: any` 的一律没有。空数组不等于"没有参数"。
    expect(catalog.gaps.propsMissing.length).toBeGreaterThan(0);
    expect(catalog.gaps.propsMissingNote).toBeTruthy();
  });
});

describe('DSL 侧标注是自洽的', () => {
  const fieldEntries = entries.filter((e) => e.role.kind === 'field');
  const plannedEntries = entries.filter((e) => e.role.kind === 'planned');

  it('标注里的组件名都真实存在（生成器会抛，这里再明说一次）', () => {
    for (const e of [...fieldEntries, ...plannedEntries]) {
      expect(catalog.groups.flatMap((g) => g.components)).toContain(e.name);
    }
  });

  it('标注的 fieldType 都是合法类型', () => {
    for (const e of fieldEntries) {
      expect(FORM_DSL_FIELD_TYPES as readonly string[]).toContain(e.role.fieldType);
    }
  });

  it('**每个已实现的字段类型都有组件认领** —— 加了类型却忘了说它由谁实现就会红', () => {
    const claimed = fieldEntries.map((e) => e.role.fieldType).sort();
    expect(claimed).toEqual([...FORM_DSL_FIELD_TYPES].sort());
  });

  it('一个类型不认领两个组件（`text` 与 `textarea` 是两个类型两个组件，别混）', () => {
    const claimed = fieldEntries.map((e) => e.role.fieldType);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it('"待接"的每条都要有 note —— 它们为什么还没接是有信息量的', () => {
    const noNote = plannedEntries.filter((e) => !e.note).map((e) => e.name);
    expect(noNote).toEqual([]);
  });

  it('每个组件类都有 role（不是字段也要说清为什么）', () => {
    const noRole = entries
      .filter((e) => e.kind === 'class' && !e.role.kind)
      .map((e) => e.name);
    expect(noRole).toEqual([]);
    const notFieldNoReason = entries
      .filter((e) => e.role.kind === 'not-field' && !e.role.reason)
      .map((e) => e.name);
    expect(notFieldNoReason).toEqual([]);
  });
});

describe('SKILL 里给 agent 看的那几张表与实现同步', () => {
  /**
   * §2.1 那张表是**手写**的（它是本包对 agent 的契约，措辞要讲究），
   * 所以它会漂移 —— 加了类型忘了补表，agent 就看不到新类型。
   * 这里把"表里列的类型集合"与 `FORM_DSL_FIELD_TYPES` 对起来。
   */
  const skill = fs.readFileSync(path.join(ROOT, 'skills/ice-web-components-dsl/SKILL.md'), 'utf8');

  function section21Rows(): string[] {
    const start = skill.indexOf('### 2.1 字段类型');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = skill.indexOf('\n\n', skill.indexOf('| `date-range`', start));
    const body = skill.slice(start, end < 0 ? undefined : end);
    const types: string[] = [];
    for (const line of body.split('\n')) {
      const m = line.match(/^\|\s*`([a-z-]+)`\s*\|/);
      // 表头那一行是 `| \`type\` | 对应控件 | …` —— 它的第一格恰好也匹配（`type` 是 `[a-z-]+`），
      // 所以要把表头自己排掉，否则会多出一个 "type"
      if (m && m[1] !== 'type') types.push(m[1]);
    }
    return types;
  }

  it('§2.1 列出的类型 == 已实现的类型（不多不少）', () => {
    expect(section21Rows().sort()).toEqual([...FORM_DSL_FIELD_TYPES].sort());
  });

  it('§7.1 的"每个 type 背后是哪个组件"也覆盖全部类型', () => {
    // §7.1 是**生成**的，理论上不会漏；但生成器遍历的是清单里的 field 标注，
    // 而标注可能漏（漏了生成器会抛）。这条是对着 agent 真正读到的那份文件验的。
    const start = skill.indexOf('### 7.1');
    const end = skill.indexOf('### 7.', start + 5);
    const body = skill.slice(start, end);
    const types: string[] = [];
    for (const line of body.split('\n')) {
      const m = line.match(/^\|\s*`([a-z-]+)`\s*\|\s*`ICE/);
      if (m) types.push(m[1]);
    }
    expect(types.sort()).toEqual([...FORM_DSL_FIELD_TYPES].sort());
  });
});

describe('值的形状（`required` / `minLength` 落在什么上面）', () => {
  const shape = (name: string) => catalog.components[name].value.kind;

  it('标量、数组、联合、元组都认得出来', () => {
    expect(shape('ICEInputNumber')).toBe('scalar');
    expect(shape('ICETextField')).toBe('unknown'); // 构造参数没进文档，推不出来 —— 不是"没有值"
    expect(shape('ICECheckboxGroup')).toBe('array');
    expect(shape('ICESelect')).toBe('union'); // string | string[]，取决于 mode
    expect(shape('ICEDateRangePicker')).toBe('tuple'); // [起, 止]，允许只给一头
  });

  it('`unknown` 与 `none` 不能混为一谈', () => {
    // unknown = 构造参数没进生成文档；none = 声明了参数但没有 value 这个键。
    // 混起来的话，读清单的人会以为 ICEUpload "没有值"——它只是用了别的表示法。
    expect(shape('ICETextField')).toBe('unknown');
    expect(catalog.components.ICETextField.props).toEqual([]);
    expect(shape('ICEUpload')).toBe('none');
    expect(catalog.components.ICEUpload.props.length).toBeGreaterThan(0);
  });

  it('值形状推不出来的那些，必须**已经记在缺口里**（而不是悄悄写成"没有值"）', () => {
    // 第一版这条写的是"能作字段的不能是 unknown/none"—— 那是错的：
    // 已接入的 11 个类型里就有 6 个（ICETextField / ICECheckBox / ICESwitch / ICESlider…）
    // 因为构造函数是 `props?: any` 而推不出值形状。
    //
    // 真正该守的不是"推不出来就不许作字段"，是"推不出来这件事**得有人知道**"。
    const unknownFieldEntries = entries
      .filter((e) => e.role.kind === 'field' && e.value.kind === 'unknown')
      .map((e) => e.name);
    expect(unknownFieldEntries.length).toBeGreaterThan(0);
    for (const name of unknownFieldEntries) {
      expect(catalog.gaps.propsMissing).toContain(name);
    }
  });

  it('"没有 value 参数"的字段必须说清初始化走哪个键（否则会被读成"不能当字段"）', () => {
    // 第一版这条写的是"已接入的类型里值形状不能是 none"—— 前提就错了：
    // `value.kind === 'none'` 只表示**组件没有 `value` 构造参数**，
    // 不表示不能当字段。`ICETransfer` 就没有 `value`，它的初始化键是 `targetKeys`。
    //
    // 真正要守的是：**偏离缺省就要说出来**。没说 = 别人只能看到"没有 value"，
    // 会得出"这个组件不能当字段"的结论（我正是这么判错的）。
    const unexplained = entries
      .filter((e) => e.role.kind === 'field' && e.value.kind === 'none' && (!e.initKey || e.initKey === 'value'))
      .map((e) => e.name);
    expect(unexplained).toEqual([]);
  });

  it('`initKey` 缺省是 `value`，偏离的必须真实存在', () => {
    expect(catalog.components.ICETextField.initKey).toBe('value');
    expect(catalog.components.ICETransfer.initKey).toBe('targetKeys');
  });
});
