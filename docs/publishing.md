# 发布到插件商店

本文件记录的是**本机 DSH 0.2.2-rc.1** 上验证过的机制，不是推测。

## 先说三个前提

1. **已经改名为 `@seon0616/dsh-prompt-template`。** 原因：原名 `dsh-prompt-optimizer` 在 npm 上已被占用（v2.0.3，作者 winditer，2026-09 发布，功能也是「输入框 prompt 优化」），且社区目录里已有 8 个名字含 `prompt-optimizer` 的插件。改名时同步改了四处：`package.json` 的 `name`、`cordis.patch.yml` 的行 `name`、`client.js` 的 `__ModuleLoader__.load({ id })`、以及 Host/Client 的路由前缀。
2. **本机没有内置 Discover。** `@deepseek-ai/dsh-plugin-market` 这个行在本 profile 里没有挂载（匹配条目数 0），所以本机唯一的市场是 `dshmarket`（插件页 → Plugin Market），数据来自 `awesome-dsh-plugin.com/plugins.json`。
3. **发现页默认没有索引源。** 即使挂载了内置市场，Host 侧 `pluginMarket` 的 `indexes` 配置默认是空数组，必须手动添加索引源 URL 才会出现插件列表。

## 商店是怎么找到插件的

商店不直接读 npm 搜索，它读**索引文档（format 1 的 JSON）**：

```
插件 → 发现 → 索引源 → 添加 https://.../index.json
```

索引里每个插件声明自己的 npm 包名、各版本、发布时间与 `engines.dsh`；点安装时，商店用该版本生成安装参数：npm 版本是 `包名@版本`，git 版本是 `git+<repo>.git#<40位commit>&path:/<目录>`。

社区常用的索引源是：

```
https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
```

它来自仓库 `awesome-dsh-plugin/awesome-dsh-plugin` 的精选列表。

## 路线一：自建索引源（最快，不需要任何人批准）

1. 把包发布到 npm（见下）。
2. 生成索引：`node scripts/make-index.mjs`（读取 npm 上的真实发布时间，写出 `market/index.json`）。
3. 把 `market/index.json` 放到一个 HTTPS 地址上：
   - 最简单：放进同一个 npm 包，用 `https://cdn.jsdelivr.net/npm/<包名>/market/index.json`；
   - 或者放 GitHub Pages、自己的静态站。
   - 注意：图标若用相对路径，必须能解析成 https 或与索引同源；本仓库的生成器直接把图标内联成 `data:` URL，规避了这个问题。
4. 打开 **插件 → 发现 → 索引源**，添加上面的 URL，刷新即可看到并一键安装。

这条路今天就能完成，缺点是别人必须知道你的索引地址。

## 路线二：进社区目录（被更多人看到）

1. 先发 npm，并有一个公开 GitHub 仓库（详情页会去仓库读 README）。
2. 到 `awesome-dsh-plugin/awesome-dsh-plugin` 仓库**提一个 PR，在列表里加一条**。
   - 注意：不要往 `dsh-market/dsh-market` 提 PR，那个仓库是市场应用本身，不是目录。
   - 站点与市场会在 CI 刷新后自动收录，按维护者说法通常一天内。
3. 收录后，订阅了 `dsh-plugin-catalog` 索引源的用户就能搜到你。

## 发布到 npm 的步骤

```bash
cd dsh-prompt-template
npm login                          # 登录 seon0616
npm publish --otp=<6 位验证码>      # 不带 --otp 时 npm 会交互式提示
```

### npm 的 2FA 要求（2026-11 实测）

直接 `npm publish` 会返回 **E403**：

> Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.

也就是说**发布必须有二步验证**。两条路：

1. **交互式 2FA（推荐，长期有效）**
   1. <https://www.npmjs.com/settings/seon0616/two-factor> 绑定 Authenticator
   2. `npm publish --otp=<当前验证码>`
2. **bypass-2FA 的细粒度令牌（有时限，不要依赖）**
   到 <https://www.npmjs.com/settings/seon0616/tokens> 生成 Granular Access Token，勾选 **Bypass two-factor authentication**，写入 `~/.npmrc`：

   ```powershell
   npm config set //registry.npmjs.org/:_authToken=<令牌>
   ```

   按 GitHub 2026-07-08 的 changelog，这条路正在被逐步取消：
   - **账号/包/组织管理类操作**（建删令牌、改访问权限、改 2FA 配置等）已经不能再靠它跳过 2FA（预计 2026-08 生效）；
   - **直接发布**预计 **2027-01 前后**失效，届时 bypass-2FA 令牌只能读私有包和**暂存发布**（staged publish），公开仍需人工 2FA 批准。
   - 长期自动化请改用 [trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers) 或 [staged publishing](https://docs.npmjs.com/staged-publishing)。

> 同一个 changelog 还说明 **npm v12** 起 `npm install` 默认不跑依赖的生命周期脚本、默认不解析 git 与远程 URL 依赖（`allowScripts` 关、`--allow-git`/`--allow-remote` 为 `none`）。本机 npm 是 **11.20.0**，暂不受影响；升级前若依赖有 `postinstall`，需 `npm approve-scripts --allow-scripts-pending` 并提交 allowlist。本插件零依赖，不受这条影响。

包名与身份（已配置好，无需再改）：

- `name`: `@seon0616/dsh-prompt-template`
- `publishConfig.access`: `public`（scoped 包默认非公开，缺了会发布失败）
- `author`: `seon0616`
- `cordis.patch.yml` 行 `name`、`client.js` 模块 `id`、路由前缀均为新名

发布前自查：

- `private: true` 已移除（本仓库已移除）。
- `files` 覆盖 `index.js`、`client.js`、`templates.js`、`cordis.patch.yml`、`locale/*.json`、`docs/*.md`、`market/index.json`、`icon.svg`、`README.md`、`NOTICE.md`。
- `dsh.bundle.patch` 与 `dsh.client` 字段存在。
- `engines.dsh` 是一个 SemVer 范围（本仓库为 `>=0.2.1-rc.2 <0.4.0-0`，覆盖当前的 0.2.2-rc.1）。
- 包内没有任何 `link:` 或本地路径依赖——本插件零依赖，天然满足。
- `peerDependencies` 里的 `@deepseek-ai/schemastery` 是 optional peer，由宿主提供，不需要随包安装。

## 商店详情页从哪来

详情页按顺序读取：

1. 该语言 `locale/<语言>.json` 里 `meta.detail` 指定的 Markdown 文件（相对包根，不能越出包）；
2. 否则读包内 `README.md`；
3. 否则读索引条目 `repository` 指向仓库的 README。

本仓库已在 `locale/en.json`、`locale/zh.json` 里分别指向 `docs/store-detail.en.md`、`docs/store-detail.zh.md`。

## 许可提醒

`templates.js` 的模板改编自 AGPL-3.0 的 prompt-optimizer。公开发布前请确认该许可对你的分发方式（尤其是通过 npm 再分发）意味着什么；详见 `NOTICE.md`。想完全规避这个问题，就用自己写的模板替换 `templates.js`。
