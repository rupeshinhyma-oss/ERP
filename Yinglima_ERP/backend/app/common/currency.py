"""
Currency Exchange Rate Service.

Provides automatic daily synchronization of foreign exchange rates
(USD to CNY, EUR, etc.) from official central bank data sources
(Frankfurter / European Central Bank with Open.er-api fallback).

Provides:
- `fetch_live_rates()`: Fetches current exchange rates from free open API with fallback.
- `sync_currency_rates_to_db()`: Saves/updates latest rates in PostgreSQL `currency_rates`.
- `get_active_rates()`: In-memory cached active rates for zero-latency queries.
- `convert_to_usd()`: Converts an amount from any currency to USD.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import time
from typing import Any

import httpx
from sqlalchemy import text

from app.core.logging import get_logger
from app.database.engine import get_engine

logger = get_logger(__name__)

# Fallback default rates in case internet/API is ever completely unreachable
DEFAULT_RATES: dict[str, float] = {
    "USD": 1.0,
    "CNY": 7.14,
    "RMB": 7.14,
    "EUR": 0.92,
    "INR": 83.50,
}

# In-memory cache to avoid querying DB on every single product price row
_cached_rates: dict[str, float] = dict(DEFAULT_RATES)
_last_cache_time: float = 0
CACHE_TTL_SECONDS = 300  # 5 minutes


async def fetch_live_rates() -> dict[str, float] | None:
    """
    Fetch exchange rates with USD as the base currency.
    Uses Frankfurter (ECB data) as primary, and Open.er-api as fallback.
    Both endpoints are 100% free, require no API keys, and have no secret tokens.
    Supports USD, CNY/RMB, EUR, and INR.
    """
    # 1. Primary: Frankfurter (Official European Central Bank data)
    primary_url = "https://api.frankfurter.app/latest?from=USD&to=CNY,EUR,INR"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8.0) as client:
            resp = await client.get(primary_url)
            if resp.status_code == 200:
                data = resp.json()
                rates = data.get("rates", {})
                if "CNY" in rates:
                    cny = float(rates["CNY"])
                    eur = float(rates.get("EUR", 0.92))
                    inr = float(rates.get("INR", 83.50))
                    logger.info("Successfully fetched live forex rates from Frankfurter", extra={"CNY": cny, "EUR": eur, "INR": inr})
                    return {
                        "USD": 1.0,
                        "CNY": cny,
                        "RMB": cny,
                        "EUR": eur,
                        "INR": inr,
                    }
    except Exception as exc:
        logger.warning(f"Primary currency API (Frankfurter) failed or timed out: {exc}. Trying fallback...")

    # 2. Fallback: Open.er-api
    fallback_url = "https://open.er-api.com/v6/latest/USD"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8.0) as client:
            resp = await client.get(fallback_url)
            if resp.status_code == 200:
                data = resp.json()
                rates = data.get("rates", {})
                if "CNY" in rates:
                    cny = float(rates["CNY"])
                    eur = float(rates.get("EUR", 0.92))
                    inr = float(rates.get("INR", 83.50))
                    logger.info("Successfully fetched live forex rates from Open.er-api fallback", extra={"CNY": cny, "EUR": eur, "INR": inr})
                    return {
                        "USD": 1.0,
                        "CNY": cny,
                        "RMB": cny,
                        "EUR": eur,
                        "INR": inr,
                    }
    except Exception as exc:
        logger.error(f"Fallback currency API (Open.er-api) also failed: {exc}. Retaining existing rates.")

    return None


async def sync_currency_rates_to_db() -> dict[str, float]:
    """
    Fetches live exchange rates and updates the PostgreSQL `currency_rates` table
    for all currency pairs configured with mode = 'auto'.
    """
    global _cached_rates, _last_cache_time
    live_rates = await fetch_live_rates()
    engine = get_engine()

    if live_rates:
        try:
            async with engine.begin() as conn:
                for target_curr, rate_val in live_rates.items():
                    if target_curr == "RMB":
                        continue  # CNY represents both CNY and RMB
                    await conn.execute(
                        text("""
                            INSERT INTO currency_rates (id, base_currency, target_currency, rate, mode, source, last_updated_at)
                            VALUES (:id, 'USD', :target, :rate, 'auto', 'Frankfurter / ECB', NOW())
                            ON CONFLICT (base_currency, target_currency)
                            DO UPDATE SET
                                rate = EXCLUDED.rate,
                                source = EXCLUDED.source,
                                last_updated_at = NOW()
                            WHERE currency_rates.mode = 'auto';
                        """),
                        {"id": f"rate-usd-{target_curr.lower()}", "target": target_curr, "rate": rate_val},
                    )
            logger.info("Updated currency_rates table with latest live rates.")
        except Exception as exc:
            logger.error(f"Failed to persist currency rates to database: {exc}")

    # Reload active rates from database
    return await get_active_rates(force_refresh=True)


async def get_active_rates(force_refresh: bool = False) -> dict[str, float]:
    """
    Returns active currency exchange rates from DB with in-memory caching.
    """
    global _cached_rates, _last_cache_time
    now = time.time()
    if not force_refresh and (now - _last_cache_time < CACHE_TTL_SECONDS) and len(_cached_rates) > 2:
        return _cached_rates

    try:
        engine = get_engine()
        async with engine.connect() as conn:
            res = await conn.execute(text("SELECT target_currency, rate, mode FROM currency_rates WHERE base_currency = 'USD'"))
            rows = res.fetchall()
            loaded: dict[str, float] = {"USD": 1.0}
            for r in rows:
                m = r._mapping
                curr = str(m["target_currency"]).upper()
                rate = float(m["rate"])
                loaded[curr] = rate
                if curr == "CNY":
                    loaded["RMB"] = rate

            if "CNY" in loaded:
                _cached_rates = loaded
                _last_cache_time = now
                return _cached_rates
    except Exception as exc:
        logger.warning(f"Error reading currency_rates from database: {exc}. Using memory cache.")

    return _cached_rates


def convert_to_usd_sync(amount: float | None, currency: str | None, rates: dict[str, float] | None = None) -> float:
    """
    Converts any amount in a given currency to USD using the provided or cached rates.
    """
    if amount is None:
        return 999999999.0
    curr = (currency or "USD").strip().upper()
    active_rates = rates or _cached_rates or DEFAULT_RATES
    rate = active_rates.get(curr, 1.0)
    if rate <= 0:
        rate = 1.0
    return amount / rate


async def run_daily_currency_worker():
    """
    Background loop that runs once every 24 hours to refresh exchange rates.
    """
    logger.info("Starting background daily currency exchange worker.")
    # Run once at startup
    try:
        await sync_currency_rates_to_db()
    except Exception as err:
        logger.warning(f"Initial currency sync failed: {err}")

    while True:
        # Sleep for 24 hours (86400 seconds)
        await asyncio.sleep(86400)
        try:
            await sync_currency_rates_to_db()
        except Exception as err:
            logger.error(f"Daily currency sync error: {err}")
