import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveOutputForGame } from "../../services/gameOutput";
import type { WaylandToplevel } from "../../services/layerShell";

const probes = vi.hoisted(() => ({
  compositor: vi.fn(),
  bounds: vi.fn(),
  distrust: vi.fn(),
  toplevels: [] as WaylandToplevel[],
}));

vi.mock("../../services/waylandCompositor", async (original) => ({
  ...(await original<typeof import("../../services/waylandCompositor")>()),
  resolveGameOutput: probes.compositor,
}));
vi.mock("../../services/warframeStatus", () => ({
  getWarframeWindowBoundsLinux: probes.bounds,
  x11PositionDistrust: probes.distrust,
}));
vi.mock("../../services/layerShell", () => ({
  layerToplevels: () => probes.toplevels,
  layerOutputRects: () => [
    { name: "DP-1", x: 2560, y: 0, width: 2560, height: 1440, placed: true },
    { name: "DP-2", x: 0, y: 0, width: 2560, height: 1440, placed: true },
  ],
}));

beforeEach(() => {
  vi.clearAllMocks();
  probes.compositor.mockResolvedValue(null);
  probes.bounds.mockResolvedValue(null);
  probes.distrust.mockReturnValue(null);
  probes.toplevels = [];
});

describe("game capture output", () => {
  it("uses the native game's compositor output before any X11 window rect", async () => {
    // Regression: native Warframe on HDR DP-1, X11 browser on SDR DP-2.
    probes.compositor.mockResolvedValue("DP-1");
    probes.bounds.mockResolvedValue({ x: 0, y: 0, width: 2560, height: 1440 });

    expect(await resolveOutputForGame()).toBe("DP-1");
    expect(probes.bounds).not.toHaveBeenCalled();
  });

  it("uses the game's foreign toplevel output without needing window geometry", async () => {
    probes.toplevels = [
      {
        title: "Warframe",
        appId: "steam_app_230410",
        activated: true,
        fullscreen: false,
        outputs: ["DP-1"],
      },
    ];
    probes.bounds.mockResolvedValue({ x: 0, y: 0, width: 2560, height: 1440 });

    expect(await resolveOutputForGame()).toBe("DP-1");
    expect(probes.bounds).not.toHaveBeenCalled();
  });

  it("does not choose a browser toplevel that only mentions Warframe", async () => {
    probes.toplevels = [
      {
        title: "Warframe Wiki",
        appId: "firefox",
        activated: true,
        fullscreen: true,
        outputs: ["DP-2"],
      },
    ];
    expect(await resolveOutputForGame()).toBeNull();
  });

  it("falls back to trusted game geometry when no compositor output is known", async () => {
    probes.bounds.mockResolvedValue({ x: 2800, y: 60, width: 1280, height: 720 });
    expect(await resolveOutputForGame()).toBe("DP-1");
  });

  it("never maps a satellite origin to a monitor", async () => {
    probes.distrust.mockReturnValue("xwayland-satellite is running");
    probes.bounds.mockResolvedValue({ x: 0, y: 0, width: 1280, height: 720 });
    expect(await resolveOutputForGame()).toBeNull();
    expect(probes.bounds).not.toHaveBeenCalled();
  });

  it("does not keep an old monitor after the game moves", async () => {
    probes.compositor.mockResolvedValueOnce("DP-1").mockResolvedValueOnce("DP-2");
    expect(await resolveOutputForGame()).toBe("DP-1");
    expect(await resolveOutputForGame()).toBe("DP-2");
  });
});
