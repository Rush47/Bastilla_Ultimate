import { chromium } from "playwright";

async function main() {
  console.log("Launching Chromium via Playwright...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  console.log("Navigating to http://localhost:3000 ...");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 15000 });

  // 1. Verify Top Banner
  const banner = page.locator("text=MISJA CIĄGŁA AKTYWNA").first();
  const bannerVisible = await banner.isVisible();
  console.log("1. Continuous Mission Banner Visible:", bannerVisible);

  // 2. Switch to ChatGPT Work tab
  console.log("Switching to ChatGPT Work tab...");
  await page.click("button:has-text('ChatGPT Work')");
  await page.waitForTimeout(1500);

  // 3. Verify 'Misja Ciągła' generative button exists
  const chip = page.locator("button:has-text('Misja Ciągła')").first();
  const chipVisible = await chip.isVisible();
  console.log("2. 'Misja Ciągła' Generative Chip Visible:", chipVisible);

  // 4. Check for interactive action buttons in the chat
  const actionButtons = page.locator("button:has-text('Aktualizacja')").first();
  const buttonsVisible = await actionButtons.isVisible().catch(() => false);
  console.log("3. Interactive Action Buttons Visible:", buttonsVisible);

  // 5. Trigger a mission cycle via button
  console.log("Triggering continuous mission cycle from GUI...");
  await page.click("button:has-text('Wymuś cykl')");
  await page.waitForTimeout(2000);

  await page.screenshot({ path: "/tmp/bastilla_verified.png" });
  console.log("Screenshot saved to /tmp/bastilla_verified.png");

  await browser.close();
  console.log("Verification finished successfully!");
}

main().catch((err) => {
  console.error("Browser verification error:", err);
  process.exit(1);
});
