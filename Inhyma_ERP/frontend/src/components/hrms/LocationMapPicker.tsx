/**
 * LocationMapPicker Component
 *
 * Official Google Maps Platform interactive map:
 * - Powered by Google Maps JavaScript API (zoom 17–18 building level)
 * - Draggable marker with real-time centered blue geofence circle
 * - Changing the radius immediately updates the circle
 * - Reverse Geocoding API automatically resolves address components on drag end
 * - Fullscreen, Satellite, Recenter, Click-to-Place, and Multi-Step fine-tuning
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
  height = "480px",
  zoom = 18,
}: LocationMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);

  const [isResolving, setIsResolving] = useState(false);
  const [activeCoords, setActiveCoords] = useState({ lat: latitude, lng: longitude });
  const [isExpanded, setIsExpanded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stepMeters, setStepMeters] = useState<number>(5);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const currentHeight = isExpanded
    ? (isMobile ? "360px" : "620px")
    : (isMobile ? "240px" : (height === "480px" ? "380px" : (height || "380px")));

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

  // Refresh Google Maps layout when expanded/collapsed
  useEffect(() => {
    if (mapInstanceRef.current && markerRef.current) {
      const maps = (window as any).google?.maps;
      if (maps?.event?.trigger) {
        setTimeout(() => {
          maps.event.trigger(mapInstanceRef.current, "resize");
          const pos = markerRef.current?.getPosition();
          if (pos) {
            mapInstanceRef.current?.panTo(pos);
          }
        }, 50);
      }
    }
  }, [isExpanded]);

  // Helper to reverse geocode and trigger onChange
  const updateCoordinatesAndReverseGeocode = async (newLat: number, newLng: number) => {
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
  };

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
          mapTypeControl: true,
          mapTypeControlOptions: {
            style: (maps.MapTypeControlStyle ? maps.MapTypeControlStyle.HORIZONTAL_BAR : 1) as any,
            position: (maps.ControlPosition ? maps.ControlPosition.TOP_LEFT : 1) as any,
          },
          streetViewControl: false,
          fullscreenControl: true,
          fullscreenControlOptions: {
            position: (maps.ControlPosition ? maps.ControlPosition.RIGHT_TOP : 7) as any,
          },
          zoomControl: true,
          gestureHandling: readOnly ? "none" : "greedy",
          scrollwheel: true,
        });

        // 2. Draggable Marker
        // optimized: false forces Google Maps to render marker as an individual DOM element
        // with instant pointer events and smooth 60fps dragging
        const marker = new maps.Marker({
          position: centerPos,
          map,
          draggable: !readOnly,
          cursor: !readOnly ? "grab" : "default",
          zIndex: 999999,
          optimized: false,
          title: "Geofence Center Pin (Click or drag anywhere to reposition)",
        });

        // 3. Blue Geofence Circle
        // clickable: false prevents the circle from capturing mouse events and blocking clicks/drags in its radius
        const circle = new maps.Circle({
          map,
          center: centerPos,
          radius: radiusMeters,
          fillColor: "#2563eb",
          fillOpacity: 0.20,
          strokeColor: "#2563eb",
          strokeOpacity: 0.85,
          strokeWeight: 2,
          clickable: false,
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
          await updateCoordinatesAndReverseGeocode(newLat, newLng);
        });

        // Map click listener: move marker & circle to clicked position
        if (!readOnly) {
          map.addListener("click", async (e: google.maps.MapMouseEvent) => {
            const pos = e.latLng;
            if (!pos) return;

            marker.setPosition(pos);
            circle.setCenter(pos);
            map.panTo(pos);

            const newLat = Number(pos.lat().toFixed(6));
            const newLng = Number(pos.lng().toFixed(6));
            await updateCoordinatesAndReverseGeocode(newLat, newLng);
          });

          // Also allow clicking directly on circle in case clickable setting behaves differently
          if (typeof (circle as any).addListener === "function") {
            circle.addListener("click", async (e: any) => {
              const pos = e.latLng;
              if (!pos) return;
              marker.setPosition(pos);
              circle.setCenter(pos);
              map.panTo(pos);
              const newLat = Number(pos.lat().toFixed(6));
              const newLng = Number(pos.lng().toFixed(6));
              await updateCoordinatesAndReverseGeocode(newLat, newLng);
            });
          }
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

  // Recenter map view to current pin
  const handleRecenter = () => {
    if (mapInstanceRef.current && markerRef.current) {
      const pos = markerRef.current.getPosition();
      if (pos) {
        mapInstanceRef.current.panTo(pos);
        mapInstanceRef.current.setZoom(zoom || 18);
      }
    }
  };

  // Micro-adjustment step nudge handlers
  const handleNudge = async (
    dLatOrDirection: number | "N" | "S" | "E" | "W",
    dLngArg: number = 0
  ) => {
    if (readOnly) return;

    let dLat = 0;
    let dLng = 0;

    if (typeof dLatOrDirection === "string") {
      const latFactor = 0.000009 * stepMeters;
      const cosLat = Math.cos((activeCoords.lat * Math.PI) / 180) || 1;
      const lngFactor = (0.000009 * stepMeters) / cosLat;

      if (dLatOrDirection === "N") dLat = latFactor;
      if (dLatOrDirection === "S") dLat = -latFactor;
      if (dLatOrDirection === "E") dLng = lngFactor;
      if (dLatOrDirection === "W") dLng = -lngFactor;
    } else {
      dLat = dLatOrDirection;
      dLng = dLngArg;
    }

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

  // Keyboard navigation for precision nudge
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "ArrowUp") handleNudge("N");
      if (e.key === "ArrowDown") handleNudge("S");
      if (e.key === "ArrowLeft") handleNudge("W");
      if (e.key === "ArrowRight") handleNudge("E");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
      {/* Top Helper & Map Action Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
          padding: "8px 12px",
          background: "var(--color-primary-soft, #eff6ff)",
          border: "1px solid var(--color-primary, #3b82f6)",
          borderRadius: "var(--radius-sm, 6px)",
          fontSize: "12px",
          color: "var(--color-primary, #1d4ed8)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "14px" }}>📍</span>
          <span>
            <strong>Drag the red pin</strong> or <strong>click anywhere on the map</strong> to set the geofence center.
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {!readOnly && (
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={handleRecenter}
              title="Center view back to the pin"
              style={{
                padding: "3px 10px",
                fontSize: "11.5px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                background: "var(--color-surface, #ffffff)",
              }}
            >
              <span>🎯</span>
              <span>Recenter Pin</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse to standard size" : "Expand map size"}
            style={{
              padding: "3px 10px",
              fontSize: "11.5px",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              background: "var(--color-surface, #ffffff)",
            }}
          >
            <span>⛶</span>
            <span>{isExpanded ? "Standard Map (480px)" : "Enlarge Map (620px)"}</span>
          </button>
        </div>
      </div>

      {/* Google Maps display box */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: currentHeight,
          borderRadius: "var(--radius-sm, 6px)",
          border: "1px solid var(--color-border)",
          overflow: "hidden",
          background: "#e5e7eb",
          transition: "height 0.2s ease-in-out",
        }}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        title="Map Area (Click anywhere to place pin, or use Arrow keys to nudge)"
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
          padding: "10px 14px",
          background: "var(--color-surface-subtle, rgba(0,0,0,0.02))",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm, 6px)",
          fontSize: "12px",
        }}
      >
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <span style={{ color: "var(--color-muted)", fontSize: "11px", fontWeight: 600 }}>LATITUDE: </span>
            <strong style={{ color: "var(--color-text)", fontFamily: "monospace", fontSize: "13px" }}>
              {activeCoords.lat.toFixed(6)}
            </strong>
          </div>
          <div>
            <span style={{ color: "var(--color-muted)", fontSize: "11px", fontWeight: 600 }}>LONGITUDE: </span>
            <strong style={{ color: "var(--color-text)", fontFamily: "monospace", fontSize: "13px" }}>
              {activeCoords.lng.toFixed(6)}
            </strong>
          </div>
        </div>

        {!readOnly && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            {/* Step size selector */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ color: "var(--color-muted)", fontSize: "11px", fontWeight: 600 }}>Fine-tune:</span>
              <div
                style={{
                  display: "inline-flex",
                  borderRadius: "4px",
                  overflow: "hidden",
                  border: "1px solid var(--color-border)",
                }}
              >
                {[1, 5, 20].map((stepVal) => (
                  <button
                    key={stepVal}
                    type="button"
                    onClick={() => setStepMeters(stepVal)}
                    style={{
                      padding: "2px 8px",
                      fontSize: "11px",
                      fontWeight: 600,
                      border: "none",
                      background:
                        stepMeters === stepVal ? "var(--color-primary, #2563eb)" : "var(--color-surface, #ffffff)",
                      color: stepMeters === stepVal ? "#ffffff" : "var(--color-text)",
                      cursor: "pointer",
                    }}
                  >
                    {stepVal}m
                  </button>
                ))}
              </div>
            </div>

            {/* D-Pad Buttons */}
            <div style={{ display: "inline-flex", gap: "3px" }}>
              <button
                type="button"
                className="btn btn-sm"
                title="Nudge North"
                onClick={() => handleNudge("N")}
                style={{ padding: "2px 8px", fontSize: "11px", minHeight: "26px", fontWeight: 600 }}
              >
                ↑ N
              </button>
              <button
                type="button"
                className="btn btn-sm"
                title="Nudge South"
                onClick={() => handleNudge("S")}
                style={{ padding: "2px 8px", fontSize: "11px", minHeight: "26px", fontWeight: 600 }}
              >
                ↓ S
              </button>
              <button
                type="button"
                className="btn btn-sm"
                title="Nudge West"
                onClick={() => handleNudge("W")}
                style={{ padding: "2px 8px", fontSize: "11px", minHeight: "26px", fontWeight: 600 }}
              >
                ← W
              </button>
              <button
                type="button"
                className="btn btn-sm"
                title="Nudge East"
                onClick={() => handleNudge("E")}
                style={{ padding: "2px 8px", fontSize: "11px", minHeight: "26px", fontWeight: 600 }}
              >
                → E
              </button>
            </div>
            <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>
              (or Arrow keys)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
