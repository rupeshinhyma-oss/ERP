import asyncio
import uuid
from datetime import date, datetime, timezone, timedelta
import app.users.models
from app.database.engine import get_sessionmaker
from sqlalchemy import text, select
from app.users.models import User
from app.hrms.models import (
    HrmsLocation, HrmsEmployeeLocation, HrmsLeaveType, HrmsHoliday,
    HrmsAttendance, HrmsAttendanceRegularization, HrmsLeaveRequest,
    HrmsAsset, HrmsAssetAssignment, HrmsExpense, HrmsSiteVisit,
    HrmsPayrollComponent, HrmsEmployeeSalary
)
from app.hrms.payroll_service import HrmsPayrollService

async def seed_data():
    sm = get_sessionmaker()
    async with sm() as session:
        print("=== SEEDING REAL POSTGRESQL QA DATA FOR OCTOBER 2026 ===")
        
        # 1. Fetch Users
        users = {}
        for uname in ['admin', 'alice', 'sales_manager', 'john', 'ops_employee']:
            u = (await session.execute(select(User).where(User.username == uname))).scalar_one_or_none()
            if not u:
                raise RuntimeError(f"User {uname} not found!")
            users[uname] = u
            print(f"User {uname}: id={u.id}, dept={getattr(u, 'department', None)}")

        # Ensure manager_id on john is sales_manager
        users['john'].manager_id = users['sales_manager'].id
        await session.commit()

        # 2. Locations
        loc_res = (await session.execute(select(HrmsLocation).where(HrmsLocation.deleted_at.is_(None)))).scalars().all()
        if not loc_res:
            thane_office = HrmsLocation(
                id=uuid.uuid4(),
                name="Inhyma Thane HQ",
                location_type="OFFICE",
                address="Lodha Supremus, Road 22, Wagle Estate, Thane, Maharashtra 400604",
                latitude=19.199824,
                longitude=72.956795,
                radius_meters=150.0,
                is_active=True,
            )
            session.add(thane_office)
            await session.flush()
        else:
            thane_office = loc_res[0]
        print(f"Office Location: {thane_office.name} ({thane_office.id})")

        # Assign location to John and ops_employee
        for u in [users['john'], users['ops_employee']]:
            el_existing = (await session.execute(
                select(HrmsEmployeeLocation).where(
                    HrmsEmployeeLocation.user_id == u.id,
                    HrmsEmployeeLocation.location_id == thane_office.id
                )
            )).scalar_one_or_none()
            if not el_existing:
                session.add(HrmsEmployeeLocation(
                    id=uuid.uuid4(),
                    user_id=u.id,
                    location_id=thane_office.id,
                    is_primary=True,
                ))
        await session.commit()

        # 3. Corporate Holidays for October 2026
        # Gandhi Jayanti on 2026-10-02
        gj = (await session.execute(
            select(HrmsHoliday).where(HrmsHoliday.holiday_date == date(2026, 10, 2))
        )).scalar_one_or_none()
        if not gj:
            session.add(HrmsHoliday(
                id=uuid.uuid4(),
                name="Gandhi Jayanti",
                holiday_date=date(2026, 10, 2),
                is_active=True,
                branch_applicability="All Branches",
                department_scope="All Departments",
            ))
            await session.commit()
            print("Added Gandhi Jayanti holiday: 2026-10-02")

        # 4. Leave Types
        cl = (await session.execute(
            select(HrmsLeaveType).where(HrmsLeaveType.name == "Casual Leave")
        )).scalar_one_or_none()
        if not cl:
            cl = (await session.execute(
                select(HrmsLeaveType).where(HrmsLeaveType.is_active == True)
            )).scalars().first()
        print(f"Leave Type: {cl.name} ({cl.id})")

        # Clean existing test records for October 2026 for John & ops_employee to make it crisp and consistent
        await session.execute(text("""
            DELETE FROM hrms_attendance_regularizations
            WHERE employee_id IN (:j, :o) AND attendance_date >= '2026-10-01' AND attendance_date <= '2026-10-31';
        """), {'j': users['john'].id, 'o': users['ops_employee'].id})
        
        await session.execute(text("""
            DELETE FROM hrms_attendance
            WHERE employee_id IN (:j, :o) AND attendance_date >= '2026-10-01' AND attendance_date <= '2026-10-31';
        """), {'j': users['john'].id, 'o': users['ops_employee'].id})

        await session.execute(text("""
            DELETE FROM hrms_leave_requests
            WHERE employee_id IN (:j, :o) AND from_date >= '2026-10-01' AND from_date <= '2026-10-31';
        """), {'j': users['john'].id, 'o': users['ops_employee'].id})
        await session.commit()

        # 5. ATTENDANCE & REGULARIZATION DATA
        # John:
        # Oct 1 (Thu): Present (9:00 AM - 6:00 PM)
        att_j_1 = HrmsAttendance(
            id=uuid.uuid4(),
            employee_id=users['john'].id,
            attendance_date=date(2026, 10, 1),
            punch_in=datetime(2026, 10, 1, 3, 30, 0, tzinfo=timezone.utc), # 9:00 AM IST
            punch_out=datetime(2026, 10, 1, 12, 30, 0, tzinfo=timezone.utc), # 6:00 PM IST
            status="PRESENT",
            working_minutes=540,
            late_minutes=0,
            office_location_id=thane_office.id,
            regularization_status="NONE",
            is_irregular=False,
        )
        session.add(att_j_1)

        # Oct 2 (Fri): Holiday Gandhi Jayanti (handled by calendar)

        # Oct 3 (Sat): Late Attendance with Approved Regularization
        # Punched in 10:15 AM (late), regularized and approved by Sales Manager
        att_j_3 = HrmsAttendance(
            id=uuid.uuid4(),
            employee_id=users['john'].id,
            attendance_date=date(2026, 10, 3),
            punch_in=datetime(2026, 10, 3, 4, 45, 0, tzinfo=timezone.utc), # 10:15 AM IST
            punch_out=datetime(2026, 10, 3, 13, 0, 0, tzinfo=timezone.utc), # 6:30 PM IST
            status="PRESENT",
            working_minutes=495,
            late_minutes=45,
            office_location_id=thane_office.id,
            regularization_status="APPROVED",
            regularization_reason="Client meeting on the way to office",
            regularization_note="Approved as discussed",
            is_irregular=False,
        )
        session.add(att_j_3)
        await session.flush()

        # Regularization record for Oct 3 (Approved)
        reg_j_3 = HrmsAttendanceRegularization(
            id=uuid.uuid4(),
            employee_id=users['john'].id,
            attendance_record_id=att_j_3.id,
            attendance_date=date(2026, 10, 3),
            request_type="LATE_ARRIVAL",
            reason="Client meeting on the way to office",
            punch_in_time="09:30 AM",
            punch_out_time="06:30 PM",
            total_hours="9h 00m",
            status="APPROVED",
            submitted_at=datetime(2026, 10, 3, 14, 0, 0, tzinfo=timezone.utc),
            reviewed_at=datetime(2026, 10, 4, 5, 0, 0, tzinfo=timezone.utc),
            reviewed_by=users['sales_manager'].id,
            manager_remarks="Client visit confirmed. Approved.",
            action_taken="APPROVE",
        )
        session.add(reg_j_3)

        # Oct 5 (Mon): Present with Pending Regularization
        att_j_5 = HrmsAttendance(
            id=uuid.uuid4(),
            employee_id=users['john'].id,
            attendance_date=date(2026, 10, 5),
            punch_in=datetime(2026, 10, 5, 5, 20, 0, tzinfo=timezone.utc), # 10:50 AM IST
            punch_out=datetime(2026, 10, 5, 13, 30, 0, tzinfo=timezone.utc), # 7:00 PM IST
            status="LATE",
            working_minutes=490,
            late_minutes=50,
            office_location_id=thane_office.id,
            regularization_status="PENDING",
            regularization_reason="Metro rail technical disruption",
            is_irregular=True,
        )
        session.add(att_j_5)
        await session.flush()

        # Regularization record for Oct 5 (Pending)
        reg_j_5 = HrmsAttendanceRegularization(
            id=uuid.uuid4(),
            employee_id=users['john'].id,
            attendance_record_id=att_j_5.id,
            attendance_date=date(2026, 10, 5),
            request_type="LATE_ARRIVAL",
            reason="Metro rail technical disruption",
            punch_in_time="09:30 AM",
            punch_out_time="07:00 PM",
            total_hours="9h 30m",
            status="PENDING",
            submitted_at=datetime(2026, 10, 5, 14, 0, 0, tzinfo=timezone.utc),
        )
        session.add(reg_j_5)

        # Oct 6 (Tue - Today): Present (Punched in)
        att_j_6 = HrmsAttendance(
            id=uuid.uuid4(),
            employee_id=users['john'].id,
            attendance_date=date(2026, 10, 6),
            punch_in=datetime(2026, 10, 6, 3, 35, 0, tzinfo=timezone.utc), # 9:05 AM IST
            punch_out=None, # In progress
            status="PRESENT",
            working_minutes=330,
            late_minutes=0,
            office_location_id=thane_office.id,
            regularization_status="NONE",
            is_irregular=False,
        )
        session.add(att_j_6)

        # ops_employee:
        # Oct 1 (Thu): Present
        att_o_1 = HrmsAttendance(
            id=uuid.uuid4(),
            employee_id=users['ops_employee'].id,
            attendance_date=date(2026, 10, 1),
            punch_in=datetime(2026, 10, 1, 3, 25, 0, tzinfo=timezone.utc),
            punch_out=datetime(2026, 10, 1, 12, 15, 0, tzinfo=timezone.utc),
            status="PRESENT",
            working_minutes=530,
            late_minutes=0,
            office_location_id=thane_office.id,
            regularization_status="NONE",
            is_irregular=False,
        )
        session.add(att_o_1)

        # Oct 3 (Sat): Absent (LOP case)
        att_o_3 = HrmsAttendance(
            id=uuid.uuid4(),
            employee_id=users['ops_employee'].id,
            attendance_date=date(2026, 10, 3),
            punch_in=None,
            punch_out=None,
            status="ABSENT",
            working_minutes=0,
            late_minutes=0,
            office_location_id=thane_office.id,
            regularization_status="NONE",
            is_irregular=True,
        )
        session.add(att_o_3)

        # Oct 5 (Mon): Present
        att_o_5 = HrmsAttendance(
            id=uuid.uuid4(),
            employee_id=users['ops_employee'].id,
            attendance_date=date(2026, 10, 5),
            punch_in=datetime(2026, 10, 5, 3, 30, 0, tzinfo=timezone.utc),
            punch_out=datetime(2026, 10, 5, 12, 30, 0, tzinfo=timezone.utc),
            status="PRESENT",
            working_minutes=540,
            late_minutes=0,
            office_location_id=thane_office.id,
            regularization_status="NONE",
            is_irregular=False,
        )
        session.add(att_o_5)

        # Oct 6 (Tue): Present
        att_o_6 = HrmsAttendance(
            id=uuid.uuid4(),
            employee_id=users['ops_employee'].id,
            attendance_date=date(2026, 10, 6),
            punch_in=datetime(2026, 10, 6, 3, 30, 0, tzinfo=timezone.utc),
            punch_out=datetime(2026, 10, 6, 12, 30, 0, tzinfo=timezone.utc),
            status="PRESENT",
            working_minutes=540,
            late_minutes=0,
            office_location_id=thane_office.id,
            regularization_status="NONE",
            is_irregular=False,
        )
        session.add(att_o_6)
        await session.commit()
        print("Created Attendance records & Regularizations for John and ops_employee.")

        # 6. LEAVE REQUESTS
        # John: Approved Leave (Oct 8 - Oct 9)
        leave_j_appr = HrmsLeaveRequest(
            id=uuid.uuid4(),
            employee_id=users['john'].id,
            leave_type_id=cl.id,
            from_date=date(2026, 10, 8),
            to_date=date(2026, 10, 9),
            number_of_days=2.0,
            reason="Family function and personal commitments",
            status="APPROVED",
            approval_status="APPROVED",
            approved_by=users['sales_manager'].id,
            approval_remarks="Approved by Sales Manager",
        )
        session.add(leave_j_appr)

        # John: Pending Leave Request (Oct 19)
        leave_j_pend = HrmsLeaveRequest(
            id=uuid.uuid4(),
            employee_id=users['john'].id,
            leave_type_id=cl.id,
            from_date=date(2026, 10, 19),
            to_date=date(2026, 10, 19),
            number_of_days=1.0,
            reason="Routine health checkup",
            status="PENDING",
            approval_status="PENDING",
        )
        session.add(leave_j_pend)

        # ops_employee: Approved Leave (Oct 12)
        leave_o_appr = HrmsLeaveRequest(
            id=uuid.uuid4(),
            employee_id=users['ops_employee'].id,
            leave_type_id=cl.id,
            from_date=date(2026, 10, 12),
            to_date=date(2026, 10, 12),
            number_of_days=1.0,
            reason="Personal relocation work",
            status="APPROVED",
            approval_status="APPROVED",
            approved_by=users['alice'].id,
            approval_remarks="Approved by HR",
        )
        session.add(leave_o_appr)
        await session.commit()
        print("Created Leave requests for John and ops_employee.")

        # 7. ASSETS
        # Clean existing asset assignments for clean state
        await session.execute(text("DELETE FROM hrms_asset_assignments WHERE employee_id IN (:j, :o);"), {'j': users['john'].id, 'o': users['ops_employee'].id})
        await session.execute(text("DELETE FROM hrms_assets WHERE assigned_to_user_id IN (:j, :o);"), {'j': users['john'].id, 'o': users['ops_employee'].id})
        await session.commit()

        asset_j = HrmsAsset(
            id=uuid.uuid4(),
            asset_code="AST-DEV-001",
            asset_name="Dell Latitude 7420 Laptop",
            asset_category="LAPTOP",
            brand="Dell",
            model="Latitude 7420 Core i7",
            serial_number="DL-LAT-7420-9831",
            purchase_date=date(2025, 4, 15),
            purchase_cost=85000.0,
            status="ASSIGNED",
            condition="EXCELLENT",
            location_id=thane_office.id,
            assigned_to_user_id=users['john'].id,
            assigned_date=date(2026, 1, 10),
            description="Work laptop assigned to Sales team",
        )
        session.add(asset_j)
        await session.flush()

        session.add(HrmsAssetAssignment(
            id=uuid.uuid4(),
            asset_id=asset_j.id,
            employee_id=users['john'].id,
            assigned_at=date(2026, 1, 10),
            assignment_status="ACTIVE",
            condition_at_assignment="NEW",
            assignment_notes="Assigned for official sales operations",
            assigned_by=users['alice'].id,
        ))

        asset_o = HrmsAsset(
            id=uuid.uuid4(),
            asset_code="AST-OPS-001",
            asset_name="Lenovo ThinkPad T14",
            asset_category="LAPTOP",
            brand="Lenovo",
            model="ThinkPad T14 Gen 3",
            serial_number="LN-TP-T14-5542",
            purchase_date=date(2025, 6, 20),
            purchase_cost=78000.0,
            status="ASSIGNED",
            condition="EXCELLENT",
            location_id=thane_office.id,
            assigned_to_user_id=users['ops_employee'].id,
            assigned_date=date(2026, 2, 1),
            description="Work laptop assigned to Operations",
        )
        session.add(asset_o)
        await session.flush()

        session.add(HrmsAssetAssignment(
            id=uuid.uuid4(),
            asset_id=asset_o.id,
            employee_id=users['ops_employee'].id,
            assigned_at=date(2026, 2, 1),
            assignment_status="ACTIVE",
            condition_at_assignment="NEW",
            assignment_notes="Assigned for operations management",
            assigned_by=users['alice'].id,
        ))
        await session.commit()
        print("Created and assigned Assets for John and ops_employee.")

        # 8. EXPENSES
        await session.execute(text("DELETE FROM hrms_expenses WHERE employee_id IN (:j, :o);"), {'j': users['john'].id, 'o': users['ops_employee'].id})
        await session.commit()

        # John: Approved Expense (Oct 4)
        exp_j = HrmsExpense(
            id=uuid.uuid4(),
            expense_code="EXP-2026-001",
            employee_id=users['john'].id,
            expense_date=date(2026, 10, 4),
            category="Travel & Transport",
            amount=1450.0,
            currency="INR",
            description="Client sales visit travel conveyance",
            location_id=thane_office.id,
            status="APPROVED",
            submitted_at=datetime(2026, 10, 4, 12, 0, 0, tzinfo=timezone.utc),
            reviewed_at=datetime(2026, 10, 5, 6, 0, 0, tzinfo=timezone.utc),
            reviewed_by=users['sales_manager'].id,
        )
        session.add(exp_j)

        # ops_employee: Pending Expense (Oct 5)
        exp_o = HrmsExpense(
            id=uuid.uuid4(),
            expense_code="EXP-2026-002",
            employee_id=users['ops_employee'].id,
            expense_date=date(2026, 10, 5),
            category="Office Supplies",
            amount=850.0,
            currency="INR",
            description="Logistics warehouse barcode labels and packing tape",
            location_id=thane_office.id,
            status="PENDING",
            submitted_at=datetime(2026, 10, 5, 10, 0, 0, tzinfo=timezone.utc),
        )
        session.add(exp_o)
        await session.commit()
        print("Created Expenses for John (Approved) and ops_employee (Pending).")

        # 9. SITE VISITS
        await session.execute(text("DELETE FROM hrms_site_visits WHERE employee_id IN (:j, :o);"), {'j': users['john'].id, 'o': users['ops_employee'].id})
        await session.commit()

        # John: Site Visit (Completed with Check-in / Check-out evidence)
        sv_j = HrmsSiteVisit(
            id=uuid.uuid4(),
            employee_id=users['john'].id,
            customer_name="Tata Steel Industrial Complex",
            site_address="Plot B-14, MIDC Industrial Area, Tarapur, Boisar, Maharashtra 401506",
            site_latitude=19.7892,
            site_longitude=72.7485,
            visit_date=date(2026, 10, 4),
            planned_start_time="10:00",
            planned_end_time="14:00",
            status="COMPLETED",
            notes="Quarterly enterprise client review and renewal discussion",
            check_in_time=datetime(2026, 10, 4, 4, 30, 0, tzinfo=timezone.utc),
            check_in_latitude=19.7891,
            check_in_longitude=72.7484,
            check_in_accuracy=10.5,
            check_in_address="Tarapur MIDC Main Gate",
            check_out_time=datetime(2026, 10, 4, 8, 30, 0, tzinfo=timezone.utc),
            check_out_latitude=19.7893,
            check_out_longitude=72.7486,
            check_out_accuracy=12.0,
            check_out_address="Tarapur MIDC Main Gate",
            created_by=users['sales_manager'].id,
        )
        session.add(sv_j)

        # ops_employee: Site Visit (Scheduled)
        sv_o = HrmsSiteVisit(
            id=uuid.uuid4(),
            employee_id=users['ops_employee'].id,
            customer_name="Bhiwandi Central Fulfillment Hub",
            site_address="Survey 142, Mankoli Naka, Bhiwandi-Kalyan Road, Bhiwandi, Maharashtra 421302",
            site_latitude=19.2981,
            site_longitude=73.0562,
            visit_date=date(2026, 10, 7),
            planned_start_time="09:30",
            planned_end_time="16:00",
            status="SCHEDULED",
            notes="Warehouse dispatch audit and inventory stock verification",
            created_by=users['admin'].id,
        )
        session.add(sv_o)
        await session.commit()
        print("Created Site Visits for John and ops_employee.")

        # 10. PAYROLL SETUP & SALARIES
        # Setup configuration: ONLY BASIC (50% CTC) and PT (₹200) active
        # Deactivate all other components
        await session.execute(text("""
            UPDATE hrms_payroll_components
            SET is_active = false
            WHERE code NOT IN ('BASIC', 'PT');
        """))
        
        # Ensure BASIC exists and is active: Percentage 50% Monthly CTC
        basic = (await session.execute(select(HrmsPayrollComponent).where(HrmsPayrollComponent.code == 'BASIC'))).scalar_one_or_none()
        if not basic:
            basic = HrmsPayrollComponent(
                id=uuid.uuid4(),
                name="Basic Salary",
                code="BASIC",
                component_type="EARNING",
                calculation_type="PERCENTAGE",
                calculation_basis="CTC",
                value=50.0,
                is_taxable=True,
                is_statutory=False,
                display_order=1,
                is_active=True,
            )
            session.add(basic)
        else:
            basic.name = "Basic Salary"
            basic.component_type = "EARNING"
            basic.calculation_type = "PERCENTAGE"
            basic.calculation_basis = "CTC"
            basic.value = 50.0
            basic.is_active = True
            basic.deleted_at = None

        # Ensure PT exists and is active: Fixed ₹200
        pt = (await session.execute(select(HrmsPayrollComponent).where(HrmsPayrollComponent.code == 'PT'))).scalar_one_or_none()
        if not pt:
            pt = HrmsPayrollComponent(
                id=uuid.uuid4(),
                name="Professional Tax",
                code="PT",
                component_type="DEDUCTION",
                calculation_type="FIXED",
                calculation_basis=None,
                value=200.0,
                is_taxable=False,
                is_statutory=True,
                display_order=2,
                is_active=True,
            )
            session.add(pt)
        else:
            pt.name = "Professional Tax"
            pt.component_type = "DEDUCTION"
            pt.calculation_type = "FIXED"
            pt.value = 200.0
            pt.is_active = True
            pt.deleted_at = None

        await session.commit()
        print("Configured active payroll components: BASIC (50% of CTC), PT (INR 200).")

        # Salary for John: Annual CTC INR 600,000 (Monthly INR 50,000)
        sal_j_list = (await session.execute(
            select(HrmsEmployeeSalary)
            .where(HrmsEmployeeSalary.employee_id == users['john'].id, HrmsEmployeeSalary.deleted_at.is_(None))
            .order_by(HrmsEmployeeSalary.is_active.desc(), HrmsEmployeeSalary.effective_from.desc())
        )).scalars().all()
        if sal_j_list:
            sal_j = sal_j_list[0]
            sal_j.annual_ctc = 600000.0
            sal_j.monthly_ctc = 50000.0
            sal_j.effective_from = date(2026, 1, 1)
            sal_j.is_active = True
            for other_sal in sal_j_list[1:]:
                other_sal.is_active = False
        else:
            sal_j = HrmsEmployeeSalary(
                id=uuid.uuid4(),
                employee_id=users['john'].id,
                annual_ctc=600000.0,
                monthly_ctc=50000.0,
                effective_from=date(2026, 1, 1),
                is_active=True,
            )
            session.add(sal_j)

        # Salary for ops_employee: Annual CTC INR 480,000 (Monthly INR 40,000)
        sal_o_list = (await session.execute(
            select(HrmsEmployeeSalary)
            .where(HrmsEmployeeSalary.employee_id == users['ops_employee'].id, HrmsEmployeeSalary.deleted_at.is_(None))
            .order_by(HrmsEmployeeSalary.is_active.desc(), HrmsEmployeeSalary.effective_from.desc())
        )).scalars().all()
        if sal_o_list:
            sal_o = sal_o_list[0]
            sal_o.annual_ctc = 480000.0
            sal_o.monthly_ctc = 40000.0
            sal_o.effective_from = date(2026, 1, 1)
            sal_o.is_active = True
            for other_sal in sal_o_list[1:]:
                other_sal.is_active = False
        else:
            sal_o = HrmsEmployeeSalary(
                id=uuid.uuid4(),
                employee_id=users['ops_employee'].id,
                annual_ctc=480000.0,
                monthly_ctc=40000.0,
                effective_from=date(2026, 1, 1),
                is_active=True,
            )
            session.add(sal_o)

        await session.commit()
        print("Assigned salaries: John INR 50,000/mo, ops_employee INR 40,000/mo.")

        # 11. Run Payroll Calculation Engine for October 2026
        # Re-calculate October 2026 payroll to consume actual attendance & leaves
        # Remove any existing approved/processed payroll for 2026-10 so calculate runs fresh
        await session.execute(text("DELETE FROM hrms_monthly_payroll_items WHERE payroll_id IN (SELECT id FROM hrms_monthly_payrolls WHERE payroll_month = '2026-10');"))
        await session.execute(text("DELETE FROM hrms_monthly_payrolls WHERE payroll_month = '2026-10';"))
        await session.commit()

        payroll_svc = HrmsPayrollService(session)
        calc_payroll = await payroll_svc.calculate_monthly_payroll("2026-10", users['admin'].id)
        await session.commit()
        print(f"Calculated October 2026 Payroll: status={calc_payroll.status}, working_days={calc_payroll.working_days}, holidays={calc_payroll.holiday_days}")

        # Inspect calculated payroll items
        items = (await session.execute(text("""
            SELECT u.username, pi.monthly_ctc, pi.working_days, pi.present_days, pi.paid_leave_days, pi.holiday_days, pi.lop_days, pi.gross_amount, pi.total_deductions, pi.net_salary
            FROM hrms_monthly_payroll_items pi
            JOIN users u ON u.id = pi.employee_id
            WHERE pi.payroll_id = :pid;
        """), {'pid': calc_payroll.id})).fetchall()
        print("=== CALCULATED OCTOBER 2026 PAYROLL ITEMS ===")
        for item in items:
            print(" ", item)

if __name__ == "__main__":
    asyncio.run(seed_data())
