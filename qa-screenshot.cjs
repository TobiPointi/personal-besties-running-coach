/* QA helper: renders the built app in Edge via puppeteer-core,
   reports layout metrics and captures screenshots. Not part of the app. */
const puppeteer = require("puppeteer-core");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = "http://localhost:4180";
const OUT = "C:\\Users\\TOBIAS~1\\AppData\\Local\\Temp\\opencode";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--disable-gpu", "--no-sandbox"],
  });
  try {
    for (const [name, w, h] of [["mobile", 390, 844], ["desktop", 1280, 1050]]) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await page.goto(URL, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 400));
      const metrics = await page.evaluate(() => {
        const q = (sel) => document.querySelector(sel);
        const rect = (sel) => {
          const el = q(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left) };
        };
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          root: rect(".ltr-root"),
          wrap: rect(".ltr-chart-wrap"),
          svg: rect(".ltr-svg"),
        };
      });
      console.log(name, JSON.stringify(metrics));
      await page.screenshot({ path: `${OUT}\\pp_${name}.png`, fullPage: name === "mobile" });

      if (name === "desktop") {
        // hover a stage to verify tooltip, then enable advanced mode
        const stage = await page.$(".ltr-svg");
        const box = await stage.boundingBox();
        await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.5);
        await new Promise((r) => setTimeout(r, 300));
        await page.screenshot({ path: `${OUT}\\pp_tooltip.png` });
        const advancedBtn = await page.evaluateHandle(() =>
          [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Advanced analysis")),
        );
        await advancedBtn.asElement().click();
        await new Promise((r) => setTimeout(r, 300));
        await page.screenshot({ path: `${OUT}\\pp_advanced.png` });
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
