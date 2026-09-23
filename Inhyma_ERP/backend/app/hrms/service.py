"""
HRMS Business Logic Service.

Encapsulates database operations and geocoding services for HRMS Locations,
Employee Location Assignments, and WFH Requests.
"""

from __future__ import annotations

import asyncio
import json
import logging
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import BadRequestException, NotFoundException
from app.hrms.models import (
    HrmsEmployeeLocation,
    HrmsLocation,
    HrmsWfhRequest,
    LocationType,
    WfhRequestStatus,
)
from app.hrms.schemas import (
    EmployeeLocationAssignmentPayload,
    LocationCreate,
    LocationUpdate,
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
        for loc, count in rows:
            output.append({
                "id": str(loc.id),
                "name": loc.name,
                "location_type": loc.location_type,
                "address": loc.address,
                "latitude": loc.latitude,
                "longitude": loc.longitude,
                "radius_meters": loc.radius_meters,
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
