import assert from "node:assert/strict";
import { chromium } from "playwright";

async function main() {
  const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors: string[] = [];
    const failedAssets: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.url().startsWith(baseUrl) && /\.(jpg|png|js|css)(\?|$)/.test(response.url()) && response.status() >= 400) {
        failedAssets.push(`${response.status()} ${response.url()}`);
      }
    });
    const overview = page.waitForResponse((response) => response.url().endsWith("/api/system/overview"));
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    assert.equal((await overview).status(), 200);
    await page.getByRole("button", { name: "ChatGPT Work", exact: true }).waitFor();
    const imagesLoaded = await page.locator("img").evaluateAll(async (images) => {
      await Promise.all(images.map((image) => (image as HTMLImageElement).decode().catch(() => {})));
      return images.every((image) => (image as HTMLImageElement).naturalWidth > 0);
    });
    assert.ok(imagesLoaded, "Desktop images must load in the production build");
    for (const name of ["ChatGPT Work", "Terminale", "Agenci Linux", "Układ 3D", "Diagnostyka i GitHub", "Pulpit Violet"]) {
      await page.getByRole("button", { name, exact: true }).first().click();
      await page.waitForTimeout(200);
      if (name === "ChatGPT Work") {
        await page.getByTitle("Włącz pełny ekran").click();
        await page.getByTitle("Wyłącz pełny ekran").waitFor();
        await page.keyboard.press("Escape");
        await page.getByTitle("Włącz pełny ekran").waitFor();
      }
      if (name === "Terminale") {
        const panel = page.getByRole("region", { name: "Logowanie Codex CLI" });
        await panel.getByRole("button", { name: "Sprawdź status Codex" }).click();
        if (process.env.TEST_CODEX_DEVICE_FLOW === "true") {
          // Enable only when the test server uses tests/fixtures/codex.mjs.
          await panel.getByRole("button", { name: "Zaloguj przez ChatGPT" }).click();
          await panel.getByText("ABCD-EFGHI", { exact: true }).waitFor();
          await panel.getByRole("button", { name: "Anuluj logowanie" }).click();
          await panel.getByText("Logowanie anulowane.", { exact: true }).waitFor();
        }
      }
    }
    assert.deepEqual(pageErrors, [], "Tabs must render without runtime errors");
    assert.deepEqual(failedAssets, [], "Built assets must be served successfully");
    await page.screenshot({ path: process.env.TEST_SCREENSHOT_PATH || "/tmp/bastilla_verified.png" });
    console.log("UI verified: six tabs, production images, no page errors.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
