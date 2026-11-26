import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isModuleFetchError,
  reloadFailedView,
  takeReloadView,
} from "../../../src/lib/lazyViewRecovery.js";

const KEY = "wf_lazy_view_reload";

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(() => {
      value = null;
    }),
    value: () => value,
  };
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", storage());
  vi.stubGlobal("location", { reload: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isModuleFetchError", () => {
  it("classifies the reported Chrome file URL error", () => {
    expect(
      isModuleFetchError(
        "Failed to fetch dynamically imported module: file:///opt/wfhelper/resources/app.asar/dist/assets/MarketView.js",
      ),
    ).toBe(true);
  });

  it.each([
    "Error loading dynamically imported module: file:///app/assets/MarketView.js",
    "Importing a module script failed.",
    "Loading chunk MarketView-btuHF2eg failed",
  ])("recognizes browser module-fetch variant: %s", (message) => {
    expect(isModuleFetchError(message)).toBe(true);
  });

  it.each([
    "GET https://api.example.test/items 500 (Internal Server Error)",
    "TypeError: Cannot read properties of undefined",
    "Failed to fetch https://api.example.test/items",
  ])("does not classify ordinary API/runtime errors: %s", (message) => {
    expect(isModuleFetchError(message)).toBe(false);
  });

  it("does not reload automatically when it identifies a module fetch error", () => {
    expect(
      isModuleFetchError("Failed to fetch dynamically imported module: file:///app/view.js"),
    ).toBe(true);
    expect(location.reload).not.toHaveBeenCalled();
  });
});

describe("explicit view recovery", () => {
  it("remembers the requested view and reloads", () => {
    const session = storage();
    vi.stubGlobal("sessionStorage", session);
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });

    reloadFailedView("market");

    expect(session.setItem).toHaveBeenCalledWith(KEY, "market");
    expect(session.value()).toBe("market");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("consumes the remembered view exactly once", () => {
    const session = storage("market");
    vi.stubGlobal("sessionStorage", session);

    expect(takeReloadView()).toBe("market");
    expect(session.removeItem).toHaveBeenCalledWith(KEY);
    expect(session.value()).toBeNull();
    expect(takeReloadView()).toBeNull();
  });

  it("rejects and clears an unknown navigation target", () => {
    const session = storage("not-a-view");
    vi.stubGlobal("sessionStorage", session);

    expect(takeReloadView()).toBeNull();
    expect(session.removeItem).toHaveBeenCalledWith(KEY);
  });

  it("still reloads if session storage is blocked", () => {
    const reload = vi.fn();
    vi.stubGlobal("sessionStorage", {
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    vi.stubGlobal("location", { reload });

    expect(() => reloadFailedView("market")).not.toThrow();
    expect(reload).toHaveBeenCalledOnce();
  });
});
