# 智能消方块

![智能消方块头像](src/assets/app-avatar.png)

3D 方块消除小游戏原型。当前实现包括 Three.js 渲染、点击移出、360° 旋转/缩放、本局计时、步数、星级、重置、撤销、指定格子炸弹、自动运行和持续生成的随机种子关卡。尺寸轮流递增，详见[难度增长表](docs/difficulty.md)。

## Scripts

```bash
npm install
npm run dev
npm run build
npm run typecheck
```

浏览器预览默认运行在 `http://127.0.0.1:3000`。微信开发者工具可选择本目录，项目配置会指向 `dist/` 作为小游戏根目录；先运行 `npm run build` 生成 `dist/game.js` 和 `dist/game.json`。

## 微信发布与游戏深度保护

`npm run wechat:upload` 和 `npm run wechat:preview` 会自动先构建，再调用微信游戏深度保护 CLI，最后上传经过检查的完整游戏包。默认对 `game.js` 开启水印和 2 级混淆；等级在 `code.fortify.config.json` 中配置。加固返回失败、缺少加固标记、map 未映射回 TypeScript 时会停止发布，不回退到明文代码；缓存损坏会重新请求加固。CLI 要求 Node.js 17.5.0 或更新版本，本项目构建和发布在 Node.js 24.13.0 下验证。

首次配置：

1. 执行 `npm run wechat:fortify:keygen`。专用私钥配置默认保存在用户目录的 `.wechat-blocks/fortify/id_rsa.conf`，同目录的 `public.pem` 是对应的 PEM 公钥。重复执行保留现有密钥。
2. 小游戏管理员在微信 MP 后台「开发支持 → 研发工具箱 → 密钥管理」登记 `public.pem` 中的完整公钥。加固密钥与现有 CI 上传密钥分别配置。
3. 保持 `wechat-ci.local.json` 中的 `privateKeyPath` 指向上传密钥，执行 `npm run wechat:check` 检查本地配置，再执行 `npm run wechat:fortify` 验证后台加固权限。
4. 真机验证加固后的游戏，然后执行 `npm run wechat:upload` 和 `npm run wechat:preview`。首次加固或核心逻辑大幅改动时应充分测试并灰度发布。

可在未提交的 `wechat-ci.local.json` 中设置 `fortifySecretConfigPath`（私钥配置文件路径）、`fortifyTimeoutMinutes`（默认 30 分钟）、`fortifyProxy`。相应环境变量为 `WECHAT_FORTIFY_SECRET_CONFIG`、`WECHAT_FORTIFY_TIMEOUT_MINUTES`、`WECHAT_FORTIFY_PROXY`。私钥配置中的 appid 必须与上传的 appid 一致；密钥不得放入构建或发布目录。

`npm run build:wechat` 在 `.wechat-build/` 生成未压缩 JS 及映射回 TypeScript 的 map，供加固服务处理；发布包在 `.wechat-release/project/`，可用微信开发者工具直接打开该目录验证。发布时关闭后续 JS 转译、压缩和普通代码保护，保持加固代码与 map 配对。未加固的 JS 及其备份、加固配置和私钥不进入发布包；最终 map 随微信包上传，用于线上错误定位。

相同 appid、密钥公钥、代码、map、加固配置和 CLI 版本复用 `.wechat-fortify-cache/` 中经过哈希检查的结果，上传和预览无需重复消耗加固次数。修改输入会重新加固。生成目录均已加入 Git 忽略；其中包含敏感 map，不应部署到公开网站。浏览器开发和 `npm run build` 保持原有构建方式。

浏览器打开 `http://127.0.0.1:3000/?sceneHud=1` 可检查微信端使用的画布界面：深蓝顶部通栏贴顶并延伸到两侧，显示难度、计时和剩余方块；底部通栏贴底并延伸到两侧，重置、撤销、炸弹和自动四个按钮无间隙等分宽度，旋转缩放提示位于按钮上方，通关弹窗提供下一关。可连续点击不同方块；退出棋盘的方块立即让路，仍在棋盘内滑动的方块预占终点，撤销按每次操作回退并暂停自动。被挡住的方块会抖动并闪黄，不扣步数。箭头直接绘制在方块表面，前方空白面保持原色，背面略暗；拖动和双指缩放不会误触方块。上下左右均可完整绕转，经过顶部和底部保持连续视角；拖动绕屏幕轴旋转，翻转后左右操作仍保持一致。竖屏默认按完整棋盘投影约占屏宽 90% 取景，短屏/横屏优先避开上下工具栏。自动开启后按钮变为薄荷绿，暂停恢复深蓝；炸弹选中为暖黄色。

点击炸弹进入选中状态并暂停自动，再点击格子会高亮目标并弹出确认框。确认后只移除该格子，即使被挡住也可移除；取消保留选中模式以便换一个目标，再点炸弹可退出模式。只有确认才消耗 1 枚炸弹和 1 步，双击确认不会重复扣除。

## 自动存档

游戏入口：`https://www.sunny-string.cn/wechat/game/`。API 位于同一路径下的 `api/`，部署在 139.224.12.141。

微信端使用 `wx.login` 静默识别同一微信账号；浏览器使用保存在本机的匿名会话。每次有效操作立即保存本地棋盘、难度、步数、道具、累计用时及仍可使用的撤销记录（最多 5 步），并自动同步服务器。退出时仍在播放的移动动画会按最终位置存档。重新打开恢复未完成的棋盘，自动运行和炸弹选中状态默认关闭；已过关进入下一难度，失败重开当前难度。旧版进行中的存档保留原布局，下一关使用新的尺寸梯度。

计时从加载完成开始，后台和离线关闭期间不计入；恢复接续、重置归零、撤销不退回时间，通关和失败停止。闲置时每 15 秒保存一次用时，退到后台立即保存。计时仅作记录，不改变星级或胜负。

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
