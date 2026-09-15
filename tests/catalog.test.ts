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

  it('已接入的类型里，值形状必须是推出来的那几种之一（不含 none）', () => {
    // `none`（声明了参数但没有 value 这个键）对已接入的类型是不成立的 ——
    // 真出现说明上游把某个控件的取值入口改了名，得人来看。
    const noneEntries = entries
      .filter((e) => e.role.kind === 'field' && e.value.kind === 'none')
      .map((e) => e.name);
    expect(noneEntries).toEqual([]);
  });
});
