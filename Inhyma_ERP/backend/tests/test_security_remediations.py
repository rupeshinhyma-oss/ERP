"""
Unit tests validating security remediations (Issues 1, 9, 10, 12, 15).
"""

import pytest
from pydantic import ValidationError

from app.common.rate_limit import RateLimiter
from app.search.service import escape_like_wildcards
from app.inquiries.schemas import InquiryItemUpdate, QuotationUpdate


def test_escape_like_wildcards():
    """Ensure SQL wildcards %, _, and \\ are escaped correctly."""
    assert escape_like_wildcards("normal text") == "normal text"
    assert escape_like_wildcards("100%") == "100\\%"
    assert escape_like_wildcards("item_code") == "item\\_code"
    assert escape_like_wildcards("c:\\test\\path") == "c:\\\\test\\\\path"
    assert escape_like_wildcards("%_\\") == "\\%\\_\\\\"


def test_mass_assignment_protection_inquiry_item():
    """Ensure InquiryItemUpdate rejects unauthorized extra fields like status or tally_status."""
    with pytest.raises(ValidationError):
        InquiryItemUpdate(
            item_id=1,
            status="APPROVED",  # type: ignore
        )

    with pytest.raises(ValidationError):
        InquiryItemUpdate(
            item_id=1,
            tally_status="POSTED",  # type: ignore
        )


def test_mass_assignment_protection_quotation_update():
    """Ensure QuotationUpdate rejects extra fields."""
    with pytest.raises(ValidationError):
        QuotationUpdate(
            status="APPROVED",  # type: ignore
        )


def test_sliding_window_rate_limiter():
    """Ensure RateLimiter limits requests according to window and max attempts."""
    limiter = RateLimiter(max_attempts=3, window_seconds=10)
    key = "test_client_ip"

    assert limiter.check_and_record(key) is True
    assert limiter.check_and_record(key) is True
    assert limiter.check_and_record(key) is True
    # 4th request exceeds max_attempts (3)
    assert limiter.check_and_record(key) is False

    # Independent key is unaffected
    assert limiter.check_and_record("other_ip") is True


@pytest.mark.asyncio
async def test_security_headers_present(client):
    """Ensure security headers are present on HTTP responses."""
    resp = await client.get("/api/v1/health/live")
    assert resp.status_code == 200
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.headers.get("X-Frame-Options") == "DENY"
    assert resp.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
