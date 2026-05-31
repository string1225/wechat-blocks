# WeChat Blocks

3D 方块消除小游戏原型。当前实现覆盖 PRD 的 Phase 1 和一部分 Phase 2：Three.js 渲染、点击消除、简化重力下落、旋转/缩放、步数、星级、重置、撤销、炸弹、自动运行和 10 个随机种子关卡。

## Scripts

```bash
npm install
npm run dev
npm run build
npm run typecheck
```

浏览器预览默认运行在 `http://127.0.0.1:3000`。微信开发者工具可选择本目录，项目配置会指向 `dist/` 作为小游戏根目录；先运行 `npm run build` 生成 `dist/game.js` 和 `dist/game.config.json`。
