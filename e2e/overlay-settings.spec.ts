import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  restartElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

test.describe("Overlay settings persistence", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-overlay-settings-e2e-", {
      env: { WFHELPER_NATIVE_WAYLAND: "1" },
    });
    page = harness.page;
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  const TOGGLES = ["relicRewardsOverlay", "rivenOverlay", "arbiSummaryOverlay"];

  function toggle(key: string) {
    return page.locator(`[data-setting="${key}"] input[type=checkbox]`);
  }

  async function openOverlayTab(): Promise<void> {
    await page.locator('#sidebar [data-view="settings"]').click();
    await page.locator('[data-tour-tab="overlay"]').click();
    await page.waitForTimeout(300);
  }

  test("overlay toggles survive a renderer reload", async () => {
    await openOverlayTab();

    const before: boolean[] = [];
    for (const key of TOGGLES) {
      const box = toggle(key);
      await expect(box).toHaveCount(1);
      before.push(await box.isChecked());
      await box.click();
      await page.waitForTimeout(250);
    }

    await page.reload();
    await page.waitForSelector("#sidebar");
    await openOverlayTab();

    for (let i = 0; i < TOGGLES.length; i++) {
      await expect(toggle(TOGGLES[i])).toBeChecked({ checked: !before[i] });
    }
  });

  test("Linux interaction setting reaches open Riven panels and survives reload", async () => {
    test.skip(process.platform !== "linux", "Linux interaction setting");
    await openOverlayTab();
    await toggle("rivenOverlay").check();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.api.getOverlaySettings().then((settings) => settings.rivenOverlayEnabled),
        ),
      )
      .toBe(true);
    await evaluateInMain(harness.app, ({ app }) => {
      const riven = process.mainModule!.require(
        `${app.getAppPath()}/.electron-build/ipc/rivenOverlayIpc`,
      ) as typeof import("../ipc/rivenOverlayIpc");
      riven.onRivenSessionOpen();
    });
    const button = page.locator("[data-linux-overlay-interaction]");
    await expect(button).toHaveText("Switch to interactive overlays");
    await button.click();
    await expect(button).toHaveText("Switch to click-through overlays");
    await expect
      .poll(() =>
        evaluateInMain(harness.app, ({ app }) => {
          const riven = process.mainModule!.require(
            `${app.getAppPath()}/.electron-build/ipc/rivenOverlayIpc`,
          ) as typeof import("../ipc/rivenOverlayIpc");
          return riven.isRivenInteractiveMode();
        }),
      )
      .toBe(true);
    const riven = harness.app.windows().find((window) => window.url().includes("side=left"));
    expect(riven).toBeDefined();
    await expect(riven!.locator("#btn-close")).toBeVisible();
    await expect(riven!.locator("#btn-rescan")).toBeVisible();
    await page.reload();
    await page.waitForSelector("#sidebar");
    await openOverlayTab();
    await expect(button).toHaveText("Switch to click-through overlays");
    harness = await restartElectronTestHarness(harness);
    page = harness.page;
    await evaluateInMain(harness.app, ({ app }) => {
      const riven = process.mainModule!.require(
        `${app.getAppPath()}/.electron-build/ipc/rivenOverlayIpc`,
      ) as typeof import("../ipc/rivenOverlayIpc");
      riven.onRivenSessionOpen();
    });
    await expect
      .poll(() => harness.app.windows().some((window) => window.url().includes("side=left")))
      .toBe(true);
    const reopened = harness.app.windows().find((window) => window.url().includes("side=left"))!;
    await expect(reopened.locator("#btn-close")).toBeVisible();
    await expect(reopened.locator("#btn-rescan")).toBeVisible();
    await openOverlayTab();
    await page.locator("[data-linux-overlay-interaction]").click();
    await expect(reopened.locator("#btn-close")).toBeHidden();
  });
});
