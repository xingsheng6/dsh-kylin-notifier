/*
 * Optional native Kylin SDK notifier helper.
 *
 * WHY THIS EXISTS
 * ---------------
 * The primary notification backend is `bridge/notify_bridge.py`, which speaks
 * the freedesktop Notifications D-Bus protocol directly. Kylin's notification
 * daemon implements that same protocol, so the Python bridge already produces
 * native Kylin notifications with click-to-focus support — no compilation and
 * no SDK dependency (works on both aarch64 and x86_64).
 *
 * This C++ file is an OPTIONAL alternative for deployments that specifically
 * want to link `libkysdk-notification` (Kylin Desktop SDK 8.2, section 8.2.1).
 * It mirrors the documented API. It is intentionally small and dependency-light.
 *
 * IMPORTANT — SDK HEADER
 * ----------------------
 * The SDK PDF documents the methods but not the C++ class name or header file.
 * Before building, inspect the headers installed by:
 *
 *   sudo apt install libkysdk-notification libkysdk-notification-dev
 *
 * then find the notification class/header, e.g.:
 *
 *   dpkg -L libkysdk-notification-dev | grep -i notif
 *   grep -R "setDefaultAction" /usr/include /usr/local/include
 *
 * and adjust the `#include` and `Notification` type below to match. The method
 * names/signatures themselves are quoted verbatim from the SDK documentation.
 *
 * BUILD (once the header/class is confirmed)
 * ------------------------------------------
 *   sudo apt install libkysdk-notification libkysdk-notification-dev \
 *                   qtbase5-dev cmake pkg-config
 *   cmake -S . -B build && cmake --build build
 *
 * See docs/KYLIN_SDK.md in this project for the full CMakeLists.txt and notes.
 */

#include <cstdio>
#include <cstdlib>
#include <string>

// TODO: replace with the real header discovered via `dpkg -L libkysdk-notification-dev`.
// #include <kysdk-notification/notification.h>

static void usage(const char* prog) {
  std::fprintf(stderr,
    "Usage: %s <summary> <body> <session-url> [app-name] [icon] [timeout-ms]\n"
    "\n"
    "Raises a Kylin desktop notification with a default action. Clicking the\n"
    "notification invokes the app's default action handler with <session-url>,\n"
    "which should open the DSH web URL carrying #session=<id>.\n",
    prog);
}

int main(int argc, char** argv) {
  if (argc < 4) {
    usage(argv[0]);
    return 2;
  }
  const std::string summary = argv[1];
  const std::string body = argv[2];
  const std::string sessionUrl = argv[3];  // authenticated URL with #session=<id>
  const std::string appName = argc > 4 ? argv[4] : "DeepSeek Harness";
  const std::string icon = argc > 5 ? argv[5] : "dialog-information";
  const int timeoutMs = argc > 6 ? std::atoi(argv[6]) : 8000;

  /*
   * Documented API (Kylin Desktop SDK 8.2.1 "消息通知类"):
   *   void setAppName(const QString&);
   *   void setSummary(const QString&);
   *   void setBodyText(const QString&);
   *   void setAppIcon(const QString&);           // system icon name only
   *   void setShowTime(int milliseconds);
   *   void setDefaultAction(const QString& appName);  // click popup -> jump to app
   *   void addAction(const QString& appName, const QString& text);  // <= 3 buttons
   *   uint notify();                              // returns notification id
   *   enum SoundType { Default = -1, AllTheTime = 0 };
   *
   * `setDefaultAction` takes an app name, not a URL. Passing the full deep link
   * here depends on how the SDK maps the action to a launched application. The
   * robust cross-environment path remains the Python D-Bus bridge; this native
   * helper is provided as a reference integration only.
   */
  // Notification n;
  // n.setAppName(QString::fromStdString(appName));
  // n.setSummary(QString::fromStdString(summary));
  // n.setBodyText(QString::fromStdString(body));
  // n.setAppIcon(QString::fromStdString(icon));
  // n.setShowTime(timeoutMs);
  // n.setDefaultAction(QString::fromStdString(sessionUrl));
  // const unsigned int id = n.notify();
  // (void)id;

  (void)summary;
  (void)body;
  (void)sessionUrl;
  (void)appName;
  (void)icon;
  (void)timeoutMs;
  std::fprintf(stderr,
    "kylin_notify: native backend not enabled. Fill in the SDK header/class "
    "(see comments) or use bridge/notify_bridge.py, which needs no compilation.\n");
  return 1;
}
