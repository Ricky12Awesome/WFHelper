// Which monitor holds the game, for overlays placed on it and for the screen
// copy that captures it.

import { layerOutputRects, layerToplevels } from "./layerShell";
import { withScope } from "./logger";
import { getWarframeWindowBoundsLinux, x11PositionDistrust } from "./warframeStatus";
import { pickWarframeWindow, resolveGameOutput } from "./waylandCompositor";

const outputLog = withScope("layerOutput");

/** Last resort where no compositor source identifies an output. Satellite's X11
 *  origin is not a desktop position and must never choose a monitor. */
async function outputFromGameBounds(): Promise<string | null> {
  if (x11PositionDistrust()) return null;
  const rects = layerOutputRects().filter((rect) => rect.placed && rect.width > 0);
  // One monitor cannot be the wrong monitor.
  if (rects.length < 2) return null;
  const bounds = await getWarframeWindowBoundsLinux();
  if (!bounds) return null;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const hit = rects.find(
    (rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height,
  );
  return hit?.name ?? null;
}

let loggedOutputSource: string | null = null;

function noteOutputSource(source: string, output: string | null): string | null {
  if (loggedOutputSource !== source) {
    loggedOutputSource = source;
    outputLog.info(`[LayerOutput] game monitor from ${source}: ${output ?? "unknown"}`);
  }
  return output;
}

/** The compositor sees native Wayland games that X11 cannot. Ask it before X11:
 *  a browser or Steam window can mention Warframe on an entirely different output. */
export async function resolveOutputForGame(): Promise<string | null> {
  const fromCompositor = await resolveGameOutput();
  if (fromCompositor) return noteOutputSource("compositor ipc", fromCompositor);

  const game = pickWarframeWindow(layerToplevels() ?? []);
  if (game?.outputs.length === 1) {
    return noteOutputSource("foreign toplevel", game.outputs[0]);
  }
  const fromBounds = await outputFromGameBounds();
  return noteOutputSource("the game window rect", fromBounds);
}
