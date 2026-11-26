# 银河麒麟消息通知插件

在银河麒麟桌面 V10（aarch64 / x86_64 均可）上，把 DSH 的「对话完成 / 待确认」事件变成桌面系统通知；点击通知自动聚焦对应对话。

## 工作链路

```
DSH Host (本插件 Host 半)
  ├─ session/event: turn/end(completed)   ─┐
  ├─ session/event: approval/asked        ─┼─> Python/DBus 桥接守护进程
  └─ user-questions/request (waterfall)   ─┘        │
                                                    │ notify + actions=["default","打开对话"]
                                                    ▼
                                    麒麟通知中心（屏幕右上角弹窗）
                                                    │ 点击
                                                    ▼
                                  URL #session=<id> 深链
                                                    │
                      ┌─────────────────────────────┴───────────────────────────┐
                      ▼                                                         ▼
        Electron 壳收到 /open 回调                                   系统浏览器打开该 URL
        显示/聚焦已有窗口并加载 URL                                   （token 在 query，hash 保留）
                      └──────────────────────> Client 插件读 #session=<id>
                                               sessions.retain → uiWorkspace.openSession
```

## 组件

| 文件 | 作用 |
|------|------|
| `bundle/` | 可安装的 Cordis bundle（Host 半 + Client 半 + 配置 + 图标 + 多语言） |
| `bundle/index.js` | Host：监听事件，生成带 `#session` 的认证 URL，调用桥接 |
| `bundle/client.js` | Client：读 URL hash，聚焦会话，清掉 hash |
| `bundle/bridge/notify_bridge.py` | 纯 Python DBus 通知桥接守护进程（跨架构，无需编译） |
| `dsh-electron-shell/src/main.js` | 已加可选通知点击回调（`/open?url=...&session=...`） |

## 安装

插件 bundle 已通过 `plugin_manager install_bundle` 安装到当前 profile（`dsh-kylin-notifier`）。安装是持久的，影响整个 profile。**需重启 DSH** 才会加载新插件。

重启后验证（在已认证的 DSH Web 页面）：

1. 打开任意会话，让一轮对话正常完成 → 应出现「对话已完成」系统通知。
2. 触发一次工具审批 / 用户提问 → 应出现「待确认」系统通知。
3. 点击通知 → 若 Electron 壳在运行，已有窗口聚焦并定位到对应会话；否则用系统浏览器打开并定位。

## 运行环境与依赖

- OS：银河麒麟桌面 V10 SP1（已在 aarch64 验证；x86_64 同理，Python 方案无架构绑定）。
- 通知后端（主路径，无需编译）：`python3` + `python3-dbus` + `python3-gi`（`gi.repository.GLib`）+ `notify-send`/`xdg-open` 可用。
- Session D-Bus 地址：桥接会在缺失 `DBUS_SESSION_BUS_ADDRESS` 时从 `XDG_RUNTIME_DIR/bus` 或 `/run/user/<uid>/bus` 推导。
- 无浏览器仅做静态验证时：JS 语法、JSON/YAML manifest、Config schema、Python 编译均已校验通过；视觉/交互未验证。

## 可选：原生 Kylin SDK 后端

主通知走 freedesktop D-Bus 协议（麒麟通知守护进程实现同一协议），已能发出原生麒麟通知。若部署环境要求显式链接 `libkysdk-notification`，见 `src/kylin-native/` 与下文。

### SDK 事实（来自附件《麒麟桌面SDK》8.2 消息通知）

- 安装：`sudo apt install libkysdk-notification libkysdk-notification-dev`
- pkg-config 名：`kysdk-notification`
- CMake：`find_package(Qt5 COMPONENTS Widgets REQUIRED)`、`find_package(PkgConfig REQUIRED)`、`pkg_check_modules(KYSDKNOTIFICATION_PKG kysdk-notification)`
- API（C++，方法名/签名按文档原样）：

  ```cpp
  uint notify();                                          // 返回通知 id（自 2.2.1.0）
  void setDefaultAction(const QString& appName);          // 点弹窗跳转应用（自 2.2.1.0）
  void addAction(const QString& appName, const QString& text); // ≤3 个跳转按钮（自 2.2.1.0）
  void setShowTime(int milliseconds);
  void setAppName(const QString&);
  void setBodyText(const QString&);
  void setSummary(const QString&);
  void setAppIcon(const QString&);                        // 仅系统图标名
  void setReplaceId(const uint id);                       // 替换未消失通知
  static void closeNotification(uint id);
  enum SoundType { Default = -1, AllTheTime = 0 };
  ```

- 弹窗位置：屏幕右上角。
- 2.3 版本前该库在「应用支撑 SDK」，2.3 起移到「桌面环境 SDK」。

### 已知缺口

SDK PDF 只写了「消息通知类」，未给出 C++ 类名与头文件。编译前先定位：

```bash
dpkg -L libkysdk-notification-dev | grep -i notif
grep -R "setDefaultAction" /usr/include /usr/local/include
```

然后在 `src/kylin-native/kylin_notify.cpp` 里填入真实 `#include` 与类名，再构建：

```bash
sudo apt install libkysdk-notification libkysdk-notification-dev qtbase5-dev cmake pkg-config
cd src/kylin-native
cmake -S . -B build && cmake --build build
```

`setDefaultAction` 的参数是应用名而非 URL，SDK 如何把动作映射到启动参数需按实际头文件/示例确认。因此**跨环境最稳的仍是 Python D-Bus 桥接**；原生后端仅作参考集成。

## 配置（cordis.patch.yml）

| 键 | 默认 | 说明 |
|----|------|------|
| `enabled` | true | 总开关 |
| `notifyOnComplete` | true | 对话完成时通知 |
| `notifyOnApproval` | true | 工具审批待确认时通知 |
| `notifyOnQuestion` | true | 用户提问待确认时通知 |
| `appName` | DeepSeek Harness | 通知应用名 |
| `icon` | dialog-information | 系统图标名 |
| `actionLabel` | 打开对话 | 通知按钮文字 |
| `timeoutMs` | 8000 | 通知显示时长 |
| `sound` | false | 是否持续提示音 |

用户可在 DSH 设置中修改；插件不会改写 cordis.patch.yml。

## 安全与隐私

- 通知桥接只在 `stdin` 收命令、`stdout` 回 ping；无网络监听（除 Electron 壳可选的本机回环 `/open` 回调，仅监听 127.0.0.1 且校验目标同源）。
- 带 token 的 URL 只在本机进程间传递，不写入日志（调试开关除外）。
- 会话 id 放在 URL `#hash`：token 校验后 authorizeIndex 的 303 重定向只丢 query、保留 hash，因此深链可用。
