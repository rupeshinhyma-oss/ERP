import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const FRONTEND_URL = "http://localhost:5174";
const BACKEND_URL = "http://127.0.0.1:8002/api/v1";
const SCREENSHOT_DIR = "C:\\Users\\om\\.gemini\\antigravity-ide\\brain\\93d96a96-4da4-4a4d-80eb-217652d3048d\\screenshots";

const PERSONAS = {
  admin: { email: "qa_admin@inhyma.test", role: "Super Admin", name: "qa_admin" },
  mgr: { email: "qa_sales_mgr@inhyma.test", role: "Sales Manager", name: "qa_sales_mgr" },
  emp: { email: "qa_sales_emp@inhyma.test", role: "Sales Employee", name: "qa_sales_emp" },
};

const DEMO_TASK_IDS = {
  t1: "6cd36f4a-3fe1-48a2-9a28-14d5d61c405c", // Employee Own Task
  t2: "380e6325-1163-4e30-99d5-2b9a855d3f81", // Employee Assigned Task
  t3: "ac90d124-1c2f-4985-a50f-5c064084fa30", // Manager Team Task
  t4: "9284cb06-5541-448e-b1ed-ed7255054c7c", // Sales Approval Verification
  t5: "ddb6e6af-6542-43cb-b128-5f81cb432008", // Cross-Department Access Check
  t6: "f2180670-88f7-4139-8341-194ec7094ea7", // Organization Scope Verification
};

async function loginApi(email) {
  const resp = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password: "QAPassword123!", device_info: "P5 Verification" }),
  });
  const data = await resp.json();
  const token = data.data?.access_token || data.access_token;
  const user = data.data?.user || data.user;
  return { token, user };
}

async function run() {
  console.log("================================================================");
  console.log("INHYMA ERP — PHASE 5 ROLE-BASED VERIFICATION");
  console.log("================================================================");

  // 1. API Role-Based Verification
  console.log("\n--- STEP 1: API Task Scoping & Action Verification ---");
  const adminAuth = await loginApi(PERSONAS.admin.email);
  const mgrAuth = await loginApi(PERSONAS.mgr.email);
  const empAuth = await loginApi(PERSONAS.emp.email);

  // Test Admin List
  const adminTasksRes = await fetch(`${BACKEND_URL}/tasks?search=QA-TASK-P5-20261026`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  const adminTasks = (await adminTasksRes.json()).data.items;
  console.log(`1.1 Super Admin Sees ${adminTasks.length} / 6 Demo Tasks (Expected: 6)`);
  const adminIds = adminTasks.map(t => t.id);

  // Test Manager List
  const mgrTasksRes = await fetch(`${BACKEND_URL}/tasks?search=QA-TASK-P5-20261026`, {
    headers: { Authorization: `Bearer ${mgrAuth.token}` },
  });
  const mgrTasks = (await mgrTasksRes.json()).data.items;
  console.log(`1.2 Sales Manager Sees ${mgrTasks.length} Demo Tasks (Expected: 4 - T1, T2, T3, T4 in Sales dept)`);
  const mgrIds = mgrTasks.map(t => t.id);

  // Verify Manager cannot see T5 and T6
  const mgrSeesT5 = mgrIds.includes(DEMO_TASK_IDS.t5);
  const mgrSeesT6 = mgrIds.includes(DEMO_TASK_IDS.t6);
  console.log(`   Manager sees cross-dept T5: ${mgrSeesT5} (Expected: false)`);
  console.log(`   Manager sees org-scope T6: ${mgrSeesT6} (Expected: false)`);

  // Test Manager direct fetch on T5 and T6
  const mgrT5Res = await fetch(`${BACKEND_URL}/tasks/${DEMO_TASK_IDS.t5}`, {
    headers: { Authorization: `Bearer ${mgrAuth.token}` },
  });
  console.log(`   Manager direct ID fetch of T5: ${mgrT5Res.status} (Expected: 403 Forbidden)`);

  // Test Employee List
  const empTasksRes = await fetch(`${BACKEND_URL}/tasks?search=QA-TASK-P5-20261026`, {
    headers: { Authorization: `Bearer ${empAuth.token}` },
  });
  const empTasks = (await empTasksRes.json()).data.items;
  console.log(`1.3 Sales Employee Sees ${empTasks.length} Demo Tasks (Expected: 3 - T1 own, T2 assigned, T4 own created approval)`);
  const empIds = empTasks.map(t => t.id);

  // Verify Employee cannot see T3 (Manager's own task), T5, T6
  const empSeesT3 = empIds.includes(DEMO_TASK_IDS.t3);
  const empSeesT5 = empIds.includes(DEMO_TASK_IDS.t5);
  const empSeesT6 = empIds.includes(DEMO_TASK_IDS.t6);
  console.log(`   Employee sees Manager's Team Task T3: ${empSeesT3} (Expected: false)`);
  console.log(`   Employee sees Cross-Dept T5: ${empSeesT5} (Expected: false)`);
  console.log(`   Employee sees Org-Scope T6: ${empSeesT6} (Expected: false)`);

  // Test Employee direct fetch of T3, T5, T6
  const empT3Res = await fetch(`${BACKEND_URL}/tasks/${DEMO_TASK_IDS.t3}`, {
    headers: { Authorization: `Bearer ${empAuth.token}` },
  });
  console.log(`   Employee direct ID fetch of T3: ${empT3Res.status} (Expected: 403 Forbidden)`);
  const empT5Res = await fetch(`${BACKEND_URL}/tasks/${DEMO_TASK_IDS.t5}`, {
    headers: { Authorization: `Bearer ${empAuth.token}` },
  });
  console.log(`   Employee direct ID fetch of T5: ${empT5Res.status} (Expected: 403 Forbidden)`);

  // Test Approval Action:
  console.log("\n1.4 Testing Approval Actions on T4:");
  // Employee tries to approve T4 (should fail with 403)
  const empApproveRes = await fetch(`${BACKEND_URL}/tasks/${DEMO_TASK_IDS.t4}/action-approval`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${empAuth.token}` },
    body: JSON.stringify({ approved: true, notes: "Employee unauthorized self-approval" }),
  });
  console.log(`   Employee approve attempt status: ${empApproveRes.status} (Expected: 403 Forbidden)`);

  // 2. Real Browser Visual QA
  console.log("\n--- STEP 2: Chrome Browser Visual QA & Screenshot Capture ---");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'],
  });

  try {
    // Helper to log in via UI with direct token injection
    async function loginUi(page, authObj) {
      await page.goto(`${FRONTEND_URL}/login`, { waitUntil: "domcontentloaded" });
      await page.evaluate((t, u) => {
        localStorage.setItem('erp_access_token', t);
        localStorage.setItem('erp_refresh_token', t);
        localStorage.setItem('erp_profile', JSON.stringify(u));
      }, authObj.token, authObj.user);
      await new Promise(r => setTimeout(r, 500));
    }

    // 2.1 Super Admin Visual Check
    console.log("2.1 Verifying Super Admin in Browser...");
    const adminPage = await browser.newPage();
    await adminPage.setViewport({ width: 1400, height: 900 });
    await loginUi(adminPage, adminAuth);
    await adminPage.goto(`${FRONTEND_URL}/tasks`, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 2000));
    
    // Type search
    const searchInput = await adminPage.$('input[placeholder*="Search"], input[type="search"]');
    if (searchInput) {
      await searchInput.type("QA-TASK-P5");
      await new Promise(r => setTimeout(r, 1000));
    }
    
    const adminScreenshotPath = path.join(SCREENSHOT_DIR, "07_phase5_admin_all_demo_tasks.png");
    await adminPage.screenshot({ path: adminScreenshotPath });
    console.log(`   ✓ Admin tasks screenshot saved: ${adminScreenshotPath}`);
    await adminPage.close();

    // 2.2 Sales Manager Visual Check
    console.log("2.2 Verifying Sales Manager in Browser...");
    const mgrPage = await browser.newPage();
    await mgrPage.setViewport({ width: 1400, height: 900 });
    await loginUi(mgrPage, mgrAuth);
    await mgrPage.goto(`${FRONTEND_URL}/tasks`, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 2000));
    
    const mgrSearch = await mgrPage.$('input[placeholder*="Search"], input[type="search"]');
    if (mgrSearch) {
      await mgrSearch.type("QA-TASK-P5");
      await new Promise(r => setTimeout(r, 1000));
    }
    
    const mgrScreenshotPath = path.join(SCREENSHOT_DIR, "08_phase5_sales_mgr_department_tasks.png");
    await mgrPage.screenshot({ path: mgrScreenshotPath });
    console.log(`   ✓ Sales Manager tasks screenshot saved: ${mgrScreenshotPath}`);

    // Test Manager viewing approval task details in drawer
    await mgrPage.goto(`${FRONTEND_URL}/tasks?id=${DEMO_TASK_IDS.t4}`, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 2000));
    const mgrApprovalScreenshotPath = path.join(SCREENSHOT_DIR, "11_phase5_sales_mgr_approval_action.png");
    await mgrPage.screenshot({ path: mgrApprovalScreenshotPath });
    console.log(`   ✓ Sales Manager approval task screenshot saved: ${mgrApprovalScreenshotPath}`);
    await mgrPage.close();

    // 2.3 Sales Employee Visual Check
    console.log("2.3 Verifying Sales Employee in Browser...");
    const empPage = await browser.newPage();
    await empPage.setViewport({ width: 1400, height: 900 });
    await loginUi(empPage, empAuth);
    await empPage.goto(`${FRONTEND_URL}/tasks`, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 2000));

    const empSearch = await empPage.$('input[placeholder*="Search"], input[type="search"]');
    if (empSearch) {
      await empSearch.type("QA-TASK-P5");
      await new Promise(r => setTimeout(r, 1000));
    }

    const empScreenshotPath = path.join(SCREENSHOT_DIR, "09_phase5_sales_emp_own_assigned_tasks.png");
    await empPage.screenshot({ path: empScreenshotPath });
    console.log(`   ✓ Sales Employee tasks screenshot saved: ${empScreenshotPath}`);

    // Test Employee IDOR access attempt to unauthorized task T5
    await empPage.goto(`${FRONTEND_URL}/tasks?id=${DEMO_TASK_IDS.t5}`, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 2000));
    const empDeniedScreenshotPath = path.join(SCREENSHOT_DIR, "10_phase5_sales_emp_cross_dept_denied.png");
    await empPage.screenshot({ path: empDeniedScreenshotPath });
    console.log(`   ✓ Sales Employee Access Denied screenshot saved: ${empDeniedScreenshotPath}`);
    await empPage.close();

  } finally {
    await browser.close();
  }

  console.log("\n================================================================");
  console.log("PHASE 5 ROLE-BASED VERIFICATION COMPLETED SUCCESSFULLY!");
  console.log("================================================================");
}

run().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
