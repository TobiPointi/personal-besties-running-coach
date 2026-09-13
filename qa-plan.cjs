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
    await page.setViewport({ width: 1180, height: 1150 });
    await page.goto(URL, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `${OUT}\\plan_default.png` });

    // Try moving the long run (s7) to today -> should trigger approval flow
    const moveButtons = await page.$$("button");
    let longMoveBtn = null;
    for (const b of moveButtons) {
      const text = await b.evaluate((el) => {
        const card = el.closest(".trn-session");
        if (!card) return "";
        const title = card.querySelector(".trn-session-title")?.textContent ?? "";
        return el.textContent === "Move" && title.includes("Long run") ? "Move" : "";
      });
      if (text) {
        longMoveBtn = b;
        break;
      }
    }
    await longMoveBtn.evaluate((el) => el.click());
    await new Promise((r) => setTimeout(r, 200));
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    await page.evaluate((v) => {
      const input = document.querySelector('.trn-move-box input[type="date"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, iso);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll(".trn-move-box .trn-btn.is-primary")];
      btns[0].click();
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `${OUT}\\plan_approval.png` });

    // Check requests inbox
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("nav button")];
      btns.find((b) => b.textContent.includes("Requests")).click();
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `${OUT}\\plan_inbox.png` });

    console.log("QA done");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
