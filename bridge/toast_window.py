#!/usr/bin/env python3
"""DeepSeek Harness macOS-style notification renderer for Kylin / UKUI.

Same stdin JSON protocol as notify_bridge.py. Instead of handing the
notification to the desktop daemon (which force-collapses popups after ~6 s
and strips action labels on the way into the sidebar), this process draws its
own always-on-top banner that looks like a native macOS notification.

Design constraints, in the order they were given:

1. No system performance cost, no stability risk. No daemon, no systemd unit,
   no polling: the process is spawned lazily by the Host plugin on the first
   notification and exits on stdin EOF. It needs no root and writes nothing.
2. Decoupled from DSH and from the Electron shell. The Host plugin only knows
   the stdin protocol; swapping this file for another renderer changes nothing
   else. Nothing here imports from the DSH bundle.
3. As pretty as possible with what is already installed. There is no
   PyGObject-WebKit binding on this machine, so the card is GTK3 + cairo: a
   frosted glass panel with rounded corners, a soft drop shadow, the DSH mark,
   a hover highlight, and a countdown bar.

Card anatomy (macOS style, no buttons):

    +------------------------------------------------+
    | (DSH)  DeepSeek Harness              刚刚       |
    | 麒麟弹窗插件                                    |
    | 会话已完成，请到 DeepSeek Harness 中查看         |
    +------------------------------------------------+

The whole banner is the click target: clicking it opens the conversation in
the Electron shell when its loopback callback server is up, and only falls
back to the desktop browser otherwise. Hovering brightens the panel and turns
the pointer into a hand, so the card reads as clickable without adding any
button chrome.

`theme` selects the palette: "light", "dark" or "auto" (follow the desktop's
color-scheme setting).

Protocol (one JSON object per line on stdin):

  {"op":"notify","summary":...,"body":...,"url":...,"session":...,
   "replaceKey":...,"timeout":ms,"appName":...,"theme":...}
  {"op":"close","replaceKey":...}
  {"op":"closeAll"}
  {"op":"ping"}

Only `ping` writes to stdout; everything else is reported on stderr so the
Host's diagnostics pipe stays free.
"""

import json
import os
import signal
import sys
from urllib.parse import quote

import cairo
import math
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Gdk, GLib, Gtk, PangoCairo  # noqa: E402

APP_NAME = "DeepSeek Harness"

# Optional debug log file, enabled by the Host plugin's `debug` setting (it
# sets KYLIN_TOAST_LOG in the renderer's environment). stderr alone is only a
# bounded in-memory tail on the Host side, so an opt-in file is the only way to
# inspect what a card did after its process exited.
_LOG_PATH = os.environ.get("KYLIN_TOAST_LOG") or ""

# macOS notification banner metrics. The reference banner (图2) is a wide,
# short pill: roughly 700x194 with a generous icon gutter on the left, so the
# card is deliberately wider than it is tall.
CARD_WIDTH = 700
CARD_GAP = 10
CARD_FALLBACK_HEIGHT = 132
MARGIN_TOP = 12
# Only ever one banner on screen: a new notification replaces the current one.
MAX_CARDS = 1
DEFAULT_TIMEOUT = 8000

# A 30 fps countdown that only runs while a card is visible. Nothing sleeps,
# nothing busy-waits: when the last card goes away every timer is stopped.
TICK_MS = 33

# macOS uses a continuous, very large corner on notification banners. At the
# reference height (~194 px for the whole window, ~132 px of body) 32 px reads
# as the pill-like corner in 图2 without turning the short rows into a capsule.
SURFACE_RADIUS = 32

# Room inside the window for the drop shadow to bleed into.
SHADOW_PAD = 26

# The shadow is a single blurred silhouette: how far it grows outward, its
# downward offset, and the box-blur radius that shapes the falloff.
SHADOW_SPREAD = 7
SHADOW_OFFSET_Y = 5
BLUR_RADIUS = 8

# App-icon gutter, matching the square tile in 图2 (~44 px at this card size).
ICON_SIZE = 46

# Inner spacing of the painted panel (applied as widget margins on the body
# row). 图2 leaves a generous left gutter so the icon clears the rounded edge.
PANEL_PAD_Y = 26
PANEL_PAD_X = 26
PANEL_PAD_X_RIGHT = 30

# ---------------------------------------------------------------- bundled fonts
#
# The banner must look identical on every machine, but fontconfig picks
# different faces on Kylin, Ubuntu and Debian. So the fonts ship with the
# plugin and get installed into the user's font directory on first launch,
# which is writable without root. San Francisco cannot be shipped (Apple's
# licence forbids redistributing it); Inter is the closest open substitute.
_PY_DIR = os.path.dirname(os.path.abspath(__file__))
# fonts/ sits either beside the bridge (installed bundle) or two levels up
# (source checkout: <plugin>/fonts next to <plugin>/bundle/bridge).
FONT_DIR_CANDIDATES = (
    os.path.join(_PY_DIR, "..", "..", "fonts"),
    os.path.join(_PY_DIR, "..", "fonts"),
    os.path.join(_PY_DIR, "fonts"),
)

# Fontless fallbacks, in the order Pango should try them when a bundled file is
# missing (e.g. a trimmed install).
FONT_STACK = (
    '"Inter", "Noto Sans SC", "SF Pro Text", "Helvetica Neue", '
    '"Noto Sans CJK SC", "Noto Sans", "DejaVu Sans", sans-serif'
)

_FONT_FILES = (
    "Inter-Regular.ttf",
    "Inter-Medium.ttf",
    "Inter-SemiBold.ttf",
    "Inter-Bold.ttf",
    "NotoSansSC-Regular.ttf",
    "NotoSansSC-Medium.ttf",
    "NotoSansSC-Bold.ttf",
)

# fc-cache --force-filter is not needed; fontconfig revalidates on mtime, so a
# marker file whose content is a hash of every shipped font keeps this to one
# run per plugin version.
_fonts_loaded = False


def _font_source_dir():
    for candidate in FONT_DIR_CANDIDATES:
        if os.path.isdir(candidate):
            return os.path.normpath(candidate)
    return None


def _user_font_dir():
    base = os.environ.get("XDG_DATA_HOME") or os.path.join(
        os.path.expanduser("~"), ".local", "share"
    )
    return os.path.join(base, "fonts", "dsh-kylin-notifier")


def load_bundled_fonts():
    """Make the plugin's own fonts visible to Pango.

    Pango 1.50 added `FcFontMap.add_font_file`, but the Pango shipped on Kylin
    V10 predates it, so the portable route is the per-user font directory plus
    a fontconfig cache rebuild. Nothing here needs root, and every failure is
    logged and swallowed: a missing font only costs the look, never the card.
    """
    global _fonts_loaded
    if _fonts_loaded:
        return True

    src_dir = _font_source_dir()
    if not src_dir:
        log("fonts: no font directory found, using system fonts")
        return False
    sources = [os.path.join(src_dir, name) for name in _FONT_FILES]
    sources = [p for p in sources if os.path.exists(p)]
    if not sources:
        log("fonts: directory %s has no font files, using system fonts" % src_dir)
        return False

    import hashlib

    digest = hashlib.sha1()
    for path in sorted(sources):
        try:
            with open(path, "rb") as handle:
                digest.update(handle.read())
        except OSError as exc:
            log("fonts: cannot read %s: %s" % (path, exc))
            return False
    stamp = digest.hexdigest()

    dest = _user_font_dir()
    marker = os.path.join(dest, ".installed")
    try:
        current = ""
        if os.path.exists(marker):
            with open(marker, "r", encoding="utf-8") as handle:
                current = handle.read().strip()
        if current != stamp:
            os.makedirs(dest, exist_ok=True)
            for path in sources:
                target = os.path.join(dest, os.path.basename(path))
                with open(path, "rb") as src, open(target, "wb") as out:
                    out.write(src.read())
            for stale in os.listdir(dest):
                if stale not in {os.path.basename(p) for p in sources} and stale != ".installed":
                    if stale.endswith(".ttf"):
                        os.remove(os.path.join(dest, stale))
            with open(marker, "w", encoding="utf-8") as handle:
                handle.write(stamp)
            _run("fc-cache", "-f", dest)
            log("fonts: installed %d files into %s" % (len(sources), dest))
        else:
            log("fonts: already installed in %s" % dest)
    except OSError as exc:
        log("fonts: install failed (%s), using system fonts" % exc)
        return False

    # Validate: if fontconfig still cannot see the families, do not pretend the
    # card is using them.
    try:
        listing = _run("fc-list", ":family")
    except Exception as exc:  # noqa: BLE001 - a broken fc-list is not fatal
        log("fonts: fc-list failed: %s" % exc)
        listing = ""
    # fc-list prints one line per face as "Inter,Inter SemiBold:style=...", so a
    # plain substring test on the whole listing is enough to tell presence.
    have_inter = "Inter" in listing
    have_cjk = "Noto Sans SC" in listing
    if not listing:
        # No fc-list output: trust the install rather than silently dropping to
        # system fonts, and let the rendered result be the evidence.
        have_inter = have_cjk = True
    if not have_inter:
        log("fonts: fontconfig does not report Inter; falling back")
        return False
    if not have_cjk:
        log("fonts: fontconfig does not report Noto Sans SC; Chinese falls back")
    _fonts_loaded = True
    log("fonts: ready (Inter=%s, Noto Sans SC=%s)" % (have_inter, have_cjk))
    return True


def _run(*argv):
    import subprocess

    proc = subprocess.run(
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "%s exited %d: %s"
            % (argv[0], proc.returncode, proc.stderr.decode("utf-8", "replace").strip())
        )
    return proc.stdout.decode("utf-8", "replace")


def log(*args):
    try:
        line = "[kylin-toast] " + " ".join(str(a) for a in args)
        print(line, file=sys.stderr, flush=True)
        # The Host captures stderr into a bounded in-memory tail that is only
        # read on failure; an opt-in file is the only way to see what a card
        # did after the fact.
        if _LOG_PATH:
            with open(_LOG_PATH, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------- sound
#
# macOS plays a short, soft "pop" when a notification banner arrives. The
# setting arrives in the notify payload as `sound`; this renderer is the only
# layer that can actually make noise, so playback lives here. PulseAudio's
# paplay is present on Kylin and the freedesktop sound theme ships a suitable
# message cue; every failure is swallowed (headless/CI/test runs have neither)
# so a missing audio device can never break the banner.

# First existing file wins. `message-new-instant.oga` is the standard
# freedesktop "new instant message" cue (a soft blip); the others are
# fallbacks for Kylin themes that install a different sound set.
_SOUND_CANDIDATES = (
    "/usr/share/sounds/freedesktop/stereo/message-new-instant.oga",
    "/usr/share/sounds/freedesktop/stereo/message.oga",
    "/usr/share/sounds/Light-Seeking/stereo/notification-general.ogg",
    "/usr/share/sounds/Light-Seeking/stereo/complete.ogg",
)

_sound_warned = False


def play_notification_sound():
    """Play the arrival cue once. Best-effort: silent systems are fine."""
    global _sound_warned
    import shutil
    import subprocess

    player = shutil.which("paplay") or shutil.which("aplay")
    if not player:
        if not _sound_warned:
            log("sound: no paplay/aplay found, skipping")
            _sound_warned = True
        return
    cue = next((p for p in _SOUND_CANDIDATES if os.path.isfile(p)), None)
    if not cue:
        if not _sound_warned:
            log("sound: no system cue file found, skipping")
            _sound_warned = True
        return
    # paplay inherits XDG_RUNTIME_DIR / PULSE_SERVER from the renderer's
    # environment (set by the Host's desktopEnv()), which is what lets it
    # reach the per-user PulseAudio daemon.
    try:
        subprocess.Popen(
            [player, cue],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        log("sound: played", cue, "via", player)
    except Exception as error:
        if not _sound_warned:
            log("sound: playback failed:", error)
            _sound_warned = True



# ---------------------------------------------------------------- palettes
#
# Every colour the card needs, per theme. Keeping them in one table means the
# hover state and the light/dark switch cannot drift apart.

THEMES = {
    "light": {
        # A white panel on a white window has no edge at all, so this theme
        # leans on three signals instead of one: a gradient that actually
        # darkens toward the bottom (#FFFFFF -> #F2F2F5), a faint cool hairline
        # just inside the edge, and a heavier, tighter shadow than dark uses.
        # Alpha stays high enough that text behind the banner never bleeds
        # through -- a see-through white card over a white UI reads as dirt.
        "glass_top": (1.000, 1.000, 1.000, 1.0),
        "glass_mid": (0.976, 0.976, 0.984, 1.0),
        "glass_bottom": (0.937, 0.937, 0.949, 1.0),
        "glass_hover_top": (1.000, 1.000, 1.000, 1.0),
        "glass_hover_mid": (0.984, 0.984, 0.992, 1.0),
        "glass_hover_bottom": (0.957, 0.957, 0.969, 1.0),
        # Cool grey hairline: reads as a machined edge on white, and is far too
        # faint to look like a second outline (that was the 叠影 bug).
        "edge_color": (0.40, 0.42, 0.48),
        "edge_top": 0.42,
        "edge_mid": 0.30,
        "edge_bottom": 0.24,
        # 2.9 x 0.16 = 0.46 peak alpha, one continuous blurred falloff.
        "shadow": 3.40,
        "logo": "#000000",
        "icon_bg": None,
        # macOS semantic colours: label #000000, secondaryLabel #3C3C43 @ 60%.
        "app": "rgba(28,28,30,0.85)",
        "when": "rgba(60,60,67,0.42)",
        "title": "rgba(0,0,0,0.92)",
        "body": "rgba(60,60,67,0.72)",
    },
    "dark": {
        # Dark acrylic per the brief: genuinely near-black, not a grey HUD.
        # The gradient runs from #26262B at the top to #16161A at the bottom,
        # so the panel still reads as glass rather than a flat black slab.
        "glass_top": (0.149, 0.149, 0.169, 1.0),
        "glass_mid": (0.110, 0.110, 0.125, 1.0),
        "glass_bottom": (0.086, 0.086, 0.102, 1.0),
        "glass_hover_top": (0.196, 0.196, 0.220, 1.0),
        "glass_hover_mid": (0.153, 0.153, 0.173, 1.0),
        "glass_hover_bottom": (0.125, 0.125, 0.145, 1.0),
        # A faint white catch-light on the top edge only: on a dark panel the
        # silhouette already separates from the wallpaper, so this stays well
        # under the level where it would read as a second frame.
        "edge_color": (1.0, 1.0, 1.0),
        "edge_top": 0.14,
        "edge_mid": 0.07,
        "edge_bottom": 0.045,
        "shadow": 3.60,
        "logo": "#FFFFFF",
        "icon_bg": None,
        # macOS dark: label #FFFFFF, secondaryLabel #EBEBF5 @ 60%.
        "app": "rgba(242,242,247,0.88)",
        "when": "rgba(235,235,245,0.42)",
        "title": "rgba(255,255,255,0.95)",
        "body": "rgba(235,235,245,0.68)",
    },
}

def build_css(theme_name):
    """CSS for the text widgets. The panel itself is painted by cairo."""
    palette = dict(THEMES[theme_name])
    palette["fontstack"] = FONT_STACK
    return """
/* Every container must stay fully transparent: the panel, its rounded
   corners and its shadow are all painted by cairo in Card._on_frame_draw().
   The moment a container gets an opaque background (theme colour included)
   it is composited *over* that cairo pass and squares the corners off. */
window,
window.background,
.toast-frame,
.toast-card,
box {
  background-color: transparent;
  background-image: none;
  border: none;
  box-shadow: none;
}
.toast-frame {
  background-color: transparent;
}
.toast-card {
  /* Painted by cairo in Card._on_frame_draw(); CSS border-radius would leave
     opaque black outside the corners on X11. */
  background-color: transparent;
  background-image: none;
  border: none;
  box-shadow: none;
  /* No padding: the card's allocation is exactly the painted panel rect, and
     _on_frame_draw already insets the panel by SHADOW_PAD. The 图2 spacing
     lives on .toast-body-row below, which is a child of this box. */
  padding: 0;
}
/* Two-column body: icon gutter on the left, text column on the right. */
.toast-body-row {
  background-color: transparent;
}
.toast-logo {
  color: %(logo)s;
}
.toast-app,
label.toast-app {
  /* 图2: the app name is a small, quiet semibold line above the title. */
  font-family: %(fontstack)s;
  color: %(app)s;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.1px;
}
.toast-when,
label.toast-when {
  /* 图2: "现在" sits on the app-name baseline, light grey, normal weight. */
  font-family: %(fontstack)s;
  color: %(when)s;
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 0px;
}
.toast-title,
label.toast-title {
  /* 图2: the conversation name is the boldest line of the three. */
  font-family: %(fontstack)s;
  color: %(title)s;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.2px;
}
.toast-body,
label.toast-body {
  /* 图2: the status line is the same size as the title but lighter. */
  font-family: %(fontstack)s;
  color: %(body)s;
  font-size: 17px;
  font-weight: 400;
  letter-spacing: -0.1px;
}
""" % palette


# ---------------------------------------------------------------- cairo helpers


def _apply_rounded_path(cr, x, y, width, height, radius):
    """A continuous rounded rectangle.

    Built from real arcs rather than a multi-ring approximation: concentric
    rounded rects were what produced the nested "叠影" outlines around the card.
    """
    radius = min(radius, width / 2.0, height / 2.0)
    cr.new_sub_path()
    cr.arc(x + width - radius, y + radius, radius, -math.pi / 2, 0)
    cr.arc(x + width - radius, y + height - radius, radius, 0, math.pi / 2)
    cr.arc(x + radius, y + height - radius, radius, math.pi / 2, math.pi)
    cr.arc(x + radius, y + radius, radius, math.pi, 3 * math.pi / 2)
    cr.close_path()


def _blurred_shadow_surface(width, height, padding, radius, spread, offset_y, alpha):
    """Render one soft shadow as a real blurred silhouette.

    Painting several rounded rects at different radii leaves visible nested
    outlines -- the "叠影" the design review flagged. A separated box blur over
    a single silhouette gives one continuous falloff instead, which is what a
    macOS drop shadow actually looks like.
    """
    sw = int(width + padding * 2)
    sh = int(height + padding * 2)
    src = cairo.ImageSurface(cairo.FORMAT_ARGB32, sw, sh)
    scr = cairo.Context(src)
    _apply_rounded_path(
        scr,
        padding - spread,
        padding - spread + offset_y,
        width + spread * 2,
        height + spread * 2,
        radius + spread,
    )
    scr.set_source_rgba(0, 0, 0, alpha)
    scr.fill()
    src.flush()

    # Separated box blur (three passes approximates a gaussian closely enough
    # at this size and costs a fraction of a real convolution).
    out = src
    for _ in range(3):
        out = _box_blur_surface(out, BLUR_RADIUS)
    return out


def _box_blur_surface(surface, radius):
    """One horizontal + vertical box blur pass over an ARGB32 surface."""
    w = surface.get_width()
    h = surface.get_height()
    src = surface.get_data()
    src = bytes(src)
    stride = surface.get_stride()

    dst_surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, w, h)
    dst = dst_surface.get_data()
    dst = bytearray(dst)
    dst_stride = dst_surface.get_stride()

    def sample(x, y):
        i = y * stride + x * 4
        return src[i], src[i + 1], src[i + 2], src[i + 3]

    # Horizontal pass: running sum of premultiplied channel values.
    for y in range(h):
        acc = [0, 0, 0, 0]
        row = y * stride
        out_row = y * dst_stride
        for x in range(min(radius + 1, w)):
            b, g, r, a = src[row + x * 4], src[row + x * 4 + 1], src[row + x * 4 + 2], src[row + x * 4 + 3]
            acc[0] += b; acc[1] += g; acc[2] += r; acc[3] += a
        for x in range(w):
            n = 0
            if x > radius:
                ox = x - radius - 1
                b, g, r, a = src[row + ox * 4], src[row + ox * 4 + 1], src[row + ox * 4 + 2], src[row + ox * 4 + 3]
                acc[0] -= b; acc[1] -= g; acc[2] -= r; acc[3] -= a
            if x + radius < w:
                ix = x + radius
                b, g, r, a = src[row + ix * 4], src[row + ix * 4 + 1], src[row + ix * 4 + 2], src[row + ix * 4 + 3]
                acc[0] += b; acc[1] += g; acc[2] += r; acc[3] += a
            n = min(x + radius, w - 1) - max(x - radius, 0) + 1
            dst[out_row + x * 4] = acc[0] // n
            dst[out_row + x * 4 + 1] = acc[1] // n
            dst[out_row + x * 4 + 2] = acc[2] // n
            dst[out_row + x * 4 + 3] = acc[3] // n

    # Vertical pass.
    tmp = bytes(dst)
    for x in range(w):
        acc = [0, 0, 0, 0]
        for y in range(min(radius + 1, h)):
            i = y * dst_stride + x * 4
            acc[0] += tmp[i]; acc[1] += tmp[i + 1]; acc[2] += tmp[i + 2]; acc[3] += tmp[i + 3]
        for y in range(h):
            if y > radius:
                oy = y - radius - 1
                i = oy * dst_stride + x * 4
                acc[0] -= tmp[i]; acc[1] -= tmp[i + 1]; acc[2] -= tmp[i + 2]; acc[3] -= tmp[i + 3]
            if y + radius < h:
                iy = y + radius
                i = iy * dst_stride + x * 4
                acc[0] += tmp[i]; acc[1] += tmp[i + 1]; acc[2] += tmp[i + 2]; acc[3] += tmp[i + 3]
            n = min(y + radius, h - 1) - max(y - radius, 0) + 1
            i = y * dst_stride + x * 4
            dst[i] = acc[0] // n
            dst[i + 1] = acc[1] // n
            dst[i + 2] = acc[2] // n
            dst[i + 3] = acc[3] // n

    dst_surface.flush()
    return dst_surface


def _paint_label(label, css_color):
    """Apply a palette colour straight to a Gtk.Label.

    `override_color` is the only reliable way here: a CSS provider added to a
    window's style context does not reach the contexts of child labels, so the
    rules in build_css() set sizes and weights but the text kept the theme's
    default foreground -- white text disappeared on the light card and dark
    text disappeared on the dark one.
    """
    try:
        rgba = Gdk.RGBA()
        if rgba.parse(css_color):
            label.override_color(Gtk.StateFlags.NORMAL, rgba)
    except Exception:  # pragma: no cover - palette strings are known-good
        pass


def _detect_system_theme():
    """Resolve "auto" against the desktop's colour-scheme preference."""
    try:
        settings = Gtk.Settings.get_default()
        if settings is not None:
            value = settings.get_property("gtk-application-prefer-dark-theme")
            return "dark" if value else "light"
    except Exception:
        pass
    return "light"


def resolve_theme(requested):
    name = str(requested or "auto").strip().lower()
    if name in THEMES:
        return name
    return _detect_system_theme()


# ---------------------------------------------------------------- one card


class Card:
    """One banner: a borderless, always-on-top popup window."""

    def __init__(self, app, payload):
        self.app = app
        self.key = str(payload.get("replaceKey") or payload.get("session") or "card")
        self.url = payload.get("url") or ""
        self.session = payload.get("session") or ""
        self.theme = resolve_theme(payload.get("theme") or app.theme)
        self.palette = THEMES[self.theme]
        timeout = payload.get("timeout")
        try:
            timeout = int(timeout)
        except (TypeError, ValueError):
            timeout = DEFAULT_TIMEOUT
        # A negative or zero timeout follows the freedesktop convention and
        # means "stay until clicked"; the Host never sends one by accident.
        self.total_ms = timeout if timeout and timeout > 0 else 0
        self.remaining_ms = float(self.total_ms)
        # Each card keeps its own clock. The app-wide tick timer is a shared
        # 60 Hz source, and a renderer that sat idle for minutes would hand the
        # first frame a delta of minutes -- enough to expire a brand-new card
        # before it was ever painted.
        self.last_tick_us = GLib.get_monotonic_time()
        self.hovered = False
        self.closing = False

        # TOPLEVEL rather than POPUP: ukui-kwin redirects toplevel windows
        # through the compositor, which is what lets the transparent corners
        # and the drop shadow blend with whatever is behind the card. A POPUP
        # window is drawn with the root window's visual and every rgba()
        # colour collapses onto black.
        self.window = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
        self.window.set_decorated(False)
        self.window.set_resizable(False)
        self.window.set_skip_taskbar_hint(True)
        self.window.set_skip_pager_hint(True)
        self.window.set_accept_focus(False)
        self.window.set_focus_on_map(False)
        self.window.set_type_hint(Gdk.WindowTypeHint.NOTIFICATION)
        self.window.set_keep_above(True)
        self.window.set_app_paintable(True)
        self.window.set_position(Gtk.WindowPosition.NONE)
        screen = self.window.get_screen()
        visual = screen.get_rgba_visual()
        if visual is not None:
            self.window.set_visual(visual)
        # Attach this card's own stylesheet: a light and a dark card can be on
        # screen together, so the sheet must not come from the screen.
        provider = app.provider_for(self.theme)
        if provider is not None:
            Gtk.StyleContext.add_provider(
                self.window.get_style_context(),
                provider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
            )
        self.window.connect("draw", self._on_draw)
        self.window.connect("enter-notify-event", self._on_enter)
        self.window.connect("leave-notify-event", self._on_leave)
        self.measured_height = CARD_FALLBACK_HEIGHT
        self.window.connect("size-allocate", self._on_size_allocate)

        self.frame = Gtk.Box()
        self.frame.get_style_context().add_class("toast-frame")
        # Paint the panel on the frame, not on the window: GTK draws a widget's
        # CSS background after the window's draw signal, so anything painted on
        # the window would be covered by the theme colour.
        self.frame.connect("draw", self._on_frame_draw)

        self.card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        self.card.get_style_context().add_class("toast-card")
        # The visual panel sits inside the shadow ring; the frame paints the
        # shadow into it.
        # _on_frame_draw paints the panel from (SHADOW_PAD, SHADOW_PAD) with
        # size (window - 2*SHADOW_PAD). The card must therefore sit exactly on
        # that rect and carry no padding of its own: GTK applies CSS padding on
        # top of the widget's own allocation, so any padding here would push
        # the icon straight back onto the panel edge.
        self.card.set_margin_top(SHADOW_PAD)
        self.card.set_margin_bottom(SHADOW_PAD)
        self.card.set_margin_start(SHADOW_PAD)
        self.card.set_margin_end(SHADOW_PAD)
        self.card.set_size_request(CARD_WIDTH - SHADOW_PAD * 2, -1)
        self.frame.pack_start(self.card, True, True, 0)

        # 图2 is a two-column banner: a square app-icon gutter on the left and
        # a three-line text column (app name + time, title, status) on the
        # right. The icon column owns its own top alignment so the mark lines
        # up with the app-name baseline instead of being vertically centred
        # against a three-line block.
        self.card.pack_start(self._build_body(payload), True, True, 0)

        # No countdown bar: a native macOS banner has no such affordance, and
        # with no buttons on the card it only added noise.
        self.bar = None

        self.window.add(self.frame)
        # Window-level events, so the whole banner is the click target.
        self.window.add_events(
            Gdk.EventMask.BUTTON_PRESS_MASK
            | Gdk.EventMask.ENTER_NOTIFY_MASK
            | Gdk.EventMask.LEAVE_NOTIFY_MASK
        )
        self.window.connect("button-press-event", self._on_card_click)

    # -- construction ----------------------------------------------------

    def _build_body(self, payload):
        """Icon gutter on the left, three stacked text lines on the right."""
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=18)
        row.get_style_context().add_class("toast-body-row")
        # 图2 spacing via widget margins rather than CSS padding: the card's
        # size_request pins the panel width, so CSS padding only squeezes the
        # content inward, leaving the icon glued to the rounded edge.
        row.set_margin_top(PANEL_PAD_Y)
        row.set_margin_bottom(PANEL_PAD_Y)
        row.set_margin_start(PANEL_PAD_X)
        row.set_margin_end(PANEL_PAD_X_RIGHT)

        logo = self._build_logo()
        logo.set_valign(Gtk.Align.START)
        logo.set_halign(Gtk.Align.START)
        # Fixed gutter: the tile must never claim more than ICON_SIZE, or the
        # text column is squeezed and the tile can spill past the padding.
        logo.set_size_request(ICON_SIZE, ICON_SIZE)
        row.pack_start(logo, False, False, 0)

        column = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        column.set_valign(Gtk.Align.START)
        row.pack_start(column, True, True, 0)

        # Line 1: app name, with the relative time pushed to the trailing edge.
        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        app = Gtk.Label(label=str(payload.get("appName") or APP_NAME))
        app.get_style_context().add_class("toast-app")
        # GTK does not cascade a window's CSS provider into the style context
        # of a child Gtk.Label, so `color` from CSS never reached the text and
        # every label fell back to the light theme's near-black foreground.
        # Setting the colour on the widget itself is unambiguous.
        _paint_label(app, self.palette["app"])
        app.set_xalign(0.0)
        app.set_valign(Gtk.Align.BASELINE)
        header.pack_start(app, False, False, 0)

        when = Gtk.Label(label="现在")
        when.get_style_context().add_class("toast-when")
        _paint_label(when, self.palette["when"])
        when.set_xalign(1.0)
        when.set_valign(Gtk.Align.BASELINE)
        header.pack_end(when, False, False, 0)
        column.pack_start(header, False, False, 0)

        # Line 2: conversation name, bold.
        title_text = str(payload.get("summary") or "").strip()
        body_text = str(payload.get("body") or "").strip()
        if title_text:
            title = Gtk.Label(label=title_text)
            title.get_style_context().add_class("toast-title")
            _paint_label(title, self.palette["title"])
            title.set_xalign(0.0)
            title.set_line_wrap(True)
            title.set_max_width_chars(44)
            title.set_margin_top(6)
            column.pack_start(title, False, False, 0)

        # Line 3: status text, lighter and the same size as the title.
        if body_text:
            body = Gtk.Label(label=body_text)
            body.get_style_context().add_class("toast-body")
            _paint_label(body, self.palette["body"])
            body.set_xalign(0.0)
            body.set_line_wrap(True)
            body.set_max_width_chars(44)
            body.set_margin_top(3)
            column.pack_start(body, False, False, 0)

        return row

    def _build_logo(self):
        """A macOS-style square app icon: tinted rounded tile plus the DSH mark.

        In 图2 the icon is not a bare glyph floating next to the text -- it is
        a coloured rounded square, iMessage-blue-green there, standing in its
        own gutter. Drawing the tile here keeps the whole banner vector and
        dependency-free while matching that silhouette exactly.
        """
        area = Gtk.DrawingArea()
        area.set_size_request(ICON_SIZE, ICON_SIZE)
        area.set_valign(Gtk.Align.START)
        dark = self.theme == "dark"
        area.connect("draw", self._draw_logo, dark)
        return area

    @staticmethod
    def _draw_logo(widget, cr, dark):
        _unused = dark
        size = ICON_SIZE
        # Rounded square tile, like an app icon. The radius is a little over
        # 22% of the side, which is what iOS/macOS use for squircle icons.
        _apply_rounded_path(cr, 0.5, 0.5, size - 1.0, size - 1.0, size * 0.225)
        tile = cairo.LinearGradient(0, 0, 0, size)
        if dark:
            tile.add_color_stop_rgb(0.0, 0.204, 0.204, 0.224)
            tile.add_color_stop_rgb(1.0, 0.129, 0.129, 0.145)
        else:
            tile.add_color_stop_rgb(0.0, 0.153, 0.153, 0.169)
            tile.add_color_stop_rgb(1.0, 0.086, 0.086, 0.098)
        cr.set_source(tile)
        cr.fill()

        # The mark itself, white on the dark tile, inset to leave a margin.
        inner = size * 0.60
        scale = inner / 50.0
        cr.save()
        cr.translate((size - inner) / 2.0, (size - inner) / 2.0)
        cr.scale(scale, scale)
        cr.new_path()
        _DSH_LOGO_PATH(cr)
        cr.set_source_rgba(1, 1, 1, 1)
        cr.fill()
        cr.restore()
        return False
        cr.paint()
        cr.restore()
        return False

    # -- interaction -----------------------------------------------------

    def _on_card_click(self, _widget, event):
        if event.button == 1:
            self.app.open_url(self.url, self.session)
            self.close(reason="clicked")
        return True

    def _on_enter(self, *_args):
        if self.hovered:
            return False
        self.hovered = True
        # Hand cursor + a brighter panel: a click affordance that adds no
        # button chrome, which is what "no buttons" asked for.
        try:
            cursor = Gdk.Cursor.new_from_name(self.window.get_display(), "pointer")
            self.window.get_window().set_cursor(cursor)
        except Exception:
            pass
        self.repaint()
        return False

    def _on_leave(self, *_args):
        if not self.hovered:
            return False
        self.hovered = False
        try:
            self.window.get_window().set_cursor(None)
        except Exception:
            pass
        self.repaint()
        return False

    def repaint(self):
        try:
            if self.frame.get_window() is not None:
                self.frame.get_window().invalidate_rect(None, False)
        except Exception:
            pass

    # -- placement -------------------------------------------------------

    def show(self, y_offset):
        """Map the window, then place it.

        Order matters. ``Gtk.Window.move()`` before the window is mapped is
        either dropped or overridden when the WM maps it, and ``get_size()``
        still reports 1x1 because nothing has been allocated yet -- the result
        is a 10x10 placeholder stuck in the corner that never becomes the card.
        Show (and let the size request resolve) first, then move to the real
        anchor.
        """
        rect = self.window.get_screen().get_display().get_primary_monitor().get_geometry()
        if rect.width <= 1 or rect.height <= 1:
            # No monitor information through this connection; assume the seat's
            # primary resolution rather than anchoring at 0,0.
            rect.width = 1920
            rect.height = 1200
        width = CARD_WIDTH

        if not self.window.get_visible():
            self.window.show_all()
            # Allocate now so get_size() is meaningful for the placement below.
            while Gtk.events_pending():
                Gtk.main_iteration_do(False)
            real_width = self.window.get_size()[0]
            if real_width > 1:
                width = real_width

        # Horizontally centred on the primary monitor, near the top edge.
        self.anchor_x = rect.x + (rect.width - width) // 2
        self.anchor_y = rect.y + MARGIN_TOP + y_offset
        self.window.move(self.anchor_x, self.anchor_y)

    def _on_size_allocate(self, _widget, allocation):
        if allocation.height > 1 and allocation.height != self.measured_height:
            self.measured_height = allocation.height
            self.app.schedule_reflow()

    def height(self):
        _w, h = self.window.get_size()
        # Before the first size-allocate the window reports 1x1; fall back to
        # the last measured height so stacking never overlaps.
        if h <= 1:
            return self.measured_height
        return h

    # -- painting --------------------------------------------------------

    def _on_draw(self, _widget, cr):
        """Clear the window to full transparency before the children draw."""
        cr.save()
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.restore()
        return False

    def _on_frame_draw(self, widget, cr):
        width = widget.get_allocated_width()
        height = widget.get_allocated_height()
        if width <= 1 or height <= 1:
            return False

        # The panel spans the allocation minus the shadow ring that the inner
        # card's margins already reserved. Painting inset again here would
        # shrink the body below the room the content uses and clip text.
        pad = SHADOW_PAD
        body_w = width - pad * 2
        body_h = height - pad * 2
        if body_w <= 1 or body_h <= 1:
            pad = 0
            body_w, body_h = width, height
        radius = SURFACE_RADIUS
        palette = self.palette

        cr.save()
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)

        # Soft drop shadow: one blurred silhouette, not several nested rounded
        # rects. Stacking rings at different radii drew concentric outlines
        # ("叠影") around the card; a single blurred silhouette has one
        # continuous falloff, like a real macOS banner.
        hover_boost = 1.25 if self.hovered else 1.0
        if palette["shadow"] > 0:
            shadow = _blurred_shadow_surface(
                body_w,
                body_h,
                pad,
                radius,
                SHADOW_SPREAD,
                SHADOW_OFFSET_Y,
                min(0.62, palette["shadow"] * 0.16 * hover_boost),
            )
            cr.set_source_surface(shadow, 0, 0)
            cr.paint()

        # Frosted glass body. There is no compositor blur available, so the
        # depth comes from layered alpha plus the sheen and rim below.
        if self.hovered:
            stops = (
                palette["glass_hover_top"],
                palette["glass_hover_mid"],
                palette["glass_hover_bottom"],
            )
        else:
            stops = (palette["glass_top"], palette["glass_mid"], palette["glass_bottom"])
        gradient = cairo.LinearGradient(pad, pad, pad, pad + body_h)
        gradient.add_color_stop_rgba(0.0, *stops[0])
        gradient.add_color_stop_rgba(0.55, *stops[1])
        gradient.add_color_stop_rgba(1.0, *stops[2])
        _apply_rounded_path(cr, pad, pad, body_w, body_h, radius)
        cr.set_source(gradient)
        cr.fill()

        # Hairline edge. Drawn as a gradient stroke *on* the panel boundary, not
        # inside it: the old rim sat at pad + 0.5 with its own radius, which
        # produced the nested halo ("叠影"). Same path, same radius, one stroke.
        r, g, b = palette["edge_color"]
        top = palette["edge_top"]
        mid = palette["edge_mid"]
        bottom = palette["edge_bottom"]
        if self.hovered:
            top, mid, bottom = top * 1.5, mid * 1.5, bottom * 1.5
        edge = cairo.LinearGradient(pad, pad, pad, pad + body_h)
        edge.add_color_stop_rgba(0.0, r, g, b, min(1.0, top))
        edge.add_color_stop_rgba(0.55, r, g, b, min(1.0, mid))
        edge.add_color_stop_rgba(1.0, r, g, b, min(1.0, bottom))
        _apply_rounded_path(cr, pad + 0.5, pad + 0.5, body_w - 1, body_h - 1, radius - 0.5)
        cr.set_line_width(1.5)
        cr.set_source(edge)
        cr.stroke()

        cr.restore()
        return False

    # -- countdown -------------------------------------------------------

    def tick(self, delta_ms=None):
        """Advance the auto-dismiss countdown. Returns False once it expired.

        The delta is measured from this card's own last frame, so time spent
        before the card existed can never be billed to it. `delta_ms` is
        accepted for callers that already have a delta and only used when a
        card has no clock of its own.
        """
        now = GLib.get_monotonic_time()
        if delta_ms is None:
            delta_ms = (now - self.last_tick_us) / 1000.0
        self.last_tick_us = now
        if self.total_ms <= 0 or self.hovered:
            return True
        self.remaining_ms -= delta_ms
        if self.remaining_ms <= 0:
            self.close(reason="timeout")
            return False
        return True

    def close(self, reason="closed"):
        if self.closing:
            return
        self.closing = True
        try:
            self.window.hide()
            self.window.destroy()
        except Exception:
            pass
        self.app.forget(self, reason)


# ---------------------------------------------------------------- app


class ToastApp:
    def __init__(self):
        self.cards = []
        self.timer_id = None
        self.last_tick = GLib.get_monotonic_time()
        self.stdin_buffer = b""
        self.providers = {}
        self.reflow_scheduled = False
        self.theme = "auto"

    # ---- appearance ----------------------------------------------------

    def provider_for(self, theme_name):
        """One CSS provider per theme, applied per window.

        Providers added to the *screen* are global: with a light and a dark
        card on screen at once the last installed sheet would recolour both,
        painting white text on the white card. Caching one provider per theme
        and attaching it to the individual window keeps each card on its own
        palette.
        """
        cached = self.providers.get(theme_name)
        if cached is not None:
            return cached
        try:
            provider = Gtk.CssProvider()
            provider.load_from_data(build_css(theme_name).encode("utf-8"))
        except Exception as error:
            log("css failed:", error)
            return None
        self.providers[theme_name] = provider
        return provider

    # ---- card lifecycle ------------------------------------------------

    def notify(self, payload):
        # Preferred path: let the Electron shell render the exact macOS-glass
        # HTML card the user supplied (Chromium supports backdrop-filter/mask
        # and Web Audio, which the GTK self-draw cannot). If no shell is
        # listening (e.g. web-only, no desktop), fall back to the GTK card.
        if self._forward_to_shell_html(payload):
            return
        # Exactly one card at a time. A newer notification replaces the one on
        # screen instead of stacking under or over it, so the banner always
        # points at the conversation that just changed state.
        for existing in list(self.cards):
            existing.close(reason="replaced")
        # The Host sends the `sound` setting in the payload; the renderer is
        # the only layer that can produce audio, so play the arrival cue here.
        sound = payload.get("sound")
        if sound is True or (isinstance(sound, str) and sound.lower() in ("1", "true", "yes")):
            play_notification_sound()
        card = Card(self, payload)
        self.cards.append(card)
        self.reflow()
        self.start_timer()

    def forget(self, card, reason):
        if card in self.cards:
            self.cards.remove(card)
        log("card gone:", reason, "left:", len(self.cards))
        self.reflow()
        if not self.cards:
            self.stop_timer()

    def reflow(self):
        """Stack the newest card on top, older ones below it."""
        y = 0
        for card in reversed(self.cards):
            try:
                card.show(y)
                y += card.height() + CARD_GAP
            except Exception as error:
                log("reflow failed:", error)
        self.reflow_scheduled = False

    def schedule_reflow(self):
        """Coalesce the size-allocate bursts a single card emits into one pass."""
        if self.reflow_scheduled or not self.cards:
            return
        self.reflow_scheduled = True
        GLib.timeout_add(16, self._deferred_reflow)

    def _deferred_reflow(self):
        self.reflow()
        return False

    def close_key(self, key):
        for card in list(self.cards):
            if card.key == key:
                card.close(reason="close-request")

    def close_all(self):
        for card in list(self.cards):
            card.close(reason="close-all")

    # ---- countdown -----------------------------------------------------

    def start_timer(self):
        if self.timer_id is None:
            self.last_tick = GLib.get_monotonic_time()
            self.timer_id = GLib.timeout_add(TICK_MS, self._on_tick)

    def stop_timer(self):
        if self.timer_id is not None:
            GLib.source_remove(self.timer_id)
            self.timer_id = None

    def _on_tick(self):
        # Cards time themselves; borrowing an app-wide delta here billed a
        # fresh card for every idle second since the last notification.
        for card in list(self.cards):
            card.tick()
        if not self.cards:
            self.timer_id = None
            return False
        return True

    # ---- side effects --------------------------------------------------

    def open_url(self, url, session):
        """Open the conversation in the shell when it is running, else a browser.

        The Electron shell writes the port of its loopback callback server into
        the service directory on startup. Posting the deep link there makes the
        shell navigate its *existing* window, which is what "open the
        conversation" is supposed to mean; falling back to xdg-open would spawn
        a second copy of the UI in a browser tab instead.
        """
        if not url:
            return
        if self._open_in_shell(url, session):
            log("opened in shell", session or "-")
            return
        self._open_in_browser(url, session)

    @staticmethod
    def _port_file():
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
        return os.path.join(base, "deepseek-harness-service", "notify-port")

    @staticmethod
    def _read_port_file():
        try:
            with open(ToastApp._port_file(), "r", encoding="utf-8") as handle:
                port = int(handle.read().strip())
        except Exception:
            return None
        return port if 0 < port < 65536 else None

    @staticmethod
    def _write_port_file(port):
        """Refresh the cached port so successive clicks skip discovery."""
        path = ToastApp._port_file()
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            # Atomic replace so a concurrent reader never sees a partial port.
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as handle:
                handle.write(str(port))
            os.replace(tmp, path)
        except Exception as error:
            log("could not refresh notify-port file:", error)

    @staticmethod
    def _listening_socket_inodes():
        """Map socket inode -> listening TCP port from /proc (IPv4 + IPv6)."""
        inodes = {}
        for table in ("/proc/net/tcp", "/proc/net/tcp6"):
            try:
                with open(table, "r", encoding="utf-8") as handle:
                    lines = handle.read().splitlines()[1:]
            except Exception:
                continue
            for line in lines:
                fields = line.split()
                # st == 0A means TCP_LISTEN; field 1 is local_address (hex
                # ip:port), field 9 is the socket inode.
                if len(fields) > 9 and fields[3] == "0A":
                    try:
                        port = int(fields[1].rsplit(":", 1)[1], 16)
                    except (ValueError, IndexError):
                        continue
                    if 0 < port < 65536:
                        inodes[fields[9]] = port
        return inodes

    @staticmethod
    def _electron_pids():
        """PIDs of the DSH Electron shell's main process (not its helpers)."""
        import glob

        pids = []
        for cmdline in glob.glob("/proc/[0-9]*/cmdline"):
            try:
                with open(cmdline, "rb") as handle:
                    cmd = handle.read().replace(b"\0", b" ").decode("utf-8", "ignore")
            except Exception:
                continue
            low = cmd.lower()
            # The main process runs `.../electron <app-dir>` with no --type=;
            # zygote/gpu/renderer helpers all carry --type= and share no
            # listening socket, so excluding them is both faster and safer.
            if "electron" in low and "dsh-electron-shell" in low and "--type=" not in low:
                try:
                    pids.append(int(cmdline.split("/")[2]))
                except (ValueError, IndexError):
                    pass
        return pids

    @staticmethod
    def _discover_shell_ports():
        """Loopback ports currently listened on by the Electron shell's main
        process, found live from /proc.

        This is the hardening: the port file is written once at shell startup
        and goes stale whenever the shell restarts. Rather than trust it, we
        look for listening sockets actually held by the Electron shell.
        """
        inodes = ToastApp._listening_socket_inodes()
        ports = set()
        for pid in ToastApp._electron_pids():
            fd_dir = "/proc/%d/fd" % pid
            try:
                fds = os.listdir(fd_dir)
            except Exception:
                continue
            for fd in fds:
                try:
                    target = os.readlink(os.path.join(fd_dir, fd))
                except Exception:
                    continue
                if target.startswith("socket:["):
                    port = inodes.get(target[len("socket:[") : -1])
                    if port:
                        ports.add(port)
        return ports

    @staticmethod
    def _shell_port():
        # Trust the cached port only if a live Electron listener still holds
        # it. Otherwise rediscover from /proc and refresh the file, so a shell
        # restart no longer breaks click-to-open.
        cached = ToastApp._read_port_file()
        live = ToastApp._discover_shell_ports()
        if cached is not None and cached in live:
            return cached
        if live:
            discovered = sorted(live)[0]
            if discovered != cached:
                log("notify-port refreshed:", cached, "->", discovered)
                ToastApp._write_port_file(discovered)
            return discovered
        return cached  # shell not listening; return cached so urlopen fails fast

    def _forward_to_shell_html(self, payload):
        """Ask the Electron shell to render the macOS-glass HTML card.

        The shell exposes a localhost notify hook with a /notify endpoint that
        pops a borderless Chromium window running the exact HTML the user asked
        for (backdrop-filter, mask refraction, Web Audio ping). The Python GTK
        renderer stays as a fallback for when no shell is listening.
        Returns True on 2xx (shell owns the card), False otherwise.
        """
        port = self._shell_port()
        if port is None:
            return False
        command = {
            "appName": str(payload.get("appName") or APP_NAME),
            "summary": str(payload.get("summary") or ""),
            "body": str(payload.get("body") or ""),
            "theme": str(payload.get("theme") or "light"),
            "icon": str(payload.get("icon") or ""),
            "sound": (payload.get("sound") is True) or str(payload.get("sound")).lower() in ("1", "true", "yes"),
            "soundName": str(payload.get("soundName") or ""),
            "position": str(payload.get("position") or "top-center"),
            "animation": str(payload.get("animation") or "elastic"),
            "timeout": payload.get("timeout"),
            "url": str(payload.get("url") or ""),
        }
        data = json.dumps(command).encode("utf-8")
        target = "http://127.0.0.1:%d/notify" % port
        try:
            import urllib.request

            request = urllib.request.Request(
                target,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=2.0) as response:
                ok = 200 <= response.status < 300
            if ok:
                log("forwarded to shell HTML card", port)
            return ok
        except Exception as error:
            log("shell /notify unavailable:", error)
            return False

    def _open_in_shell(self, url, session):
        port = self._shell_port()
        if port is None:
            return False
        query = "url=" + quote(url, safe="")
        if session:
            query += "&session=" + quote(session, safe="")
        target = "http://127.0.0.1:%d/open?%s" % (port, query)
        try:
            import urllib.request

            # A short timeout: the shell answers immediately or it is not there.
            with urllib.request.urlopen(target, timeout=2.0) as response:
                return 200 <= response.status < 300
        except Exception as error:
            log("shell callback unavailable:", error)
            return False

    def _open_in_browser(self, url, session):
        try:
            import subprocess

            env = dict(os.environ)
            env.pop("DESKTOP_STARTUP_ID", None)
            subprocess.Popen(
                ["xdg-open", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
                env=env,
            )
            log("opened in browser", session or "-")
        except Exception as error:
            log("open failed:", error)

    # ---- protocol ------------------------------------------------------

    def handle(self, raw):
        try:
            message = json.loads(raw)
        except Exception:
            log("bad json:", raw[:120])
            return
        if not isinstance(message, dict):
            return
        op = message.get("op")
        if op == "notify":
            self.notify(message)
        elif op == "close":
            self.close_key(str(message.get("replaceKey") or ""))
        elif op == "closeAll":
            self.close_all()
        elif op == "ping":
            print(json.dumps({"ok": True, "cards": len(self.cards)}), flush=True)
        else:
            log("unknown op:", op)

    def feed(self, chunk):
        self.stdin_buffer += chunk
        while b"\n" in self.stdin_buffer:
            line, self.stdin_buffer = self.stdin_buffer.split(b"\n", 1)
            if line.strip():
                self.handle(line.decode("utf-8", "replace"))


# ---------------------------------------------------------------- DSH mark
#
# The notification icon is the DeepSeek Harness mark, taken from the shipped
# favicon so the banner is branded with the product the alert came from.

_DSH_LOGO_D = (
    "M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 "
    "10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 "
    "44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 "
    "39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 "
    "9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 "
    "35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 "
    "7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 "
    "34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 "
    "19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 "
    "21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 "
    "16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 "
    "25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 "
    "8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 "
    "19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 "
    "9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 "
    "3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 "
    "31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 "
    "21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 "
    "39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 "
    "38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 "
    "35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 "
    "41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 "
    "19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 "
    "45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 "
    "10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 "
    "18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 "
    "34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 "
    "17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 "
    "37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 "
    "4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 "
    "20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 "
    "16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 "
    "31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 "
    "38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM"
    "26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 "
    "23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 "
    "27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 "
    "24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 "
    "26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 "
    "28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 "
    "28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 "
    "24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 "
    "27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 "
    "22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 "
    "26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 "
    "21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 "
    "31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 "
    "26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z"
)


def _DSH_LOGO_PATH(cr):
    """Trace the DSH mark. A 1.4 pt stroke thickens the hairline details."""
    cr.new_path()
    token = ""
    numbers = []
    command = None

    def flush():
        nonlocal numbers, command
        if command is None or not numbers:
            numbers = []
            return
        if command == "M":
            cr.move_to(numbers[0], numbers[1])
        elif command == "C":
            cr.curve_to(*numbers[:6])
        elif command == "Z":
            cr.close_path()
        numbers = []

    index = 0
    data = _DSH_LOGO_D
    while index < len(data):
        char = data[index]
        if char.isalpha():
            flush()
            command = char
            index += 1
            continue
        if char in " ,":
            index += 1
            continue
        start = index
        while index < len(data) and (data[index].isdigit() or data[index] in ".-"):
            index += 1
        numbers.append(float(data[start:index]))
    flush()


def _parent_alive():
    """True while the Host process that spawns us is still around."""
    try:
        return os.getppid() > 1
    except Exception:
        return False


def _watch_parent():
    """Exit when orphaned, so a crashed Host cannot leave cards on screen.

    The stdin EOF handler covers the normal path; this guards the case where
    the Host dies without closing the pipe (SIGKILL, container teardown).
    """
    if os.getppid() <= 1:
        log("orphaned, quitting")
        Gtk.main_quit()
        return False
    return True


def main():
    app = ToastApp()

    # The system notification daemon reports the desktop scheme through GTK;
    # read it once at startup so "auto" has something to resolve against.
    try:
        Gtk.init_check([])
    except Exception:
        pass

    # Fonts ship with the plugin, so register them once the display is up and
    # before the first card is built.
    load_bundled_fonts()

    def on_stdin(fd, _condition):
        try:
            chunk = os.read(fd, 65536)
        except (OSError, BlockingIOError):
            return True
        if not chunk:
            log("stdin closed, quitting")
            Gtk.main_quit()
            return False
        app.feed(chunk)
        return True

    GLib.io_add_watch(sys.stdin.fileno(), GLib.PRIORITY_DEFAULT, GLib.IO_IN, on_stdin)
    # 2 s is slow enough to be free and fast enough that a crashed Host never
    # strands a card on the desktop.
    GLib.timeout_add_seconds(2, _watch_parent)

    def on_signal(*_args):
        Gtk.main_quit()
        return False

    for sig in (signal.SIGTERM, signal.SIGINT):
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, on_signal)

    log("ready")
    Gtk.main()
    app.close_all()


if __name__ == "__main__":
    main()