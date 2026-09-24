"""
Attendance Engine PostgreSQL Migration Script.

Ensures all tables and columns for the Real Attendance Engine exist:
- hrms_attendance_logs (check_in_time, check_out_time, office_id, latitude, longitude, punch_type, status, final_status, total_work_minutes, rule_triggered)
- hrms_attendance_policies (policy_name, shift_start, shift_end, grace_until, late_starts_after, direct_half_day_after, late_marks_before_half_day, payroll_cycle, is_active, is_archived)
- hrms_locations (Inhyma Thane Office)
"""

import asyncio
from sqlalchemy import text
from app.database.engine import get_engine
from app.database.base import Base
import app.users.models  # noqa: F401
import app.rbac.models  # noqa: F401
import app.hrms.models  # noqa: F401


async def run_migration():
    engine = get_engine()
    async with engine.begin() as conn:
        # 1. Create tables if not already existing
        await conn.run_sync(Base.metadata.create_all)

        # 2. Add columns to hrms_attendance_logs if not exist
        await conn.execute(
            text("""
            ALTER TABLE hrms_attendance_logs 
            ADD COLUMN IF NOT EXISTS check_in_time TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS check_out_time TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS office_id UUID REFERENCES hrms_locations(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS punch_type VARCHAR(20) DEFAULT 'CHECK_IN',
            ADD COLUMN IF NOT EXISTS final_status VARCHAR(50) DEFAULT 'Present',
            ADD COLUMN IF NOT EXISTS total_work_minutes INTEGER,
            ADD COLUMN IF NOT EXISTS rule_triggered VARCHAR(150);
            """)
        )

        # 3. Add columns to hrms_attendance_policies if not exist
        await conn.execute(
            text("""
            ALTER TABLE hrms_attendance_policies
            ADD COLUMN IF NOT EXISTS name VARCHAR(150),
            ADD COLUMN IF NOT EXISTS shift_start VARCHAR(50) DEFAULT '10:30 AM',
            ADD COLUMN IF NOT EXISTS shift_end VARCHAR(50) DEFAULT '07:00 PM',
            ADD COLUMN IF NOT EXISTS grace_until VARCHAR(50) DEFAULT '10:45 AM',
            ADD COLUMN IF NOT EXISTS late_starts_after VARCHAR(50) DEFAULT '10:46 AM',
            ADD COLUMN IF NOT EXISTS direct_half_day_after VARCHAR(50) DEFAULT '11:31 AM',
            ADD COLUMN IF NOT EXISTS late_marks_before_half_day INTEGER DEFAULT 3,
            ADD COLUMN IF NOT EXISTS payroll_cycle VARCHAR(100) DEFAULT '1st to 31st of Month',
            ADD COLUMN IF NOT EXISTS employment_type VARCHAR(100) DEFAULT 'Full Time Permanent',
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
            """)
        )

        # 4. Check if Thane office exists, if not seed it
        res = await conn.execute(
            text("SELECT id FROM hrms_locations WHERE name ILIKE '%Thane%' LIMIT 1")
        )
        if not res.fetchone():
            await conn.execute(
                text("""
                INSERT INTO hrms_locations (
                    id, name, location_type, address, latitude, longitude, radius_meters, is_active, created_at, updated_at
                ) VALUES (
                    gen_random_uuid(),
                    'Inhyma Thane Office',
                    'OFFICE',
                    'Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604',
                    19.198300,
                    72.948300,
                    150.0,
                    TRUE,
                    NOW(),
                    NOW()
                )
                """)
            )
            print("Seeded Inhyma Thane Office.")
        else:
            print("Inhyma Thane Office already exists.")

        # 5. Check if default policy exists, if not seed it
        p_res = await conn.execute(
            text("SELECT id FROM hrms_attendance_policies WHERE is_active = TRUE AND is_archived = FALSE LIMIT 1")
        )
        if not p_res.fetchone():
            await conn.execute(
                text("""
                INSERT INTO hrms_attendance_policies (
                    id, name, shift_start, shift_end, grace_until, late_starts_after,
                    direct_half_day_after, late_marks_before_half_day, payroll_cycle,
                    employment_type, is_active, is_archived, created_at, updated_at
                ) VALUES (
                    gen_random_uuid(),
                    'General Office Policy',
                    '10:30 AM',
                    '07:00 PM',
                    '10:45 AM',
                    '10:46 AM',
                    '11:31 AM',
                    3,
                    '1st to 31st of Month',
                    'Full Time Permanent',
                    TRUE,
                    FALSE,
                    NOW(),
                    NOW()
                )
                """)
            )
            print("Seeded General Office Policy.")
        else:
            print("Active attendance policy already exists.")

    print("PostgreSQL Attendance Engine migration completed successfully.")


if __name__ == "__main__":
    asyncio.run(run_migration())
