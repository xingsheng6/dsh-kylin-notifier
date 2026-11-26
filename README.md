# dsh-kylin-notifier

[![npm version](https://img.shields.io/npm/v/dsh-kylin-notifier.svg)](https://www.npmjs.com/package/dsh-kylin-notifier)
[![license](https://img.shields.io/npm/l/dsh-kylin-notifier.svg)](LICENSE)
[![node](https://img.shields.io/node/v/dsh-kylin-notifier.svg)](https://nodejs.org)

银河麒麟桌面消息提醒 —— 给 DSH（DeepSeek Harness）用的桌面通知插件。

> 已在 npm 发布：`npm i -g dsh-kylin-notifier` 或在 DSH 里 `dsh plugin add dsh-kylin-notifier`；
> 源码托管在 [github.com/xingsheng6/dsh-kylin-notifier](https://github.com/xingsheng6/dsh-kylin-notifier)。

对话跑完、工具等你确认、或者智能体在等你选答案的时候，桌面右下角弹一条通知；
**点一下通知，就能直接跳回对应的那次对话。**

面向银河麒麟（Kylin V10 及兼容发行版）、国产 ARM / x86 信创桌面环境。

---

## 它解决什么问题

DSH 是网页界面。你切去干别的活儿的时候，不知道对话已经跑完了，
也不知道它正卡在「等你点确认」这一步。这个插件把这两种情况搬到桌面上：

| 场景 | 会发生什么 |
|---|---|
| 一轮对话跑完 | 弹出通知，标题是这次对话的标题，正文是回答的开头 |
| 工具调用等你批准 / 拒绝 | 弹出通知；你做了选择后通知自动撤回 |
| 智能体在等你选答案 | 弹出通知，点一下回到那道题 |
| 会话中断、报错、超长截断 | 同上，也会提醒 |

点通知 → 打开 DSH 网页并定位到那次对话（已打开则直接切过去，不刷新页面）。

---

## 两个可选的样式

插件自带两个渲染后端，在设置页里切换：

| 后端 | 说明 | 额外要求 |
|---|---|---|
| **麒麟系统通知**（`native`，默认） | 走 freedesktop / 麒麟通知中心，就是系统原生的那条通知 | 无需额外配置，装上就能用 |
| **仿 macOS 玻璃卡片**（`toast`） | 自绘的圆角玻璃卡片，可调主题 / 位置 / 动效 / 提示音 | **需要配合桌面壳改造**，见下方说明 |

> **仿 macOS 卡片为什么需要改桌面壳？**
> 这个样式是画在 Electron 桌面壳里的一个无边框透明窗口上，**能听见提示音、
> 能做淡入淡出和弹性动画**，普通网页做不到这个效果。所以它依赖随作者发布的
> 「桌面壳补丁」，而不是纯插件能力。
>
> **只用「麒麟系统通知」的话，不需要任何桌面壳改动，装上插件即可。**

---

## 安装

### 前置条件

- 银河麒麟桌面 V10 或兼容的 Linux 桌面（需要图形会话 + D-Bus）
- DSH（DeepSeek Harness）已安装并可正常启动
- Python 3.8+（通知桥接脚本用；麒麟 V10 自带）
- Node.js 20 以上（DSH 本身的要求）

### 第一步：装进 DSH 的 profile

DSH 的插件统一装在 profile 里，用 `dsh plugin`（内部转发给 pnpm）：

```bash
# 从 npm 安装
dsh plugin add dsh-kylin-notifier
```

装完后**重启 DSH 服务**，设置里就能看到 **「通知」** 这一节，那就是插件的设置页。

### 第二步：确认插件已启用

```bash
dsh plugin why dsh-kylin-notifier
```

看到它被列在 profile 依赖里就说明装上了。若设置页显示「插件未加载」，
检查 profile 的 `cordis.patch.yml` 里是否已有 `kylin-notifier` 这条配置块
（`dsh plugin add` 一般会自动写入；没有的话手动补，或直接从本仓库的
`cordis.patch.yml` 复制）。

### 第三步：确认能用

打开设置 → 通知，点「试一下」按钮。
桌面上应该弹出通知；点这条通知，浏览器/桌面壳跳到 DSH 并打开一个新对话。

---

## 配置项一览

全部在 DSH 的「设置 → 通知」里改，改完立即生效，不用重启。

| 配置 | 作用 |
|---|---|
| 总开关 | 一键关掉所有桌面通知 |
| 对话完成时提醒 | 一轮对话正常结束 / 中断 / 报错 / 截断时提醒 |
| 工具需要确认时提醒 | 工具在等你批准时提醒，选择后自动撤回 |
| 需要回答时提醒 | 智能体等你选项时提醒 |
| 每个对话保留几条 | 同一对话最多同时留几条通知，超出自动关最旧的 |
| 两条通知最小间隔（秒） | 防刷屏；设 0 表示不限 |
| 渲染方式 | 麒麟系统通知 / 仿 macOS 玻璃卡片 |
| 主题 | 浅色 / 深色 / 跟随系统 |
| 出现位置 | 右上角 / 顶部居中 / 右下角 |
| 动画 | 弹性 / 干脆 / 柔和 三种 |
| 停留时间 | 1 / 3 / 5 / 10 / 30 / 60 秒 |
| 提示音 | 开关 + 18 种音色（macOS 6 种、iOS 6 种、微信风格 6 种） |
| 应用名 | 通知里显示的程序名 |
| 调试日志 | 打开后写入 `/tmp/kylin-toast.log` |

---

## 卸载

```bash
dsh plugin remove dsh-kylin-notifier
```

然后重启 DSH 服务，设置里的「通知」一节就会消失。

---

## 常见问题

**Q：装了但从来不弹通知？**

按这个顺序查：

```bash
# 1. 有没有图形会话
echo $DISPLAY ; echo $XDG_RUNTIME_DIR

# 2. D-Bus 会话总线通不通
gdbus call --session --dest org.freedesktop.Notifications \
  --object-path /org/freedesktop/Notifications \
  --method org.freedesktop.Notifications.GetServerInformation

# 3. 打开插件设置里「调试日志」，再触发一次对话完成
cat /tmp/kylin-toast.log
```

最常见的原因是 DSH 服务由 systemd 启动，环境里没有 `DISPLAY`。
需要把 `DISPLAY=:0`、`XAUTHORITY`、`XDG_RUNTIME_DIR` 传进服务环境。

**Q：点了通知，DSH 没跳过去？**

网页版 DSH 会在当前标签页切换到对应对话；如果是纯系统通知（`native`），
点击行为取决于你桌面环境的通知中心是否支持默认动作，麒麟通知中心支持。

**Q：提示音没有声音？**

提示音由桌面壳播放（仿 macOS 卡片样式）。用系统通知样式时，声音交给
系统通知本身处理，受系统通知设置的音量与免打扰状态影响。

**Q：为什么不用系统里的苹方 / San Francisco 字体？**

SF Pro 是 Apple 专有字体，许可证禁止再分发，所以插件内置了开源的 **Inter**
（拉丁）+ **Noto Sans SC 子集**（中文），保证每台机器渲染出来一样。
字体许可证见 `NOTICE`。

**Q：能装到别的地方用吗？**

插件本身只依赖 D-Bus 通知规范，理论上任何 Linux 桌面都能用；
但界面文案、安装说明和测试都围绕银河麒麟桌面做的，其他发行版未做验证。

---

## 开发

> 本仓库默认位置：`~/.dsh/kylin-notifier/repo`（DSH 主目录下）。

```
.
├── index.js              # Host 侧：监听会话事件、调桥接、拼通知内容
├── client.js             # 浏览器侧：深链跳转、设置页面
├── cordis.patch.yml      # 装进 profile 时的默认配置
├── bridge/
│   ├── notify_bridge.py  # D-Bus / 麒麟通知后端
│   └── toast_window.py   # 自绘玻璃卡片后端（GTK3）
├── fonts/                # 内置字体（OFL 1.1）
├── assets/               # 图标
├── locale/               # 中英文案
└── NOTICE                # 第三方资源与许可证说明
```

本地 profile 挂源码调试（`<profile>` 一般是 `~/.dsh/profiles/web`）：

```bash
# 让 profile 直接指向本地源码目录
dsh plugin add link:/path/to/dsh-kylin-notifier
```

然后重启 DSH 服务即可（改 `index.js` / `bridge/*.py` 必须重启；只改 `client.js` 时刷新页面就行）。

语法检查：

```bash
node --check index.js && node --check client.js
python3 -m py_compile bridge/notify_bridge.py bridge/toast_window.py
```

---

## 版本

- **1.3.1** — 首次发布到 npm 的版本，内容与 1.3.0 一致（1.3.0 发布后立即补发，
  用于修正 npm 上的版本标记）。功能：点击通知就地切换对话，不再刷新整页；
  设置页换成新的分组式布局；停留时间改为 1/3/5/10/30/60 秒；卡片加三种出现位置与三种动效。
- **1.3.0** — 点击通知就地切换对话，不再刷新整页；设置页换成新的分组式布局；
  停留时间改为 1/3/5/10/30/60 秒；卡片加三种出现位置与三种动效。
- **1.2.0** — 深色主题重做；修复空闲后新卡片瞬间消失；同一时刻只保留一张卡片。
- **1.1.0** — 点击通知带会话深链，自动定位到对应对话。
- **1.0.0** — 首个可用版本：完成 / 待确认 / 待回答三类通知。

---

## 许可证

代码：**MIT**，见 [LICENSE](LICENSE)。
内置字体：**SIL Open Font License 1.1**，版权与来源见 [NOTICE](NOTICE)。

---

## 免责声明

本项目为个人开源作品，与银河麒麟软件有限公司、深度求索（DeepSeek）均无隶属关系。
「银河麒麟」「DeepSeek」等名称仅用于描述兼容性。