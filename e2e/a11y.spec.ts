import { expect, test, type Page } from "@playwright/test";

import {
  assertHiddenElementsDoNotPaint,
  boot,
  driveAllStates,
  expectBaselineNotStale,
  expectNoHorizontalOverflow,
  NARROW,
  reportCollected,
  settle,
  watchPageErrors,
} from "./gate";

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  pageErrors.set(page, watchPageErrors(page));
});

test.afterEach(async ({ page }) => {
  const errors = pageErrors.get(page) ?? [];
  expect(errors, errors.join("\n")).toEqual([]);
});

const comprehensiveCases = [
  { osScheme: "dark", viewport: undefined, label: "dark OS preference" },
  {
    osScheme: "light",
    viewport: NARROW,
    label: "light OS preference at 380px",
  },
] as const;

for (const { osScheme, viewport, label } of comprehensiveCases) {
  test(`all DC-net states pass WCAG A/AA under ${label}`, async ({ page }) => {
    test.setTimeout(900_000);
    if (viewport) await page.setViewportSize(viewport);
    await boot(page, osScheme);
    await driveAllStates(page, label);
    expectBaselineNotStale();
    reportCollected();
  });
}

for (const width of [320, 380, 390, 768, 1440]) {
  test(`all exhibits reflow without page-level clipping at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: 900 });
    await boot(page, "dark");

    for (const panel of [
      "round",
      "views",
      "collisions",
      "disruption",
      "reuse",
    ]) {
      await page.locator(`#tab-${panel}`).click();
      await expect(page.locator(`#panel-${panel}`)).toBeVisible();
      await settle(page);
      await assertHiddenElementsDoNotPaint(page, `${panel} at ${width}px`);
      await expectNoHorizontalOverflow(page, `${panel} at ${width}px`);
    }

    await page.locator("#tab-disruption").click();
    await page.locator("#commit-button").click();
    await expect(
      page.locator('#commit-output[data-stale="false"]'),
    ).toHaveCount(1);
    await expectNoHorizontalOverflow(page, `commitment evidence at ${width}px`);
    await expect(
      page.getByRole("heading", {
        name: "What this round does—and does not—establish",
      }),
    ).toBeVisible();
  });
}

test("skip link, tabs, forms, disclosure, and hidden panels obey keyboard contracts", async ({
  page,
}) => {
  await page.goto(".");
  await page.keyboard.press("Tab");
  await expect(page.locator(".cl-skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#app")).toBeFocused();

  const round = page.locator("#tab-round");
  await round.focus();
  await expect(round).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-views")).toBeFocused();
  await expect(page.locator("#panel-views")).toBeVisible();
  await expect(page.locator("#panel-round")).toBeHidden();

  await page.keyboard.press("End");
  await expect(page.locator("#tab-reuse")).toBeFocused();
  await expect(page.locator("#panel-reuse")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(round).toBeFocused();
  await expect(page.locator("#panel-round")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#tab-reuse")).toBeFocused();
  await expect(page.locator("#panel-reuse")).toBeVisible();

  await expect(
    page.locator(
      '[role="tabpanel"][hidden] :is(a,button,input,select,textarea,summary):visible',
    ),
  ).toHaveCount(0);

  const summary = page.locator("details > summary");
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("details")).toHaveAttribute("open", "");
});

test("project links are keyboard reachable from a fresh document", async ({
  page,
}) => {
  await page.goto(".");
  await page.keyboard.press("Tab");
  await expect(page.locator(".cl-skip-link")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "CL Crypto Lab systemslibrarian.dev home" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Crypto Lab menu" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "View this project on GitHub" }),
  ).toBeFocused();
});

test("status and output regions announce stale, refusal, and recomputed states", async ({
  page,
}) => {
  await page.goto(".");
  const statuses = page.locator(
    '[role="status"][aria-live="polite"][aria-atomic="true"]',
  );
  await expect(statuses).toHaveCount(6);
  const outputs = page.locator('.output[aria-live="polite"]');
  await expect(outputs).toHaveCount(6);

  const message = page.locator("#round-message");
  await message.fill("49");
  await expect(page.locator("#round-status")).toContainText("stale");
  await expect(page.locator("#round-output")).toHaveAttribute(
    "data-stale",
    "true",
  );
  await message.fill("gg");
  await page.getByRole("button", { name: "Run with fresh masks" }).click();
  await expect(page.locator("#round-status")).toContainText(
    "Prior evidence remains stale",
  );
  await message.fill("7f");
  await page.getByRole("button", { name: "Run with fresh masks" }).click();
  await expect(page.locator("#round-status")).toContainText(
    "evidence computed",
  );
  await expect(page.locator("#round-output")).toHaveAttribute(
    "data-stale",
    "false",
  );
});

test("fleet chrome, bounded hero, and teaching footer remain present", async ({
  page,
}) => {
  await page.goto(".");
  await expect(page).toHaveTitle("DC-net — crypto-lab");
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.locator("h1.cl-hero-title")).toHaveText("DC-net");
  await expect(page.locator(".cl-hero-sub")).toContainText(
    "Dining cryptographers",
  );
  await expect(page.locator(".cl-hero-why-label")).toHaveText("WHY IT MATTERS");
  await expect(page.locator(".scope-banner")).toContainText(
    "Bounded teaching model",
  );
  await expect(page.locator(".scripture-footer")).toContainText(
    "do it all for the glory of God",
  );
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    /^data:image\/svg\+xml/,
  );
  expect(
    await page.evaluate(() => ({
      attribute: document.documentElement.dataset.theme,
      stored: localStorage.getItem("theme"),
    })),
  ).toEqual({ attribute: "dark", stored: "dark" });
});

test("reduced-motion preference disables smooth scrolling and transitions", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(".");
  const styles = await page.evaluate(() => ({
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    transitions: Array.from(
      document.querySelectorAll<HTMLElement>("button,a,summary"),
    )
      .filter((element) => element.checkVisibility?.())
      .flatMap((element) =>
        getComputedStyle(element)
          .transitionDuration.split(",")
          .map((duration) => {
            const value = Number.parseFloat(duration);
            return duration.trim().endsWith("ms") ? value / 1_000 : value;
          }),
      ),
    animations: Array.from(document.getAnimations()).filter(
      (animation) => animation.playState === "running",
    ).length,
  }));
  expect(styles.scrollBehavior).toBe("auto");
  expect(styles.transitions.length).toBeGreaterThan(0);
  expect(styles.transitions.every((seconds) => seconds <= 0.00001)).toBe(true);
  expect(styles.animations).toBe(0);
});
