# logo-substitute

DSH（DeepSeek Harness）Web GUI 品牌替换插件。

> **自用声明**：本项目是作者**自用**的小工具，顺手开源给小范围的朋友共用，
> 按 **MIT** 协议授权，你可以自由使用、修改、再分发。

## 功能

在「设置」里新增一个 **Logo替换** 子菜单，把侧边栏顶部品牌行里的**鲸鱼标志**与
**deepseek 字形**换成你自己的图标与文字。

- 页面顶部是「使用默认」/「使用自定义」两个切换标签，底部固定一个「保存」按钮。
- 「使用自定义」时提供两项输入：**图标上传**（图片）与**文字标识名称**。
- 保存「使用自定义」后，侧边栏品牌行变成：**你的图标 + 你的文字 + `HARNESS`**。
  官方 `HARNESS` 标记**保留**，由本插件接在自定义文字后面重绘。
- 保存「使用默认」则恢复官方品牌（鲸鱼 + deepseek HARNESS）。这一步**不会删除**你已上传的
  图片与文字 —— 随时切回「使用自定义」继续用，无需重新上传。
- 图标只要求**宽高相等（正方形）**，对像素尺寸没有限制；非正方形会给出中文提示，
  并且**不会覆盖**已保存的设置。
- 页面底部显示插件版本号与作者信息。
- 配置存在渲染层 `localStorage`（key `logo-substitute:v1`），刷新 / 重启 GUI 后仍然生效。

## 效果

| | 品牌行显示 |
|---|---|
| 使用默认 | 🐳 `deepseek HARNESS`（官方原样） |
| 使用自定义 | 你的图标 + 你的文字 + `HARNESS` |

## 环境要求

| 项 | 值 |
|---|---|
| 插件版本 | **1.0**（`package.json` 的 `version` 为 `1.0.0`，同一个版本） |
| DSH 版本 | 在 `0.2.0-rc.2` 上验证通过；`dsh.engines.dsh` 声明 `>=0.2.0-rc.2`（**仅作声明**，宿主不强制校验） |
| 宿主平台 | Web GUI（桌面版与网页版共用同一套渲染层） |
| 运行时依赖 | **无**。浏览器半只 `require('react')`，不 `require` 任何 `@deepseek-ai/*` 包 |
| 构建步骤 | **无**。浏览器半是手写的 ModuleLoader bundle |

## 安装

DSH 的「添加插件」（**设置 → 插件 → 添加插件**）接受四类输入：**包名（可带版本）**、
**Git 地址**、**压缩包**、**本地绝对路径**。任选其一即可。

### 方式一：图形界面（不熟悉命令行的话用这个）

1. 把本目录放到本机 —— 直接拷贝、或 `git clone`、或用解压后的压缩包。
2. 打开 DSH → **设置 → 插件 → 添加插件**。
3. 填入下列任意一种，然后点「安装」：
   - 本地目录的绝对路径，例如 `/绝对/路径/logo-substitute`
   - Git 地址，例如 `https://github.com/<你的账号>/logo-substitute.git`
   - 你打好的压缩包路径，例如 `/绝对/路径/logo-substitute-1.0.0.tgz`
4. **重启 DSH 图形界面**（bundle 组成只在启动时装配）。

### 方式二：命令行

```bash
# 本地目录，link 安装：改源码即时生效，适合自己开发调试
dsh plugin --profile desktop add link:/绝对/路径/logo-substitute

# 本地目录，拷贝安装：装完与源目录无关
dsh plugin --profile desktop add /绝对/路径/logo-substitute

# Git 仓库
dsh plugin --profile desktop add https://github.com/<你的账号>/logo-substitute.git

# 压缩包
dsh plugin --profile desktop add /绝对/路径/logo-substitute-1.0.0.tgz
```

> 图形界面用的 profile 名是 **`desktop`**。装到别的 profile（比如 `web`）当前界面看不到。

装完**重启 DSH 图形界面**，再打开 设置 → 左侧应出现「Logo替换」。

## 使用

1. 打开 **设置 → Logo替换**
2. 选「**使用自定义**」
3. 上传一张**正方形**图片
4. 填「文字标识名称」
5. 点「**保存**」→ 侧边栏品牌行立即更新（不用刷新）

想还原成官方品牌：回到该页选「使用默认」，再点「保存」。

## 卸载

```bash
dsh plugin --profile desktop remove logo-substitute
```

也可以在 **设置 → 插件** 里停用 / 卸载，然后重启界面。

本插件**不修改 DSH 的任何官方文件**，卸载后侧边栏品牌自动回到官方显示；
如果你的配置想一并清掉，删掉 `localStorage` 里的 `logo-substitute:v1` 键即可。

## 外观

界面全部使用 DSH 主题 token（`--dsw-alias-*`），深浅色自动跟随，无任何硬编码颜色。
自定义图标按品牌位容器尺寸（24px）等比 `object-fit: contain` 显示。

HARNESS 字样用 10px、字距 `.12em`、三级文字色绘制，尽量贴合官方观感。

## 已知限制

- **`HARNESS` 标记是插件重绘的**，不是官方那段手绘 SVG 字形 —— 官方把「deepseek」和
  「HARNESS」焊在同一个 SVG 里，无法只保留后者。所以它**不会像素级一致**。
- 配置存在 `localStorage`，**按机器**保存，不跨机器同步；清空 DSH 的站点数据会丢配置。
- 只替换**侧边栏品牌行**。「新建会话」按钮本身以及其它界面元素不受影响。
- 插件**不支持自动更新**：升级需要先卸载再装新版。

## 故障排查

**装完看不到「Logo替换」** —— 依次检查：

1. 是否**重启了整个图形界面**。只刷新页面不够，bundle 组成在启动时才装配。
2. `~/.dsh/profiles/desktop/package.json` 里是否有**两处**条目，缺一不可：
   - `dependencies` 里有 `"logo-substitute"`
   - `dsh.profile.bundles` 数组里有 `"logo-substitute"` ← **这一处才决定插件是否被加载**
3. 个别环境下 `dsh plugin ... add` 会在写完 npm 侧（`dependencies` / `node_modules` 软链 /
   `pnpm-lock.yaml`）之后**卡住不返回**，于是 `bundles` 没被写入。此时手动把
   `"logo-substitute"` 加进 `dsh.profile.bundles` 再重启即可。**改之前先备份该文件。**

**品牌行空白而不是回落官方** —— 说明自定义图片数据坏了（例如手工改过 `localStorage`）。
删掉 `logo-substitute:v1` 这个键，刷新即可恢复。

## 目录结构

```
logo-substitute/
├── package.json          # 包清单：exports、license、files、dsh.bundle.patch、dsh.client
├── index.js              # 宿主半（exports "."），纯 UI 插件，无逻辑
├── client.js             # 浏览器半（exports "./client"），手写 ModuleLoader bundle
├── cordis.patch.yml      # bundle patch：把插件行插入 profile 的 web 组成
├── README.md
├── LICENSE               # MIT
├── .gitignore
└── tools/
    └── smoke-test.mjs    # 冒烟校验脚本（npm run smoke）
```

## 实现要点（为什么不会和官方品牌打架）

`sidebar.brand.mark`（鲸鱼）与 `sidebar.brand.name`（deepseek HARNESS）都是 `single`
席位，官方包 `@deepseek-ai/dsh-client-ui-brand-official` 以 priority 0 注册它们。

引擎在 `single` 席位上不允许**同 priority** 二次注册，但允许**不同 priority 共存**，
并且渲染时**priority 数值最小者胜出**。因此本插件以 `priority: -1` 接管这两个席位，
而且只在「已保存模式为自定义、且有图片」时才注册；一旦切回默认就立即 `dispose`，
让官方品牌自然回来 —— 本插件**不**复刻官方鲸鱼 SVG 来当"默认"，避免随 DSH 版本漂移。

## 自检

```bash
node tools/smoke-test.mjs   # 或 npm run smoke
```

纯 node、零依赖、不联网、不写盘：stub `window.__ModuleLoader__` + stub `react` + 假
`ctx.slots` + 假 `localStorage`，覆盖入口契约、`settings.section` 席位注册、
品牌席位的 `priority: -1` 与切回默认后的释放、正方形校验、持久化 round-trip、脏数据回落，
以及底部插件信息（版本 / 作者）。全部通过时打印 `SMOKE OK: n/n` 并以 0 退出。

## 示例
![Demo](demo.png)

## 免责声明
本插件**不修改 DSH 的任何官方文件**，卸载后侧边栏品牌自动回到官方显示；
如果你的配置想一并清掉，删掉 `localStorage` 里的 `logo-substitute:v1` 键即可。
仅供学习专用。

## 作者

**JakeKim@XingHaoTech** ｜ 微信：**vvip2u**

## 许可

[MIT](LICENSE) © 2026 JakeKim@XingHaoTech

本项目为作者自用工具，按 MIT 协议开源。软件按「原样」提供，不附带任何形式的担保。
