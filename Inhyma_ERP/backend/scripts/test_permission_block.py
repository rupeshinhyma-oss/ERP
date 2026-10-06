import asyncio
import app.users.models
from httpx import AsyncClient, ASGITransport
from app.main import create_application

async def test():
    app = create_application()
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        # 1. Admin login
        admin_res = await client.post('/api/v1/auth/login', json={'identifier': 'admin', 'password': 'ChangeMe!12345'})
        assert admin_res.status_code == 200, f'Admin login failed: {admin_res.text}'
        admin_token = admin_res.json()['data']['access_token']
        admin_headers = {'Authorization': f'Bearer {admin_token}'}
        print('1. Admin login SUCCESS')

        # 2. Alice login
        alice_res = await client.post('/api/v1/auth/login', json={'identifier': 'alice', 'password': 'password123'})
        assert alice_res.status_code == 200, f'Alice login failed: {alice_res.text}'
        alice_data = alice_res.json()['data']
        alice_token = alice_data['access_token']
        alice_id = alice_data['user']['id']
        alice_headers = {'Authorization': f'Bearer {alice_token}'}
        print('2. Alice login SUCCESS. User ID:', alice_id)

        # 3. Alice accesses expenses -> 200 OK
        exp_res = await client.get('/api/v1/hrms/expenses', headers=alice_headers)
        assert exp_res.status_code == 200, f'Expected 200, got {exp_res.status_code}: {exp_res.text}'
        print('3. Alice accesses Expenses: 200 OK (PASS)')

        # Find permission id for hrms.expenses
        perms_res = await client.get('/api/v1/rbac/permissions', headers=admin_headers)
        perms_list = perms_res.json()['data']
        exp_perm = next(p for p in perms_list if p['code'] == 'hrms.expenses')
        exp_perm_id = exp_perm['id']

        # 4. Admin revokes hrms.expenses from Alice
        revoke_res = await client.post(
            f'/api/v1/rbac/users/{alice_id}/permissions',
            headers=admin_headers,
            json={'permission_id': exp_perm_id, 'is_granted': False}
        )
        assert revoke_res.status_code == 200, f'Revoke failed: {revoke_res.text}'
        print('4. Admin revokes hrms.expenses from Alice: SUCCESS')

        # Alice logs in again to get fresh token
        alice_res2 = await client.post('/api/v1/auth/login', json={'identifier': 'alice', 'password': 'password123'})
        alice_token2 = alice_res2.json()['data']['access_token']
        alice_headers2 = {'Authorization': f'Bearer {alice_token2}'}
        alice_perms2 = alice_res2.json()['data']['user']['permissions']
        assert 'hrms.expenses' not in alice_perms2, 'hrms.expenses should not be in Alice permissions!'
        print('   hrms.expenses removed from Alice token perms: VERIFIED')

        # 5. Alice accesses expenses -> MUST return 403 Forbidden!
        exp_blocked = await client.get('/api/v1/hrms/expenses', headers=alice_headers2)
        assert exp_blocked.status_code == 403, f'Expected 403 Forbidden, got {exp_blocked.status_code}: {exp_blocked.text}'
        print('5. Alice accessing Expenses while blocked: 403 FORBIDDEN (PASS)')

        # 6. Alice accesses attendance -> MUST return 200 OK!
        att_res = await client.get('/api/v1/hrms/attendance/calendar?year=2026&month=10', headers=alice_headers2)
        assert att_res.status_code == 200, f'Expected 200, got {att_res.status_code}: {att_res.text}'
        print('6. Other HRMS module (Attendance) still works for Alice: 200 OK (PASS)')

        # 7. Admin restores hrms.expenses for Alice
        restore_res = await client.delete(
            f'/api/v1/rbac/users/{alice_id}/permissions/{exp_perm_id}',
            headers=admin_headers
        )
        assert restore_res.status_code == 200, f'Restore failed: {restore_res.text}'
        print('7. Admin restores hrms.expenses override: SUCCESS')

        # Alice logs in again
        alice_res3 = await client.post('/api/v1/auth/login', json={'identifier': 'alice', 'password': 'password123'})
        alice_token3 = alice_res3.json()['data']['access_token']
        alice_headers3 = {'Authorization': f'Bearer {alice_token3}'}
        exp_restored = await client.get('/api/v1/hrms/expenses', headers=alice_headers3)
        assert exp_restored.status_code == 200, f'Expected 200, got {exp_restored.status_code}'
        print('8. Alice accesses Expenses after restore: 200 OK (PASS)')

        # 8. Repeat with second module: hrms.site_visits
        sv_perm = next(p for p in perms_list if p['code'] == 'hrms.site_visits')
        sv_perm_id = sv_perm['id']
        await client.post(
            f'/api/v1/rbac/users/{alice_id}/permissions',
            headers=admin_headers,
            json={'permission_id': sv_perm_id, 'is_granted': False}
        )
        alice_res4 = await client.post('/api/v1/auth/login', json={'identifier': 'alice', 'password': 'password123'})
        alice_token4 = alice_res4.json()['data']['access_token']
        alice_headers4 = {'Authorization': f'Bearer {alice_token4}'}
        sv_blocked = await client.get('/api/v1/hrms/site-visits', headers=alice_headers4)
        assert sv_blocked.status_code == 403, f'Expected 403, got {sv_blocked.status_code}'
        print('9. Alice accessing Site Visits while blocked: 403 FORBIDDEN (PASS)')

        # Restore site visits
        await client.delete(f'/api/v1/rbac/users/{alice_id}/permissions/{sv_perm_id}', headers=admin_headers)
        alice_res5 = await client.post('/api/v1/auth/login', json={'identifier': 'alice', 'password': 'password123'})
        alice_token5 = alice_res5.json()['data']['access_token']
        sv_restored = await client.get('/api/v1/hrms/site-visits', headers={'Authorization': f'Bearer {alice_token5}'})
        assert sv_restored.status_code == 200, f'Expected 200, got {sv_restored.status_code}'
        print('10. Alice accessing Site Visits after restore: 200 OK (PASS)')

if __name__ == '__main__':
    asyncio.run(test())
