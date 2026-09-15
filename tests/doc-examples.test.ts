/**
 * **文档即契约**：把 SKILL / 提示词 / README 里的 ```json 代码块抽出来跑校验。
 *
 * 为什么值得单独测：Agent 唯一的"说明书"就是这几份文档，一旦里面出现不存在的字段类型、
 * 写错的选项形状、悬空的依赖名，Agent 会照着抄 —— 而这类错误不会在别处暴露
 * （没人会去手动跑文档里的例子）。这里把"文档里的完整表单必须能通过 validateFormDsl"
 * 变成回归：**文档腐化 = 测试红**。
 *
 * 「至少 N 个代码块」那条是防**测试空转**：抽取正则一旦失效，下面几条会对着空数组通过。
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateFormDsl } from '../src/validate';

const ROOT = path.resolve(__dirname, '..');
const DOCS = [
  'README.md',
  'skills/ice-web-components-dsl/SKILL.md',
  'prompts/agent-prompt.md',
];

/** 抽出所有 ```json 代码块。 */
function jsonBlocks(markdown: string): string[] {
  const out: string[] = [];
  const re = /```json\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    out.push(match[1]);
  }
  return out;
}

/** 一份"完整表单文档"= 是个对象且带 fields 数组。 */
function isDocument(value: any): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.fields);
}

describe('文档与提示词里的 JSON 例子', () => {
  for (const rel of DOCS) {
    describe(rel, () => {
      const markdown = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const blocks = jsonBlocks(markdown);
      const parsed = blocks.map((block) => {
        let value: any = null;
        let error: Error | null = null;
        try {
          value = JSON.parse(block);
        } catch (err) {
          error = err as Error;
        }
        return { block, value, error };
      });

      it('至少包含 2 个 JSON 代码块（防止抽取逻辑失效导致测试空转）', () => {
        expect(blocks.length).toBeGreaterThanOrEqual(2);
      });

      it('每个 JSON 代码块都是合法 JSON', () => {
        const broken = parsed
          .filter((item) => item.error)
          .map((item, index) => ({ index, message: item.error!.message }));
        expect(broken).toEqual([]);
      });

      it('每个完整表单文档都能通过校验，且没有 error 级诊断', () => {
        const documents = parsed.filter((item) => isDocument(item.value));
        // jest 的 expect 只接受一个参数；下一条断言失败时看测试名就知道是哪个文件
        expect(documents.length).toBeGreaterThan(0);

        const broken = documents
          .map((item, index) => ({ index, result: validateFormDsl(item.value) }))
          .filter(({ result }) => !result.valid)
          .map(({ index, result }) => ({
            example: index + 1,
            problems: result.errors.map((d) => `${d.code} @ ${d.path}`),
          }));
        expect(broken).toEqual([]);
      });

      it('完整表单示例都不是空表单（空 fields 没有意义，也会被校验拦下）', () => {
        const documents = parsed.filter((item) => isDocument(item.value));
        for (const item of documents) {
          expect(item.value.fields.length).toBeGreaterThan(0);
        }
      });
    });
  }
});
