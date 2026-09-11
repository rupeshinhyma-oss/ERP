"""
Unit tests for SSRF protection and external URL validator.
"""

import pytest
from pydantic import ValidationError

from app.core.url_validator import validate_external_url
from app.erp_registry.schemas import ErpInstanceCreate
from app.federation.schemas import FederationClientCreate


def test_valid_public_urls():
    """Ensure standard external URLs pass validation."""
    valid_urls = [
        "https://example.com/callback",
        "http://app.example.org:8080/oauth",
        "https://sub.domain.co.uk/path?param=1",
    ]
    for url in valid_urls:
        assert validate_external_url(url) == url


def test_reject_forbidden_schemes():
    """Ensure non-http/https schemes are rejected."""
    invalid_schemes = [
        "ftp://example.com",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "gopher://example.com",
    ]
    for url in invalid_schemes:
        with pytest.raises(ValueError, match="Invalid URL scheme"):
            validate_external_url(url)


def test_reject_cloud_metadata_always():
    """Ensure 169.254.169.254 is rejected regardless of local/production mode."""
    metadata_urls = [
        "http://169.254.169.254/latest/meta-data/",
        "http://169.254.1.1/",
    ]
    for url in metadata_urls:
        with pytest.raises(ValueError, match="forbidden"):
            validate_external_url(url, allow_local=True)
        with pytest.raises(ValueError, match="forbidden"):
            validate_external_url(url, allow_local=False)


def test_reject_private_ranges_in_strict_mode():
    """Ensure private RFC1918 and loopback are rejected in strict mode."""
    private_urls = [
        "http://127.0.0.1:8000/callback",
        "http://localhost:3000/callback",
        "http://10.0.0.5/api",
        "http://192.168.1.100/webhook",
        "http://172.16.0.1/admin",
    ]
    for url in private_urls:
        with pytest.raises(ValueError):
            validate_external_url(url, allow_local=False)


def test_reject_embedded_credentials():
    """Ensure URLs with credentials are rejected."""
    with pytest.raises(ValueError, match="embedded user credentials"):
        validate_external_url("https://user:password@example.com/callback")


def test_federation_schema_ssrf_validation():
    """Ensure FederationClientCreate rejects SSRF URLs in redirect_uris."""
    with pytest.raises(ValidationError):
        FederationClientCreate(
            redirect_uris=["http://169.254.169.254/latest/meta-data/"],
            federation_enabled=True,
        )


def test_erp_instance_schema_ssrf_validation():
    """Ensure ErpInstanceCreate rejects SSRF in base_url."""
    with pytest.raises(ValidationError):
        ErpInstanceCreate(
            key="test_erp",
            name="Test ERP",
            display_name="Test ERP",
            base_url="http://169.254.169.254/api",
        )
