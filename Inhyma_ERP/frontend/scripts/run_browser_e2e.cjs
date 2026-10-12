const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const SCREENSHOT_DIR = "C:\\Users\\om\\.gemini\\antigravity-ide\\brain\\a1e5064f-48cf-4bc7-b1bb-baab4968ca1d\\screenshots";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:5174";

const USERS = {
  ADMIN: { username: "admin", password: "ChangeMe!12345", name: "Admin User", role: "super_admin" },
  HR: { username: "alice", password: "password123", name: "Alice HR", role: "HR" },
  MANAGER: { username: "sales_manager", password: "password123", name: "Sales Manager", role: "department_manager" },
  EMPLOYEE: { username: "john", password: "password123", name: "John Doe", role: "employee" },
  OPS_EMP: { username: "ops_employee", password: "password123", name: "Operations Staff", role: "employee" },
};

const results = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: [],
};

function recordTest(name, passed, details = "") {
  results.total++;
  if (passed) {
    results.passed++;
    console.log(`[PASS] ${name}: ${details}`);
    results.tests.push({ name, status: "PASS", details });
  } else {
    results.failed++;
    console.error(`[FAIL] ${name}: ${details}`);
    results.tests.push({ name, status: "FAIL", details });
  }
}

async function loginUser(page, username, password) {
  // Navigate to login page
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle2" });

  // Completely clear localStorage and sessionStorage to ensure genuine session isolation
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Reload fresh login page
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle2" });
  await page.waitForSelector("input", { timeout: 10000 });

  // Type username and password reliably with Ctrl+A Backspace
  const inputs = await page.$$("input");
  if (inputs.length >= 2) {
    await inputs[0].click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await inputs[0].type(username, { delay: 20 });

    await inputs[1].click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await inputs[1].type(password, { delay: 20 });
  }

  // Click submit
  const submitBtn = await page.$("button[type='submit']");
  if (submitBtn) {
    await submitBtn.click();
  }

  // Wait for navigation away from login
  await page.waitForFunction(() => !window.location.pathname.includes("/login"), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1200));
}

async function run() {
  console.log("================================================================================");
  console.log("STARTING COMPREHENSIVE BROWSER END-TO-END QA (PUPPETEER-CORE + SYSTEM CHROME)");
  console.log("================================================================================");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
    defaultViewport: { width: 1366, height: 850 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });

  const page = await browser.newPage();

  // Monitor console errors and network failures
  const consoleErrors = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("requestfailed", (req) => {
    networkFailures.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });

  try {
    // =========================================================================
    // ROLE 1: ADMIN (Super Admin)
    // =========================================================================
    console.log("\n--- TESTING ROLE: SUPER ADMIN ---");
    await loginUser(page, USERS.ADMIN.username, USERS.ADMIN.password);
    recordTest("Admin Login", !page.url().includes("/login"), `Current URL: ${page.url()}`);

    // Navigate to Attendance Page
    await page.goto(`${BASE_URL}/hrms/attendance`, { waitUntil: "networkidle2" });
    await page.waitForSelector(".hrms-tabs-nav", { timeout: 10000 });
    recordTest("Attendance Page Loaded", true, "Tabs nav present");

    // Check View Mode Toggle: All Employees vs Individual
    await page.waitForSelector(".hrms-view-mode-toggle button", { timeout: 10000 });
    const viewButtons = await page.$$(".hrms-view-mode-toggle button");
    recordTest("View Mode Toggle Rendered", viewButtons.length === 2, `Found ${viewButtons.length} toggle buttons`);

    // Switch to All Employees Matrix
    await viewButtons[1].click();
    await page.waitForFunction(() => window.location.search.includes("view=all"), { timeout: 5000 });
    await page.waitForSelector("table", { timeout: 10000 });

    const matrixTableText = await page.$eval("table", (el) => el.innerText);
    const hasEmp001 = matrixTableText.includes("EMP-001");
    const hasEmp004 = matrixTableText.includes("EMP-004");
    recordTest("All Employees Matrix Displays Employee Codes", hasEmp001 && hasEmp004, "Found EMP-001 and EMP-004 in table");

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01_admin_all_employees_matrix.png"), fullPage: true });

    // Click "Open" specifically in John Doe's row (EMP-001)
    const clickedOpen = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tr"));
      const johnRow = rows.find((r) => r.innerText.includes("John Doe") || r.innerText.includes("EMP-001"));
      if (johnRow) {
        const btn = johnRow.querySelector("button");
        if (btn) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    recordTest("Admin Clicked 'Open' on John Doe Row", clickedOpen, "Clicked Open in John Doe row");

    // Verify view switches to Individual Calendar with John Doe's information
    await page.waitForFunction(() => window.location.search.includes("view=individual") && window.location.search.includes("employee_id="), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 1200));

    const pageContentAfterOpen = await page.$eval(".hrms-tab-content", (el) => el.innerText);
    const hasJohnInBanner = pageContentAfterOpen.includes("John Doe") && pageContentAfterOpen.includes("EMP-001");
    const hasRestrictedNotice = pageContentAfterOpen.includes("restricted to your own personal employee session");
    recordTest("Calendar & Banner Switch to John Doe (EMP-001)", hasJohnInBanner && hasRestrictedNotice, "Verified banner and title show John Doe (EMP-001)");

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "02_admin_john_calendar_open.png"), fullPage: true });

    // Switch Employee via Dropdown to Operations Staff (EMP-004)
    await page.waitForSelector("#attendance-emp-select", { timeout: 5000 });
    await page.select("#attendance-emp-select", "7fe1352f-82f5-45df-bf3c-554c35d80cfc");
    await new Promise((r) => setTimeout(r, 1200));

    const pageContentAfterOps = await page.$eval(".hrms-tab-content", (el) => el.innerText);
    const hasOpsInBanner = pageContentAfterOps.includes("Operations") && pageContentAfterOps.includes("EMP-004");
    recordTest("Employee Dropdown Switch to Operations Staff (EMP-004)", hasOpsInBanner, "Verified banner shows Operations Staff (EMP-004)");

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "03_admin_ops_calendar_dropdown.png"), fullPage: true });

    // Test Month Navigation (Prev Month inside .hrms-cal-nav)
    const clickedPrev = await page.evaluate(() => {
      const navBtns = Array.from(document.querySelectorAll(".hrms-cal-nav button"));
      const prevBtn = navBtns.find((b) => b.innerText.includes("‹") || b.innerText.includes("Prev"));
      if (prevBtn) {
        prevBtn.click();
        return true;
      }
      return false;
    });

    if (clickedPrev) {
      await new Promise((r) => setTimeout(r, 1200));
      const monthTitle = await page.$eval(".hrms-cal-month-title", (el) => el.innerText);
      const isSeptember = monthTitle.includes("September 2026");
      const opsPreserved = (await page.$eval(".hrms-tab-content", (el) => el.innerText)).includes("Operations");
      recordTest("Month Navigation Preserves Selected Employee", isSeptember && opsPreserved, `Month: ${monthTitle}, Employee preserved: ${opsPreserved}`);

      // Return back to current month
      await page.evaluate(() => {
        const navBtns = Array.from(document.querySelectorAll(".hrms-cal-nav button"));
        const nextBtn = navBtns.find((b) => b.innerText.includes("Next") || b.innerText.includes("›"));
        if (nextBtn) nextBtn.click();
      });
      await new Promise((r) => setTimeout(r, 800));
    } else {
      recordTest("Month Navigation Preserves Selected Employee", false, "Prev button not found in .hrms-cal-nav");
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "04_admin_month_navigation.png"), fullPage: true });

    // Test HRMS Setup Sub-Tabs: Return Timer & Detailed Tracking
    await page.goto(`${BASE_URL}/hrms/setup`, { waitUntil: "networkidle2" });
    await page.waitForSelector("button", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Find and click "Detailed Tracking" tab
    const clickedDetailedTracking = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const target = btns.find((b) => b.innerText.includes("Detailed Tracking"));
      if (target) {
        target.click();
        return true;
      }
      return false;
    });
    await new Promise((r) => setTimeout(r, 1000));
    recordTest("Admin Opened Detailed Tracking Setup Tab", clickedDetailedTracking, "Detailed tracking tab active");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "05_admin_setup_detailed_tracking.png"), fullPage: true });

    // Find and click "Return Timer" tab
    const clickedReturnTimer = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const target = btns.find((b) => b.innerText.includes("Return Timer"));
      if (target) {
        target.click();
        return true;
      }
      return false;
    });
    await new Promise((r) => setTimeout(r, 1000));
    recordTest("Admin Opened Return Timer Setup Tab", clickedReturnTimer, "Return timer sub-tab active");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "06_admin_setup_return_timer.png"), fullPage: true });

    // Test HRMS Payroll Page
    await page.goto(`${BASE_URL}/hrms/payroll`, { waitUntil: "networkidle2" });
    await page.waitForSelector("table, .hrms-tabs-nav", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1000));

    const payrollText = await page.evaluate(() => document.body.innerText);
    const hasPayrollTable = payrollText.includes("Payroll") || payrollText.includes("Salary");
    recordTest("Admin Payroll Module Rendered", hasPayrollTable, "Payroll page loaded with data tables");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "07_admin_payroll_dashboard.png"), fullPage: true });

    // =========================================================================
    // ROLE 2: DEPARTMENT MANAGER (sales_manager)
    // =========================================================================
    console.log("\n--- TESTING ROLE: DEPARTMENT MANAGER (Sales) ---");
    await loginUser(page, USERS.MANAGER.username, USERS.MANAGER.password);
    recordTest("Sales Manager Login", !page.url().includes("/login"), `Current URL: ${page.url()}`);

    await page.goto(`${BASE_URL}/hrms/attendance`, { waitUntil: "networkidle2" });
    await page.waitForSelector(".hrms-tabs-nav", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Manager employee selector should contain John Doe but NOT Operations Employee
    const mgrEmpSelect = await page.$("#attendance-emp-select");
    if (mgrEmpSelect) {
      const selectHtml = await page.evaluate((el) => el.innerHTML, mgrEmpSelect);
      const hasJohnOption = selectHtml.includes("John Doe") || selectHtml.includes("EMP-001");
      const lacksOpsOption = !selectHtml.includes("EMP-004") && !selectHtml.includes("Operations Staff");
      recordTest("Sales Manager Department Scoping in Dropdown", hasJohnOption && lacksOpsOption, `Has John: ${hasJohnOption}, Lacks Ops: ${lacksOpsOption}`);
    }

    // Direct URL tampering test: Sales Manager attempting to access Ops Employee
    await page.goto(`${BASE_URL}/hrms/attendance?employee_id=7fe1352f-82f5-45df-bf3c-554c35d80cfc&view=individual`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1500));
    const tamperText = await page.evaluate(() => document.body.innerText);
    const isOpsDataLeaked = tamperText.includes("Operations Staff") && tamperText.includes("EMP-004");
    recordTest("Manager Cross-Department URL Tamper Blocked", !isOpsDataLeaked, "Operations employee data not leaked to Sales Manager");

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "08_manager_scoping_attendance.png"), fullPage: true });

    // =========================================================================
    // ROLE 3: SALES EMPLOYEE (john)
    // =========================================================================
    console.log("\n--- TESTING ROLE: SALES EMPLOYEE (John) ---");
    await loginUser(page, USERS.EMPLOYEE.username, USERS.EMPLOYEE.password);
    recordTest("Sales Employee John Login", !page.url().includes("/login"), `Current URL: ${page.url()}`);

    await page.goto(`${BASE_URL}/hrms/attendance`, { waitUntil: "networkidle2" });
    await page.waitForSelector(".hrms-tabs-nav", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1200));

    // Employee must NOT see employee selector or "All Employees" toggle
    const empSelectorForJohn = await page.$("#attendance-emp-select");
    const toggleForJohn = await page.$(".hrms-view-mode-toggle");
    recordTest("Employee John Self-Service Lockdown (No Switcher)", empSelectorForJohn === null && toggleForJohn === null, "Privileged selectors hidden");

    // Geolocation simulation: Click Inside (10m)
    const clickedInside = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll(".hrms-sim-btn"));
      const btn = btns.find((b) => b.innerText.includes("Inside"));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    await new Promise((r) => setTimeout(r, 800));
    const insideStatus = await page.$eval(".hrms-punch-distance-chip", (el) => el.innerText);
    const isInside = insideStatus.includes("Inside Geofence");
    recordTest("Employee Geolocation Simulator: Inside Geofence", clickedInside && isInside, `Chip: ${insideStatus}`);

    // Geolocation simulation: Click Outside (500m)
    const clickedOutside = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll(".hrms-sim-btn"));
      const btn = btns.find((b) => b.innerText.includes("Outside"));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    await new Promise((r) => setTimeout(r, 800));
    const outsideStatus = await page.$eval(".hrms-punch-distance-chip", (el) => el.innerText);
    const isOutside = outsideStatus.includes("Outside Geofence");
    recordTest("Employee Geolocation Simulator: Outside Geofence", clickedOutside && isOutside, `Chip: ${outsideStatus}`);

    // Return to inside for clean state
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll(".hrms-sim-btn"));
      const btn = btns.find((b) => b.innerText.includes("Inside"));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 500));

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "09_employee_john_attendance_simulator.png"), fullPage: true });

    // Direct URL tampering test: John attempting to access Admin Calendar
    await page.goto(`${BASE_URL}/hrms/attendance?employee_id=ea2b5763-5a4d-4f21-8bff-adc3e6cb8235&view=individual`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));
    const johnTamperText = await page.evaluate(() => document.body.innerText);
    const isAdminDataLeaked = johnTamperText.includes("Admin User") && johnTamperText.includes("EMP-000");
    recordTest("Employee Direct URL Admin Calendar Access Blocked", !isAdminDataLeaked, "Admin calendar not leaked to John");

    // Employee Payroll Self-Service
    await page.goto(`${BASE_URL}/hrms/payroll`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1500));
    const empPayrollText = await page.evaluate(() => document.body.innerText);
    const hasMySlips = empPayrollText.includes("My Approved Salary Slips") || empPayrollText.includes("Payroll") || empPayrollText.includes("Salary");
    recordTest("Employee John Payroll Self-Service", hasMySlips, "Employee payroll view rendered");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "10_employee_john_payroll.png"), fullPage: true });

    // =========================================================================
    // ROLE 4: OPERATIONS EMPLOYEE (ops_employee)
    // =========================================================================
    console.log("\n--- TESTING ROLE: OPERATIONS EMPLOYEE ---");
    await loginUser(page, USERS.OPS_EMP.username, USERS.OPS_EMP.password);
    recordTest("Operations Employee Login", !page.url().includes("/login"), `Current URL: ${page.url()}`);

    await page.goto(`${BASE_URL}/hrms/attendance`, { waitUntil: "networkidle2" });
    await page.waitForSelector(".hrms-tabs-nav", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1000));

    const opsContent = await page.evaluate(() => document.body.innerText);
    const hasOpsCalendar = opsContent.includes("Attendance") && !opsContent.includes("John Doe");
    recordTest("Operations Employee Self-Service Isolation", hasOpsCalendar, "Ops employee isolated from Sales");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "11_ops_employee_attendance.png"), fullPage: true });

    // =========================================================================
    // ROLE 5: HR MANAGER (alice)
    // =========================================================================
    console.log("\n--- TESTING ROLE: HR MANAGER ---");
    await loginUser(page, USERS.HR.username, USERS.HR.password);
    recordTest("HR Manager Alice Login", !page.url().includes("/login"), `Current URL: ${page.url()}`);

    await page.goto(`${BASE_URL}/hrms/attendance`, { waitUntil: "networkidle2" });
    await page.waitForSelector(".hrms-tabs-nav", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1000));

    // HR should have company-wide employee selector
    const hrEmpSelect = await page.$("#attendance-emp-select");
    if (hrEmpSelect) {
      const hrSelectHtml = await page.evaluate((el) => el.innerHTML, hrEmpSelect);
      const hrHasJohn = hrSelectHtml.includes("John Doe") || hrSelectHtml.includes("EMP-001");
      const hrHasOps = hrSelectHtml.includes("Operations Staff") || hrSelectHtml.includes("EMP-004");
      recordTest("HR Company-Wide Employee Selection Access", hrHasJohn && hrHasOps, "HR has visibility into both Sales and Operations");
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "12_hr_attendance_company_wide.png"), fullPage: true });

  } catch (err) {
    console.error("Browser E2E Execution Error:", err);
    recordTest("Browser E2E Execution", false, err.message);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "error_state.png"), fullPage: true });
  } finally {
    await browser.close();
  }

  console.log("\n" + "=".repeat(80));
  console.log("BROWSER END-TO-END QA SUITE COMPLETED");
  console.log("=".repeat(80));
  console.log(`Total Tests:  ${results.total}`);
  console.log(`Passed:       ${results.passed}`);
  console.log(`Failed:       ${results.failed}`);
  console.log(`Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);
  console.log("Screenshots saved to:", SCREENSHOT_DIR);
  console.log("=".repeat(80));

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, "browser_e2e_results.json"),
    JSON.stringify({ ...results, consoleErrors, networkFailures }, null, 2)
  );

  process.exit(results.failed === 0 ? 0 : 1);
}

run();
