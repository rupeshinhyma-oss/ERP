import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:8002/api/v1';
const FRONTEND_BASE = 'http://localhost:5174';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = 'C:\\Users\\om\\.gemini\\antigravity-ide\\brain\\93d96a96-4da4-4a4d-80eb-217652d3048d\\screenshots';

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function apiLogin(identifier, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Login failed for ${identifier}: ${JSON.stringify(json)}`);
  return json.data.access_token;
}

async function getProfile(token) {
  const res = await fetch(`${API_BASE}/auth/profile`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const json = await res.json();
  return json.data || json;
}

async function run() {
  console.log('====================================================');
  console.log('PHASE 9: REAL UI VERIFICATION IN RUNNING BROWSER');
  console.log('====================================================\n');

  console.log('Launching headless Chrome from:', CHROME_PATH);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleLogs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleLogs.push(msg.text());
  });

  async function loginAs(email, password) {
    const token = await apiLogin(email, password);
    const profile = await getProfile(token);
    
    // Clear storage and navigate
    await page.goto(`${FRONTEND_BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((tok, prof) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('erp_access_token', tok);
      localStorage.setItem('erp_refresh_token', tok);
      localStorage.setItem('erp_profile', JSON.stringify(prof));
    }, token, profile);

    await page.goto(`${FRONTEND_BASE}/tasks`, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2000));
  }

  // ----------------------------------------------------
  // TEST 1: Super Admin UI
  // ----------------------------------------------------
  console.log('\n--- 1. Testing Super Admin UI (qa_admin@inhyma.test) ---');
  await loginAs('qa_admin@inhyma.test', 'QAPassword123!');

  const adminBanner = await page.evaluate(() => {
    const banner = document.querySelector('.bg-emerald-50, .bg-blue-50, .bg-purple-50, .bg-slate-50, [class*="border-emerald"], [class*="border-blue"]');
    return banner ? banner.innerText.replace(/\n+/g, ' | ') : null;
  });
  console.log('  Admin Scope Banner:', adminBanner);

  const adminViews = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const viewButtons = buttons.filter(b => ['My Tasks', 'Department Tasks', 'Organization Tasks', 'All Tasks'].some(v => b.innerText.includes(v)));
    return viewButtons.map(b => b.innerText.trim());
  });
  console.log('  Admin Available View Buttons:', adminViews);

  const adminDeptOptions = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    for (const sel of selects) {
      const options = Array.from(sel.querySelectorAll('option')).map(o => o.text.trim());
      if (options.some(o => o.includes('Department') || o.includes('Sales') || o.includes('Management'))) {
        return options;
      }
    }
    return [];
  });
  console.log(`  Admin Department Selector Option Count: ${adminDeptOptions.length}`);

  const adminShot = path.join(SCREENSHOT_DIR, 'phase9_01_super_admin_tasks.png');
  await page.screenshot({ path: adminShot });
  console.log('  ✓ Super Admin screenshot saved to:', adminShot);

  // ----------------------------------------------------
  // TEST 2: Sales Manager UI
  // ----------------------------------------------------
  console.log('\n--- 2. Testing Sales Manager UI (qa_sales_mgr@inhyma.test) ---');
  await loginAs('qa_sales_mgr@inhyma.test', 'QAPassword123!');

  const mgrBanner = await page.evaluate(() => {
    const banner = document.querySelector('.bg-emerald-50, .bg-blue-50, .bg-purple-50, .bg-slate-50, [class*="border-emerald"], [class*="border-blue"]');
    return banner ? banner.innerText.replace(/\n+/g, ' | ') : null;
  });
  console.log('  Manager Scope Banner:', mgrBanner);

  const mgrViews = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const viewButtons = buttons.filter(b => ['My Tasks', 'Department Tasks', 'Organization Tasks', 'All Tasks'].some(v => b.innerText.includes(v)));
    return viewButtons.map(b => b.innerText.trim());
  });
  console.log('  Manager Available View Buttons:', mgrViews);

  const hasOrgViewForMgr = mgrViews.some(v => v.includes('Organization'));
  console.log('  Manager Has Organization View (Should be FALSE):', hasOrgViewForMgr);

  const mgrDeptOptions = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    for (const sel of selects) {
      const options = Array.from(sel.querySelectorAll('option')).map(o => o.text.trim());
      if (options.some(o => o.includes('Sales') || o.includes('Department'))) {
        return options;
      }
    }
    return [];
  });
  console.log('  Manager Department Selector Options:', mgrDeptOptions);

  // Switch to Department view
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const deptBtn = buttons.find(b => b.innerText.includes('Department Tasks'));
    if (deptBtn) deptBtn.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // Check tasks visible in Manager Department View
  const mgrTaskRows = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr, .task-row, [data-task-id], [class*="task-card"]'));
    return rows.map(r => r.innerText.replace(/\n+/g, ' ')).filter(txt => txt.includes('QA-TASK-P5'));
  });
  console.log(`  Manager Department View QA Tasks Detected (${mgrTaskRows.length}):`);
  for (const row of mgrTaskRows) {
    console.log('    ->', row.slice(0, 100));
  }

  // Check badges for General or Director
  const mgrBadges = await page.evaluate(() => {
    const allSpans = Array.from(document.querySelectorAll('span, badge, div'));
    const badges = allSpans.filter(s => s.innerText.includes('🏛️') || s.innerText.includes('General') || s.innerText.includes('Director') || s.innerText.includes('Sales'));
    return [...new Set(badges.map(b => b.innerText.trim()))];
  });
  console.log('  Manager UI Badges Observed:', mgrBadges);

  const mgrShot = path.join(SCREENSHOT_DIR, 'phase9_02_sales_manager_tasks.png');
  await page.screenshot({ path: mgrShot });
  console.log('  ✓ Sales Manager screenshot saved to:', mgrShot);

  // ----------------------------------------------------
  // TEST 3: Sales Employee UI
  // ----------------------------------------------------
  console.log('\n--- 3. Testing Sales Employee UI (qa_sales_emp@inhyma.test) ---');
  await loginAs('qa_sales_emp@inhyma.test', 'QAPassword123!');

  const empBanner = await page.evaluate(() => {
    const banner = document.querySelector('.bg-emerald-50, .bg-blue-50, .bg-purple-50, .bg-slate-50, [class*="border-emerald"], [class*="border-blue"]');
    return banner ? banner.innerText.replace(/\n+/g, ' | ') : null;
  });
  console.log('  Employee Scope Banner:', empBanner);

  const empViews = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const viewButtons = buttons.filter(b => ['My Tasks', 'Department Tasks', 'Organization Tasks', 'All Tasks'].some(v => b.innerText.includes(v)));
    return viewButtons.map(b => b.innerText.trim());
  });
  console.log('  Employee Available View Buttons (Should only have My Tasks):', empViews);

  const hasDeptViewForEmp = empViews.some(v => v.includes('Department'));
  console.log('  Employee Has Department View (Should be FALSE):', hasDeptViewForEmp);

  const empTaskRows = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr, .task-row, [data-task-id], [class*="task-card"]'));
    return rows.map(r => r.innerText.replace(/\n+/g, ' ')).filter(txt => txt.includes('QA-TASK-P5'));
  });
  console.log(`  Employee Personal View QA Tasks Detected (${empTaskRows.length}):`);
  for (const row of empTaskRows) {
    console.log('    ->', row.slice(0, 100));
  }

  const seesMgrTeamTask = empTaskRows.some(r => r.includes('QA-TASK-P5-03') || r.includes('Sales Manager Team Task'));
  console.log('  Employee Sees Manager Team Task T3 (Should be FALSE):', seesMgrTeamTask);

  const empBadges = await page.evaluate(() => {
    const allSpans = Array.from(document.querySelectorAll('span, badge, div'));
    const badges = allSpans.filter(s => s.innerText.includes('🏛️') || s.innerText.includes('General') || s.innerText.includes('Director') || s.innerText.includes('Sales'));
    return [...new Set(badges.map(b => b.innerText.trim()))];
  });
  console.log('  Employee UI Badges Observed:', empBadges);

  const empShot = path.join(SCREENSHOT_DIR, 'phase9_03_sales_employee_tasks.png');
  await page.screenshot({ path: empShot });
  console.log('  ✓ Sales Employee screenshot saved to:', empShot);

  await browser.close();
  console.log('\n====================================================');
  console.log('REAL UI BROWSER VERIFICATION COMPLETE');
  console.log('====================================================');
}

run().catch(err => {
  console.error('Fatal error during UI verification:', err);
  process.exit(1);
});
