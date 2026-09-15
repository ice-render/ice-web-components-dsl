module.exports = {
  // 校验器是纯逻辑（node 就够），但**编译器要构造真实的 `ice-web-components` 组件**，
  // 那些组件会碰 DOM（例如输入法用的隐藏 input），所以统一用 jsdom 环境跑。
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  roots: ['<rootDir>/tests'],
};
