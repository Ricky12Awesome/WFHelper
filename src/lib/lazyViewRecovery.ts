import { VIEW_NAMES, type ViewName } from "../types/views.js";

const RELOAD_VIEW_KEY = "wf_lazy_view_reload";

/** After a rebuild, an open window may still import old chunk URLs. Reloading
 *  reads the current entry point instead of retrying those URLs. */
export function isModuleFetchError(message: string): boolean {
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk [\w-]+ failed/i.test(
    message,
  );
}

/** Reload only on the user's explicit recovery action; background prefetch
 *  errors must never interrupt an order or another form they are editing. */
export function reloadFailedView(view: ViewName): void {
  try {
    sessionStorage.setItem(RELOAD_VIEW_KEY, view);
  } catch {
    // A reload still clears the failed module cache if storage is unavailable.
  }
  location.reload();
}

/** One-shot navigation target, local to this window rather than other windows
 *  or future launches. Normal startup and workspace restoration stay intact. */
export function takeReloadView(): ViewName | null {
  try {
    const view = sessionStorage.getItem(RELOAD_VIEW_KEY);
    sessionStorage.removeItem(RELOAD_VIEW_KEY);
    return VIEW_NAMES.find((candidate) => candidate === view) ?? null;
  } catch {
    return null;
  }
}
