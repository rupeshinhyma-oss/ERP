"""
HRMS Attendance Module.
Proxy layer mapping to app.attendance and app.hrms.
"""

from app.attendance.routes import router
from app.attendance.service import AttendanceService
from app.attendance.repository import AttendanceRepository

__all__ = ["router", "AttendanceService", "AttendanceRepository"]
