"""
Daily Exchange Rate Helper for Inhyma ERP.

Fetches USD -> INR / CNY exchange rates once per calendar day using free,
keyless bank/ECB APIs (Frankfurter primary, Open.er-api fallback).
"""

from __future__ import annotations

from datetime import date
import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)

_DEFAULT_RATES: dict[str, float] = {
    "USD": 1.0,
    "CNY": 7.20,
    "RMB": 7.20,
    "INR": 85.00,
}

_cached_date: date | None = None
_cached_rates: dict[str, float] = dict(_DEFAULT_RATES)


async def fetch_daily_rates() -> dict[str, float]:
    """Return USD-based exchange rates, refreshing from live APIs at most once per day."""
    global _cached_date, _cached_rates
    today = date.today()
    if _cached_date == today and _cached_rates:
        return dict(_cached_rates)

    # 1. Primary: Frankfurter (European Central Bank)
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8.0) as client:
            resp = await client.get("https://api.frankfurter.app/latest?from=USD&to=CNY,INR")
            if resp.status_code == 200:
                rates = resp.json().get("rates", {})
                if "INR" in rates:
                    cny = float(rates.get("CNY", _DEFAULT_RATES["CNY"]))
                    inr = float(rates["INR"])
                    _cached_rates = {"USD": 1.0, "CNY": cny, "RMB": cny, "INR": inr}
                    _cached_date = today
                    logger.info("Fetched daily FX rates from Frankfurter: USD->INR=%.4f, USD->CNY=%.4f", inr, cny)
                    return dict(_cached_rates)
    except Exception as exc:
        logger.warning("Frankfurter FX fetch failed: %s; trying fallback.", exc)

    # 2. Fallback: Open.er-api
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8.0) as client:
            resp = await client.get("https://open.er-api.com/v6/latest/USD")
            if resp.status_code == 200:
                rates = resp.json().get("rates", {})
                if "INR" in rates:
                    cny = float(rates.get("CNY", _DEFAULT_RATES["CNY"]))
                    inr = float(rates["INR"])
                    _cached_rates = {"USD": 1.0, "CNY": cny, "RMB": cny, "INR": inr}
                    _cached_date = today
                    logger.info("Fetched daily FX rates from open.er-api: USD->INR=%.4f, USD->CNY=%.4f", inr, cny)
                    return dict(_cached_rates)
    except Exception as exc:
        logger.warning("Fallback FX fetch failed: %s; using cached/default rates.", exc)

    return dict(_cached_rates)


async def get_usd_to_inr_rate() -> float:
    """Return today's USD -> INR conversion rate."""
    rates = await fetch_daily_rates()
    return round(float(rates.get("INR", _DEFAULT_RATES["INR"])), 4)
