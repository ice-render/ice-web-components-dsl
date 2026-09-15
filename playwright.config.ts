import { defineConfig } from '@playwright/test';

/**
 * 示例页真机冒烟。
 *
 * 前置：`npm run build` —— 示例页加载 `../node_modules/ice-render/dist/index.umd.js`、
 * `../node_modules/ice-web-components/dist/index.umd.js` 与本包的 `../dist/index.umd.js`（顺序不能换）。
 *
 * **端口 8101**：家族端口一仓一个，权威表在 `ice-render/AGENTS.md`（新增服务先登记再写配置）。
 * `reuseExistingServer: false`：端口被别的仓的服务占着时**响亮失败** —— 表下面记着一次真实事故，
 * 某仓私自用了 8093 而 web-components 的 playwright 也是 8093 且开了复用，
 * 于是它的 e2e 静默复用了别人的服务目录、用例全红，排查成本极高。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  reporter: [['list']],
  webServer: {
    command: 'npx http-server . -p 8101 -c-1 --silent',
    port: 8101,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:8101',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    channel: 'chrome',
  },
});
