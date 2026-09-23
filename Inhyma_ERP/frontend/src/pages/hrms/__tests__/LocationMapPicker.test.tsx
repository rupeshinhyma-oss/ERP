import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { LocationMapPicker } from "@/components/hrms/LocationMapPicker";
import * as googleMaps from "@/lib/googleMaps";

describe("LocationMapPicker Component (Google Maps Platform)", () => {
  let mockMapInstance: any;
  let mockMarkerInstance: any;
  let mockCircleInstance: any;
  let markerListeners: Record<string, Function> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    markerListeners = {};

    mockMapInstance = {
      setCenter: vi.fn(),
      setZoom: vi.fn(),
      panTo: vi.fn(),
      addListener: vi.fn(),
    };

    mockMarkerInstance = {
      setPosition: vi.fn(),
      getPosition: vi.fn().mockReturnValue({
        lat: () => 19.198251,
        lng: () => 72.948232,
      }),
      setMap: vi.fn(),
      addListener: vi.fn((event: string, callback: Function) => {
        markerListeners[event] = callback;
      }),
    };

    mockCircleInstance = {
      setCenter: vi.fn(),
      setRadius: vi.fn(),
      setMap: vi.fn(),
    };

    // Mock Google Maps SDK classes
    const MockMap = vi.fn().mockImplementation(() => mockMapInstance);
    const MockMarker = vi.fn().mockImplementation(() => mockMarkerInstance);
    const MockCircle = vi.fn().mockImplementation(() => mockCircleInstance);

    vi.spyOn(googleMaps, "loadGoogleMapsSdk").mockResolvedValue({
      Map: MockMap,
      Marker: MockMarker,
      Circle: MockCircle,
    } as any);

    vi.spyOn(googleMaps, "reverseGeocodeGoogle").mockResolvedValue({
      place_id: "ChIJ_lodha_supremus",
      formatted_address: "Lodha Supremus, Road No. 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
      address_components: [
        { long_name: "Lodha Supremus", short_name: "Lodha Supremus", types: ["premise"] },
        { long_name: "Road No. 22", short_name: "Road No. 22", types: ["route"] },
        { long_name: "Wagle Industrial Estate", short_name: "Wagle Estate", types: ["sublocality_level_1"] },
        { long_name: "Thane", short_name: "Thane", types: ["locality"] },
        { long_name: "Maharashtra", short_name: "MH", types: ["administrative_area_level_1"] },
        { long_name: "400604", short_name: "400604", types: ["postal_code"] },
        { long_name: "India", short_name: "IN", types: ["country"] },
      ],
      geometry: {
        location: {
          lat: () => 19.198251,
          lng: () => 72.948232,
        },
      },
    } as any);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("initializes Google Maps at building-level zoom (18) with draggable marker and blue circle", async () => {
    render(
      <LocationMapPicker
        latitude={19.198251}
        longitude={72.948232}
        radiusMeters={150}
        zoom={18}
      />
    );

    await waitFor(() => {
      expect(googleMaps.loadGoogleMapsSdk).toHaveBeenCalled();
    });

    // Check DOM container exists
    expect(screen.getByTestId("google-map-container")).toBeTruthy();

    // Blue Geofence Circle overlay shows 150m
    expect(screen.getByText(/Blue Geofence Circle: 150m/i)).toBeTruthy();
  });

  it("immediately updates circle radius when radius prop changes", async () => {
    const { rerender } = render(
      <LocationMapPicker
        latitude={19.198251}
        longitude={72.948232}
        radiusMeters={150}
        zoom={18}
      />
    );

    await waitFor(() => {
      expect(googleMaps.loadGoogleMapsSdk).toHaveBeenCalled();
    });

    // Change radius prop to 250m
    rerender(
      <LocationMapPicker
        latitude={19.198251}
        longitude={72.948232}
        radiusMeters={250}
        zoom={18}
      />
    );

    // setRadius should immediately be called on circle instance with 250
    expect(mockCircleInstance.setRadius).toHaveBeenCalledWith(250);
    expect(screen.getByText(/Blue Geofence Circle: 250m/i)).toBeTruthy();
  });

  it("handles marker dragend by reverse-geocoding coordinates and calling onChange with verification data", async () => {
    const handleChange = vi.fn();

    render(
      <LocationMapPicker
        latitude={19.198251}
        longitude={72.948232}
        radiusMeters={150}
        zoom={18}
        onChange={handleChange}
      />
    );

    await waitFor(() => {
      expect(googleMaps.loadGoogleMapsSdk).toHaveBeenCalled();
    });

    // Verify dragend listener registered
    expect(markerListeners["dragend"]).toBeDefined();

    // Trigger dragend listener
    await markerListeners["dragend"]();

    await waitFor(() => {
      expect(googleMaps.reverseGeocodeGoogle).toHaveBeenCalledWith(19.198251, 72.948232);
      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          latitude: 19.198251,
          longitude: 72.948232,
          verification: expect.objectContaining({
            building: "Lodha Supremus",
            city: "Thane",
            pin_code: "400604",
          }),
        })
      );
    });
  });
});
