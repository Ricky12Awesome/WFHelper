import { describe, expect, it, vi } from "vitest";

import {
  createHyprlandInteractionShortcut,
  interactionToggleCommand,
} from "../../services/hyprlandInteractionShortcut";

interface Binding {
  modmask: number;
  key: string;
  keycode?: number;
  description?: string;
  dispatcher?: string;
  arg?: string;
}

function build(
  initial: Binding[] = [],
  command = "env WFHELPER_USER_DATA='/profile' '/app' --toggle-overlay-interaction",
) {
  const binds = [...initial];
  const calls: string[][] = [];
  const run = vi.fn((args: string[]) => {
    calls.push(args);
    if (args[0] === "-j" && args[1] === "binds") return JSON.stringify(binds);
    if (args[0] !== "keyword") throw new Error(`unexpected command: ${args.join(" ")}`);
    if (args[1] === "unbind") {
      const [, key] = args[2].split(",");
      const matches = binds.filter((binding) => binding.key.toLowerCase() === key.toLowerCase());
      for (const binding of matches) binds.splice(binds.indexOf(binding), 1);
      return "ok";
    }
    if (args[1] === "binddi") {
      const [mods, key, description, dispatcher, ...command] = args[2].split(",");
      const mask = mods
        .split(" ")
        .reduce((value, mod) => value | ({ CTRL: 4, ALT: 8, SHIFT: 1, SUPER: 64 }[mod] ?? 0), 0);
      binds.push({ modmask: mask, key, description, dispatcher, arg: command.join(",") });
      return "ok";
    }
    throw new Error(`unexpected keyword: ${args[1]}`);
  });
  const fallback = { register: vi.fn(() => true), unregister: vi.fn() };
  const watchReload = vi.fn((_callback: () => void) => vi.fn());
  const log = { info: vi.fn(), warn: vi.fn() };
  const shortcut = createHyprlandInteractionShortcut({
    fallback,
    log,
    platform: "linux",
    env: { HYPRLAND_INSTANCE_SIGNATURE: "test", XDG_RUNTIME_DIR: "/run/user/1000" },
    userData: () => "/profile",
    command: () => command,
    run,
    watchReload,
  });
  return { shortcut, binds, calls, fallback, log, run, watchReload };
}

describe("Hyprland interaction shortcut", () => {
  it("uses Lua bind and unbind on modern Hyprland without falling back to an X11 grab", () => {
    let rows: Binding[] = [];
    const command = interactionToggleCommand({
      executable: "/opt/WF Helper/app",
      appPath: "/unused",
      userData: '/a"b\\c',
      packaged: true,
    });
    const run = vi.fn((args: string[]) => {
      if (args[0] === "-j") return JSON.stringify(rows);
      if (args[0] === "keyword") return "keyword can't work with non-legacy parsers. Use eval.";
      if (args[0] === "eval" && args[1].startsWith("hl.bind(")) {
        expect(args[1]).toContain('hl.bind("CTRL + F7", hl.dsp.exec_cmd(');
        expect(args[1]).toContain(JSON.stringify(command));
        expect(args[1]).toContain("dont_inhibit = true");
        rows = [
          {
            modmask: 4,
            key: "F7",
            description: /description = "([^"]+)"/.exec(args[1])![1],
            dispatcher: "__lua",
            arg: "26",
          },
        ];
        return "ok";
      }
      if (args[0] === "eval" && args[1] === 'hl.unbind("CTRL + F7")') {
        rows = [];
        return "ok";
      }
      throw new Error("unexpected command");
    });
    const fallback = { register: vi.fn(() => true), unregister: vi.fn() };
    const shortcut = createHyprlandInteractionShortcut({
      fallback,
      log: { info: vi.fn(), warn: vi.fn() },
      platform: "linux",
      env: { HYPRLAND_INSTANCE_SIGNATURE: "test", XDG_RUNTIME_DIR: "/run/user/1000" },
      userData: () => "/profile",
      command: () => command,
      run,
      watchReload: () => () => {},
    });
    expect(shortcut.register("Control+F7", vi.fn())).toBe(true);
    expect(rows).toHaveLength(1);
    shortcut.dispose();
    expect(rows).toHaveLength(0);
    expect(run.mock.calls.filter(([args]) => args[0] === "keyword")).toHaveLength(1);
    expect(fallback.register).not.toHaveBeenCalled();
  });

  it("reports a rejected compositor binding as a failure, without a misleading X11 fallback", () => {
    const probe = build();
    probe.run.mockImplementation((args) => (args[0] === "-j" ? "[]" : "invalid key"));
    expect(probe.shortcut.register("F7", vi.fn())).toBe(false);
    expect(probe.fallback.register).not.toHaveBeenCalled();
    expect(probe.watchReload).not.toHaveBeenCalled();
  });

  it("registers F7 as a native binddi exec of the existing toggle CLI", () => {
    const probe = build();
    expect(probe.shortcut.register("F7", vi.fn())).toBe(true);
    expect(probe.calls).toContainEqual([
      "keyword",
      "binddi",
      expect.stringContaining(",F7,WFHelper interaction "),
    ]);
    expect(probe.binds).toHaveLength(1);
    expect(probe.binds[0]).toMatchObject({
      key: "F7",
      dispatcher: "exec",
      arg: "env WFHELPER_USER_DATA='/profile' '/app' --toggle-overlay-interaction",
    });
  });

  it.each([
    ["Control+Alt+F7", "CTRL ALT", 12],
    ["Super+Shift+F7", "SUPER SHIFT", 65],
    ["CommandOrControl+F7", "CTRL", 4],
  ])("translates %s modifiers for Hyprland", (accelerator, mods, mask) => {
    const probe = build();
    expect(probe.shortcut.register(accelerator, vi.fn())).toBe(true);
    expect(
      probe.calls.some(
        ([kind, op, payload]) =>
          kind === "keyword" && op === "binddi" && payload.startsWith(`${mods},F7,`),
      ),
    ).toBe(true);
    expect(probe.binds).toHaveLength(1);
    expect(probe.binds[0].modmask).toBe(mask);
  });

  it("quotes packaged, AppImage, and development launch commands safely", () => {
    expect(
      interactionToggleCommand({
        executable: "/opt/WF Helper/wfhelper",
        appPath: "/source/app.asar",
        userData: "/profile dir",
        packaged: true,
      }),
    ).toBe(
      "env -u ELECTRON_RUN_AS_NODE 'WFHELPER_USER_DATA=/profile dir' '/opt/WF Helper/wfhelper' '--toggle-overlay-interaction'",
    );
    expect(
      interactionToggleCommand({
        executable: "/usr/bin/electron",
        appImage: "/tmp/WF's.AppImage",
        appPath: "/src/app",
        userData: "/profile",
        packaged: true,
      }),
    ).toBe(
      "env -u ELECTRON_RUN_AS_NODE 'WFHELPER_USER_DATA=/profile' '/tmp/WF'\\''s.AppImage' '--toggle-overlay-interaction'",
    );
    expect(
      interactionToggleCommand({
        executable: "/usr/bin/electron",
        appPath: "/src/My App",
        userData: "/profile",
        packaged: false,
      }),
    ).toBe(
      "env -u ELECTRON_RUN_AS_NODE 'WFHELPER_USER_DATA=/profile' '/usr/bin/electron' '/src/My App' '--toggle-overlay-interaction'",
    );
  });

  it("refuses a user F7 binding by key name or physical keycode", () => {
    for (const userBinding of [
      { modmask: 0, key: "F7", dispatcher: "exec", arg: "user-command" },
      { modmask: 0, key: "", keycode: 73, dispatcher: "exec", arg: "user-command" },
    ]) {
      const probe = build([userBinding]);
      expect(probe.shortcut.register("F7", vi.fn())).toBe(false);
      expect(probe.binds).toEqual([userBinding]);
    }
  });

  it("refuses an existing binding in another submap", () => {
    const probe = build([{ modmask: 0, key: "F7", submap: "resize" } as Binding]);
    expect(probe.shortcut.register("F7", vi.fn())).toBe(false);
  });

  it("does not unbind a user replacement when unregistering", () => {
    const probe = build();
    probe.shortcut.register("F7", vi.fn());
    probe.binds[0] = { modmask: 0, key: "F7", dispatcher: "exec", arg: "user replacement" };
    probe.shortcut.unregister("F7");
    expect(probe.binds).toEqual([
      { modmask: 0, key: "F7", dispatcher: "exec", arg: "user replacement" },
    ]);
    expect(
      probe.calls.filter((args) => args[0] === "keyword" && args[1] === "unbind"),
    ).toHaveLength(0);
  });

  it("recovers an identical owned bind without adding a duplicate", () => {
    const description = "WFHelper interaction 55d685028857";
    const command = "env WFHELPER_USER_DATA='/profile' '/app' --toggle-overlay-interaction";
    const probe = build(
      [{ modmask: 0, key: "F7", description, dispatcher: "exec", arg: command }],
      command,
    );
    expect(probe.shortcut.register("F7", vi.fn())).toBe(true);
    expect(probe.binds).toHaveLength(1);
  });

  it("recreates a removed owned binding after a compositor config reload", () => {
    const probe = build();
    expect(probe.shortcut.register("F7", vi.fn())).toBe(true);
    const onReload = probe.watchReload.mock.calls[0][0];
    probe.binds.splice(0, 1);
    onReload();
    expect(probe.binds).toHaveLength(1);
    expect(probe.binds[0]).toMatchObject({ key: "F7", dispatcher: "exec" });
  });

  it("uses the fallback backend outside a Hyprland session", () => {
    const fallback = { register: vi.fn(() => true), unregister: vi.fn() };
    const shortcut = createHyprlandInteractionShortcut({
      fallback,
      log: { info: vi.fn(), warn: vi.fn() },
      platform: "linux",
      env: {},
      userData: () => "/profile",
      command: () => "unused",
      run: vi.fn(() => {
        throw new Error("must not run");
      }),
      watchReload: vi.fn(() => vi.fn()),
    });
    const callback = vi.fn();
    expect(shortcut.register("F7", callback)).toBe(true);
    shortcut.unregister("F7");
    expect(fallback.register).toHaveBeenCalledWith("F7", callback);
    expect(fallback.unregister).toHaveBeenCalledWith("F7");
  });
});
