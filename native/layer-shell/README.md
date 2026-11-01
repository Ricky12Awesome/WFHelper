# layer-shell addon

Optional. Built only by `scripts/build-layer-shell.mjs` on Linux, never during
`pnpm install`, and the build is allowed to fail: without the `.node` the app
uses ordinary BrowserWindow overlays exactly as before.

`wlr-layer-shell-unstable-v1.xml` is vendored because it ships with wlroots and
is in no Debian package. `wlr-foreign-toplevel-management-unstable-v1.xml`, which
backs `toplevels()`, and `wlr-screencopy-unstable-v1.xml`, which backs the
`screencopy*()` capture, are vendored for the same reason. Generated code also needs
`xdg-shell-protocol.c` from `wayland-protocols`, or the link fails on
`xdg_popup_interface`.

The addon uses its own Wayland connection, including when Electron runs on X11.
`setInteractive(handle, enabled, focus)` changes the surface's input region and
takes exclusive keyboard focus only for explicit interaction. This releases a
fullscreen game's pointer lock; an input region alone cannot do that. Disabling
interaction releases focus. Always-clickable panels can accept mouse input with
`focus` false so appearing does not interrupt the game.

Develop against a throwaway compositor rather than a desktop session:

    WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 sway -c /dev/null
