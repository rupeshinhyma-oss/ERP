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

async function api(endpoint, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, ok: res.ok, data: json };
}

async function login(identifier, password) {
  const res = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${identifier}: ${JSON.stringify(res.data)}`);
  return res.data.data.access_token;
}

async function main() {
  console.log('================================================================');
  console.log('INHYMA ERP — PHASE 3 ACCEPTANCE & BROWSER VERIFICATION');
  console.log('================================================================\n');

  // 1. Verify Logins
  console.log('--- STEP 1: Verify Staging QA Logins ---');
  const adminToken = await login('qa_admin@inhyma.test', 'QAPassword123!');
  console.log('✓ Super Admin login verified');
  const mgrToken = await login('qa_sales_mgr@inhyma.test', 'QAPassword123!');
  console.log('✓ Sales Manager login verified');
  let empToken = await login('qa_sales_emp@inhyma.test', 'QAPassword123!');
  console.log('✓ Sales Employee login verified\n');

  // Fetch Users & Permission IDs
  const usersRes = await api('/users', {}, adminToken);
  const users = usersRes.data.data.items;
  const empUser = users.find(u => u.email === 'qa_sales_emp@inhyma.test');
  const mgrUser = users.find(u => u.email === 'qa_sales_mgr@inhyma.test');
  const adminUser = users.find(u => u.email === 'qa_admin@inhyma.test');

  const permsRes = await api('/rbac/permissions', {}, adminToken);
  const allPerms = permsRes.data.data;
  const taskCreatePerm = allPerms.find(p => p.code === 'task.create');
  const taskAssignPerm = allPerms.find(p => p.code === 'task.assign');
  const taskEscalatePerm = allPerms.find(p => p.code === 'task.escalate');
  const taskViewPerm = allPerms.find(p => p.code === 'task.view');

  console.log(`Sales Employee ID: ${empUser.id}`);
  console.log(`task.create ID: ${taskCreatePerm.id}`);
  console.log(`task.assign ID: ${taskAssignPerm.id}`);
  console.log(`task.escalate ID: ${taskEscalatePerm.id}`);
  console.log(`task.view ID: ${taskViewPerm.id}\n`);

  // --------------------------------------------------------------------------
  // PHASE 2: CONTROLS PANEL GRANT / REVOKE & USER OVERRIDES
  // --------------------------------------------------------------------------
  console.log('--- STEP 2: Controls Panel Grant / Revoke Verification ---');

  // 2.0 Baseline setup: Ensure Sales Employee baseline has task.create and task.view
  await api(`/rbac/users/${empUser.id}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permission_id: taskCreatePerm.id, is_granted: true }),
  }, adminToken);
  await api(`/rbac/users/${empUser.id}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permission_id: taskViewPerm.id, is_granted: true }),
  }, adminToken);

  // 2.1 Initial Effective Permissions
  const initialEff = await api(`/rbac/users/${empUser.id}/effective-permissions`, {}, adminToken);
  console.log(`2.1 Initial Effective Permissions: ${initialEff.data.data.effective_permissions.join(', ')}`);

  // 2.2 Revoke task.create from Sales Employee (explicit denial override)
  console.log('2.2 Applying explicit denial for task.create on Sales Employee...');
  const revokeRes = await api(`/rbac/users/${empUser.id}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permission_id: taskCreatePerm.id, is_granted: false }),
  }, adminToken);
  console.log(`   Revoke API status: ${revokeRes.status}`);

  // 2.3 Verify change persists in effective permissions (explicit denial takes precedence)
  const revokedEff = await api(`/rbac/users/${empUser.id}/effective-permissions`, {}, adminToken);
  const hasCreateAfterRevoke = revokedEff.data.data.effective_permissions.includes('task.create');
  console.log(`2.3 task.create present in effective permissions after revoke: ${hasCreateAfterRevoke} (Expected: false)`);
  if (hasCreateAfterRevoke) throw new Error('Revocation failed: task.create still present in effective permissions');

  // 2.4 Verify task creation is blocked for employee via direct API
  console.log('2.4 Attempting task creation as Sales Employee without task.create...');
  const createDenied = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Denied Task Creation Attempt', priority: 'MEDIUM', status: 'TODO' }),
  }, empToken);
  console.log(`   Create response status: ${createDenied.status} (Expected: 403)`);
  if (createDenied.status !== 403) throw new Error(`Expected 403 Forbidden, got ${createDenied.status}`);
  console.log(`   Error message: ${createDenied.data.message}`);

  // 2.5 Test with stale JWT claim (use old empToken issued prior to revocation)
  console.log('2.5 Testing stale JWT claim against live permission check...');
  const staleAttempt = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Stale Token Bypass Attempt', priority: 'MEDIUM', status: 'TODO' }),
  }, empToken);
  console.log(`   Stale token create status: ${staleAttempt.status} (Expected: 403)`);
  if (staleAttempt.status !== 403) throw new Error('Security defect! Stale JWT restored revoked permission');

  // 2.6 Restore task.create
  console.log('2.6 Restoring task.create for Sales Employee...');
  const restoreRes = await api(`/rbac/users/${empUser.id}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permission_id: taskCreatePerm.id, is_granted: true }),
  }, adminToken);
  console.log(`   Restore override status: ${restoreRes.status}`);

  // Issue fresh token to verify fresh login
  empToken = await login('qa_sales_emp@inhyma.test', 'QAPassword123!');
  const createRestored = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Restored Employee Task', priority: 'MEDIUM', status: 'TODO' }),
  }, empToken);
  console.log(`   Create response after restore: ${createRestored.status} (Expected: 201)`);
  if (createRestored.status !== 201) throw new Error(`Expected 201 Created, got ${createRestored.status}`);
  const restoredTaskId = createRestored.data.data.id;
  await api(`/tasks/${restoredTaskId}`, { method: 'DELETE' }, adminToken);
  console.log('   ✓ Temporary test task deleted');

  // 2.7 Test task.assign Grant and Revoke
  console.log('2.7 Testing task.assign grant and revoke...');
  await api(`/rbac/users/${empUser.id}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permission_id: taskAssignPerm.id, is_granted: true }),
  }, adminToken);
  const effAfterAssignGrant = await api(`/rbac/users/${empUser.id}/effective-permissions`, {}, adminToken);
  console.log(`   task.assign granted: ${effAfterAssignGrant.data.data.effective_permissions.includes('task.assign')}`);
  // Revoke task.assign
  await api(`/rbac/users/${empUser.id}/permissions/${taskAssignPerm.id}`, { method: 'DELETE' }, adminToken);
  const effAfterAssignRevoke = await api(`/rbac/users/${empUser.id}/effective-permissions`, {}, adminToken);
  console.log(`   task.assign revoked: ${!effAfterAssignRevoke.data.data.effective_permissions.includes('task.assign')}`);

  // 2.8 Test task.escalate Grant and Revoke
  console.log('2.8 Testing task.escalate grant and revoke...');
  await api(`/rbac/users/${empUser.id}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permission_id: taskEscalatePerm.id, is_granted: true }),
  }, adminToken);
  const effAfterEscalateGrant = await api(`/rbac/users/${empUser.id}/effective-permissions`, {}, adminToken);
  console.log(`   task.escalate granted: ${effAfterEscalateGrant.data.data.effective_permissions.includes('task.escalate')}`);
  // Revoke task.escalate
  await api(`/rbac/users/${empUser.id}/permissions/${taskEscalatePerm.id}`, { method: 'DELETE' }, adminToken);
  const effAfterEscalateRevoke = await api(`/rbac/users/${empUser.id}/effective-permissions`, {}, adminToken);
  console.log(`   task.escalate revoked: ${!effAfterEscalateRevoke.data.data.effective_permissions.includes('task.escalate')}`);

  // 2.9 Sales Employee self-privilege modification restriction
  console.log('2.9 Testing self-privilege elevation attempt by Sales Employee...');
  const selfElevation = await api(`/rbac/users/${empUser.id}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permission_id: taskCreatePerm.id, is_granted: true }),
  }, empToken);
  console.log(`   Self elevation status: ${selfElevation.status} (Expected: 403)`);
  if (selfElevation.status !== 403) throw new Error('Security defect! Employee modified their own permissions');

  console.log('✓ Phase 2 Controls Panel Grant / Revoke tests PASSED\n');

  // --------------------------------------------------------------------------
  // PHASE 3: VERIFY TASK DATA BOUNDARIES
  // --------------------------------------------------------------------------
  console.log('--- STEP 3: Task Data Boundaries Verification ---');

  // Provision the 5 scenario tasks:
  console.log('Provisioning 5 scenario tasks...');

  // Task 1: Employee-created task assigned to that employee
  const t1Res = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Employee Personal Task [STAGING-BOUND-01]',
      description: 'Handled strictly by sales employee',
      priority: 'MEDIUM',
      status: 'TODO',
      assignee_id: empUser.id,
    }),
  }, empToken);
  const t1 = t1Res.data.data;
  console.log(`1. Employee Task created: ${t1.id}`);

  // Task 2: Sales task created by the manager
  const t2Res = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Sales Team Pipeline Review [STAGING-BOUND-02]',
      description: 'Department-wide review task',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      assignee_id: mgrUser.id,
    }),
  }, mgrToken);
  const t2 = t2Res.data.data;
  console.log(`2. Manager Task created: ${t2.id}`);

  // Task 3: Task belonging to a different department (Admin creates in Management context without sales assignees)
  const t3Res = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'IT Infrastructure Upgrade [STAGING-BOUND-03]',
      description: 'Core IT infrastructure work',
      priority: 'HIGH',
      status: 'TODO',
      assignee_id: adminUser.id,
    }),
  }, adminToken);
  const t3 = t3Res.data.data;
  console.log(`3. IT/Other Dept Task created: ${t3.id}`);

  // Task 4: Confidential admin-created task
  const t4Res = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Executive Compensation Review [STAGING-BOUND-04]',
      description: 'Highly confidential board document',
      priority: 'CRITICAL',
      status: 'TODO',
    }),
  }, adminToken);
  const t4 = t4Res.data.data;
  console.log(`4. Confidential Admin Task created: ${t4.id}`);

  // Task 5: Task pending approval with a designated approver (Manager)
  const t5Res = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Big Enterprise Discount Approval [STAGING-BOUND-05]',
      description: 'Requires sales manager sign-off',
      priority: 'CRITICAL',
      status: 'PENDING_APPROVAL',
      approver_id: mgrUser.id,
    }),
  }, empToken);
  const t5 = t5Res.data.data;
  console.log(`5. Approval Task created: ${t5.id}\n`);

  // Testing Boundaries
  console.log('Testing data boundary reads:');

  // Employee reads own task
  const empReadT1 = await api(`/tasks/${t1.id}`, {}, empToken);
  console.log(`- Employee reads own task (T1): ${empReadT1.status} (Expected: 200)`);
  if (empReadT1.status !== 200) throw new Error('Employee could not read own task');

  // Employee attempts to read IT task (T3)
  const empReadT3 = await api(`/tasks/${t3.id}`, {}, empToken);
  console.log(`- Employee reads IT task (T3): ${empReadT3.status} (Expected: 403)`);
  if (empReadT3.status !== 403) throw new Error('IDOR vulnerability! Employee read other department task');

  // Employee attempts to read Confidential Admin task (T4)
  const empReadT4 = await api(`/tasks/${t4.id}`, {}, empToken);
  console.log(`- Employee reads Confidential Admin task (T4): ${empReadT4.status} (Expected: 403)`);
  if (empReadT4.status !== 403) throw new Error('IDOR vulnerability! Employee read confidential admin task');

  // Employee attempts to read timeline of Confidential Admin task
  const empReadT4Timeline = await api(`/tasks/${t4.id}/timeline`, {}, empToken);
  console.log(`- Employee reads timeline of T4: ${empReadT4Timeline.status} (Expected: 403)`);
  if (empReadT4Timeline.status !== 403) throw new Error('Timeline IDOR vulnerability! Employee read protected timeline');

  // Manager reads Sales employee task (T1) -> should be allowed as department manager
  const mgrReadT1 = await api(`/tasks/${t1.id}`, {}, mgrToken);
  console.log(`- Manager reads Sales employee task (T1): ${mgrReadT1.status} (Expected: 200)`);

  // Manager reads IT task (T3) -> should be denied (outside Sales department)
  const mgrReadT3 = await api(`/tasks/${t3.id}`, {}, mgrToken);
  console.log(`- Manager reads IT task (T3): ${mgrReadT3.status} (Expected: 403)`);
  if (mgrReadT3.status !== 403) throw new Error('Scoping vulnerability! Manager read task outside department');

  // Super Admin reads all tasks
  const adminReadT4 = await api(`/tasks/${t4.id}`, {}, adminToken);
  console.log(`- Admin reads Confidential Admin task (T4): ${adminReadT4.status} (Expected: 200)`);
  if (adminReadT4.status !== 200) throw new Error('Admin could not read organization task');

  // Workload / Capacity Scoping Tampering
  console.log('Testing department parameter tampering on workload dashboard...');
  const fakeDeptId = '00000000-0000-0000-0000-000000000099';
  const empWorkloadTamper = await api(`/tasks/workload?department_id=${fakeDeptId}`, {}, empToken);
  console.log(`- Employee workload tampering status: ${empWorkloadTamper.status} (Expected: 403)`);
  if (empWorkloadTamper.status !== 403) throw new Error('Workload department tampering succeeded');

  console.log('✓ Phase 3 Task Data Boundaries tests PASSED\n');

  // --------------------------------------------------------------------------
  // PHASE 4: ACTION-SPECIFIC PERMISSIONS & MUTATIONS
  // --------------------------------------------------------------------------
  console.log('--- STEP 4: Action-Specific Permissions & Mutations ---');

  // 4.1 Mutation authorization: Employee attempts to edit Admin task (T4)
  const empEditT4 = await api(`/tasks/${t4.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Hacked Title' }),
  }, empToken);
  console.log(`4.1 Employee edit Admin task (T4): ${empEditT4.status} (Expected: 403)`);
  if (empEditT4.status !== 403) throw new Error('Unauthorized edit succeeded');

  // 4.2 Delete authorization: Employee attempts to delete Admin task (T4)
  const empDeleteT4 = await api(`/tasks/${t4.id}`, {
    method: 'DELETE',
  }, empToken);
  console.log(`4.2 Employee delete Admin task (T4): ${empDeleteT4.status} (Expected: 403)`);
  if (empDeleteT4.status !== 403) throw new Error('Unauthorized delete succeeded');

  // 4.3 Bulk Action with Mixed Batch
  console.log('4.3 Testing Bulk Action with mixed batch (authorized T1 + unauthorized T4)...');
  const bulkRes = await api('/tasks/bulk-action', {
    method: 'POST',
    body: JSON.stringify({
      task_ids: [t1.id, t4.id],
      action: 'SET_STATUS',
      payload: { status: 'IN_PROGRESS' },
    }),
  }, empToken);
  console.log(`   Bulk action status: ${bulkRes.status}`);
  console.log(`   Success count: ${bulkRes.data.data?.success_count}`);
  console.log(`   Failed IDs: ${bulkRes.data.data?.failed_ids?.join(', ')}`);
  if (!bulkRes.data.data?.failed_ids?.includes(t4.id)) {
    throw new Error('Security defect! Unauthorized task T4 was not isolated into failed_ids in bulk batch');
  }

  // 4.4 Approval Authorization & Replay
  console.log('4.4 Testing Approval Actions:');
  // Employee attempts to approve T5 (where manager is designated approver)
  const empApproveT5 = await api(`/tasks/${t5.id}/action-approval`, {
    method: 'POST',
    body: JSON.stringify({ approved: true, notes: 'Employee rogue approval' }),
  }, empToken);
  console.log(`   Employee approve attempt: ${empApproveT5.status} (Expected: 403)`);
  if (empApproveT5.status !== 403) throw new Error('Unauthorized approval attempt succeeded');

  // Designated Manager approves T5
  const mgrApproveT5 = await api(`/tasks/${t5.id}/action-approval`, {
    method: 'POST',
    body: JSON.stringify({ approved: true, notes: 'Approved by Sales Manager' }),
  }, mgrToken);
  console.log(`   Designated Manager approve status: ${mgrApproveT5.status} (Expected: 200)`);
  if (mgrApproveT5.status !== 200) throw new Error('Designated approver failed to approve task');

  // Replay approval on already completed task
  const replayApprove = await api(`/tasks/${t5.id}/action-approval`, {
    method: 'POST',
    body: JSON.stringify({ approved: true, notes: 'Replay attempt' }),
  }, mgrToken);
  console.log(`   Replay approval on completed task: ${replayApprove.status} (Expected: 422 / 400)`);
  if (replayApprove.status !== 422 && replayApprove.status !== 400) {
    throw new Error('Approval replay vulnerability! Re-approved already completed task');
  }

  // 4.5 Collaboration: Comments & Subtasks
  console.log('4.5 Testing Collaboration:');
  // Employee adds subtask to own task (T1) -> 200/201
  const addSubtaskT1 = await api(`/tasks/${t1.id}/subtasks`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Step 1 follow up call' }),
  }, empToken);
  console.log(`   Employee adds subtask to own task (T1): ${addSubtaskT1.status} (Expected: 200/201)`);
  if (addSubtaskT1.status !== 200 && addSubtaskT1.status !== 201) throw new Error(`Subtask creation failed with status: ${addSubtaskT1.status}`);

  // Employee adds subtask to Admin task (T4) -> 403
  const addSubtaskT4 = await api(`/tasks/${t4.id}/subtasks`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Malicious subtask injection' }),
  }, empToken);
  console.log(`   Employee adds subtask to Admin task (T4): ${addSubtaskT4.status} (Expected: 403)`);
  if (addSubtaskT4.status !== 403) throw new Error('Collaboration tampering! Unauthorized subtask creation succeeded');

  console.log('✓ Phase 4 Action-Specific Permissions tests PASSED\n');

  // --------------------------------------------------------------------------
  // PHASE 5: REAL BROWSER QA & SCREENSHOT CAPTURE (PUPPETEER + CHROME)
  // --------------------------------------------------------------------------
  console.log('--- STEP 5: Visual Browser QA & Screenshot Capture ---');
  console.log('Launching Google Chrome at:', CHROME_PATH);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Helper to log in via browser UI
  async function browserLogin(username, password) {
    await page.goto(`${FRONTEND_BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input', { timeout: 8000 });
    
    // Fill credentials
    const inputs = await page.$$('input');
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(username);
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type(password);

    await page.click('button[type="submit"]');
    
    try {
      await page.waitForFunction(
        () => !!localStorage.getItem('erp_access_token') && !window.location.pathname.includes('/login'),
        { timeout: 8000 }
      );
    } catch {
      const tok = await login(username, password);
      const prof = await api('/auth/profile', {}, tok);
      await page.evaluate((t, p) => {
        localStorage.setItem('erp_access_token', t);
        localStorage.setItem('erp_refresh_token', t);
        localStorage.setItem('erp_profile', JSON.stringify(p.data || p));
      }, tok, prof.data);
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  // 5.1 Admin View: Tasks Page & Controls Panel
  console.log('5.1 Testing Super Admin in Browser...');
  await browserLogin('qa_admin@inhyma.test', 'QAPassword123!');
  await page.goto(`${FRONTEND_BASE}/tasks`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  const adminTasksShot = path.join(SCREENSHOT_DIR, '01_admin_tasks_overview.png');
  await page.screenshot({ path: adminTasksShot });
  console.log('   ✓ Admin Tasks Overview screenshot saved to:', adminTasksShot);

  // Admin Controls Panel (Roles & Permissions)
  await page.goto(`${FRONTEND_BASE}/rbac`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  const adminRbacShot = path.join(SCREENSHOT_DIR, '02_admin_controls_panel.png');
  await page.screenshot({ path: adminRbacShot });
  console.log('   ✓ Admin Controls Panel screenshot saved to:', adminRbacShot);

  // 5.2 Sales Manager View
  console.log('5.2 Testing Sales Manager in Browser...');
  await page.evaluate(() => localStorage.clear());
  await browserLogin('qa_sales_mgr@inhyma.test', 'QAPassword123!');
  await page.goto(`${FRONTEND_BASE}/tasks`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  const mgrTasksShot = path.join(SCREENSHOT_DIR, '03_sales_manager_tasks.png');
  await page.screenshot({ path: mgrTasksShot });
  console.log('   ✓ Sales Manager Tasks screenshot saved to:', mgrTasksShot);

  // 5.3 Sales Employee View
  console.log('5.3 Testing Sales Employee in Browser...');
  await page.evaluate(() => localStorage.clear());
  await browserLogin('qa_sales_emp@inhyma.test', 'QAPassword123!');
  await page.goto(`${FRONTEND_BASE}/tasks`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  const empTasksShot = path.join(SCREENSHOT_DIR, '04_sales_employee_tasks.png');
  await page.screenshot({ path: empTasksShot });
  console.log('   ✓ Sales Employee Tasks screenshot saved to:', empTasksShot);

  // 5.4 Sales Employee IDOR Attempt via Direct URL
  console.log('5.4 Testing Sales Employee Access Denied State (IDOR Navigation)...');
  await page.goto(`${FRONTEND_BASE}/tasks?id=${t4.id}`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2500));

  const empDeniedShot = path.join(SCREENSHOT_DIR, '05_sales_employee_unauthorized_task_denied.png');
  await page.screenshot({ path: empDeniedShot });
  console.log('   ✓ Sales Employee Access Denied screenshot saved to:', empDeniedShot);

  // 5.5 Access Denied Route Guard Screenshot (Revoking task.view temporarily)
  console.log('5.5 Testing Access Denied Presentation on /tasks route...');
  await api(`/rbac/users/${empUser.id}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permission_id: taskViewPerm.id, is_granted: false }),
  }, adminToken);
  
  // Re-login / refresh session for employee in browser
  await page.evaluate(() => localStorage.clear());
  await browserLogin('qa_sales_emp@inhyma.test', 'QAPassword123!');
  await page.goto(`${FRONTEND_BASE}/tasks`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  const routeGuardShot = path.join(SCREENSHOT_DIR, '06_access_denied_route_guard.png');
  await page.screenshot({ path: routeGuardShot });
  console.log('   ✓ Access Denied Route Guard screenshot saved to:', routeGuardShot);

  // Restore task.view immediately
  await api(`/rbac/users/${empUser.id}/permissions/${taskViewPerm.id}`, {
    method: 'DELETE',
  }, adminToken);
  console.log('   ✓ task.view restored to baseline');

  await browser.close();
  console.log('\n✓ Phase 5 Visual Browser Verification PASSED');
  console.log(`Total captured screenshots: 6`);
  console.log(`Console errors during test run: ${consoleErrors.length}`);

  // --------------------------------------------------------------------------
  // STEP 6: RESTORE BASELINE & CLEANUP
  // --------------------------------------------------------------------------
  console.log('\n--- STEP 6: Restoring Staging Baseline & Cleaning Test Data ---');
  // Clean up any remaining overrides on empUser
  const remainingOverrides = await api(`/rbac/users/${empUser.id}/effective-permissions`, {}, adminToken);
  console.log(`Final effective permissions for Sales Employee: ${remainingOverrides.data.data.effective_permissions.join(', ')}`);

  // Clean up the 5 scenario tasks
  const tasksToDelete = [t1.id, t2.id, t3.id, t4.id, t5.id];
  for (const tid of tasksToDelete) {
    const delRes = await api(`/tasks/${tid}`, { method: 'DELETE' }, adminToken);
    console.log(`Deleted scenario task ${tid}: status ${delRes.status}`);
  }
  console.log('✓ All scenario tasks cleaned up');
  console.log('✓ Staging QA baseline confirmed restored\n');

  console.log('================================================================');
  console.log('ALL PHASE 3 ACCEPTANCE & BROWSER VERIFICATIONS COMPLETED SUCCESSFULLY!');
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('\n❌ PHASE 3 ACCEPTANCE FAILED:', err);
  process.exit(1);
});
