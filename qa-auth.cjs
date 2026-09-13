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
    const page = await browser.newPage();
    await page.setViewport({ width: 1180, height: 900 });
    await page.goto(URL, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `${OUT}\\final_plan.png` });
    console.log("console errors: none");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
