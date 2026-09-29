# 和AI一起消方块

![和AI一起消方块头像](src/assets/app-avatar.png)

3D 方块消除小游戏原型。当前实现覆盖 PRD 的 Phase 1 和一部分 Phase 2：Three.js 渲染、点击消除、简化重力下落、旋转/缩放、步数、星级、重置、撤销、炸弹、自动运行和 10 个随机种子关卡。

## Scripts

```bash
npm install
npm run dev
npm run build
npm run typecheck
```

浏览器预览默认运行在 `http://127.0.0.1:3000`。微信开发者工具可选择本目录，项目配置会指向 `dist/` 作为小游戏根目录；先运行 `npm run build` 生成 `dist/game.js` 和 `dist/game.json`。

浏览器打开 `http://127.0.0.1:3000/?sceneHud=1` 可检查微信端使用的画布界面：顶部切换难度，底部提供重置、撤销、炸弹和自动，通关弹窗提供下一关。可连续点击不同方块；退出棋盘的方块立即让路，仍在棋盘内滑动的方块预占终点，撤销按每次操作回退并暂停自动。被挡住的方块会抖动并闪黄，不扣步数。箭头直接绘制在方块表面，前方空白面保持原色，背面略暗；拖动和双指缩放不会误触方块。

## 自动存档

游戏入口：`https://www.sunny-string.cn/wechat/game/`。API 位于同一路径下的 `api/`，部署在 139.224.12.141。

微信端使用 `wx.login` 静默识别同一微信账号；浏览器使用保存在本机的匿名会话。每次有效操作立即保存本地棋盘、难度、步数、道具及最近 30 步撤销记录，并自动同步服务器。退出时仍在播放的移动动画会按最终位置存档。重新打开恢复未完成的棋盘，自动运行默认暂停；已过关进入下一难度，失败重开当前难度，最后一关通关保留完成状态。

断网可继续使用本地存档，联网后重试。服务器用递增版本号拒绝陈旧写入，重试使用同一操作编号避免重复提交；多设备冲突以服务器已保存的版本为准，未同步的本地副本保留在 `wechat-blocks.progress.v1.conflict`。浏览器清除站点数据后无法找回匿名存档；微信账号存档可跨设备恢复。只保存游戏进度和不可直接识别的账号散列，不请求昵称、头像、手机号或位置。

## 存档服务维护

后端仅依赖 Python 3.11+ 标准库和 SQLite，监听 `127.0.0.1:3040`，由现有 Nginx 提供 HTTPS。小游戏后台需允许 request 域名 `https://www.sunny-string.cn`。

- 服务：`wechat-blocks.service`；每日备份：`wechat-blocks-backup.timer`（保留最近 14 份）。
- 数据库：`/var/lib/wechat-blocks/progress.sqlite3`，独立于版本目录；备份在同目录的 `backups/`。
- 服务端密钥：`/etc/wechat-blocks/server.env` 的 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`，仅服务账号可读；禁止提交或打包到客户端。
- 版本：`/opt/wechat-blocks/releases/<release>`，`current` 软链接指向运行版本。每个版本包含 `server/` 和生产构建复制出的 `public/`。
- 部署：在 139 上对解压的版本运行 `sudo bash /opt/wechat-blocks/releases/<release>/server/deploy.sh`。脚本保留已有密钥和数据库，对 Nginx 仅添加该游戏的路径配置。
- 健康检查：`https://www.sunny-string.cn/wechat/game/api/health`，`wechatLoginConfigured` 应为 `true`。
- 验证：`npm run typecheck`、`npm test`、`python -m unittest discover -s server -p 'test_*.py' -v`、`npm run build`。

回滚可将 `current` 切回上一版本后重启 `wechat-blocks`；数据库版本不随前端回滚。恢复数据库前先停止服务并保留现有数据库及 WAL/SHM 文件，再从一致性备份恢复。发布小游戏仍按 AGENTS.md 执行上传和生成预览二维码。
