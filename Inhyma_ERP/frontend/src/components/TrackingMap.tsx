import { useEffect, useRef, useState } from "react";
import {
  loadGoogleMapsSdk,
} from "@/lib/googleMaps";

export interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
  type?: "site" | "checkin" | "checkout" | "start" | "end" | "waypoint" | "simulator";
  accuracy?: number;
  time?: string;
  address?: string;
}

export interface TrackingMapProps {
  points?: MapPoint[];
  polyline?: Array<{ lat: number; lng: number }>;
  height?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  isSimulated?: boolean;
  interactive?: boolean;
  draggableMarker?: boolean;
  selectedCoord?: { lat: number; lng: number } | null;
  onLocationSelect?: (coord: { lat: number; lng: number; address?: string }) => void;
  title?: string;
}

// Helper to generate Google Maps pin SVG icons
function getPinSvg(color: string, label: string): google.maps.Icon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
    <path fill="${color}" stroke="#ffffff" stroke-width="2" d="M17 0C7.6 0 0 7.6 0 17c0 11.5 17 27 17 27s17-15.5 17-27C34 7.6 26.4 0 17 0z"/>
    <circle fill="#ffffff" cx="17" cy="16" r="10"/>
    <text x="17" y="20" fill="${color}" font-size="10" font-weight="800" text-anchor="middle" font-family="Arial,sans-serif">${label}</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: { width: 34, height: 44, equals: () => false },
    anchor: { x: 17, y: 44, equals: () => false },
  };
}

export function TrackingMap({
  points = [],
  polyline = [],
  height = "360px",
  center,
  zoom = 15,
  isSimulated = false,
  interactive = false,
  draggableMarker = false,
  selectedCoord,
  onLocationSelect,
  title,
}: TrackingMapProps) {
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const interactiveMarkerRef = useRef<google.maps.Marker | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const mapsSdkRef = useRef<typeof google.maps | null>(null);

  // Latest callback references to avoid tearing down map listeners
  const onLocationSelectRef = useRef(onLocationSelect);
  onLocationSelectRef.current = onLocationSelect;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  // Track map ready state so UI does not show false loading states
  const [isMapReady, setIsMapReady] = useState(false);
  const [isLoadingSdk, setIsLoadingSdk] = useState(
    () => !(typeof window !== "undefined" && (window as any).google?.maps)
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // 1. One-time Map Initialization
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;

    const initializeMap = async () => {
      if (!mapCanvasRef.current) return;

      try {
        const maps = await loadGoogleMapsSdk();
        if (!isMounted || !mapCanvasRef.current) return;

        mapsSdkRef.current = maps;

        // Determine default starting center
        const startCenter =
          center ||
          (selectedCoord
            ? selectedCoord
            : points.length > 0
            ? { lat: points[0].lat, lng: points[0].lng }
            : { lat: 18.5204, lng: 73.8567 });

        if (!mapInstanceRef.current) {
          const map = new maps.Map(mapCanvasRef.current, {
            center: startCenter,
            zoom,
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            gestureHandling: "cooperative",
          });

          mapInstanceRef.current = map;
          infoWindowRef.current = new maps.InfoWindow();

          // Single click listener using ref
          map.addListener("click", (e: any) => {
            if (!interactiveRef.current || !onLocationSelectRef.current) return;
            const latLng = e?.latLng;
            if (!latLng) return;
            const rawLat = (latLng as any)?.lat;
            const rawLng = (latLng as any)?.lng;
            const lat: number = typeof rawLat === "function" ? rawLat.call(latLng) : Number(rawLat);
            const lng: number = typeof rawLng === "function" ? rawLng.call(latLng) : Number(rawLng);
            onLocationSelectRef.current({ lat, lng });
          });
        }

        setIsMapReady(true);
      } catch (err: any) {
        console.warn("Failed to initialize Google Maps in TrackingMap:", err);
        if (isMounted) {
          setLoadError(err.message || "Failed to load Google Maps");
        }
      } finally {
        if (isMounted) {
          setIsLoadingSdk(false);
        }
      }
    };

    // Use requestAnimationFrame for instantaneous modal/tab render
    const frameId = requestAnimationFrame(() => {
      initializeMap();
    });

    return () => {
      isMounted = false;
      cancelAnimationFrame(frameId);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 2. Fast Center & Zoom Update (without rebuilding the map)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!isMapReady || !map || !center) return;
    map.panTo(center);
  }, [isMapReady, center?.lat, center?.lng]);

  // ---------------------------------------------------------------------------
  // 3. Fast Markers Update (clears & updates markers on the existing map)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapInstanceRef.current;
    const maps = mapsSdkRef.current;
    if (!isMapReady || !map || !maps) return;

    // Clear previous point markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const boundsCoords: Array<{ lat: number; lng: number }> = [];

    points.forEach((pt) => {
      boundsCoords.push({ lat: pt.lat, lng: pt.lng });

      let color = "#2563eb";
      let pinLabel = "•";
      let typeName = "Location";

      switch (pt.type) {
        case "site":
          color = "#7c3aed";
          pinLabel = "S";
          typeName = "Planned Site Location";
          break;
        case "checkin":
          color = "#16a34a";
          pinLabel = "IN";
          typeName = "📍 Check-in";
          break;
        case "checkout":
          color = "#dc2626";
          pinLabel = "OUT";
          typeName = "📍 Check-out";
          break;
        case "start":
          color = "#16a34a";
          pinLabel = "A";
          typeName = "Route Start";
          break;
        case "end":
          color = "#dc2626";
          pinLabel = "B";
          typeName = "Route End";
          break;
        case "simulator":
          color = "#d97706";
          pinLabel = "SIM";
          typeName = "Simulated Location";
          break;
        case "waypoint":
          color = "#f59e0b";
          pinLabel = "•";
          typeName = "GPS Waypoint";
          break;
      }

      const marker = new maps.Marker({
        position: { lat: pt.lat, lng: pt.lng },
        map,
        title: pt.label || typeName,
        icon: getPinSvg(color, pinLabel),
      });

      marker.addListener("click", () => {
        if (infoWindowRef.current && mapInstanceRef.current) {
          const timeHtml = pt.time
            ? `<div style="font-size:12px;color:#475569;margin-top:2px;">Time: <strong>${pt.time}</strong></div>`
            : "";
          const accHtml = pt.accuracy
            ? `<div style="font-size:12px;color:#475569;">Accuracy: <strong>±${Math.round(pt.accuracy)} m</strong></div>`
            : "";
          const addrHtml = pt.address
            ? `<div style="font-size:12px;color:#0f172a;margin-top:4px;">${pt.address}</div>`
            : "";

          const html = `
            <div style="font-family:sans-serif;padding:6px 8px;min-width:180px;">
              <div style="font-weight:700;color:${color};font-size:13px;">
                ${pt.label || typeName}
              </div>
              ${timeHtml}
              ${accHtml}
              ${addrHtml}
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">GPS: ${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}</div>
            </div>
          `;
          infoWindowRef.current.setContent(html);
          infoWindowRef.current.open(mapInstanceRef.current, marker);
        }
      });

      markersRef.current.push(marker);
    });

    // Auto-fit bounds if multiple points are displayed
    if (boundsCoords.length > 1) {
      const bounds = new maps.LatLngBounds();
      boundsCoords.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds);
    } else if (boundsCoords.length === 1 && !center && !selectedCoord) {
      map.panTo(boundsCoords[0]);
    }
  }, [isMapReady, points]);

  // ---------------------------------------------------------------------------
  // 4. Fast Polyline Update (updates existing polyline path)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapInstanceRef.current;
    const maps = mapsSdkRef.current;
    if (!isMapReady || !map || !maps) return;

    if (polyline.length === 0) {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
      return;
    }

    if (polylineRef.current) {
      polylineRef.current.setPath(polyline);
    } else {
      const poly = new maps.Polyline({
        path: polyline,
        geodesic: true,
        strokeColor: isSimulated ? "#d97706" : "#2563eb",
        strokeOpacity: 0.85,
        strokeWeight: 4,
        map,
      });
      polylineRef.current = poly;
    }
  }, [isMapReady, polyline, isSimulated]);

  // ---------------------------------------------------------------------------
  // 5. Fast Interactive Selected Marker Update
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapInstanceRef.current;
    const maps = mapsSdkRef.current;
    if (!isMapReady || !map || !maps) return;

    if (selectedCoord) {
      if (!interactiveMarkerRef.current) {
        const marker = new maps.Marker({
          position: selectedCoord,
          map,
          draggable: Boolean(draggableMarker),
          title: "Selected Location (Drag to refine)",
          icon: getPinSvg("#0284c7", "📍"),
        });

        if (draggableMarker) {
          marker.addListener("dragend", () => {
            const pos = marker.getPosition();
            if (pos && onLocationSelectRef.current) {
              const rawLat = (pos as any)?.lat;
              const rawLng = (pos as any)?.lng;
              const lat: number = typeof rawLat === "function" ? rawLat.call(pos) : Number(rawLat);
              const lng: number = typeof rawLng === "function" ? rawLng.call(pos) : Number(rawLng);
              onLocationSelectRef.current({ lat, lng });
            }
          });
        }

        interactiveMarkerRef.current = marker;
      } else {
        interactiveMarkerRef.current.setPosition(selectedCoord);
        interactiveMarkerRef.current.setMap(map);
      }
    } else if (interactiveMarkerRef.current) {
      interactiveMarkerRef.current.setMap(null);
      interactiveMarkerRef.current = null;
    }
  }, [isMapReady, selectedCoord?.lat, selectedCoord?.lng, draggableMarker]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid #cbd5e1",
        background: "#f1f5f9",
      }}
    >
      {title && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            zIndex: 5,
            background: "rgba(255,255,255,0.94)",
            padding: "4px 10px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#1e293b",
            boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>🗺️</span>
          <span>{title}</span>
          {isSimulated && (
            <span
              style={{
                background: "#fef3c7",
                color: "#b45309",
                padding: "1px 6px",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              SIMULATED / TEST
            </span>
          )}
        </div>
      )}

      {isLoadingSdk && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#f8fafc",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            color: "#64748b",
            gap: "8px",
          }}
        >
          <div
            style={{
              width: "24px",
              height: "24px",
              border: "3px solid #cbd5e1",
              borderTopColor: "#2563eb",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <div style={{ fontSize: "13px", fontWeight: 500 }}>Loading Google Maps...</div>
        </div>
      )}

      {loadError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#fff1f2",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            color: "#991b1b",
            padding: "20px",
            textAlign: "center",
            gap: "6px",
          }}
        >
          <div style={{ fontSize: "20px" }}>⚠️</div>
          <div style={{ fontSize: "13px", fontWeight: 600 }}>Google Maps Unavailable</div>
          <div style={{ fontSize: "12px", color: "#64748b" }}>{loadError}</div>
        </div>
      )}

      <div
        ref={mapCanvasRef}
        data-testid="google-tracking-map"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
