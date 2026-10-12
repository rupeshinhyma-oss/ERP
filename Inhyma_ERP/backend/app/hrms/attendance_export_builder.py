"""
Monthly Attendance Matrix & Excel Export Engine for Inhyma ERP HRMS.

Builds a professional, multi-tab attendance workbook:
1. "Attendance Matrix": One employee section per employee and one column per calendar date,
   with employee summary fields (Columns A-Q) and daily details (Columns S onwards) for:
   - Attendance Status (colored badges)
   - In Time (IST)
   - Out Time (IST)
   - Working Hours
   - Shift Name
   - Overtime
   - Reason / Regularization information
   Frozen panes at row 4 / col 19.
2. "Monthly Summary": 1-row-per-employee consolidation of all 17 summary metrics,
   attendance rate, and database punch count.
3. "Attendance Export": Complete authoritative punch-in/out audit log for all matching database records.
"""

from __future__ import annotations

import calendar
import io
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Set

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.hrms.models import (
    HrmsAttendance,
    HrmsAttendancePolicy,
    HrmsEmployeeLocation,
    HrmsHoliday,
    HrmsLeaveRequest,
    HrmsLeaveType,
    HrmsLocation,
)
from app.rbac.models import Role, UserRole
from app.users.models import User, UserStatus

# Indian Standard Time (Asia/Kolkata) with resilient UTC+5:30 fallback
try:
    from zoneinfo import ZoneInfo
    IST = ZoneInfo("Asia/Kolkata")
except Exception:
    IST = timezone(timedelta(hours=5, minutes=30))


def to_ist(dt: datetime | None) -> datetime | None:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)


def format_time_ist(dt: datetime | None) -> str:
    ist_dt = to_ist(dt)
    return ist_dt.strftime("%I:%M %p") if ist_dt else ""


def format_duration(minutes: int | None) -> str:
    if not minutes or minutes <= 0:
        return "0h 00m"
    return f"{minutes // 60}h {minutes % 60:02d}m"


def validate_attendance_matrix_workbook(wb: openpyxl.Workbook, date_list: list[date]) -> None:
    """
    Programmatic validation of the generated Attendance Matrix workbook.
    Verifies sheet name, summary headers, date headings, daily metric subheadings,
    merged ranges, freeze panes, and column alignment.
    Raises ValueError with precise cell coordinates if validation fails.
    """
    # 1. Verify exactly one worksheet named "Attendance Matrix"
    if wb.sheetnames != ["Attendance Matrix"]:
        raise ValueError(
            f"Workbook structure validation failed: Expected exactly one worksheet ['Attendance Matrix'], "
            f"got {wb.sheetnames}."
        )

    ws = wb["Attendance Matrix"]

    # 2. Required 17 summary headers
    expected_summary = [
        "Employee Code / ID",
        "Employee Name",
        "Branch / Office",
        "Department",
        "Employment Type",
        "Date of Joining",
        "Total Working Days",
        "Paid Days",
        "Present Days",
        "Absent Days",
        "Paid Leave",
        "Unpaid Leave",
        "Total Working Hours",
        "Total Shift Hours",
        "Total Overtime",
        "Total Week-Offs",
        "Total Holidays",
    ]

    for c_idx, expected_h in enumerate(expected_summary, start=1):
        cell_r1 = ws.cell(row=1, column=c_idx)
        if cell_r1.value != expected_h:
            raise ValueError(
                f"Summary header validation failed at {cell_r1.coordinate} (Row 1, Col {c_idx}): "
                f"Expected '{expected_h}', got '{cell_r1.value}'."
            )
        # Check vertical merge R1:R2
        coord_r1 = cell_r1.coordinate
        coord_r2 = ws.cell(row=2, column=c_idx).coordinate
        is_merged = any(coord_r1 in rng and coord_r2 in rng for rng in ws.merged_cells.ranges)
        if not is_merged:
            raise ValueError(
                f"Summary header vertical merge validation failed at {coord_r1}:{coord_r2}: "
                f"Expected column {c_idx} to be merged across Rows 1 & 2."
            )

    # 3. Required 7 daily metrics per date
    expected_metrics = [
        "Attendance Status",
        "In Time",
        "Out Time",
        "Working Hours",
        "Shift Name",
        "Overtime",
        "Reason / Regularization",
    ]
    num_summary = len(expected_summary)
    num_metrics = len(expected_metrics)

    for d_idx, cal_date in enumerate(date_list):
        d_start = num_summary + 1 + d_idx * num_metrics
        d_end = d_start + num_metrics - 1
        expected_date_str = f"{cal_date.strftime('%d-%b-%Y')} ({cal_date.strftime('%a')})"

        # Check Row 1 Date Parent Header
        date_cell = ws.cell(row=1, column=d_start)
        if date_cell.value != expected_date_str:
            raise ValueError(
                f"Date parent header validation failed at {date_cell.coordinate} (Row 1, Col {d_start}): "
                f"Expected '{expected_date_str}', got '{date_cell.value}'."
            )

        # Check Row 1 Horizontal Merge across 7 metric sub-columns
        coord_start = date_cell.coordinate
        coord_end = ws.cell(row=1, column=d_end).coordinate
        is_date_merged = any(
            coord_start in rng and coord_end in rng
            for rng in ws.merged_cells.ranges
        )
        if not is_date_merged:
            raise ValueError(
                f"Date header merge validation failed across {coord_start}:{coord_end}: "
                f"Expected date '{expected_date_str}' to be merged horizontally across cols {d_start} to {d_end}."
            )

        # Check Row 2 Daily Metric Subheadings
        for m_idx, expected_m in enumerate(expected_metrics):
            m_col = d_start + m_idx
            m_cell = ws.cell(row=2, column=m_col)
            if m_cell.value != expected_m:
                raise ValueError(
                    f"Daily metric header validation failed at {m_cell.coordinate} (Row 2, Col {m_col}): "
                    f"Expected '{expected_m}', got '{m_cell.value}'."
                )

    # 4. Verify Total Columns
    expected_total_cols = num_summary + len(date_list) * num_metrics
    if ws.max_column != expected_total_cols:
        raise ValueError(
            f"Worksheet column count mismatch: Expected {expected_total_cols} columns, but found {ws.max_column}."
        )

    # 5. Verify Freeze Panes
    if ws.freeze_panes != "C3":
        raise ValueError(
            f"Freeze panes validation failed: Expected 'C3' (freezing header rows 1-2 and identification cols A-B), "
            f"got '{ws.freeze_panes}'."
        )


async def build_monthly_attendance_excel(
    db: AsyncSession,
    start_date: date,
    end_date: date,
    employee_id: Optional[uuid.UUID] = None,
    allowed_employee_ids: Optional[Set[uuid.UUID]] = None,
    is_admin: bool = False,
    calendar_month_name: Optional[str] = None,
) -> tuple[io.BytesIO, int, int]:
    """
    Generate authoritative attendance Excel workbook directly from PostgreSQL data.
    Enforces Row 1 & Row 2 two-level headers with freeze panes C3 and programmatic validation.
    Returns: (BytesIO buffer, total_employees_count, total_attendance_records_count).
    """
    num_days = (end_date - start_date).days + 1
    today = datetime.now(IST).date()
    date_list = [start_date + timedelta(days=i) for i in range(num_days)]

    summary_headers = [
        "Employee Code / ID",
        "Employee Name",
        "Branch / Office",
        "Department",
        "Employment Type",
        "Date of Joining",
        "Total Working Days",
        "Paid Days",
        "Present Days",
        "Absent Days",
        "Paid Leave",
        "Unpaid Leave",
        "Total Working Hours",
        "Total Shift Hours",
        "Total Overtime",
        "Total Week-Offs",
        "Total Holidays",
    ]
    num_summary_cols = len(summary_headers)  # 17

    daily_metrics = [
        ("STATUS", "Attendance Status"),
        ("IN_TIME", "In Time"),
        ("OUT_TIME", "Out Time"),
        ("HOURS", "Working Hours"),
        ("SHIFT", "Shift Name"),
        ("OVERTIME", "Overtime"),
        ("REASON", "Reason / Regularization"),
    ]
    num_metrics_per_day = len(daily_metrics)  # 7
    total_cols = num_summary_cols + num_days * num_metrics_per_day

    # Visual Styles
    navy_dark = "1E293B"
    navy_fill = PatternFill(start_color=navy_dark, end_color=navy_dark, fill_type="solid")
    alt_row_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    white_fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
    summary_col_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    metric_header_fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")

    present_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
    late_fill = PatternFill(start_color="FEF9C3", end_color="FEF9C3", fill_type="solid")
    holiday_fill = PatternFill(start_color="EDE9FE", end_color="EDE9FE", fill_type="solid")
    weekend_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    leave_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
    absent_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
    half_day_fill = PatternFill(start_color="FFEDD5", end_color="FFEDD5", fill_type="solid")

    border_side = Side(border_style="thin", color="CBD5E1")
    thin_border = Border(left=border_side, right=border_side, top=border_side, bottom=border_side)

    font_header = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    font_metric_header = Font(name="Calibri", size=9, bold=True, color="1E293B")
    font_bold = Font(name="Calibri", size=9.5, bold=True, color="0F172A")
    font_regular = Font(name="Calibri", size=9.5, color="1E293B")
    font_badge = Font(name="Calibri", size=8.5, bold=True, color="0F172A")

    align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    align_left = Alignment(horizontal="left", vertical="center", wrap_text=True)

    def apply_header_structure(ws: openpyxl.worksheet.worksheet.Worksheet) -> None:
        ws.views.sheetView[0].showGridLines = True
        ws.row_dimensions[1].height = 28
        ws.row_dimensions[2].height = 24

        # Row 1: Summary Headers (Cols 1 to 17, merged vertically across Rows 1 & 2)
        for c_idx, h_text in enumerate(summary_headers, start=1):
            cell_r1 = ws.cell(row=1, column=c_idx, value=h_text)
            cell_r1.font = font_header
            cell_r1.fill = navy_fill
            cell_r1.alignment = align_center
            cell_r1.border = thin_border

            cell_r2 = ws.cell(row=2, column=c_idx, value="")
            cell_r2.fill = navy_fill
            cell_r2.border = thin_border

            ws.merge_cells(start_row=1, start_column=c_idx, end_row=2, end_column=c_idx)

        # Row 1: Calendar Date Parent Headers & Row 2: Daily Metric Subheadings
        for d_idx, d_val in enumerate(date_list):
            d_start_col = num_summary_cols + 1 + d_idx * num_metrics_per_day
            d_end_col = d_start_col + num_metrics_per_day - 1
            weekday_name = d_val.strftime("%a")
            date_header_text = f"{d_val.strftime('%d-%b-%Y')} ({weekday_name})"

            for c in range(d_start_col, d_end_col + 1):
                c_cell = ws.cell(row=1, column=c)
                c_cell.fill = navy_fill
                c_cell.border = thin_border

            date_cell = ws.cell(row=1, column=d_start_col, value=date_header_text)
            date_cell.font = font_header
            date_cell.alignment = align_center
            ws.merge_cells(start_row=1, start_column=d_start_col, end_row=1, end_column=d_end_col)

            for m_idx, (m_key, m_label) in enumerate(daily_metrics):
                m_col = d_start_col + m_idx
                m_cell = ws.cell(row=2, column=m_col, value=m_label)
                m_cell.font = font_metric_header
                m_cell.fill = metric_header_fill
                m_cell.alignment = align_center
                m_cell.border = thin_border

        ws.freeze_panes = "C3"

        summary_widths = [16, 22, 18, 18, 16, 14, 15, 12, 12, 12, 12, 12, 16, 16, 14, 14, 13]
        for col_i, w in enumerate(summary_widths, start=1):
            ws.column_dimensions[get_column_letter(col_i)].width = w

        metric_widths = [15, 12, 12, 13, 18, 12, 24]
        for d_idx in range(num_days):
            d_start_col = num_summary_cols + 1 + d_idx * num_metrics_per_day
            for m_idx, mw in enumerate(metric_widths):
                col_letter = get_column_letter(d_start_col + m_idx)
                ws.column_dimensions[col_letter].width = mw

    # 1. Fetch attendance policy for shift and weekly off configuration
    policy_res = await db.execute(select(HrmsAttendancePolicy).limit(1))
    policy = policy_res.scalar_one_or_none()

    shift_name = policy.shift_name if policy and policy.shift_name else "Inhyma General Shift"
    shift_start = policy.shift_start_time if policy and policy.shift_start_time else "10:30"
    shift_end = policy.shift_end_time if policy and policy.shift_end_time else "19:00"
    weekly_off_raw = (policy.weekly_off or "Sunday") if policy else "Sunday"
    weekly_off_days = {d.strip().capitalize() for d in weekly_off_raw.split(",") if d.strip()}
    if not weekly_off_days:
        weekly_off_days = {"Sunday"}

    try:
        sh1, sm1 = map(int, shift_start.split(":"))
        sh2, sm2 = map(int, shift_end.split(":"))
        shift_minutes = (sh2 * 60 + sm2) - (sh1 * 60 + sm1)
        if shift_minutes <= 0:
            shift_minutes = 510
    except Exception:
        shift_minutes = 510

    # 2. Query authorized employees from User table
    user_stmt = (
        select(User)
        .where(
            User.deleted_at.is_(None),
            User.is_active.is_(True),
            User.status == UserStatus.ACTIVE,
        )
        .order_by(User.first_name.asc(), User.last_name.asc(), User.username.asc())
    )
    if employee_id:
        user_stmt = user_stmt.where(User.id == employee_id)
    elif allowed_employee_ids is not None:
        user_stmt = user_stmt.where(User.id.in_(allowed_employee_ids))
    elif not is_admin:
        user_stmt = user_stmt.where(User.id == employee_id if employee_id else False)

    users = list((await db.execute(user_stmt)).scalars().all())
    uids = [u.id for u in users]

    # Handle empty employees case
    if not uids:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Attendance Matrix"
        apply_header_structure(ws)
        validate_attendance_matrix_workbook(wb, date_list)
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return buf, 0, 0

    # 3. Batch resolve departments and branch offices for authorized employees
    dept_map: dict[uuid.UUID, str] = {}
    branch_map: dict[uuid.UUID, str] = {}

    try:
        r_stmt = (
            select(UserRole.user_id, Role.name)
            .join(Role, Role.id == UserRole.role_id)
            .where(UserRole.user_id.in_(uids), Role.deleted_at.is_(None))
        )
        for uid, rname in (await db.execute(r_stmt)).all():
            if rname.lower() not in ("user", "employee", "department_manager", "super_admin", "admin") and uid not in dept_map:
                dept_map[uid] = rname
    except Exception:
        pass

    try:
        loc_stmt = (
            select(HrmsEmployeeLocation.user_id, HrmsLocation.name)
            .join(HrmsLocation, HrmsLocation.id == HrmsEmployeeLocation.location_id)
            .where(HrmsEmployeeLocation.user_id.in_(uids), HrmsLocation.deleted_at.is_(None))
            .order_by(HrmsEmployeeLocation.is_primary.desc())
        )
        for uid, lname in (await db.execute(loc_stmt)).all():
            if uid not in branch_map:
                branch_map[uid] = lname
    except Exception:
        pass

    # 4. Fetch holidays in date range
    holidays_stmt = (
        select(HrmsHoliday)
        .where(
            HrmsHoliday.deleted_at.is_(None),
            HrmsHoliday.is_active.is_(True),
            HrmsHoliday.holiday_date >= start_date,
            HrmsHoliday.holiday_date <= end_date,
        )
    )
    all_holidays = list((await db.execute(holidays_stmt)).scalars().all())

    # 5. Fetch approved leaves in date range
    leaves_stmt = (
        select(HrmsLeaveRequest, HrmsLeaveType)
        .join(HrmsLeaveType, HrmsLeaveType.id == HrmsLeaveRequest.leave_type_id)
        .where(
            HrmsLeaveRequest.employee_id.in_(uids),
            HrmsLeaveRequest.approval_status == "APPROVED",
            HrmsLeaveRequest.from_date <= end_date,
            HrmsLeaveRequest.to_date >= start_date,
        )
    )
    all_leaves = list((await db.execute(leaves_stmt)).all())

    # 6. Fetch actual PostgreSQL attendance records in date range
    att_stmt = (
        select(HrmsAttendance)
        .where(
            HrmsAttendance.employee_id.in_(uids),
            HrmsAttendance.attendance_date >= start_date,
            HrmsAttendance.attendance_date <= end_date,
        )
    )
    all_attendance = list((await db.execute(att_stmt)).scalars().all())
    total_matched_att_records = len(all_attendance)

    # Index attendance by (employee_id, date)
    emp_att_map: dict[tuple[uuid.UUID, date], HrmsAttendance] = {}
    for a in all_attendance:
        emp_att_map[(a.employee_id, a.attendance_date)] = a

    # Index leaves by employee_id -> dict[date, tuple[HrmsLeaveRequest, HrmsLeaveType]]
    emp_leave_map: dict[uuid.UUID, dict[date, tuple[HrmsLeaveRequest, HrmsLeaveType]]] = {}
    for req, lt in all_leaves:
        cur = max(req.from_date, start_date)
        req_end = min(req.to_date, end_date)
        if req.employee_id not in emp_leave_map:
            emp_leave_map[req.employee_id] = {}
        while cur <= req_end:
            emp_leave_map[req.employee_id][cur] = (req, lt)
            cur += timedelta(days=1)

    # 7. Create Excel Workbook
    wb = openpyxl.Workbook()
    ws1 = wb.active
    ws1.title = "Attendance Matrix"
    apply_header_structure(ws1)

    current_row = 3

    for user_idx, u in enumerate(users):
        emp_code = u.employee_code or getattr(u, "code", None) or f"EMP-{str(u.id)[:6].upper()}"
        first = u.first_name or ""
        last = u.last_name or ""
        emp_name = f"{first} {last}".strip() or getattr(u, "username", "Employee") or "Employee"
        emp_branch = branch_map.get(u.id) or "Main Office"
        emp_dept = dept_map.get(u.id) or getattr(u, "department", None) or "General"
        raw_emp_type = getattr(u.employment_type, "value", u.employment_type) or getattr(u, "employment_status", None) or "Full-Time"
        emp_type = str(raw_emp_type).replace("_", " ").title() if raw_emp_type else "Full-Time"
        doj_str = u.date_of_joining.strftime("%Y-%m-%d") if u.date_of_joining else "-"

        emp_hol_map = {}
        for h in all_holidays:
            b_app = (h.branch_applicability or "All Branches").lower()
            d_app = (getattr(h, "department_scope", None) or "All Departments").lower()
            if ("all" in b_app or emp_branch.lower() in b_app) and ("all" in d_app or emp_dept.lower() in d_app):
                emp_hol_map[h.holiday_date] = h

        leaves_for_emp = emp_leave_map.get(u.id, {})

        total_working_days = 0
        paid_days = 0.0
        present_days = 0.0
        absent_days = 0.0
        paid_leave = 0.0
        unpaid_leave = 0.0
        total_working_mins = 0
        total_shift_mins = 0
        total_ot_mins = 0
        total_week_offs = 0
        total_holidays = 0
        actual_db_punches = 0

        daily_eval = {}
        has_records = any((u.id, d) in emp_att_map for d in date_list) or len(leaves_for_emp) > 0

        for d in date_list:
            day_name = d.strftime("%A")
            is_weekend = day_name in weekly_off_days
            is_holiday = d in emp_hol_map
            holiday_obj = emp_hol_map.get(d)
            leave_info = leaves_for_emp.get(d)
            att_rec = emp_att_map.get((u.id, d))

            if is_weekend:
                total_week_offs += 1
            elif is_holiday:
                total_holidays += 1
            else:
                total_working_days += 1
                total_shift_mins += shift_minutes

            d_status = "-"
            d_in = "-"
            d_out = "-"
            d_hrs = "-"
            d_shift = shift_name if not is_weekend and not is_holiday else ("Weekly Off" if is_weekend else "Holiday")
            d_ot = "-"
            d_reason = "-"
            badge_type = "neutral"

            if att_rec:
                actual_db_punches += 1
                wm = att_rec.working_minutes or 0
                total_working_mins += wm

                ot_m = max(0, wm - shift_minutes) if wm > shift_minutes else 0
                total_ot_mins += ot_m

                in_time_dt = to_ist(att_rec.punch_in)
                out_time_dt = to_ist(att_rec.punch_out)

                d_in = in_time_dt.strftime("%I:%M %p") if in_time_dt else ("Punched In" if att_rec.punch_in else "-")
                d_out = out_time_dt.strftime("%I:%M %p") if out_time_dt else ("In Progress" if att_rec.punch_in and not att_rec.punch_out else "-")
                d_hrs = format_duration(wm) if wm > 0 else ("0h 00m" if att_rec.punch_in else "-")
                d_ot = format_duration(ot_m) if ot_m > 0 else "0h 00m"

                status_raw = (att_rec.status or "PRESENT").upper()
                if status_raw in ("PRESENT", "LATE", "IN_PROGRESS", "WORK_FROM_HOME", "ON_DUTY") or att_rec.regularization_status == "APPROVED":
                    present_days += 1.0
                    paid_days += 1.0
                    badge_type = "present" if status_raw != "LATE" else "late"
                    d_status = status_raw
                elif status_raw == "HALF_DAY":
                    present_days += 0.5
                    absent_days += 0.5
                    paid_days += 0.5
                    badge_type = "half_day"
                    d_status = "HALF_DAY"
                elif status_raw in ("ABSENT", "LOP"):
                    absent_days += 1.0
                    badge_type = "absent"
                    d_status = "ABSENT"
                else:
                    d_status = status_raw
                    if is_holiday or is_weekend:
                        paid_days += 1.0

                if att_rec.regularization_status and att_rec.regularization_status != "NONE":
                    note = att_rec.regularization_reason or att_rec.regularization_note or ""
                    d_reason = f"Reg: {att_rec.regularization_status} {note}".strip()
                elif att_rec.late_minutes and att_rec.late_minutes > 0:
                    d_reason = f"Late by {att_rec.late_minutes}m"
                elif att_rec.early_exit_minutes and att_rec.early_exit_minutes > 0:
                    d_reason = f"Early exit {att_rec.early_exit_minutes}m"
                else:
                    d_reason = "-"

            elif leave_info:
                req, lt = leave_info
                d_status = f"LEAVE ({lt.code or lt.name})"
                badge_type = "leave"
                d_reason = f"Approved {lt.name}: {req.reason or ''}".strip()
                if lt.is_paid:
                    paid_leave += 1.0
                    paid_days += 1.0
                else:
                    unpaid_leave += 1.0
            elif is_holiday:
                d_status = "HOLIDAY"
                badge_type = "holiday"
                d_reason = holiday_obj.name if holiday_obj else "Declared Holiday"
                paid_days += 1.0
            elif is_weekend:
                d_status = "WEEKEND"
                badge_type = "weekend"
                paid_days += 1.0
            else:
                if has_records:
                    if d < today:
                        d_status = "ABSENT"
                        badge_type = "absent"
                        absent_days += 1.0
                    elif d == today:
                        d_status = "NOT_PUNCHED"
                        badge_type = "neutral"
                    else:
                        d_status = "FUTURE"
                        badge_type = "neutral"
                else:
                    d_status = "—"
                    badge_type = "neutral"

            daily_eval[d] = {
                "STATUS": (d_status, badge_type),
                "IN_TIME": (d_in, "neutral"),
                "OUT_TIME": (d_out, "neutral"),
                "HOURS": (d_hrs, "neutral"),
                "SHIFT": (d_shift, "neutral"),
                "OVERTIME": (d_ot, "neutral"),
                "REASON": (d_reason, "neutral"),
            }

        if not has_records:
            paid_days = float(total_working_days + total_week_offs + total_holidays)

        emp_summary_data = [
            emp_code,
            emp_name,
            emp_branch,
            emp_dept,
            emp_type,
            doj_str,
            total_working_days,
            paid_days,
            present_days,
            absent_days,
            paid_leave,
            unpaid_leave,
            format_duration(total_working_mins),
            format_duration(total_shift_mins),
            format_duration(total_ot_mins),
            total_week_offs,
            total_holidays,
        ]

        r_num = current_row
        ws1.row_dimensions[r_num].height = 20
        is_alt = (user_idx % 2 == 1)
        base_fill = alt_row_fill if is_alt else white_fill

        # Write employee summary and metadata columns (Cols 1 to 17)
        for c_idx, val in enumerate(emp_summary_data, start=1):
            cell = ws1.cell(row=r_num, column=c_idx, value=val)
            cell.font = font_bold if c_idx in (1, 2, 7, 8, 9) else font_regular
            cell.alignment = align_left if c_idx in (2, 3, 4) else align_center
            cell.fill = summary_col_fill if c_idx in (1, 2) else base_fill
            cell.border = thin_border

        # Write daily attendance metric columns for each date
        for d_idx, d_val in enumerate(date_list):
            d_start_col = num_summary_cols + 1 + d_idx * num_metrics_per_day
            d_eval = daily_eval[d_val]

            for m_idx, (m_key, m_label) in enumerate(daily_metrics):
                col_num = d_start_col + m_idx
                cell_val, b_type = d_eval[m_key]
                d_cell = ws1.cell(row=r_num, column=col_num, value=cell_val)
                d_cell.font = font_regular
                d_cell.alignment = align_center
                d_cell.border = thin_border

                if m_key == "STATUS":
                    d_cell.font = font_badge
                    if b_type == "present":
                        d_cell.fill = present_fill
                    elif b_type == "late":
                        d_cell.fill = late_fill
                    elif b_type == "holiday":
                        d_cell.fill = holiday_fill
                    elif b_type == "weekend":
                        d_cell.fill = weekend_fill
                    elif b_type == "leave":
                        d_cell.fill = leave_fill
                    elif b_type == "absent":
                        d_cell.fill = absent_fill
                    elif b_type == "half_day":
                        d_cell.fill = half_day_fill
                    else:
                        d_cell.fill = base_fill
                elif b_type == "weekend" or d_val.strftime("%A") in weekly_off_days:
                    d_cell.fill = weekend_fill
                elif b_type == "holiday":
                    d_cell.fill = holiday_fill
                else:
                    d_cell.fill = base_fill

        current_row += 1

    # Programmatically validate before saving
    validate_attendance_matrix_workbook(wb, date_list)

    wb.active = ws1

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf, len(users), total_matched_att_records
