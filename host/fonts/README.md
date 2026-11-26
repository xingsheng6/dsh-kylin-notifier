# Bundled fonts

The notification card draws with these fonts instead of whatever fontconfig
happens to pick, so the banner looks the same on every machine the plugin runs
on — Kylin, Ubuntu, Debian, with or without Noto packages installed.

| File | Family | Weights | Source |
|---|---|---|---|
| `Inter-Regular.ttf` … `Inter-Bold.ttf` | Inter | 400 / 500 / 600 / 700 | [Google Fonts – Inter](https://fonts.google.com/specimen/Inter) |
| `NotoSansSC-*.ttf` | Noto Sans SC (subset) | 400 / 500 / 700 | [Google Fonts – Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC) |

## Why Inter instead of San Francisco

macOS banners use SF Pro, which is Apple's own typeface. Its licence only
covers use on Apple devices and forbids redistributing the font files, so it
cannot ship inside this plugin. Inter is the closest open equivalent: same
neutral UI proportions and x-height, designed for small-size interface text.

## Why the Simplified Chinese files are so small

SF Pro has no CJK coverage, and a full Noto Sans SC is ~10 MB per weight. The
plugin only ever renders a handful of fixed strings (status text plus the
conversation title), so the Chinese faces were subset to those glyphs plus
basic ASCII and punctuation. See `SUBSET_CHARS` in `bridge/toast_window.py`
for the exact character set — **if you add new UI strings containing new
characters, regenerate the subsets**, otherwise those glyphs fall back to the
system font.

## Licences

Both families are licensed under the SIL Open Font License 1.1, which permits
bundling and redistribution provided the licence travels with the font and the
fonts are not sold on their own.

- Inter — <https://github.com/rsms/inter/blob/master/LICENSE.txt>
- Noto Sans SC — <https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE>
