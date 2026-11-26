#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Kylin/standard-Linux notification bridge for the DSH notifier plugin.

Protocol: one JSON command per line on stdin. Responses (only for ping) go to
stdout as one JSON line. Commands:

  {"op":"notify","summary":...,"body":...,"appName":...,"icon":...,
   "session":"<sessionId>","replaceKey":"<optional key, defaults to session>",
    "url":"<authenticated url with #session=...>",
   "timeout":-1,"sound":false,"actionLabel":"打开对话"}
  {"op":"close","id":123}
  {"op":"ping"}

On ActionInvoked(default) the bridge opens the stored URL with xdg-open (or
with the optional Electron shell hook), which loads the DSH web app; the
client-side part of the plugin reads `#session=<id>` and focuses that
conversation.

Works on both aarch64 and x86_64: pure Python + python3-dbus + freedesktop
org.freedesktop.Notifications (the same DBus service Kylin's notification
daemon implements). No compilation required.
"""

import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import dbus
from dbus.mainloop.glib import DBusGMainLoop

try:
    from gi.repository import GLib
except ImportError:  # pragma: no cover - fallback for minimal installs
    import glib as GLib

DBusGMainLoop(set_as_default=True)

SERVICE = "org.freedesktop.Notifications"
PATH = "/org/freedesktop/Notifications"
IFACE = "org.freedesktop.Notifications"

_bus = None
_iface = None
_url_by_id = {}
_session_by_id = {}
_replace_by_session = {}
_last_id = 0
_main_loop = None


def blog(msg):
    """Write one diagnostic line to stderr (the host keeps a bounded tail)."""
    try:
        sys.stderr.write("[kylin-notifier bridge] %s\n" % msg)
        sys.stderr.flush()
    except Exception:
        pass


# UKUI's sidebar ignores the freedesktop `sound-name` hint, so the DBus hint
# alone produces no audible cue. Play the system's standard "new message"
# sound directly with paplay as well. Everything is best-effort: no player or
# no audio device simply means a silent notification, never a failed popup.
_SOUND_CANDIDATES = (
    "/usr/share/sounds/freedesktop/stereo/message-new-instant.oga",
    "/usr/share/sounds/freedesktop/stereo/message.oga",
    "/usr/share/sounds/Light-Seeking/stereo/notification-general.ogg",
    "/usr/share/sounds/Light-Seeking/stereo/complete.ogg",
)
_sound_warned = False


def play_sound():
    global _sound_warned
    import shutil

    player = shutil.which("paplay") or shutil.which("aplay")
    if not player:
        if not _sound_warned:
            blog("sound: no paplay/aplay found, skipping")
            _sound_warned = True
        return
    cue = next((p for p in _SOUND_CANDIDATES if os.path.isfile(p)), None)
    if not cue:
        if not _sound_warned:
            blog("sound: no system cue file found, skipping")
            _sound_warned = True
        return
    try:
        subprocess.Popen(
            [player, cue],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        blog("sound: played %s via %s" % (cue, player))
    except Exception as error:
        if not _sound_warned:
            blog("sound: playback failed: %s" % error)
            _sound_warned = True


def ensure_bus():
    """Connect to the session bus, discovering the address when absent.

    Kylin desktop sessions normally expose /run/user/<uid>/bus. On headless
    sessions DBUS_SESSION_BUS_ADDRESS may be unset; we derive it from the uid
    or XDG_RUNTIME_DIR instead of requiring X11 autolaunch.
    """
    global _bus, _iface
    if _bus is not None:
        return _bus
    if not os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
        runtime = os.environ.get("XDG_RUNTIME_DIR")
        candidates = []
        if runtime:
            candidates.append("unix:path=" + os.path.join(runtime, "bus"))
        candidates.append("unix:path=/run/user/%d/bus" % os.getuid())
        for candidate in candidates:
            if os.path.exists(candidate.split("path=", 1)[-1]):
                os.environ["DBUS_SESSION_BUS_ADDRESS"] = candidate
                break
    _bus = dbus.SessionBus()
    obj = _bus.get_object(SERVICE, PATH)
    _iface = dbus.Interface(obj, IFACE)
    return _bus


def open_url(url, session):
    """Open the conversation URL, preferring a running Electron shell hook."""
    if not url:
        return
    hook_file = os.path.expanduser(
        "~/.local/share/deepseek-harness-service/notify-port"
    )
    port = None
    try:
        with open(hook_file, "r", encoding="utf-8") as fh:
            port = int(fh.read().strip())
    except Exception:
        port = None

    if port:
        try:
            query = urllib.parse.urlencode({"url": url, "session": session or ""})
            req = urllib.request.Request(
                "http://127.0.0.1:%d/open?%s" % (port, query)
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    return
        except Exception:
            pass  # fall through to xdg-open

    env = dict(os.environ)
    try:
        subprocess.Popen(
            ["xdg-open", url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            start_new_session=True,
        )
    except Exception:
        try:
            subprocess.Popen(
                ["gio", "open", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=env,
                start_new_session=True,
            )
        except Exception:
            pass


def on_action_invoked(nid, action):
    try:
        nid = int(nid)
    except Exception:
        return
    if action == "default":
        url = _url_by_id.pop(nid, "")
        session = _session_by_id.pop(nid, "")
        if url:
            open_url(url, session)
        try:
            _iface.CloseNotification(dbus.UInt32(nid))
        except Exception:
            pass
        return
    if action == "dismiss":
        # Dismiss only this one popup; nothing is persisted, so the very next
        # turn still notifies as usual.
        try:
            _iface.CloseNotification(dbus.UInt32(nid))
        except Exception:
            pass


def on_notification_closed(nid, reason):
    try:
        nid = int(nid)
    except Exception:
        return
    _url_by_id.pop(nid, None)
    _session_by_id.pop(nid, None)


def do_notify(cmd):
    global _last_id
    ensure_bus()
    session = str(cmd.get("session") or "")
    replace_key = str(cmd.get("replaceKey") or session)
    summary = str(cmd.get("summary") or "")
    body = str(cmd.get("body") or "")
    app_name = str(cmd.get("appName") or "DeepSeek Harness")
    icon = str(cmd.get("icon") or "dialog-information")
    url = str(cmd.get("url") or "")
    # Empty labels are meaningful: UKUI renders an icon-only button when the
    # label is blank, which is how the "open conversation" action can appear as
    # a bare arrow next to the desktop shell's own close button.
    action_label = str(cmd.get("actionLabel") or "")
    dismiss_label = str(cmd.get("dismissLabel") or "")
    try:
        timeout = int(cmd.get("timeout", -1))
    except Exception:
        timeout = -1

    replaces = int(_replace_by_session.get(replace_key, 0))
    # UKUI's notification server requires a non-empty label, so an empty label
    # means "no text button", not "empty button": the open action is then only
    # reachable by clicking the notification body.
    actions = []
    if action_label:
        actions += ["default", action_label]
    if dismiss_label:
        actions += ["dismiss", dismiss_label]
    hints = {}
    # In native mode the desktop notification centre owns the popup, and the
    # settings page no longer exposes a sound toggle: every notification simply
    # uses the system sound. Keep the freedesktop hint for desktops that honour
    # it and also play the cue directly, because UKUI's sidebar ignores
    # sound-name (which is why a hint-only implementation was silent).
    hints["sound-name"] = dbus.String("message-new-instant")
    play_sound()
    nid = int(
        _iface.Notify(
            app_name,
            replaces,
            icon,
            summary,
            body,
            actions,
            hints,
            timeout,
        )
    )
    _last_id = nid
    if replace_key:
        _replace_by_session[replace_key] = nid
    _url_by_id[nid] = url
    _session_by_id[nid] = session


def do_close(cmd):
    ensure_bus()
    nid = 0
    try:
        nid = int(cmd.get("id") or 0)
    except Exception:
        nid = 0
    # Also accept the replace key we issued the notification with: a caller
    # retracting "please confirm" knows the key, not the daemon-side id.
    key = cmd.get("replaceKey")
    if not nid and key:
        nid = int(_replace_by_session.get(str(key), 0) or 0)
        if key:
            _replace_by_session.pop(str(key), None)
    if nid:
        _iface.CloseNotification(nid)
        _url_by_id.pop(nid, None)
        _session_by_id.pop(nid, None)


def handle_line(line):
    line = line.strip()
    if not line:
        return
    try:
        cmd = json.loads(line)
    except Exception:
        return
    op = cmd.get("op")
    blog("op=%s summary=%r" % (op, cmd.get("summary", "")))
    if op == "notify":
        try:
            do_notify(cmd)
            blog("notify ok last_id=%d" % _last_id)
        except Exception as exc:  # keep the daemon alive on a bad command
            blog("notify FAILED: %r" % exc)
            sys.stderr.write("notify failed: %s\n" % exc)
            sys.stderr.flush()
    elif op == "close":
        try:
            do_close(cmd)
        except Exception as exc:
            sys.stderr.write("close failed: %s\n" % exc)
            sys.stderr.flush()
    elif op == "ping":
        sys.stdout.write(json.dumps({"ok": True}) + "\n")
        sys.stdout.flush()


def main():
    global _main_loop
    blog("bridge started pid=%d" % os.getpid())
    bus = ensure_bus()
    blog("bus connected")
    bus.add_signal_receiver(
        on_action_invoked,
        signal_name="ActionInvoked",
        dbus_interface=IFACE,
        bus_name=SERVICE,
    )
    bus.add_signal_receiver(
        on_notification_closed,
        signal_name="NotificationClosed",
        dbus_interface=IFACE,
        bus_name=SERVICE,
    )
    _main_loop = GLib.MainLoop()
    # Read stdin without blocking the GLib main loop. GLib's IO watch is
    # available through the same gi binding used for the main loop.
    try:
        GLib.io_add_watch(
            sys.stdin.fileno(),
            GLib.IOCondition.IN | GLib.IOCondition.HUP,
            _on_stdin,
        )
    except Exception:
        # Fallback: a background thread draining stdin into the main loop.
        import threading

        def _reader():
            for line in sys.stdin:
                GLib.idle_add(handle_line, line)
            GLib.idle_add(_main_loop.quit)

        threading.Thread(target=_reader, daemon=True).start()
    _main_loop.run()


_stdin_buf = b""


def _on_stdin(fd, condition):
    global _stdin_buf
    # Read the RAW fd, never sys.stdin.readline(): the buffered reader swallows
    # a whole block, leaving complete lines stranded in Python's buffer while
    # the fd is already drained - GLib then sees nothing to wake on and every
    # further command is silently lost. This was the "sometimes no popup" bug.
    try:
        chunk = os.read(fd, 65536)
    except (OSError, BlockingIOError):
        return True
    if not chunk:
        blog("stdin closed, quitting")
        if _main_loop is not None:
            _main_loop.quit()
        return False
    _stdin_buf += chunk
    while b"\n" in _stdin_buf:
        raw, _stdin_buf = _stdin_buf.split(b"\n", 1)
        if raw.strip():
            handle_line(raw.decode("utf-8", "replace") + "\n")
    return True


def _unused_old_stdin(fd, condition):
    line = sys.stdin.readline()
    if line:
        handle_line(line)
        return True
    # stdin closed (parent harness exited): no further commands can arrive.
    blog("stdin closed, quitting")
    if _main_loop is not None:
        _main_loop.quit()
    return False


if __name__ == "__main__":
    main()
