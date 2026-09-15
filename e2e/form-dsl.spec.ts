import { expect, test, type Page } from '@playwright/test';

/**
 * 示例页真机冒烟。
 *
 * **判据不是"按钮存在"**，而是：
 *  - 画布上真的有墨（表单真画出来了，不是一张空画布）；
 *  - **真实点中画布上的提交按钮**能走完校验 → 提交这条链；
 *  - 诊断里带**可操作的替代信息**（可用类型 / 可用字段 / 可用取值）——
 *    那是这个包存在的理由。
 */

/** 点中画布上某个组件（canvas 里没有 DOM 目标，只能按引擎给的绝对原点算）。 */
async function clickComponent(page: Page, expr: string): Promise<void> {
  const point = await page.evaluate((source) => {
    const component = new Function('return ' + source)() as any;
    if (!component) return null;
    const canvas = document.getElementById('form') as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const origin = component.state.absoluteOrigin || component.state.localOrigin;
    return {
      x: box.left + origin[0] + component.state.width / 2,
      y: box.top + origin[1] + component.state.height / 2,
    };
  }, expr);
  if (!point) throw new Error(`定位不到组件：${expr}`);
  await page.mouse.click(point.x, point.y);
}

/** 画布着墨量。 */
async function ink(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('form') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
    return n;
  });
}

function texts(page: Page) {
  return {
    diagnostics: page.locator('#diagnostics'),
    status: page.locator('#status'),
    values: page.locator('#values'),
  };
}

test('合法 DSL：表单真的画出来了', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('/examples/form-dsl.html');

  await expect(texts(page).status).toContainText('已渲染');
  await expect(texts(page).diagnostics).toContainText('校验通过');

  // 画布 440×500 @ dpr=2 → 880×1000，着墨量应当可观（不是空画布）
  const inkCount = await ink(page);
  expect(inkCount, '表单必须真的画出来').toBeGreaterThan(5000);

  // 三个字段 + 提交按钮都在编译产物里
  const fieldNames = await page.evaluate(() => (window as any).__form.compiled.fieldNames);
  expect(fieldNames).toEqual(['station', 'mode', 'flow']);
  expect(await page.evaluate(() => !!(window as any).__form.compiled.submitButton)).toBe(true);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('真实点击画布上的提交按钮：必填没填时被拦住', async ({ page }) => {
  await page.goto('/examples/form-dsl.html');
  await expect(texts(page).status).toContainText('已渲染');

  // 真实点中画布上的按钮（不是programmatic submit）
  await clickComponent(page, 'window.__form.compiled.submitButton');

  // 校验没过 → 不出现提交值
  await expect(texts(page).values).toHaveText('');

  // 且错误落到了模型上
  const errors = await page.evaluate(() => (window as any).__form.compiled.model.getErrors());
  expect(Object.keys(errors).length).toBeGreaterThan(0);
});

test('真实点击提交按钮：填全后提交值出来', async ({ page }) => {
  await page.goto('/examples/form-dsl.html');
  await expect(texts(page).status).toContainText('已渲染');

  await page.evaluate(() =>
    (window as any).__form.compiled.setValues({ station: '一号泵站', mode: 'manual', flow: 1200 })
  );
  await clickComponent(page, 'window.__form.compiled.submitButton');

  await expect(texts(page).values).toContainText('一号泵站');
  await expect(texts(page).values).toContainText('1200');
});

test('类型写错：诊断里**列出可用类型**，且不渲染', async ({ page }) => {
  await page.goto('/examples/form-dsl.html');
  await page.click('[data-preset="unknownType"]');

  await expect(texts(page).status).toContainText('未渲染');
  const diagnostics = texts(page).diagnostics;
  // 关键：不是只说"类型不认识"，而是把可用类型列出来
  await expect(diagnostics).toContainText('不支持的字段类型「richtext」');
  await expect(diagnostics).toContainText('可用类型：text / textarea / password');
  // 顺带给出一条"minLength 写在数值字段上"的警告
  await expect(diagnostics).toContainText('[警告]');
});

test('选项有问题：诊断里**列出可用取值**', async ({ page }) => {
  await page.goto('/examples/form-dsl.html');
  await page.click('[data-preset="badOptions"]');

  const diagnostics = texts(page).diagnostics;
  await expect(diagnostics).toContainText('默认值「auto」不在 options 里');
  await expect(diagnostics).toContainText('可用取值：on / off');
  await expect(diagnostics).toContainText('不能为空数组');
});

test('依赖指向空：诊断里**列出可用字段名**', async ({ page }) => {
  await page.goto('/examples/form-dsl.html');
  await page.click('[data-preset="badDep"]');

  const diagnostics = texts(page).diagnostics;
  await expect(diagnostics).toContainText('依赖的字段「passwrod」不存在');
  await expect(diagnostics).toContainText('可用字段：password / confirm');
  await expect(diagnostics).toContainText('fields[1].dependencies[0]');
});

test('改回合法预设后能重新渲染（旧的实例被收掉）', async ({ page }) => {
  await page.goto('/examples/form-dsl.html');
  await page.click('[data-preset="badDep"]');
  await expect(texts(page).status).toContainText('未渲染');

  await page.click('[data-preset="ok"]');
  await expect(texts(page).status).toContainText('已渲染');
  await expect(texts(page).diagnostics).toContainText('校验通过');
  expect(await ink(page)).toBeGreaterThan(5000);
});
