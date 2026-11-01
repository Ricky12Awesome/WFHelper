// An X11 globalShortcut grab never sees keys delivered to a native Wayland
// game or layer surface. Register the interaction key with Hyprland itself.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { OVERLAY_INTERACTION_TOGGLE_ARG } from "./launchArgs";

interface ShortcutBackend {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

interface HyprBinding {
  modmask: number;
  key: string;
  keycode?: number;
  description?: string;
  dispatcher?: string;
  arg?: string;
}

interface Key {
  mods: string;
  mask: number;
  name: string;
  keycode?: number;
}

const MODIFIERS: Record<string, [string, number]> = {
  ctrl: ["CTRL", 4],
  control: ["CTRL", 4],
  commandorcontrol: ["CTRL", 4],
  alt: ["ALT", 8],
  option: ["ALT", 8],
  shift: ["SHIFT", 1],
  super: ["SUPER", 64],
  meta: ["SUPER", 64],
  command: ["SUPER", 64],
};
const KEYS: Record<string, string> = {
  enter: "Return",
  return: "Return",
  escape: "Escape",
  esc: "Escape",
  space: "space",
  tab: "Tab",
  backspace: "BackSpace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "Prior",
  pagedown: "Next",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  plus: "plus",
};

function parseKey(accelerator: string): Key | null {
  const parts = accelerator
    .toLowerCase()
    .split("+")
    .map((part) => part.trim());
  const rawKey = parts.pop() ?? "";
  const mods = new Set<string>();
  let mask = 0;
  for (const part of parts) {
    const modifier = MODIFIERS[part];
    if (!modifier) return null;
    mods.add(modifier[0]);
    mask |= modifier[1];
  }
  const fn = /^f([1-9]|1\d|2[0-4])$/.exec(rawKey);
  const name = fn
    ? rawKey.toUpperCase()
    : (KEYS[rawKey] ?? (/^[a-z0-9]$/.test(rawKey) ? rawKey : null));
  if (!name) return null;
  // Hyprland also accepts physical code: bindings; do not shadow one for the
  // same function key just because its `key` field is empty.
  const f = fn ? Number(fn[1]) : 0;
  const keycode = f >= 1 && f <= 10 ? 66 + f : f === 11 ? 95 : f === 12 ? 96 : undefined;
  return { mods: [...mods].join(" "), mask, name, keycode };
}

function shellQuote(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Invalid shortcut launch path");
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function luaQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function luaKey(key: Key): string {
  return [...key.mods.split(" ").filter(Boolean), key.name].join(" + ");
}

export function interactionToggleCommand(options: {
  executable: string;
  appPath: string;
  userData: string;
  packaged: boolean;
  appImage?: string;
}): string {
  const executable = options.appImage || options.executable;
  const args = options.packaged || options.appImage ? [] : [options.appPath];
  // The compositor's environment can differ from the running app's. Target its
  // exact profile, or Electron would acquire a different single-instance lock.
  return [
    "env",
    "-u",
    "ELECTRON_RUN_AS_NODE",
    shellQuote(`WFHELPER_USER_DATA=${options.userData}`),
    ...[executable, ...args, OVERLAY_INTERACTION_TOGGLE_ARG].map(shellQuote),
  ].join(" ");
}

function watchHyprlandReload(env: NodeJS.ProcessEnv, onReload: () => void): () => void {
  const socket = net.connect(
    path.join(env.XDG_RUNTIME_DIR!, "hypr", env.HYPRLAND_INSTANCE_SIGNATURE!, ".socket2.sock"),
  );
  socket.unref();
  socket.setEncoding("utf8");
  let pending = "";
  socket.on("data", (data: string) => {
    pending += data;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) if (line.startsWith("configreloaded>>")) onReload();
  });
  socket.on("error", () => socket.destroy());
  return () => socket.destroy();
}

export function createHyprlandInteractionShortcut(options: {
  fallback: ShortcutBackend;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  platform?: string;
  env?: NodeJS.ProcessEnv;
  userData: () => string;
  command: () => string;
  run?: (args: string[]) => string;
  watchReload?: (onReload: () => void) => () => void;
}): ShortcutBackend & { dispose(): void } {
  const env = options.env ?? process.env;
  const native =
    (options.platform ?? process.platform) === "linux" &&
    !!env.HYPRLAND_INSTANCE_SIGNATURE &&
    !!env.XDG_RUNTIME_DIR;
  const run =
    options.run ?? ((args) => execFileSync("hyprctl", args, { encoding: "utf8", timeout: 1000 }));
  let active: { accelerator: string; key: Key; command: string; description: string } | null = null;
  let stopWatch: (() => void) | null = null;
  let lua = false;

  function change(legacy: string[], code: string): void {
    if (!lua) {
      const result = run(["keyword", ...legacy]).trim();
      if (/non-legacy parsers/.test(result)) lua = true;
      else {
        if (result !== "ok") throw new Error(result);
        return;
      }
    }
    const result = run(["eval", code]).trim();
    if (result !== "ok") throw new Error(result);
  }

  function remove(key: Key): void {
    change(["unbind", `${key.mods},${key.name}`], `hl.unbind(${luaQuote(luaKey(key))})`);
  }

  function matching(key: Key): HyprBinding[] {
    const rows: unknown = JSON.parse(run(["-j", "binds"]));
    if (!Array.isArray(rows)) throw new Error("Invalid Hyprland bindings response");
    return (rows as HyprBinding[]).filter(
      (binding) =>
        binding.modmask === key.mask &&
        (binding.key.toLowerCase() === key.name.toLowerCase() ||
          (key.keycode !== undefined && binding.keycode === key.keycode)),
    );
  }

  function install(binding: NonNullable<typeof active>): boolean {
    const existing = matching(binding.key);
    if (existing.some((row) => row.description !== binding.description)) {
      options.log.warn(
        "[OverlayInteractionHotkey] Hyprland key already bound:",
        binding.accelerator,
      );
      return false;
    }
    // Recover an identical binding left by a crash without duplicating it.
    if (
      existing.length === 1 &&
      existing[0].dispatcher === "exec" &&
      existing[0].arg === binding.command
    )
      return true;
    if (existing.length) remove(binding.key);
    change(
      [
        "binddi",
        `${binding.key.mods},${binding.key.name},${binding.description},exec,${binding.command}`,
      ],
      `hl.bind(${luaQuote(luaKey(binding.key))}, hl.dsp.exec_cmd(${luaQuote(binding.command)}), {dont_inhibit = true, description = ${luaQuote(binding.description)}})`,
    );
    return true;
  }

  function unregister(accelerator: string): void {
    if (!native) return options.fallback.unregister(accelerator);
    if (!active || active.accelerator !== accelerator) return;
    const binding = active;
    active = null;
    stopWatch?.();
    stopWatch = null;
    try {
      const rows = matching(binding.key);
      // `unbind` removes every binding for the key. Do not remove a user's
      // replacement or another binding added after we registered ours.
      if (rows.length && rows.every((row) => row.description === binding.description)) {
        remove(binding.key);
      }
    } catch (err) {
      options.log.warn("[OverlayInteractionHotkey] Hyprland unbind failed:", String(err));
    }
  }

  return {
    register(accelerator, callback): boolean {
      if (!native) return options.fallback.register(accelerator, callback);
      const key = parseKey(accelerator);
      if (!key) return false;
      if (active) unregister(active.accelerator);
      try {
        const owner = createHash("sha256").update(options.userData()).digest("hex").slice(0, 12);
        const binding = {
          accelerator,
          key,
          command: options.command(),
          description: `WFHelper interaction ${owner}`,
        };
        if (!install(binding)) return false;
        active = binding;
        stopWatch = (options.watchReload ?? ((onReload) => watchHyprlandReload(env, onReload)))(
          () => {
            if (!active) return;
            try {
              install(active);
            } catch (err) {
              options.log.warn("[OverlayInteractionHotkey] Hyprland rebind failed:", String(err));
            }
          },
        );
        options.log.info("[OverlayInteractionHotkey] Hyprland binding:", accelerator);
        return true;
      } catch (err) {
        options.log.warn("[OverlayInteractionHotkey] Hyprland registration failed:", String(err));
        return false;
      }
    },
    unregister,
    dispose(): void {
      if (active) unregister(active.accelerator);
    },
  };
}
