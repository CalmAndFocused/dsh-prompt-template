# 进 dsh-market 的具体操作（按官方贡献指南整理）

目标：让别人在 **插件 → Plugin Market** 里搜 `dsh-prompt-template` 能找到你的插件。

## 它的数据从哪来

`dshmarket` 每次打开时实时拉取：

```
https://awesome-dsh-plugin.com/plugins.json
```

这个文件由仓库 **`awesome-dsh-plugin/awesome-dsh-plugin`** 的 CI 从 `data/plugins/*.yml` 生成。
所以进入市场的**唯一动作是往那个仓库提一个 PR，加一个 YAML 文件**。

不是往 `dsh-market/dsh-market` 提——那是市场应用本身，不是目录。

## 提交形式

新增**一个文件**：`data/plugins/seon0616__dsh-prompt-template.yml`
（命名规则 `<owner>__<repo>.yml`）

内容见本仓库的 [`store-submission/seon0616__dsh-prompt-template.yml`](../store-submission/seon0616__dsh-prompt-template.yml)。

关键字段：

| 字段 | 要求 |
|---|---|
| `url` | 必须与仓库地址**完全一致** |
| `name` | 列表里显示的文字，通常是 `owner/repo` |
| `category` | 从固定的取值里挑；本插件用 `ui`（输入框界面） |
| `description.en` | **必填**，一句话、句号结尾，只陈述功能，不许营销词 |
| `description.zh` | 可选，写不了可不写，维护者会补 |
| `icon` | 可选，必须是 **GitHub 托管的位图**（png/jpg/webp），**SVG 会被拒** |

**描述里含 `: `（冒号+空格）时必须用引号包起来**，否则 YAML 会把冒号当成嵌套键。

## 会被 CI 检查的硬条件

1. **`package.json` 必须声明 `dsh.bundle`** —— 只声明 `dsh.client` 会被拒（这是最常见的被拒原因）。本插件两者都有。
2. **仓库创建满 1 天** —— 自动检查，刚建的仓库会被挡住，几小时后自动达标，不用重开 PR。
3. 仓库要有**真实可用的代码**，占位仓库不收。
4. 仓库要加 **`dsh-plugin`** topic。
5. 一个 PR **最多 3 条**。
6. 不能只改别人的条目；更新自己条目时只改自己的 YAML，不要手改 README。

## 关于「是否重复收录」

列表里已经有 8 个名字含 `prompt-optimizer` 的插件。官方规则明确：

> 两个插件做同一件事时，先来者保留位置——但这只是平局时的排序依据，不是既得利益……**规则不是先来后到，规则是谁更好。**

所以描述必须点出**它做了什么别人没做的**，且必须与代码一致（维护者会读代码核对）。本插件的差异点：

- 三种模板模式，其中 `iterate` 把需求**写进**提示词而不是执行它；
- `{{变量}}` 占位符逐字保留（有自测守着）；
- 同一操作暴露为 `optimize_prompt` agent 工具；
- 原文作为 JSON 证据嵌入，防止指令被当任务执行。

## npm 包与仓库的关联

发布 npm 包对收录**不是必需**的。但如果要关联（市场才能显示下载量），
**npm 包的 `package.json` 里 `repository` 必须指回被收录的那个仓库**，否则两者不会关联。
本仓库的 `repository` 已指向 `https://github.com/seon0616/dsh-prompt-template`。

## 一个必须记住的坑：`engines.dsh` 的预发布匹配

`0.2.0` 发布时写的 `engines.dsh` 是 `>=0.2.1-rc.2 <0.4.0-0`。
用 node-semver 实测：**它排除了 `0.2.2-rc.1`**——也就是当时正在跑的版本。
原因是预发布版本只有在范围内的某个比较符**同元组且带预发布标签**时才会被放行。

已在 `0.2.1` 修正为显式分支：

```
>=0.2.1-rc.2 <0.3.0-0 || >=0.2.2-rc.1 <0.3.0-0 || >=0.3.0-0 <0.4.0-0
```

实测覆盖 `0.2.1-rc.2` / `0.2.1` / `0.2.2-rc.1` / `0.2.2` / `0.3.0`，排除 `0.4.0-0`。
**官方贡献指南里专门警告过同一个陷阱**，写 peer/engines 范围前务必用 `semver.satisfies` 验一遍。

## 完整操作顺序

```powershell
# 1. 建 GitHub 仓库 seon0616/dsh-prompt-template，把本目录推上去
#    并加 `dsh-plugin` topic

# 2. 等仓库创建满 1 天（CI 硬条件）

# 3. fork awesome-dsh-plugin/awesome-dsh-plugin

# 4. 在 fork 里新增（不是修改 README）
#    data/plugins/seon0616__dsh-prompt-template.yml
#    内容复制 store-submission/seon0616__dsh-prompt-template.yml

# 5. 提 PR，标题例如：Add seon0616/dsh-prompt-template (prompt template rewriter)

# 6. 等 CI 与人工评审；被打回会以 PR 评论指出要改什么
#    改了就往同一分支推，然后留一条评论说明，无需重开 PR
```

合并后网站自动重建，市场下一次打开就能搜到。

## 想更快：自建索引源（不经过 PR）

这条只对**能加索引源的市场**有效。本机内置 Discover 未挂载，所以对 `dshmarket` 无效——
但如果你装了内置市场或别人订阅了你的索引，可以用：

1. `node scripts/make-index.mjs`（发布后跑，读真实发布时间）
2. 把 `market/index.json` 托管到 HTTPS（**不要随包发布**，见 `publishing.md`）
3. 在 Discover 的「索引源」里加该 URL
