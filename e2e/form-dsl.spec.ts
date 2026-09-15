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

/**
 * 着墨部分的包围盒与它占画布的比例（CSS 像素）。
 *
 * `ink()` 只回答"画了没有"。一个表单把控件画在左边 360px 里、右边空 500px，
 * 着墨量照样是几千 —— 这种"画出来了但没铺满"的缺陷只有按**排布**判才看得见。
 */
async function inkBounds(page: Page): Promise<{ right: number; widthRatio: number }> {
  return page.evaluate(() => {
    const canvas = document.getElementById('form') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width;
    let maxX = -1;
    for (let y = 0; y < canvas.height; y++) {
      const row = y * canvas.width * 4;
      for (let x = 0; x < canvas.width; x++) {
        if (data[row + x * 4 + 3] !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    // 逻辑像素 = 画布像素 / (backing / css)。不写死 dpr —— 换个 profile 就会静默错一倍。
    const box = canvas.getBoundingClientRect();
    const scale = box.width > 0 ? canvas.width / box.width : 1;
    return {
      right: maxX / scale,
      widthRatio: canvas.width > 0 ? (maxX - minX + 1) / canvas.width : 0,
    };
  });
}

function texts(page: Page) {
  return {
    diagnostics: page.locator('#diagnostics'),
    status: page.locator('#status'),
    values: page.locator('#values'),
  };
}

/**
 * 等到画布上真的有墨。
 *
 * **不能直接读一次就断言**：渲染是引擎的帧循环干的活，`render()` 里 `renderFormDsl()` 返回时
 * 画面还没落到画布上 —— 直接量会量到 0，而且"有时候过、有时候不过"取决于那一瞬的调度。
 * 这个竞态原先被一个固定的 `resize(440,500)`（尺寸没变、不需要重排）掩盖着，
 * 表单层改成按内容量高度之后立刻显出来了。
 */
async function waitForInk(page: Page, min = 5000): Promise<number> {
  let last = -1;
  await expect
    .poll(async () => (last = await ink(page)), { message: '画布上迟迟没有墨', timeout: 5000 })
    .toBeGreaterThan(min);
  return last;
}

test('合法 DSL：表单真的画出来了', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('/examples/form-dsl.html');

  await expect(texts(page).status).toContainText('已渲染');
  await expect(texts(page).diagnostics).toContainText('校验通过');

  // 画布是 560×390 左右（宿主按 #stage 的宽度算，高度是量出来的），着墨量应当可观
  await waitForInk(page);

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
  await waitForInk(page);
});

/**
 * 表单要**铺满内容宽度**：既不缩成左边一小块，也不被拉满整张卡片。
 *
 * 这一条是实测缺陷的回归：宿主容器 896 宽时表单只在左边画了 229px，**右边空掉 667px（74%）**。
 * 根因在 DSL 层不在渲染器：宽度在 ICE 里是每个组件自己的属性，没有"父级拉满"的自动传导 ——
 * `align: 'stretch'` 只拉 `ICEFormItem`、**不拉控件**，于是每个控件落到各自的出厂默认
 * （`ICETextField` 200、`ICEInputNumber` 140…），同一张表单里还互不相同。
 * 见 README §8.1。
 */
test('表单铺满内容宽度（不是只用左边一小块）', async ({ page }) => {
  await page.goto('/examples/form-dsl.html');
  await expect(texts(page).status).toContainText('已渲染');
  // 先等画面真的落下来，否则量到的是一张还没画的空画布
  await waitForInk(page);

  const canvasWidth = await page.evaluate(
    () => (document.getElementById('form') as HTMLCanvasElement).getBoundingClientRect().width
  );
  const bounds = await inkBounds(page);

  expect(
    bounds.widthRatio,
    `着墨只占画布宽的 ${(bounds.widthRatio * 100).toFixed(1)}%，右侧空 ${(canvasWidth - bounds.right).toFixed(0)}px`
  ).toBeGreaterThan(0.9);
});

/**
 * 宽屏上表单停在 `maxWidth`（默认 640），画布跟着表单走 —— 不是画布宽出一截、右边空一块。
 *
 * 这一条管的是"拉伸也要有上限"：把 896 全铺满不是"排满了"，是难看 ——
 * 一行 896 宽的输入框没人读得过来。同时验证 `result.width` 这个取值器：
 * 宿主必须能知道表单**最终**多宽，否则它只能拿自己给的宽度去定画布。
 */
test('宽屏上表单停在 maxWidth，画布跟表单一样宽', async ({ page }) => {
  await page.goto('/examples/form-dsl.html');
  await expect(texts(page).status).toContainText('已渲染');
  await waitForInk(page);

  const stage = await page.evaluate(() => document.getElementById('stage').clientWidth);
  const info = await page.evaluate(() => {
    const canvas = document.getElementById('form') as HTMLCanvasElement;
    return {
      canvas: Math.round(canvas.getBoundingClientRect().width),
      formWidth: Math.round((window as any).__form.width),
    };
  });

  // 舞台比 640 宽 —— 否则这条用例什么也没验证
  expect(stage).toBeGreaterThan(700);
  expect(info.formWidth, '表单应当停在默认上限 640').toBe(640);
  expect(info.canvas, '画布宽度要跟着表单走（不然右边会空一块）').toBe(info.formWidth);
});

/**
 * 容器尺寸变了要**重新对齐内容**，不能只改画布。
 *
 * 这是 `setWidth()` 那条路径单独的回归：`resize()` 管画布、`setWidth()` 管内容，两件事。
 * 少了它，画布窄了而表单还是原来那么宽 —— 右边被裁掉或又空出来。
 */
test('窗口变窄后表单跟着重新对齐（不只是画布变窄）', async ({ page }) => {
  await page.goto('/examples/form-dsl.html');
  await expect(texts(page).status).toContainText('已渲染');
  await waitForInk(page);

  const wide = await inkBounds(page);
  expect(wide.right, '宽屏下表单应当停在 640').toBeGreaterThan(600);

  // 窄到舞台放不下 640 —— 这样表单必须跟着缩
  await page.setViewportSize({ width: 760, height: 900 });

  // `window.resize` → `fit()` 是同步的，但布局/重绘要等一帧，所以轮询而不是赌
  await expect
    .poll(async () => (await inkBounds(page)).right, {
      message: '缩窄之后表单没有跟着变窄',
      timeout: 5000,
    })
    .toBeLessThan(wide.right - 100);

  // 变窄之后仍然铺满（画布跟着表单走，所以比例应当接近 1）
  expect((await inkBounds(page)).widthRatio).toBeGreaterThan(0.9);
});
