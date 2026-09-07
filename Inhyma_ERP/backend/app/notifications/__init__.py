"""
Notifications Module.
"""

from app.notifications.models import Notification
from app.notifications.routes import router

__all__ = [
    "Notification",
    "router",
]
