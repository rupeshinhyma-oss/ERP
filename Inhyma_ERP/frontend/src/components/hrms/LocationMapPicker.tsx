/**
 * LocationMapPicker Component
 *
 * Official Google Maps Platform interactive map:
 * - Powered by Google Maps JavaScript API (zoom 17–18 building level)
 * - Draggable marker with real-time centered blue geofence circle
 * - Changing the radius immediately updates the circle
 * - Reverse Geocoding API automatically resolves address components on drag end
 */

import { useEffect, useRef, useState } from "react";
import {
  loadGoogleMapsSdk,
  reverseGeocodeGoogle,
  parseGoogleAddressComponents,
  subscribeGoogleMapsError,
} from "@/lib/googleMaps";

export interface LocationVerificationData {
  place_id?: string;
  building?: string;
  unit_floor?: string;
  street?: string;
  locality?: string;
  city?: string;
  state?: string;
  pin_code?: string;
  country?: string;
  display_name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface LocationMapPickerProps {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  onChange?: (coords: {
    latitude: number;
    longitude: number;
    address?: string;
    verification?: LocationVerificationData;
  }) => void;
  readOnly?: boolean;
  height?: string;
  zoom?: number;
}

export function LocationMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onChange,
  readOnly = false,
  height = "320px",
  zoom = 18,
}: LocationMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);

  const [isResolving, setIsResolving] = useState(false);
  const [activeCoords, setActiveCoords] = useState({ lat: latitude, lng: longitude });
  const [loadError, setLoadError] = useState<string | null>(null);

  // Sync coords from prop
  useEffect(() => {
    setActiveCoords({ lat: latitude, lng: longitude });
  }, [latitude, longitude]);

  // Subscribe to global Google Maps errors (auth failure, billing, network)
  useEffect(() => {
    const unsub = subscribeGoogleMapsError((err) => {
      setLoadError(err.message);
    });
    return unsub;
  }, []);

  // Initialize Google Maps JavaScript API Map, Marker, Circle
  useEffect(() => {
    if (!containerRef.current) return;

    let isMounted = true;

    async function initMap() {
      try {
        const maps = await loadGoogleMapsSdk();
        if (!isMounted || !containerRef.current) return;

        const centerPos = { lat: latitude, lng: longitude };

        // 1. Google Maps Map instance
        const map = new maps.Map(containerRef.current, {
          center: centerPos,
          zoom,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          gestureHandling: readOnly ? "none" : "auto",
        });

        // 2. Draggable Marker
        const marker = new maps.Marker({
          position: centerPos,
          map,
          draggable: !readOnly,
          title: "Geofence Center Pin (Drag to adjust)",
        });

        // 3. Blue Geofence Circle
        const circle = new maps.Circle({
          map,
          center: centerPos,
          radius: radiusMeters,
          fillColor: "#2563eb",
          fillOpacity: 0.20,
          strokeColor: "#2563eb",
          strokeOpacity: 0.85,
          strokeWeight: 2,
        });

        // Marker drag listener: real-time dynamic centering of the geofence circle
        marker.addListener("drag", () => {
          const pos = marker.getPosition();
          if (pos) {
            circle.setCenter(pos);
            const lat = Number(pos.lat().toFixed(6));
            const lng = Number(pos.lng().toFixed(6));
            setActiveCoords({ lat, lng });
          }
        });

        // Marker dragend listener: reverse geocode and update verification card
        marker.addListener("dragend", async () => {
          const pos = marker.getPosition();
          if (!pos) return;

          circle.setCenter(pos);
          map.panTo(pos);

          const newLat = Number(pos.lat().toFixed(6));
          const newLng = Number(pos.lng().toFixed(6));
          setActiveCoords({ lat: newLat, lng: newLng });

          setIsResolving(true);
          try {
            const geocodeResult = await reverseGeocodeGoogle(newLat, newLng);
            const parsed = parseGoogleAddressComponents(geocodeResult);
            onChange?.({
              latitude: newLat,
              longitude: newLng,
              address: parsed.formatted_address,
              verification: {
                place_id: parsed.place_id,
                building: parsed.building,
                unit_floor: parsed.unit_floor,
                street: parsed.street,
                locality: parsed.locality,
                city: parsed.city,
                state: parsed.state,
                pin_code: parsed.pin_code,
                country: parsed.country,
                display_name: parsed.formatted_address,
                address: parsed.formatted_address,
                latitude: newLat,
                longitude: newLng,
              },
            });
          } catch {
            onChange?.({ latitude: newLat, longitude: newLng });
          } finally {
            setIsResolving(false);
          }
        });

        // Map click listener: move marker & circle to clicked position
        if (!readOnly) {
          map.addListener("click", async (e: google.maps.MapMouseEvent) => {
            const pos = e.latLng;
            if (!pos) return;

            marker.setPosition(pos);
            circle.setCenter(pos);

            const newLat = Number(pos.lat().toFixed(6));
            const newLng = Number(pos.lng().toFixed(6));
            setActiveCoords({ lat: newLat, lng: newLng });

            setIsResolving(true);
            try {
              const geocodeResult = await reverseGeocodeGoogle(newLat, newLng);
              const parsed = parseGoogleAddressComponents(geocodeResult);
              onChange?.({
                latitude: newLat,
                longitude: newLng,
                address: parsed.formatted_address,
                verification: {
                  place_id: parsed.place_id,
                  building: parsed.building,
                  unit_floor: parsed.unit_floor,
                  street: parsed.street,
                  locality: parsed.locality,
                  city: parsed.city,
                  state: parsed.state,
                  pin_code: parsed.pin_code,
                  country: parsed.country,
                  display_name: parsed.formatted_address,
                  address: parsed.formatted_address,
                  latitude: newLat,
                  longitude: newLng,
                },
              });
            } catch {
              onChange?.({ latitude: newLat, longitude: newLng });
            } finally {
              setIsResolving(false);
            }
          });
        }

        mapInstanceRef.current = map;
        markerRef.current = marker;
        circleRef.current = circle;
      } catch (err: any) {
        console.warn("Google Maps init warning:", err);
        if (isMounted) {
          setLoadError(err?.message || "Google Maps API loading failed");
        }
      }
    }

    initMap();

    return () => {
      isMounted = false;
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      mapInstanceRef.current = null;
    };
  }, []);

  // Update center, marker, circle radius when props change
  useEffect(() => {
    if (mapInstanceRef.current && markerRef.current && circleRef.current) {
      const pos = { lat: latitude, lng: longitude };
      markerRef.current.setPosition(pos);
      circleRef.current.setCenter(pos);
      // Changing the radius immediately updates the circle
      circleRef.current.setRadius(radiusMeters);
      mapInstanceRef.current.setCenter(pos);
      if (zoom) {
        mapInstanceRef.current.setZoom(zoom);
      }
    }
  }, [latitude, longitude, radiusMeters, zoom]);

  // Micro-adjustment step nudge handlers
  const handleNudge = async (dLat: number, dLng: number) => {
    if (readOnly) return;
    const newLat = Number((activeCoords.lat + dLat).toFixed(6));
    const newLng = Number((activeCoords.lng + dLng).toFixed(6));
    setActiveCoords({ lat: newLat, lng: newLng });

    const newPos = { lat: newLat, lng: newLng };
    if (markerRef.current && circleRef.current && mapInstanceRef.current) {
      markerRef.current.setPosition(newPos);
      circleRef.current.setCenter(newPos);
      mapInstanceRef.current.panTo(newPos);
    }

    setIsResolving(true);
    try {
      const geocodeResult = await reverseGeocodeGoogle(newLat, newLng);
      const parsed = parseGoogleAddressComponents(geocodeResult);
      onChange?.({
        latitude: newLat,
        longitude: newLng,
        address: parsed.formatted_address,
        verification: {
          place_id: parsed.place_id,
          building: parsed.building,
          unit_floor: parsed.unit_floor,
          street: parsed.street,
          locality: parsed.locality,
          city: parsed.city,
          state: parsed.state,
          pin_code: parsed.pin_code,
          country: parsed.country,
          display_name: parsed.formatted_address,
          address: parsed.formatted_address,
          latitude: newLat,
          longitude: newLng,
        },
      });
    } catch {
      onChange?.({ latitude: newLat, longitude: newLng });
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
      {/* Google Maps display box */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height,
          borderRadius: "var(--radius-sm, 6px)",
          border: "1px solid var(--color-border)",
          overflow: "hidden",
          background: "#e5e7eb",
        }}
      >
        <div
          ref={containerRef}
          data-testid="google-map-container"
          style={{ width: "100%", height: "100%", zIndex: 1 }}
        >
          {loadError && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--color-danger, #ef4444)",
                fontSize: "13px",
                padding: "24px",
                textAlign: "center",
                background: "var(--color-danger-soft, #fef2f2)",
              }}
            >
              <strong style={{ marginBottom: "6px" }}>Google Maps Notice</strong>
              <span>{loadError}</span>
            </div>
          )}
        </div>

        {/* Loading overlay during reverse geocode */}
        {isResolving && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              background: "rgba(15, 23, 42, 0.85)",
              color: "#ffffff",
              padding: "4px 10px",
              borderRadius: "4px",
              fontSize: "11px",
              fontWeight: 600,
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>Updating reverse verification...</span>
          </div>
        )}

        {/* Geofence radius badge overlay */}
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            background: "rgba(255, 255, 255, 0.95)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
            padding: "4px 10px",
            borderRadius: "4px",
            fontSize: "12px",
            fontWeight: 600,
            zIndex: 1000,
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#2563eb",
            }}
          />
          <span>Blue Geofence Circle: {radiusMeters}m</span>
        </div>
      </div>

      {/* Coordinate telemetry & fine-tuning nudge controls */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px",
          padding: "8px 12px",
          background: "var(--color-surface-subtle, rgba(0,0,0,0.02))",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm, 6px)",
          fontSize: "12px",
        }}
      >
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <span style={{ color: "var(--color-muted)" }}>Latitude: </span>
            <strong style={{ color: "var(--color-text)", fontFamily: "monospace" }}>
              {activeCoords.lat.toFixed(6)}
            </strong>
          </div>
          <div>
            <span style={{ color: "var(--color-muted)" }}>Longitude: </span>
            <strong style={{ color: "var(--color-text)", fontFamily: "monospace" }}>
              {activeCoords.lng.toFixed(6)}
            </strong>
          </div>
        </div>

        {!readOnly && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "var(--color-muted)", fontSize: "11px" }}>Fine-tune pin:</span>
            <div style={{ display: "inline-flex", gap: "3px" }}>
              <button
                type="button"
                className="btn btn-sm"
                title="Nudge North"
                onClick={() => handleNudge(0.0001, 0)}
                style={{ padding: "2px 8px", fontSize: "11px", minHeight: "24px" }}
              >
                ↑ N
              </button>
              <button
                type="button"
                className="btn btn-sm"
                title="Nudge South"
                onClick={() => handleNudge(-0.0001, 0)}
                style={{ padding: "2px 8px", fontSize: "11px", minHeight: "24px" }}
              >
                ↓ S
              </button>
              <button
                type="button"
                className="btn btn-sm"
                title="Nudge West"
                onClick={() => handleNudge(0, -0.0001)}
                style={{ padding: "2px 8px", fontSize: "11px", minHeight: "24px" }}
              >
                ← W
              </button>
              <button
                type="button"
                className="btn btn-sm"
                title="Nudge East"
                onClick={() => handleNudge(0, 0.0001)}
                style={{ padding: "2px 8px", fontSize: "11px", minHeight: "24px" }}
              >
                → E
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
