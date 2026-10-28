import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const screenshotDir = 'C:\\Users\\om\\.gemini\\antigravity-ide\\brain\\93d96a96-4da4-4a4d-80eb-217652d3048d\\screenshots';

if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

async function run() {
  console.log('Launching Chrome from:', chromePath);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating to http://localhost:5174/login...');
  await page.goto('http://localhost:5174/login', { waitUntil: 'domcontentloaded', timeout: 15000 });

  const title = await page.title();
  console.log('Page Title:', title);

  const shotPath = path.join(screenshotDir, '00_login_page_probe.png');
  await page.screenshot({ path: shotPath });
  console.log('Screenshot saved to:', shotPath);

  await browser.close();
  console.log('Browser test completed successfully!');
}

run().catch(err => {
  console.error('Browser probe failed:', err);
  process.exit(1);
});
