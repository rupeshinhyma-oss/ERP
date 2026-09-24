"""
HRMS Business Logic Service.

Encapsulates database operations and geocoding services for HRMS Locations,
Employee Location Assignments, and WFH Requests.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import BadRequestException, NotFoundException
from app.hrms.models import (
    HrmsAdjustedLeave,
    HrmsAttendanceExemption,
    HrmsAttendanceLog,
    HrmsAttendancePolicy,
    HrmsAttendanceSettings,
    HrmsEmployeeLocation,
    HrmsLocation,
    HrmsRegularizationRequest,
    HrmsWfhRequest,
    LocationType,
    WfhRequestStatus,
)
from app.hrms.schemas import (
    AdjustedLeaveActionPayload,
    ApprovalActionPayload,
    AttendanceExemptionCreate,
    AttendancePolicyCreate,
    AttendancePolicyUpdate,
    AttendanceSettingsUpdate,
    EmployeeLocationAssignmentPayload,
    LocationCreate,
    LocationUpdate,
    RegularizationRequestCreate,
    WfhRequestCreate,
    WfhRequestReview,
)
from app.users.models import User

logger = logging.getLogger(__name__)


def _parse_osm_feature(raw_item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract structured, worldwide address details from OpenStreetMap Nominatim feature.
    Does not hardcode any city, state, or building.
    """
    address_dict = raw_item.get("address") or {}

    # Building / Place Name
    building = (
        raw_item.get("name")
        or address_dict.get("building")
        or address_dict.get("amenity")
        or address_dict.get("office")
        or address_dict.get("shop")
        or address_dict.get("commercial")
        or address_dict.get("industrial")
        or address_dict.get("tourism")
        or address_dict.get("leisure")
        or address_dict.get("historic")
        or address_dict.get("emergency")
        or address_dict.get("man_made")
        or address_dict.get("house_name")
        or ""
    )

    # Street
    house_num = address_dict.get("house_number", "")
    road = (
        address_dict.get("road")
        or address_dict.get("street")
        or address_dict.get("pedestrian")
        or address_dict.get("footway")
        or address_dict.get("path")
        or address_dict.get("avenue")
        or address_dict.get("boulevard")
        or address_dict.get("lane")
        or ""
    )
    if house_num and road:
        street = f"{house_num}, {road}" if building != house_num else road
    else:
        street = road or house_num

    # Locality
    locality = (
        address_dict.get("suburb")
        or address_dict.get("neighbourhood")
        or address_dict.get("quarter")
        or address_dict.get("residential")
        or address_dict.get("district")
        or address_dict.get("locality")
        or address_dict.get("subdistrict")
        or ""
    )

    # City
    city = (
        address_dict.get("city")
        or address_dict.get("town")
        or address_dict.get("municipality")
        or address_dict.get("village")
        or address_dict.get("hamlet")
        or address_dict.get("county")
        or address_dict.get("city_district")
        or ""
    )

    # State
    state = (
        address_dict.get("state")
        or address_dict.get("province")
        or address_dict.get("region")
        or address_dict.get("state_district")
        or ""
    )

    # PIN Code
    pin_code = (
        address_dict.get("postcode")
        or address_dict.get("postal_code")
        or ""
    )

    # Country
    country = address_dict.get("country", "")

    # Place ID (stable identifier)
    place_id = str(raw_item.get("place_id", ""))

    display_name = raw_item.get("display_name", "")
    try:
        lat = round(float(raw_item.get("lat", 0.0)), 6)
    except (TypeError, ValueError):
        lat = 0.0
    try:
        lon = round(float(raw_item.get("lon", 0.0)), 6)
    except (TypeError, ValueError):
        lon = 0.0

    # If building name is empty, derive from display_name if distinct
    if not building and display_name:
        parts = [p.strip() for p in display_name.split(",")]
        if len(parts) > 1 and parts[0] != street and parts[0] != city:
            building = parts[0]

    return {
        "place_id": place_id,
        "display_name": display_name,
        "latitude": lat,
        "longitude": lon,
        "type": raw_item.get("type", "location"),
        "building": building,
        "street": street,
        "locality": locality,
        "city": city,
        "state": state,
        "pin_code": pin_code,
        "country": country,
        "address": display_name,
    }


def _parse_photon_feature(feature: Dict[str, Any]) -> Dict[str, Any]:
    """Extract structured worldwide location from Photon Komoot (OSM-backed) feature."""
    props = feature.get("properties") or {}
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or [0.0, 0.0]
    lon = round(float(coords[0]), 6) if len(coords) > 0 else 0.0
    lat = round(float(coords[1]), 6) if len(coords) > 1 else 0.0

    name = props.get("name") or ""
    street = props.get("street") or ""
    housenumber = props.get("housenumber") or ""
    if housenumber and street:
        street_full = f"{housenumber}, {street}"
    else:
        street_full = street or housenumber

    locality = props.get("district") or props.get("suburb") or props.get("locality") or ""
    city = props.get("city") or props.get("county") or props.get("town") or ""
    state = props.get("state") or ""
    pin_code = props.get("postcode") or ""
    country = props.get("country") or ""
    place_type = props.get("type") or props.get("osm_value") or "location"

    parts = []
    if name:
        parts.append(name)
    if street_full and street_full != name:
        parts.append(street_full)
    if locality and locality != name:
        parts.append(locality)
    if city and city != locality:
        parts.append(city)
    if state and state != city:
        parts.append(state)
    if pin_code:
        parts.append(pin_code)
    if country:
        parts.append(country)

    display_name = ", ".join(parts) if parts else name or f"Location ({lat:.6f}, {lon:.6f})"
    place_id = str(props.get("osm_id") or f"pt-{lat}-{lon}")

    return {
        "place_id": place_id,
        "display_name": display_name,
        "latitude": lat,
        "longitude": lon,
        "type": place_type,
        "building": name,
        "street": street_full,
        "locality": locality,
        "city": city,
        "state": state,
        "pin_code": pin_code,
        "country": country,
        "address": display_name,
    }


def generate_query_strategies(clean_query: str) -> List[str]:
    """
    Generates multiple progressive search strategies:
    1. Full raw address
    2. Remove apartment/building/road/flat numbers
    3. Landmark/Building + Locality/City
    4. Landmark/Building alone
    5. Locality + City
    6. Postal PIN Code alone
    7. City alone
    """
    import re

    clean = re.sub(r"[\r\n\t]+", " ", clean_query).strip()
    if not clean:
        return []

    candidates = [clean]
    parts = [p.strip() for p in re.split(r"[,;]+", clean) if p.strip()]

    unit_pattern = re.compile(
        r"^(flat|apt|apartment|unit|suite|room|floor|plot|road\s+no|road\s+number|pillar|block|gate|cabin|shop\s+no|gala)\b.*",
        re.IGNORECASE,
    )

    # Strategy 2: Remove unit/flat/road number tokens
    filtered = [p for p in parts if not unit_pattern.match(p)]
    if len(filtered) != len(parts) and len(filtered) >= 2:
        candidates.append(", ".join(filtered))

    # Strategy 3: Landmark / First token + Locality / City
    if len(filtered) >= 3:
        candidates.append(f"{filtered[0]}, {filtered[1]}")
        candidates.append(f"{filtered[0]}, {filtered[-2]}")
    elif len(filtered) == 2:
        candidates.append(f"{filtered[0]}, {filtered[1]}")

    # Strategy 4: First token alone (building / landmark name)
    if filtered and len(filtered[0]) >= 3:
        candidates.append(filtered[0])

    # Strategy 5: Locality + City
    if len(filtered) >= 3:
        candidates.append(", ".join(filtered[1:]))

    # Strategy 6: PIN Code alone
    pin = re.search(r"\b\d{5,6}\b", clean)
    if pin:
        candidates.append(pin.group(0))

    # Strategy 7: City / last token
    if len(filtered) >= 2 and len(filtered[-1]) >= 3:
        candidates.append(filtered[-1])

    # Deduplicate preserving order
    seen = set()
    result = []
    for c in candidates:
        norm = c.strip().lower()
        if norm not in seen and len(c.strip()) >= 2:
            seen.add(norm)
            result.append(c.strip())
    return result


def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points in meters using Haversine formula."""
    r = 6371000.0  # Earth's radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def parse_time_str_to_minutes(time_str: str) -> int:
    """Parse '10:30 AM', '10:45 AM', '19:00' to minutes from midnight."""
    clean = time_str.strip().upper()
    try:
        dt = datetime.strptime(clean, "%I:%M %p")
        return dt.hour * 60 + dt.minute
    except Exception:
        pass
    try:
        dt = datetime.strptime(clean, "%H:%M")
        return dt.hour * 60 + dt.minute
    except Exception:
        return 10 * 60 + 30


class HrmsService:
    """Service handling all HRMS Location and WFH operations."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # -----------------------------------------------------------------------
    # Universal Geocoding & Coordinates Resolution
    # -----------------------------------------------------------------------

    async def search_addresses(self, query: str) -> List[Dict[str, Any]]:
        """
        Universal multi-strategy address suggestion search worldwide.
        Tries full address, then progressively relaxes over-specific apartment/road numbers,
        landmarks, localities, and PIN codes. Never fails on minor sub-string mismatches.
        """
        clean_query = query.strip()
        if not clean_query:
            return []

        def _execute_search() -> List[Dict[str, Any]]:
            strategies = generate_query_strategies(clean_query)
            all_results = []
            seen_coords = set()

            def _query_photon(q: str) -> List[Dict[str, Any]]:
                try:
                    url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(q)}&limit=6"
                    req = urllib.request.Request(
                        url,
                        headers={"User-Agent": "InhymaERP/1.0 (location-service@inhyma.com)"},
                    )
                    with urllib.request.urlopen(req, timeout=3.5) as resp:
                        if resp.status == 200:
                            data = json.loads(resp.read().decode("utf-8"))
                            features = data.get("features") or []
                            return [_parse_photon_feature(f) for f in features]
                except Exception:
                    pass
                return []

            def _query_nominatim(q: str) -> List[Dict[str, Any]]:
                try:
                    url = (
                        f"https://nominatim.openstreetmap.org/search?"
                        f"q={urllib.parse.quote(q)}&format=json&addressdetails=1&limit=6"
                    )
                    req = urllib.request.Request(
                        url,
                        headers={
                            "User-Agent": "InhymaERP-UniversalLocation/1.0 (location-service@inhyma.com)",
                            "Accept-Language": "en",
                            "Referer": "https://erp.inhyma.com",
                        },
                    )
                    with urllib.request.urlopen(req, timeout=3.5) as resp:
                        if resp.status == 200:
                            data = json.loads(resp.read().decode("utf-8"))
                            if isinstance(data, list):
                                return [_parse_osm_feature(item) for item in data]
                except Exception:
                    pass
                return []

            for strat in strategies:
                # 1. Query Photon first (Google Maps-style autocomplete, fuzzy, high speed)
                candidates = _query_photon(strat)

                # 2. If Photon returned 0, fallback to Nominatim search
                if not candidates:
                    candidates = _query_nominatim(strat)

                for item in candidates:
                    coord_key = (round(item["latitude"], 4), round(item["longitude"], 4))
                    if coord_key not in seen_coords:
                        seen_coords.add(coord_key)
                        all_results.append(item)

                if len(all_results) >= 3:
                    break

            return all_results

        return await asyncio.to_thread(_execute_search)

    async def geocode_address(self, address: str) -> Dict[str, Any]:
        """
        Resolve human-readable address to coordinates worldwide using multi-strategy search.
        Raises NotFoundException if no match can be determined.
        """
        clean_addr = address.strip()
        if not clean_addr:
            raise BadRequestException("Address cannot be blank")

        results = await self.search_addresses(clean_addr)
        if results:
            return results[0]

        raise NotFoundException(
            "We couldn't find an exact match. Please choose one of the suggestions or refine your search."
        )

    async def reverse_geocode(self, lat: float, lon: float) -> Dict[str, Any]:
        """
        Reverse-lookup coordinates to a structured address verification card worldwide.
        """
        def _fetch_reverse() -> Optional[Dict[str, Any]]:
            try:
                url = (
                    f"https://nominatim.openstreetmap.org/reverse?"
                    f"lat={lat}&lon={lon}&format=json&addressdetails=1&zoom=18"
                )
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": "InhymaERP-UniversalLocation/1.0 (location-service@inhyma.com)",
                        "Accept-Language": "en",
                        "Referer": "https://erp.inhyma.com",
                    },
                )
                with urllib.request.urlopen(req, timeout=4.0) as resp:
                    if resp.status == 200:
                        data = json.loads(resp.read().decode("utf-8"))
                        if data and isinstance(data, dict):
                            if "lat" not in data:
                                data["lat"] = lat
                            if "lon" not in data:
                                data["lon"] = lon
                            return _parse_osm_feature(data)
            except Exception as exc:
                logger.warning(f"OSM reverse geocode failed for {lat},{lon}: {exc}")
            return None

        result = await asyncio.to_thread(_fetch_reverse)
        if result:
            return result

        # Dynamic fallback based purely on the coordinates without hardcoding any city or building
        return {
            "place_id": f"pin-{round(lat, 4)}-{round(lon, 4)}",
            "display_name": f"Location ({lat:.6f}, {lon:.6f})",
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
            "type": "custom_pin",
            "building": "Custom Pin Location",
            "street": "",
            "locality": "",
            "city": "",
            "state": "",
            "pin_code": "",
            "country": "",
            "address": f"Location ({lat:.6f}, {lon:.6f})",
        }

    # -----------------------------------------------------------------------
    # Location Management
    # -----------------------------------------------------------------------

    async def list_locations(
        self,
        active_only: bool = False,
        search: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        List all office/facility locations with assigned employee counts.
        """
        stmt = (
            select(
                HrmsLocation,
                func.count(HrmsEmployeeLocation.id).label("assigned_count"),
            )
            .outerjoin(HrmsEmployeeLocation, HrmsEmployeeLocation.location_id == HrmsLocation.id)
            .where(HrmsLocation.deleted_at.is_(None))
            .group_by(HrmsLocation.id)
            .order_by(HrmsLocation.is_active.desc(), HrmsLocation.name.asc())
        )

        if active_only:
            stmt = stmt.where(HrmsLocation.is_active.is_(True))

        if search and search.strip():
            term = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    HrmsLocation.name.ilike(term),
                    HrmsLocation.address.ilike(term),
                    HrmsLocation.location_type.ilike(term),
                )
            )

        result = await self.db.execute(stmt)
        rows = result.all()

        output: List[Dict[str, Any]] = []
        if not rows:
            default_loc = HrmsLocation(
                name="Inhyma Thane Office",
                location_type=LocationType.OFFICE,
                address="Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
                latitude=19.198300,
                longitude=72.948300,
                radius_meters=150.0,
                place_id="ChIJ_lodha_supremus_thane_421",
                is_active=True,
            )
            self.db.add(default_loc)
            await self.db.commit()
            await self.db.refresh(default_loc)
            return [{
                "id": str(default_loc.id),
                "name": default_loc.name,
                "location_type": default_loc.location_type,
                "address": default_loc.address,
                "latitude": default_loc.latitude,
                "longitude": default_loc.longitude,
                "radius_meters": default_loc.radius_meters,
                "place_id": getattr(default_loc, "place_id", None),
                "is_active": default_loc.is_active,
                "assigned_employees_count": 0,
                "created_at": default_loc.created_at,
                "updated_at": default_loc.updated_at,
            }]

        for loc, count in rows:
            output.append({
                "id": str(loc.id),
                "name": loc.name,
                "location_type": loc.location_type,
                "address": loc.address,
                "latitude": loc.latitude,
                "longitude": loc.longitude,
                "radius_meters": loc.radius_meters,
                "place_id": getattr(loc, "place_id", None),
                "is_active": loc.is_active,
                "assigned_employees_count": count or 0,
                "created_at": loc.created_at,
                "updated_at": loc.updated_at,
            })
        return output

    async def get_location(self, location_id: str) -> Dict[str, Any]:
        """Fetch single location by UUID."""
        try:
            loc_uuid = uuid.UUID(location_id)
        except ValueError:
            raise BadRequestException("Invalid location ID format")

        stmt = (
            select(
                HrmsLocation,
                func.count(HrmsEmployeeLocation.id).label("assigned_count"),
            )
            .outerjoin(HrmsEmployeeLocation, HrmsEmployeeLocation.location_id == HrmsLocation.id)
            .where(HrmsLocation.id == loc_uuid, HrmsLocation.deleted_at.is_(None))
            .group_by(HrmsLocation.id)
        )
        result = await self.db.execute(stmt)
        row = result.first()
        if not row:
            raise NotFoundException("Location not found")

        loc, count = row
        return {
            "id": str(loc.id),
            "name": loc.name,
            "location_type": loc.location_type,
            "address": loc.address,
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "radius_meters": loc.radius_meters,
            "place_id": getattr(loc, "place_id", None),
            "is_active": loc.is_active,
            "assigned_employees_count": count or 0,
            "created_at": loc.created_at,
            "updated_at": loc.updated_at,
        }

    async def create_location(self, payload: LocationCreate) -> Dict[str, Any]:
        """Create and persist confirmed office location."""
        loc = HrmsLocation(
            name=payload.name.strip(),
            location_type=payload.location_type.value if hasattr(payload.location_type, "value") else str(payload.location_type),
            address=payload.address.strip(),
            latitude=payload.latitude,
            longitude=payload.longitude,
            radius_meters=payload.radius_meters,
            place_id=payload.place_id,
            is_active=True,
        )
        self.db.add(loc)
        await self.db.commit()
        await self.db.refresh(loc)

        return {
            "id": str(loc.id),
            "name": loc.name,
            "location_type": loc.location_type,
            "address": loc.address,
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "radius_meters": loc.radius_meters,
            "place_id": getattr(loc, "place_id", None),
            "is_active": loc.is_active,
            "assigned_employees_count": 0,
            "created_at": loc.created_at,
            "updated_at": loc.updated_at,
        }

    async def update_location(self, location_id: str, payload: LocationUpdate) -> Dict[str, Any]:
        """Update an existing location's details, address, coordinates, or status."""
        try:
            loc_uuid = uuid.UUID(location_id)
        except ValueError:
            raise BadRequestException("Invalid location ID format")

        stmt = select(HrmsLocation).where(HrmsLocation.id == loc_uuid, HrmsLocation.deleted_at.is_(None))
        result = await self.db.execute(stmt)
        loc = result.scalar_one_or_none()
        if not loc:
            raise NotFoundException("Location not found")

        if payload.name is not None:
            loc.name = payload.name.strip()
        if payload.location_type is not None:
            loc.location_type = payload.location_type.value if hasattr(payload.location_type, "value") else str(payload.location_type)
        if payload.address is not None:
            loc.address = payload.address.strip()
        if payload.latitude is not None:
            loc.latitude = payload.latitude
        if payload.longitude is not None:
            loc.longitude = payload.longitude
        if payload.radius_meters is not None:
            loc.radius_meters = payload.radius_meters
        if payload.place_id is not None:
            loc.place_id = payload.place_id
        if payload.is_active is not None:
            loc.is_active = payload.is_active

        await self.db.commit()
        await self.db.refresh(loc)

        # Count assignments
        count_stmt = select(func.count(HrmsEmployeeLocation.id)).where(HrmsEmployeeLocation.location_id == loc_uuid)
        count_res = await self.db.execute(count_stmt)
        count = count_res.scalar() or 0

        return {
            "id": str(loc.id),
            "name": loc.name,
            "location_type": loc.location_type,
            "address": loc.address,
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "radius_meters": loc.radius_meters,
            "is_active": loc.is_active,
            "assigned_employees_count": count,
            "created_at": loc.created_at,
            "updated_at": loc.updated_at,
        }

    async def toggle_location_status(self, location_id: str) -> Dict[str, Any]:
        """Soft-disable or re-enable a location (no hard deletion)."""
        try:
            loc_uuid = uuid.UUID(location_id)
        except ValueError:
            raise BadRequestException("Invalid location ID format")

        stmt = select(HrmsLocation).where(HrmsLocation.id == loc_uuid, HrmsLocation.deleted_at.is_(None))
        result = await self.db.execute(stmt)
        loc = result.scalar_one_or_none()
        if not loc:
            raise NotFoundException("Location not found")

        loc.is_active = not loc.is_active
        await self.db.commit()
        await self.db.refresh(loc)

        count_stmt = select(func.count(HrmsEmployeeLocation.id)).where(HrmsEmployeeLocation.location_id == loc_uuid)
        count_res = await self.db.execute(count_stmt)
        count = count_res.scalar() or 0

        return {
            "id": str(loc.id),
            "name": loc.name,
            "location_type": loc.location_type,
            "address": loc.address,
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "radius_meters": loc.radius_meters,
            "is_active": loc.is_active,
            "assigned_employees_count": count,
            "created_at": loc.created_at,
            "updated_at": loc.updated_at,
        }

    async def delete_location(self, location_id: str) -> Dict[str, Any]:
        """Soft-delete an office location."""
        try:
            loc_uuid = uuid.UUID(location_id)
        except ValueError:
            raise BadRequestException("Invalid location ID format")

        stmt = select(HrmsLocation).where(HrmsLocation.id == loc_uuid, HrmsLocation.deleted_at.is_(None))
        result = await self.db.execute(stmt)
        loc = result.scalar_one_or_none()
        if not loc:
            raise NotFoundException("Location not found")

        loc.deleted_at = datetime.now(timezone.utc)
        loc.is_active = False
        await self.db.commit()

        return {"id": str(loc.id), "name": loc.name, "deleted": True}

    # -----------------------------------------------------------------------
    # Employee Location Assignments
    # -----------------------------------------------------------------------

    async def list_employee_assignments(self, search: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        List all active employees with their primary and additional assigned locations.
        """
        stmt = (
            select(User)
            .where(User.deleted_at.is_(None))
            .order_by(User.first_name.asc(), User.last_name.asc())
        )
        if search and search.strip():
            term = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    User.first_name.ilike(term),
                    User.last_name.ilike(term),
                    User.display_name.ilike(term),
                    User.employee_code.ilike(term),
                    User.email.ilike(term),
                )
            )

        users_res = await self.db.execute(stmt)
        users = users_res.scalars().all()

        user_ids = [u.id for u in users]
        if not user_ids:
            return []

        # Fetch all assignments for these users
        assign_stmt = (
            select(HrmsEmployeeLocation, HrmsLocation)
            .join(HrmsLocation, HrmsLocation.id == HrmsEmployeeLocation.location_id)
            .where(
                HrmsEmployeeLocation.user_id.in_(user_ids),
                HrmsLocation.deleted_at.is_(None),
            )
        )
        assign_res = await self.db.execute(assign_stmt)
        assignments = assign_res.all()

        # Group by user_id
        grouped: Dict[uuid.UUID, Dict[str, Any]] = {}
        for emp_loc, loc in assignments:
            loc_summary = {
                "id": str(loc.id),
                "name": loc.name,
                "location_type": loc.location_type,
                "address": loc.address,
                "radius_meters": loc.radius_meters,
                "is_primary": emp_loc.is_primary,
            }
            if emp_loc.user_id not in grouped:
                grouped[emp_loc.user_id] = {"primary": None, "additional": []}

            if emp_loc.is_primary:
                grouped[emp_loc.user_id]["primary"] = loc_summary
            else:
                grouped[emp_loc.user_id]["additional"].append(loc_summary)

        output: List[Dict[str, Any]] = []
        for u in users:
            name_parts = [p for p in [u.first_name, u.last_name] if p]
            full_name = " ".join(name_parts) if name_parts else (u.display_name or u.username or "Employee")
            user_data = grouped.get(u.id, {"primary": None, "additional": []})
            output.append({
                "user_id": str(u.id),
                "employee_name": full_name,
                "employee_code": u.employee_code,
                "email": u.email,
                "department": u.department_name if hasattr(u, "department_name") else None,
                "role": u.role.name if hasattr(u, "role") and u.role else None,
                "primary_location": user_data["primary"],
                "additional_locations": user_data["additional"],
            })

        return output

    async def get_employee_locations(self, user_id: str) -> Dict[str, Any]:
        """Fetch primary and additional locations for a specific employee."""
        try:
            u_uuid = uuid.UUID(user_id)
        except ValueError:
            raise BadRequestException("Invalid user ID format")

        user_stmt = select(User).where(User.id == u_uuid, User.deleted_at.is_(None))
        user_res = await self.db.execute(user_stmt)
        u = user_res.scalar_one_or_none()
        if not u:
            raise NotFoundException("Employee not found")

        assign_stmt = (
            select(HrmsEmployeeLocation, HrmsLocation)
            .join(HrmsLocation, HrmsLocation.id == HrmsEmployeeLocation.location_id)
            .where(
                HrmsEmployeeLocation.user_id == u_uuid,
                HrmsLocation.deleted_at.is_(None),
            )
        )
        assign_res = await self.db.execute(assign_stmt)
        rows = assign_res.all()

        primary_loc = None
        additional_locs = []
        for emp_loc, loc in rows:
            loc_summary = {
                "id": str(loc.id),
                "name": loc.name,
                "location_type": loc.location_type,
                "address": loc.address,
                "radius_meters": loc.radius_meters,
                "is_primary": emp_loc.is_primary,
            }
            if emp_loc.is_primary:
                primary_loc = loc_summary
            else:
                additional_locs.append(loc_summary)

        name_parts = [p for p in [u.first_name, u.last_name] if p]
        full_name = " ".join(name_parts) if name_parts else (u.display_name or u.username or "Employee")

        return {
            "user_id": str(u.id),
            "employee_name": full_name,
            "employee_code": u.employee_code,
            "email": u.email,
            "department": getattr(u, "department_name", None),
            "role": u.role.name if getattr(u, "role", None) else None,
            "primary_location": primary_loc,
            "additional_locations": additional_locs,
        }

    async def assign_employee_locations(
        self,
        user_id: str,
        payload: EmployeeLocationAssignmentPayload,
    ) -> Dict[str, Any]:
        """
        HR/Admin assignment: Set exactly one primary location + optional additional locations.
        """
        try:
            u_uuid = uuid.UUID(user_id)
            primary_uuid = uuid.UUID(payload.primary_location_id)
            add_uuids = [uuid.UUID(loc_id) for loc_id in payload.additional_location_ids if loc_id != payload.primary_location_id]
        except ValueError:
            raise BadRequestException("Invalid UUID format in assignment payload")

        # Verify user exists
        user_stmt = select(User).where(User.id == u_uuid, User.deleted_at.is_(None))
        user_res = await self.db.execute(user_stmt)
        u = user_res.scalar_one_or_none()
        if not u:
            raise NotFoundException("Employee not found")

        # Verify primary location exists and is active
        primary_stmt = select(HrmsLocation).where(
            HrmsLocation.id == primary_uuid,
            HrmsLocation.deleted_at.is_(None),
            HrmsLocation.is_active.is_(True),
        )
        primary_res = await self.db.execute(primary_stmt)
        primary_loc = primary_res.scalar_one_or_none()
        if not primary_loc:
            raise BadRequestException("Primary location does not exist or is inactive")

        # Verify additional locations if provided
        if add_uuids:
            add_stmt = select(HrmsLocation).where(
                HrmsLocation.id.in_(add_uuids),
                HrmsLocation.deleted_at.is_(None),
                HrmsLocation.is_active.is_(True),
            )
            add_res = await self.db.execute(add_stmt)
            found_add = add_res.scalars().all()
            if len(found_add) != len(add_uuids):
                raise BadRequestException("One or more additional locations do not exist or are inactive")

        # Atomically remove previous assignments for this user
        del_stmt = delete(HrmsEmployeeLocation).where(HrmsEmployeeLocation.user_id == u_uuid)
        await self.db.execute(del_stmt)

        # Insert primary location
        primary_record = HrmsEmployeeLocation(
            user_id=u_uuid,
            location_id=primary_uuid,
            is_primary=True,
        )
        self.db.add(primary_record)

        # Insert additional locations
        for add_id in add_uuids:
            self.db.add(
                HrmsEmployeeLocation(
                    user_id=u_uuid,
                    location_id=add_id,
                    is_primary=False,
                )
            )

        await self.db.commit()
        return await self.get_employee_locations(user_id)

    # -----------------------------------------------------------------------
    # WFH Requests & Manager Approval Queue
    # -----------------------------------------------------------------------

    async def create_wfh_request(self, user_id: str, payload: WfhRequestCreate) -> Dict[str, Any]:
        """Submit a WFH request with confirmed map pin."""
        try:
            u_uuid = uuid.UUID(user_id)
        except ValueError:
            raise BadRequestException("Invalid user ID format")

        req = HrmsWfhRequest(
            user_id=u_uuid,
            wfh_date=payload.wfh_date,
            reason=payload.reason.strip(),
            address=payload.address.strip(),
            latitude=payload.latitude,
            longitude=payload.longitude,
            radius_meters=payload.radius_meters,
            place_id=payload.place_id,
            status=WfhRequestStatus.PENDING.value,
            submitted_at=datetime.now(timezone.utc),
        )
        self.db.add(req)
        await self.db.commit()
        await self.db.refresh(req)

        # Fetch employee display name
        u_stmt = select(User).where(User.id == u_uuid)
        u_res = await self.db.execute(u_stmt)
        u = u_res.scalar_one_or_none()
        emp_name = u.display_name or (f"{u.first_name or ''} {u.last_name or ''}".strip()) if u else "Employee"

        return {
            "id": str(req.id),
            "user_id": str(req.user_id),
            "employee_name": emp_name or "Employee",
            "employee_code": u.employee_code if u else None,
            "wfh_date": req.wfh_date.isoformat(),
            "reason": req.reason,
            "address": req.address,
            "latitude": req.latitude,
            "longitude": req.longitude,
            "radius_meters": req.radius_meters,
            "place_id": getattr(req, "place_id", None),
            "status": req.status,
            "manager_id": None,
            "manager_remarks": None,
            "submitted_at": req.submitted_at,
            "reviewed_at": None,
        }

    async def list_my_wfh_requests(self, user_id: str) -> List[Dict[str, Any]]:
        """List current employee's submitted WFH requests."""
        try:
            u_uuid = uuid.UUID(user_id)
        except ValueError:
            raise BadRequestException("Invalid user ID format")

        stmt = (
            select(HrmsWfhRequest, User)
            .join(User, User.id == HrmsWfhRequest.user_id)
            .where(HrmsWfhRequest.user_id == u_uuid)
            .order_by(HrmsWfhRequest.submitted_at.desc())
        )
        res = await self.db.execute(stmt)
        rows = res.all()

        output = []
        for req, u in rows:
            emp_name = u.display_name or (f"{u.first_name or ''} {u.last_name or ''}".strip())
            output.append({
                "id": str(req.id),
                "user_id": str(req.user_id),
                "employee_name": emp_name or "Employee",
                "employee_code": u.employee_code,
                "wfh_date": req.wfh_date.isoformat(),
                "reason": req.reason,
                "address": req.address,
                "latitude": req.latitude,
                "longitude": req.longitude,
                "radius_meters": req.radius_meters,
                "place_id": getattr(req, "place_id", None),
                "status": req.status,
                "manager_id": str(req.manager_id) if req.manager_id else None,
                "manager_remarks": req.manager_remarks,
                "submitted_at": req.submitted_at,
                "reviewed_at": req.reviewed_at,
            })
        return output

    async def list_pending_wfh_requests(self) -> List[Dict[str, Any]]:
        """List all pending WFH requests in the manager approval queue."""
        stmt = (
            select(HrmsWfhRequest, User)
            .join(User, User.id == HrmsWfhRequest.user_id)
            .where(HrmsWfhRequest.status == WfhRequestStatus.PENDING.value)
            .order_by(HrmsWfhRequest.submitted_at.asc())
        )
        res = await self.db.execute(stmt)
        rows = res.all()

        output = []
        for req, u in rows:
            emp_name = u.display_name or (f"{u.first_name or ''} {u.last_name or ''}".strip())
            output.append({
                "id": str(req.id),
                "user_id": str(req.user_id),
                "employee_name": emp_name or "Employee",
                "employee_code": u.employee_code,
                "wfh_date": req.wfh_date.isoformat(),
                "reason": req.reason,
                "address": req.address,
                "latitude": req.latitude,
                "longitude": req.longitude,
                "radius_meters": req.radius_meters,
                "place_id": getattr(req, "place_id", None),
                "status": req.status,
                "manager_id": str(req.manager_id) if req.manager_id else None,
                "manager_remarks": req.manager_remarks,
                "submitted_at": req.submitted_at,
                "reviewed_at": req.reviewed_at,
            })
        return output

    async def review_wfh_request(
        self,
        request_id: str,
        manager_id: str,
        payload: WfhRequestReview,
    ) -> Dict[str, Any]:
        """Approve or reject an employee's WFH request."""
        try:
            req_uuid = uuid.UUID(request_id)
            mgr_uuid = uuid.UUID(manager_id)
        except ValueError:
            raise BadRequestException("Invalid UUID format")

        stmt = select(HrmsWfhRequest).where(HrmsWfhRequest.id == req_uuid)
        res = await self.db.execute(stmt)
        req = res.scalar_one_or_none()
        if not req:
            raise NotFoundException("WFH request not found")

        req.status = payload.status.value if hasattr(payload.status, "value") else str(payload.status)
        req.manager_id = mgr_uuid
        req.manager_remarks = payload.manager_remarks.strip() if payload.manager_remarks else None
        req.reviewed_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(req)

        u_stmt = select(User).where(User.id == req.user_id)
        u_res = await self.db.execute(u_stmt)
        u = u_res.scalar_one_or_none()
        emp_name = u.display_name or (f"{u.first_name or ''} {u.last_name or ''}".strip()) if u else "Employee"

        return {
            "id": str(req.id),
            "user_id": str(req.user_id),
            "employee_name": emp_name or "Employee",
            "employee_code": u.employee_code if u else None,
            "wfh_date": req.wfh_date.isoformat(),
            "reason": req.reason,
            "address": req.address,
            "latitude": req.latitude,
            "longitude": req.longitude,
            "radius_meters": req.radius_meters,
            "status": req.status,
            "manager_id": str(req.manager_id) if req.manager_id else None,
            "manager_remarks": req.manager_remarks,
            "submitted_at": req.submitted_at,
            "reviewed_at": req.reviewed_at,
        }

    # -----------------------------------------------------------------------
    # ATTENDANCE LOGS & PUNCH
    # -----------------------------------------------------------------------

    def _serialize_attendance_log(self, log: HrmsAttendanceLog) -> Dict[str, Any]:
        """Serialize attendance record for API responses."""
        office_name = "Inhyma Thane Office"
        if log.office:
            office_name = log.office.name
        elif log.workplace:
            office_name = log.workplace

        return {
            "id": str(log.id),
            "user_id": str(log.user_id),
            "employee_id": str(log.user_id),
            "attendance_date": log.attendance_date.isoformat(),
            "check_in_time": log.check_in_time.isoformat() if log.check_in_time else None,
            "check_out_time": log.check_out_time.isoformat() if log.check_out_time else None,
            "punched_in": log.check_in_time.isoformat() if log.check_in_time else (log.punch_in or None),
            "punched_out": log.check_out_time.isoformat() if log.check_out_time else (log.punch_out or None),
            "office_id": str(log.office_id) if log.office_id else None,
            "office_name": office_name,
            "latitude": log.latitude,
            "longitude": log.longitude,
            "punch_type": log.punch_type or "CHECK_IN",
            "status": log.status,
            "final_status": log.final_status or log.status,
            "total_work_minutes": log.total_work_minutes,
            "total_hours": log.total_hours,
            "rule_triggered": log.rule_triggered,
            "punch_in": log.punch_in,
            "punch_out": log.punch_out,
            "workplace": office_name,
            "is_irregular": log.is_irregular,
            "late_mark": getattr(log, "late_mark", False),
            "half_day": getattr(log, "half_day", False),
            "regularization_status": getattr(log, "regularization_status", None),
        }

    async def get_active_policy(self) -> HrmsAttendancePolicy:
        """Fetch active policy or auto-seed default."""
        stmt = (
            select(HrmsAttendancePolicy)
            .where(
                HrmsAttendancePolicy.is_active == True,
                HrmsAttendancePolicy.deleted_at.is_(None),
                HrmsAttendancePolicy.is_archived == False,
            )
            .order_by(HrmsAttendancePolicy.created_at.desc())
        )
        res = await self.db.execute(stmt)
        policy = res.scalars().first()
        if not policy:
            policy = HrmsAttendancePolicy(
                name="General Office Policy",
                shift_start="10:30 AM",
                shift_end="07:00 PM",
                grace_until="10:45 AM",
                late_starts_after="10:46 AM",
                direct_half_day_after="11:31 AM",
                late_marks_before_half_day=3,
                payroll_cycle="1st to 31st of Month",
                employment_type="Full Time Permanent",
                is_active=True,
                is_archived=False,
            )
            self.db.add(policy)
            await self.db.commit()
            await self.db.refresh(policy)
        return policy

    async def evaluate_punch_in_status(
        self, user_id: uuid.UUID, check_in_dt: datetime, policy: HrmsAttendancePolicy
    ) -> tuple[str, str]:
        """
        Evaluates punch in time against active policy rules.
        Shift: 10:30 AM - 07:00 PM
        10:32 -> Present
        10:46 -> Late Mark 1 (or 2)
        3rd Late in Month -> Half Day
        11:31 -> Immediate Half Day
        """
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        now_local = check_in_dt.astimezone(ist_tz)
        punch_minutes = now_local.hour * 60 + now_local.minute

        grace_minutes = parse_time_str_to_minutes(policy.grace_until or "10:45 AM")
        direct_half_day_minutes = parse_time_str_to_minutes(policy.direct_half_day_after or "11:31 AM")

        if punch_minutes <= grace_minutes:
            return "Present", "On Time / Grace Period"

        if punch_minutes >= direct_half_day_minutes:
            return "Half Day", "Immediate Half Day"

        # Late threshold check in current month
        yr = now_local.year
        mo = now_local.month
        stmt = (
            select(func.count())
            .select_from(HrmsAttendanceLog)
            .where(
                HrmsAttendanceLog.user_id == user_id,
                func.extract("year", HrmsAttendanceLog.attendance_date) == yr,
                func.extract("month", HrmsAttendanceLog.attendance_date) == mo,
                or_(
                    HrmsAttendanceLog.final_status == "Late Punch",
                    HrmsAttendanceLog.rule_triggered.ilike("%Late Mark%"),
                    HrmsAttendanceLog.rule_triggered.ilike("%3rd Late%"),
                ),
            )
        )
        count_res = await self.db.execute(stmt)
        late_count = count_res.scalar() or 0
        current_instance = late_count + 1

        threshold = policy.late_marks_before_half_day or 3
        if current_instance >= threshold:
            return "Half Day", "3rd Late in Month (Half Day)"
        else:
            return "Late Punch", f"Late Mark {current_instance}"

    async def get_assigned_office(self, user_id: str) -> Dict[str, Any]:
        """Fetch employee assigned office or ensure default Inhyma Thane Office."""
        from app.hrms.repository import AttendanceRepository
        repo = AttendanceRepository(self.db)
        uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        office = await repo.get_assigned_office(uid)
        return {
            "id": str(office.id),
            "name": office.name,
            "address": office.address,
            "latitude": office.latitude,
            "longitude": office.longitude,
            "radius_meters": office.radius_meters,
            "is_active": office.is_active,
        }

    async def get_today_attendance(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Fetch today's persistent attendance record and server time metadata for the employee."""
        uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        now_utc = datetime.now(timezone.utc)
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        now_local = now_utc.astimezone(ist_tz)
        today = now_local.date()

        policy = await self.get_active_policy()
        shift_str = f"{policy.shift_start} – {policy.shift_end}" if policy and policy.shift_start and policy.shift_end else "10:30 AM – 07:00 PM"

        # Determine employee assigned office from repository
        office_data = await self.get_assigned_office(str(uid))

        stmt = (
            select(HrmsAttendanceLog)
            .options(selectinload(HrmsAttendanceLog.office))
            .where(
                HrmsAttendanceLog.user_id == uid,
                HrmsAttendanceLog.attendance_date == today,
            )
            .order_by(HrmsAttendanceLog.created_at.desc())
        )
        res = await self.db.execute(stmt)
        log = res.scalars().first()

        greeting = "Good Morning" if now_local.hour < 12 else ("Good Afternoon" if now_local.hour < 17 else "Good Evening")
        attendance_state = log.status if log else "NOT_PUNCHED"
        serialized_log = self._serialize_attendance_log(log) if log else None

        resp = {
            "server_time": now_utc.isoformat(),
            "server_time_local": now_local.isoformat(),
            "current_date": str(today),
            "current_time": now_local.strftime("%I:%M %p"),
            "greeting": greeting,
            "current_shift": shift_str,
            "attendance_state": attendance_state,
            "assigned_office": office_data,
            "session": serialized_log,
        }
        if serialized_log:
            resp.update(serialized_log)
        return resp

    async def punch_in(
        self,
        user_id: str,
        latitude: float,
        longitude: float,
        office_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Real persistent punch in flow:
        1. Fetch assigned office coordinates & geofence.
        2. Block punch if outside radius.
        3. Create persistent record with server timestamp check_in_time.
        4. Auto-evaluate policy rules.
        """
        uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        now_utc = datetime.now(timezone.utc)
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        now_local = now_utc.astimezone(ist_tz)
        today = now_local.date()

        # 1. Fetch employee's assigned office
        office = None
        if office_id:
            try:
                o_uuid = uuid.UUID(office_id)
                office = await self.db.get(HrmsLocation, o_uuid)
            except Exception:
                pass

        if not office:
            stmt = (
                select(HrmsEmployeeLocation)
                .options(selectinload(HrmsEmployeeLocation.location))
                .where(
                    HrmsEmployeeLocation.user_id == uid,
                    HrmsEmployeeLocation.is_primary == True,
                )
            )
            res = await self.db.execute(stmt)
            assignment = res.scalar_one_or_none()
            if assignment and assignment.location and assignment.location.is_active:
                office = assignment.location

        if not office:
            stmt = select(HrmsLocation).where(
                HrmsLocation.is_active == True,
                HrmsLocation.deleted_at.is_(None),
            ).order_by(
                HrmsLocation.name.ilike("%Thane%").desc(),
                HrmsLocation.name.ilike("%BKC%").desc(),
                HrmsLocation.created_at.asc(),
            )
            res = await self.db.execute(stmt)
            office = res.scalars().first()

        if not office:
            office = HrmsLocation(
                name="Inhyma Thane Office",
                location_type=LocationType.OFFICE.value,
                address="Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
                latitude=19.198300,
                longitude=72.948300,
                radius_meters=150.0,
                is_active=True,
            )
            self.db.add(office)
            await self.db.commit()
            await self.db.refresh(office)

        # 2. Validate current GPS against assigned office geofence
        dist_meters = haversine_distance_meters(latitude, longitude, office.latitude, office.longitude)
        if dist_meters > office.radius_meters:
            dist_km = round(dist_meters / 1000.0, 1)
            dist_str = f"{dist_km:g} km" if dist_km >= 1.0 else f"{int(dist_meters)} m"
            raise BadRequestException(
                f"Punch Blocked: You are outside your assigned office ({dist_str} away)"
            )

        # 3. Check today's record
        stmt = (
            select(HrmsAttendanceLog)
            .options(selectinload(HrmsAttendanceLog.office))
            .where(
                HrmsAttendanceLog.user_id == uid,
                HrmsAttendanceLog.attendance_date == today,
            )
            .order_by(HrmsAttendanceLog.created_at.desc())
        )
        res = await self.db.execute(stmt)
        existing = res.scalars().first()

        if existing:
            if existing.status == "OPEN":
                return self._serialize_attendance_log(existing)
            elif existing.status == "CLOSED":
                raise BadRequestException("Attendance already completed for today.")

        # 4. Evaluate policy rules
        policy = await self.get_active_policy()
        final_status, rule_triggered = await self.evaluate_punch_in_status(uid, now_utc, policy)

        # 5. Create new attendance record
        is_late = (final_status in ["Late Punch", "Half Day"])
        is_half_day = (final_status == "Half Day")

        log = HrmsAttendanceLog(
            user_id=uid,
            attendance_date=today,
            check_in_time=now_utc,
            office_id=office.id,
            latitude=latitude,
            longitude=longitude,
            punch_type="CHECK_IN",
            status="OPEN",
            final_status=final_status,
            rule_triggered=rule_triggered,
            punch_in=now_local.strftime("%I:%M %p"),
            workplace=office.name,
            is_irregular=is_late,
            late_mark=is_late,
            half_day=is_half_day,
            regularization_status=None,
        )
        self.db.add(log)
        await self.db.commit()
        await self.db.refresh(log)
        await self.db.refresh(log, ["office"])

        return self._serialize_attendance_log(log)

    async def punch_out(
        self,
        user_id: str,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Real persistent punch out flow:
        1. Finds today's OPEN record.
        2. Sets check_out_time server timestamp.
        3. Computes total_work_minutes & final_status.
        4. Marks record CLOSED. Never creates a second record.
        """
        uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        now_utc = datetime.now(timezone.utc)
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        now_local = now_utc.astimezone(ist_tz)
        today = now_local.date()

        stmt = (
            select(HrmsAttendanceLog)
            .options(selectinload(HrmsAttendanceLog.office))
            .where(
                HrmsAttendanceLog.user_id == uid,
                HrmsAttendanceLog.attendance_date == today,
                HrmsAttendanceLog.status == "OPEN",
            )
        )
        res = await self.db.execute(stmt)
        log = res.scalar_one_or_none()

        if not log:
            raise BadRequestException("No active OPEN punch-in record found for today.")

        log.check_out_time = now_utc
        if log.check_in_time:
            total_seconds = max(0.0, (now_utc - log.check_in_time).total_seconds())
        else:
            total_seconds = 0.0

        total_work_minutes = int(total_seconds / 60.0)
        log.total_work_minutes = total_work_minutes
        hrs = total_work_minutes // 60
        mins = total_work_minutes % 60
        log.total_hours = f"{hrs}h {mins:02d}m"
        log.punch_out = now_local.strftime("%I:%M %p")
        log.punch_type = "CHECK_OUT"
        log.status = "CLOSED"

        if total_work_minutes < 240 and log.final_status != "Half Day":
            log.final_status = "Half Day"
            log.half_day = True
            log.is_irregular = True

        await self.db.commit()
        await self.db.refresh(log)
        await self.db.refresh(log, ["office"])

        return self._serialize_attendance_log(log)

    async def get_month_attendance(self, user_id: str, month: str) -> List[Dict[str, Any]]:
        """Query real database attendance records for requested month (YYYY-MM)."""
        uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        try:
            parts = month.split("-")
            yr, mo = int(parts[0]), int(parts[1])
        except Exception:
            today = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=5, minutes=30))).date()
            yr, mo = today.year, today.month

        stmt = (
            select(HrmsAttendanceLog)
            .options(selectinload(HrmsAttendanceLog.office))
            .where(
                HrmsAttendanceLog.user_id == uid,
                func.extract("year", HrmsAttendanceLog.attendance_date) == yr,
                func.extract("month", HrmsAttendanceLog.attendance_date) == mo,
            )
            .order_by(HrmsAttendanceLog.attendance_date.asc())
        )
        res = await self.db.execute(stmt)
        logs = res.scalars().all()
        return [self._serialize_attendance_log(l) for l in logs]

    async def list_attendance_logs(self, user_id: str, month: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return attendance logs for user, optionally filtered by month (YYYY-MM)."""
        uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        stmt = select(HrmsAttendanceLog).options(selectinload(HrmsAttendanceLog.office)).where(HrmsAttendanceLog.user_id == uid)
        if month:
            try:
                parts = month.split("-")
                yr, mo = int(parts[0]), int(parts[1])
                stmt = stmt.where(
                    func.extract("year", HrmsAttendanceLog.attendance_date) == yr,
                    func.extract("month", HrmsAttendanceLog.attendance_date) == mo,
                )
            except Exception:
                pass
        stmt = stmt.order_by(HrmsAttendanceLog.attendance_date.desc())
        res = await self.db.execute(stmt)
        logs = res.scalars().all()
        return [self._serialize_attendance_log(l) for l in logs]

    async def record_punch(self, user_id: str, punch_type: str, workplace: str) -> Dict[str, Any]:
        """Legacy helper for backward compatibility."""
        if punch_type.lower() == "out":
            return await self.punch_out(user_id)
        else:
            return await self.punch_in(user_id, latitude=19.198300, longitude=72.948300)

    # -----------------------------------------------------------------------
    # REGULARIZATION REQUESTS (DRAWER)
    # -----------------------------------------------------------------------

    async def create_regularization_request(
        self, user_id: str, payload: RegularizationRequestCreate
    ) -> Dict[str, Any]:
        """Employee submits an attendance regularization request."""
        uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        req = HrmsRegularizationRequest(
            user_id=uid,
            attendance_date=payload.attendance_date,
            check_in=payload.check_in,
            check_out=payload.check_out,
            total_hours=payload.total_hours,
            reason=payload.reason.strip(),
            status="PENDING",
        )
        self.db.add(req)
        await self.db.commit()
        await self.db.refresh(req)

        return {
            "id": str(req.id),
            "user_id": str(req.user_id),
            "attendance_date": req.attendance_date.isoformat(),
            "check_in": req.check_in,
            "check_out": req.check_out,
            "total_hours": req.total_hours,
            "reason": req.reason,
            "status": req.status,
            "submitted_at": req.submitted_at.isoformat(),
        }

    async def list_regularization_requests(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """List regularization requests, filtered by user if provided."""
        stmt = select(HrmsRegularizationRequest)
        if user_id:
            uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
            stmt = stmt.where(HrmsRegularizationRequest.user_id == uid)
        stmt = stmt.order_by(HrmsRegularizationRequest.submitted_at.desc())
        res = await self.db.execute(stmt)
        reqs = res.scalars().all()

        results = []
        for r in reqs:
            u_stmt = select(User).where(User.id == r.user_id)
            u_res = await self.db.execute(u_stmt)
            u = u_res.scalar_one_or_none()
            emp_name = u.display_name or (f"{u.first_name or ''} {u.last_name or ''}".strip()) if u else "Employee"

            results.append({
                "id": str(r.id),
                "user_id": str(r.user_id),
                "employee_name": emp_name or "Employee",
                "employee_code": u.employee_code if u else None,
                "attendance_date": r.attendance_date.isoformat(),
                "check_in": r.check_in,
                "check_out": r.check_out,
                "total_hours": r.total_hours,
                "reason": r.reason,
                "status": r.status,
                "manager_remarks": r.manager_remarks,
                "submitted_at": r.submitted_at.isoformat(),
                "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            })
        return results

    # -----------------------------------------------------------------------
    # UNIFIED APPROVAL MODULE
    # -----------------------------------------------------------------------

    async def list_unified_approvals(self, status_filter: Optional[str] = None) -> List[Dict[str, Any]]:
        """Unified inbox combining Regularization and WFH requests."""
        approvals: List[Dict[str, Any]] = []

        # 1. Regularization
        reg_stmt = select(HrmsRegularizationRequest)
        if status_filter:
            reg_stmt = reg_stmt.where(HrmsRegularizationRequest.status == status_filter.upper())
        reg_stmt = reg_stmt.order_by(HrmsRegularizationRequest.submitted_at.desc())
        reg_res = await self.db.execute(reg_stmt)
        for r in reg_res.scalars().all():
            u_stmt = select(User).where(User.id == r.user_id)
            u_res = await self.db.execute(u_stmt)
            u = u_res.scalar_one_or_none()
            emp_name = u.display_name or (f"{u.first_name or ''} {u.last_name or ''}".strip()) if u else "Employee"
            approvals.append({
                "id": str(r.id),
                "type": "Attendance Regularization",
                "employee": emp_name or "Employee",
                "employee_code": u.employee_code if u else None,
                "date": r.attendance_date.isoformat(),
                "reason": f"{r.reason} (Punch: {r.check_in} - {r.check_out})",
                "status": r.status,
                "manager_remarks": r.manager_remarks,
                "submitted_at": r.submitted_at.isoformat(),
            })

        # 2. WFH Requests
        wfh_stmt = select(HrmsWfhRequest)
        if status_filter:
            wfh_stmt = wfh_stmt.where(HrmsWfhRequest.status == status_filter.upper())
        wfh_stmt = wfh_stmt.order_by(HrmsWfhRequest.submitted_at.desc())
        wfh_res = await self.db.execute(wfh_stmt)
        for w in wfh_res.scalars().all():
            u_stmt = select(User).where(User.id == w.user_id)
            u_res = await self.db.execute(u_stmt)
            u = u_res.scalar_one_or_none()
            emp_name = u.display_name or (f"{u.first_name or ''} {u.last_name or ''}".strip()) if u else "Employee"
            approvals.append({
                "id": str(w.id),
                "type": "WFH Request",
                "employee": emp_name or "Employee",
                "employee_code": u.employee_code if u else None,
                "date": w.wfh_date.isoformat(),
                "reason": f"{w.reason} (Location: {w.address})",
                "status": w.status,
                "manager_remarks": w.manager_remarks,
                "submitted_at": w.submitted_at.isoformat(),
            })

        return approvals

    async def review_approval(
        self, request_type: str, request_id: str, manager_id: str, payload: ApprovalActionPayload
    ) -> Dict[str, Any]:
        """Manager approves or rejects a regularization or WFH request."""
        mgr_uuid = uuid.UUID(manager_id) if isinstance(manager_id, str) else manager_id
        req_uuid = uuid.UUID(request_id) if isinstance(request_id, str) else request_id
        new_status = payload.status.upper()

        if "regularization" in request_type.lower():
            stmt = select(HrmsRegularizationRequest).where(HrmsRegularizationRequest.id == req_uuid)
            res = await self.db.execute(stmt)
            r = res.scalar_one_or_none()
            if not r:
                raise NotFoundException("Regularization request not found")
            r.status = new_status
            r.manager_id = mgr_uuid
            r.manager_remarks = payload.manager_remarks
            r.reviewed_at = datetime.now(timezone.utc)
            await self.db.commit()
            return {"id": str(r.id), "status": r.status, "manager_remarks": r.manager_remarks}
        else:
            return await self.review_wfh_request(
                request_id=request_id,
                manager_id=manager_id,
                payload=WfhRequestReview(status=WfhRequestStatus[new_status], manager_remarks=payload.manager_remarks),
            )

    # -----------------------------------------------------------------------
    # ADJUSTED LEAVE WORKFLOW
    # -----------------------------------------------------------------------

    async def list_adjusted_leaves(self) -> List[Dict[str, Any]]:
        """List attendance irregularities tracked as adjustment records."""
        stmt = select(HrmsAdjustedLeave).order_by(HrmsAdjustedLeave.irregularity_date.desc())
        res = await self.db.execute(stmt)
        records = res.scalars().all()

        results = []
        for rec in records:
            u_stmt = select(User).where(User.id == rec.user_id)
            u_res = await self.db.execute(u_stmt)
            u = u_res.scalar_one_or_none()
            emp_name = u.display_name or (f"{u.first_name or ''} {u.last_name or ''}".strip()) if u else "Employee"
            results.append({
                "id": str(rec.id),
                "employee": emp_name or "Employee",
                "employee_code": u.employee_code if u else None,
                "date": rec.irregularity_date.isoformat(),
                "irregularity_type": rec.irregularity_type,
                "requested_action": rec.requested_action,
                "final_decision": rec.final_decision,
                "leave_deducted": rec.leave_deducted,
                "manager_remarks": rec.manager_remarks,
            })
        return results

    async def action_adjusted_leave(
        self, leave_id: str, manager_id: str, payload: AdjustedLeaveActionPayload
    ) -> Dict[str, Any]:
        """Approve, Reject, or Adjust Against Leave Balance."""
        mgr_uuid = uuid.UUID(manager_id) if isinstance(manager_id, str) else manager_id
        l_uuid = uuid.UUID(leave_id) if isinstance(leave_id, str) else leave_id

        stmt = select(HrmsAdjustedLeave).where(HrmsAdjustedLeave.id == l_uuid)
        res = await self.db.execute(stmt)
        rec = res.scalar_one_or_none()
        if not rec:
            raise NotFoundException("Adjusted leave record not found")

        rec.manager_id = mgr_uuid
        rec.manager_remarks = payload.manager_remarks

        if payload.action == "APPROVE":
            rec.final_decision = "Approved as-is (Waived)"
            rec.leave_deducted = None
        elif payload.action == "REJECT":
            rec.final_decision = "Rejected (Loss of Pay)"
            rec.leave_deducted = "1.0 Day LOP"
        elif payload.action == "ADJUST_LEAVE":
            rec.final_decision = f"Adjusted Against {payload.leave_type or 'Casual Leave'}"
            rec.leave_deducted = f"0.5 Day {payload.leave_type or 'Casual Leave'}"

        await self.db.commit()
        await self.db.refresh(rec)
        return {
            "id": str(rec.id),
            "final_decision": rec.final_decision,
            "leave_deducted": rec.leave_deducted,
            "manager_remarks": rec.manager_remarks,
        }

    # -----------------------------------------------------------------------
    # ATTENDANCE SETTINGS & EXEMPTIONS
    # -----------------------------------------------------------------------

    async def get_attendance_settings(self) -> Dict[str, Any]:
        """Fetch 3-tab attendance settings singleton."""
        stmt = select(HrmsAttendanceSettings).limit(1)
        res = await self.db.execute(stmt)
        settings = res.scalar_one_or_none()
        if not settings:
            settings = HrmsAttendanceSettings()
            self.db.add(settings)
            await self.db.commit()
            await self.db.refresh(settings)

        return {
            "shift_name": settings.shift_name,
            "shift_start": getattr(settings, "shift_start", "10:30 AM"),
            "shift_end": getattr(settings, "shift_end", "07:00 PM"),
            "grace_until": getattr(settings, "grace_until", "10:45 AM"),
            "late_starts_after": getattr(settings, "late_starts_after", "10:45 AM"),
            "direct_half_day_after": getattr(settings, "direct_half_day_after", "11:30 AM"),
            "late_marks_before_half_day": getattr(settings, "late_marks_before_half_day", 3),
            "payroll_cycle": getattr(settings, "payroll_cycle", "1st to 31st of Month"),
            "employment_type": settings.employment_type,
            "max_late_check_in": settings.max_late_check_in,
            "max_early_check_out": settings.max_early_check_out,
            "grace_period_mins": settings.grace_period_mins,
            "late_attendance_rule": settings.late_attendance_rule,
            "recurring_cycle": settings.recurring_cycle,
            "min_overtime_mins": settings.min_overtime_mins,
            "max_overtime_mins": settings.max_overtime_mins,
            "holiday_overtime": settings.holiday_overtime,
            "weekend_overtime": settings.weekend_overtime,
            "approval_required": settings.approval_required,
        }

    async def update_attendance_settings(self, payload: AttendanceSettingsUpdate) -> Dict[str, Any]:
        """Update 3-tab attendance settings."""
        stmt = select(HrmsAttendanceSettings).limit(1)
        res = await self.db.execute(stmt)
        settings = res.scalar_one_or_none()
        if not settings:
            settings = HrmsAttendanceSettings()
            self.db.add(settings)

        for k, v in payload.model_dump(exclude_unset=True).items():
            if v is not None:
                setattr(settings, k, v)

        await self.db.commit()
        await self.db.refresh(settings)
        return await self.get_attendance_settings()

    async def list_attendance_exemptions(self) -> List[Dict[str, Any]]:
        """List Tab 2 attendance exemptions."""
        stmt = select(HrmsAttendanceExemption).where(HrmsAttendanceExemption.status == "ACTIVE")
        res = await self.db.execute(stmt)
        exemptions = res.scalars().all()

        results = []
        for ex in exemptions:
            u_stmt = select(User).where(User.id == ex.user_id)
            u_res = await self.db.execute(u_stmt)
            u = u_res.scalar_one_or_none()
            emp_name = u.display_name or (f"{u.first_name or ''} {u.last_name or ''}".strip()) if u else "Employee"
            results.append({
                "id": str(ex.id),
                "employee": emp_name or "Employee",
                "employee_code": u.employee_code if u else None,
                "exemption_type": ex.exemption_type,
                "effective_from": ex.effective_from.isoformat(),
                "status": ex.status,
            })
        return results

    async def create_attendance_exemption(self, payload: AttendanceExemptionCreate) -> Dict[str, Any]:
        """Add Tab 2 attendance exemption."""
        uid = uuid.UUID(payload.user_id) if isinstance(payload.user_id, str) else payload.user_id
        ex = HrmsAttendanceExemption(
            user_id=uid,
            exemption_type=payload.exemption_type,
            effective_from=payload.effective_from,
            status="ACTIVE",
        )
        self.db.add(ex)
        await self.db.commit()
        await self.db.refresh(ex)
        return {"id": str(ex.id), "exemption_type": ex.exemption_type, "status": ex.status}

    # -----------------------------------------------------------------------
    # ATTENDANCE POLICIES (MULTI-POLICY ENGINE)
    # -----------------------------------------------------------------------

    def _serialize_policy(self, p: HrmsAttendancePolicy) -> Dict[str, Any]:
        """Serialize policy with primary and alias fields for maximum compatibility."""
        return {
            "id": str(p.id),
            "name": p.name,
            "policy_name": p.name,
            "shift_start": p.shift_start,
            "shift_end": p.shift_end,
            "grace_until": p.grace_until,
            "late_starts_after": p.late_starts_after,
            "late_after": p.late_starts_after,
            "direct_half_day_after": p.direct_half_day_after,
            "late_marks_before_half_day": p.late_marks_before_half_day,
            "late_threshold": p.late_marks_before_half_day,
            "payroll_cycle": p.payroll_cycle,
            "employment_type": p.employment_type,
            "is_active": p.is_active,
            "active": p.is_active,
            "is_archived": p.is_archived,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        }

    async def list_policies(self, include_archived: bool = False) -> List[Dict[str, Any]]:
        """List all attendance policies. Seeds default company policy if empty."""
        stmt = (
            select(HrmsAttendancePolicy)
            .where(HrmsAttendancePolicy.deleted_at.is_(None))
            .order_by(HrmsAttendancePolicy.is_active.desc(), HrmsAttendancePolicy.created_at.asc())
        )
        if not include_archived:
            stmt = stmt.where(HrmsAttendancePolicy.is_archived.is_(False))

        res = await self.db.execute(stmt)
        policies = res.scalars().all()

        if not policies:
            # Auto-seed default company policy
            default_p = HrmsAttendancePolicy(
                name="General Office Policy",
                shift_start="10:30 AM",
                shift_end="07:00 PM",
                grace_until="10:45 AM",
                late_starts_after="10:46 AM",
                direct_half_day_after="11:31 AM",
                late_marks_before_half_day=3,
                payroll_cycle="1st to 31st of Month",
                employment_type="Full Time Permanent",
                is_active=True,
                is_archived=False,
            )
            self.db.add(default_p)
            await self.db.commit()
            await self.db.refresh(default_p)
            policies = [default_p]

        return [self._serialize_policy(p) for p in policies]

    async def create_policy(self, payload: AttendancePolicyCreate) -> Dict[str, Any]:
        """Create a new reusable attendance policy."""
        name_val = (payload.policy_name or payload.name or "Company Attendance Policy").strip()
        late_after_val = payload.late_after or payload.late_starts_after or "10:46 AM"
        threshold_val = payload.late_threshold or payload.late_marks_before_half_day or 3
        active_val = payload.active if payload.active is not None else payload.is_active

        # If this policy is marked active, deactivate others
        if active_val:
            res = await self.db.execute(select(HrmsAttendancePolicy).where(HrmsAttendancePolicy.is_active.is_(True)))
            for existing in res.scalars().all():
                existing.is_active = False

        policy = HrmsAttendancePolicy(
            name=name_val,
            shift_start=payload.shift_start,
            shift_end=payload.shift_end,
            grace_until=payload.grace_until,
            late_starts_after=late_after_val,
            direct_half_day_after=payload.direct_half_day_after,
            late_marks_before_half_day=threshold_val,
            payroll_cycle=payload.payroll_cycle,
            employment_type=payload.employment_type,
            is_active=active_val,
            is_archived=False,
        )
        self.db.add(policy)
        await self.db.commit()
        await self.db.refresh(policy)

        if policy.is_active:
            await self._sync_settings_from_policy(policy)

        return self._serialize_policy(policy)

    async def update_policy(self, policy_id: str, payload: AttendancePolicyUpdate) -> Dict[str, Any]:
        """Update an existing attendance policy."""
        try:
            p_uuid = uuid.UUID(policy_id)
        except ValueError:
            raise BadRequestException("Invalid policy ID format")

        stmt = select(HrmsAttendancePolicy).where(
            HrmsAttendancePolicy.id == p_uuid, HrmsAttendancePolicy.deleted_at.is_(None)
        )
        res = await self.db.execute(stmt)
        policy = res.scalar_one_or_none()
        if not policy:
            raise NotFoundException("Attendance policy not found")

        dump = payload.model_dump(exclude_unset=True)
        if "policy_name" in dump and dump["policy_name"] is not None:
            policy.name = dump["policy_name"].strip()
        elif "name" in dump and dump["name"] is not None:
            policy.name = dump["name"].strip()

        if "late_after" in dump and dump["late_after"] is not None:
            policy.late_starts_after = dump["late_after"]
        elif "late_starts_after" in dump and dump["late_starts_after"] is not None:
            policy.late_starts_after = dump["late_starts_after"]

        if "late_threshold" in dump and dump["late_threshold"] is not None:
            policy.late_marks_before_half_day = dump["late_threshold"]
        elif "late_marks_before_half_day" in dump and dump["late_marks_before_half_day"] is not None:
            policy.late_marks_before_half_day = dump["late_marks_before_half_day"]

        active_flag = None
        if "active" in dump and dump["active"] is not None:
            active_flag = dump["active"]
        elif "is_active" in dump and dump["is_active"] is not None:
            active_flag = dump["is_active"]

        if active_flag is not None:
            policy.is_active = active_flag

        for field in ["shift_start", "shift_end", "grace_until", "direct_half_day_after", "payroll_cycle", "employment_type", "is_archived"]:
            if field in dump and dump[field] is not None:
                setattr(policy, field, dump[field])

        if policy.is_active:
            # Deactivate others
            all_res = await self.db.execute(
                select(HrmsAttendancePolicy).where(
                    HrmsAttendancePolicy.id != p_uuid,
                    HrmsAttendancePolicy.is_active.is_(True),
                )
            )
            for other in all_res.scalars().all():
                other.is_active = False

        await self.db.commit()
        await self.db.refresh(policy)

        if policy.is_active:
            await self._sync_settings_from_policy(policy)

        return self._serialize_policy(policy)

    async def activate_policy(self, policy_id: str) -> Dict[str, Any]:
        """Set a policy as the active company policy."""
        return await self.update_policy(policy_id, AttendancePolicyUpdate(is_active=True))

    async def duplicate_policy(self, policy_id: str) -> Dict[str, Any]:
        """Duplicate an existing policy as an inactive copy."""
        try:
            p_uuid = uuid.UUID(policy_id)
        except ValueError:
            raise BadRequestException("Invalid policy ID format")

        stmt = select(HrmsAttendancePolicy).where(
            HrmsAttendancePolicy.id == p_uuid, HrmsAttendancePolicy.deleted_at.is_(None)
        )
        res = await self.db.execute(stmt)
        orig = res.scalar_one_or_none()
        if not orig:
            raise NotFoundException("Attendance policy not found")

        copy_p = HrmsAttendancePolicy(
            name=f"{orig.name} (Copy)",
            shift_start=orig.shift_start,
            shift_end=orig.shift_end,
            grace_until=orig.grace_until,
            late_starts_after=orig.late_starts_after,
            direct_half_day_after=orig.direct_half_day_after,
            late_marks_before_half_day=orig.late_marks_before_half_day,
            payroll_cycle=orig.payroll_cycle,
            employment_type=orig.employment_type,
            is_active=False,
            is_archived=False,
        )
        self.db.add(copy_p)
        await self.db.commit()
        await self.db.refresh(copy_p)

        return {
            "id": str(copy_p.id),
            "name": copy_p.name,
            "shift_start": copy_p.shift_start,
            "shift_end": copy_p.shift_end,
            "grace_until": copy_p.grace_until,
            "late_starts_after": copy_p.late_starts_after,
            "direct_half_day_after": copy_p.direct_half_day_after,
            "late_marks_before_half_day": copy_p.late_marks_before_half_day,
            "payroll_cycle": copy_p.payroll_cycle,
            "employment_type": copy_p.employment_type,
            "is_active": copy_p.is_active,
            "is_archived": copy_p.is_archived,
        }

    async def archive_policy(self, policy_id: str) -> Dict[str, Any]:
        """Archive a policy so it is hidden from default view."""
        return await self.update_policy(policy_id, AttendancePolicyUpdate(is_archived=True, is_active=False))

    async def _sync_settings_from_policy(self, policy: HrmsAttendancePolicy) -> None:
        """Helper to sync active policy thresholds to HrmsAttendanceSettings singleton."""
        stmt = select(HrmsAttendanceSettings).limit(1)
        res = await self.db.execute(stmt)
        settings = res.scalar_one_or_none()
        if not settings:
            settings = HrmsAttendanceSettings()
            self.db.add(settings)

        settings.shift_name = policy.name
        settings.shift_start = policy.shift_start
        settings.shift_end = policy.shift_end
        settings.grace_until = policy.grace_until
        settings.late_starts_after = policy.late_starts_after
        settings.direct_half_day_after = policy.direct_half_day_after
        settings.late_marks_before_half_day = policy.late_marks_before_half_day
        settings.payroll_cycle = policy.payroll_cycle
        settings.employment_type = policy.employment_type
        await self.db.commit()


