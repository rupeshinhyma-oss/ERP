import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AddressMapConfirmModal } from "@/components/hrms/AddressMapConfirmModal";
import * as googleMaps from "@/lib/googleMaps";

// Mock LocationMapPicker for modal flow tests
vi.mock("@/components/hrms/LocationMapPicker", () => ({
  LocationMapPicker: ({
    latitude,
    longitude,
    radiusMeters,
    zoom,
    onChange,
  }: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    zoom?: number;
    onChange?: (c: any) => void;
  }) => (
    <div data-testid="mock-google-map-picker">
      <div data-testid="mock-map-lat">{latitude}</div>
      <div data-testid="mock-map-lng">{longitude}</div>
      <div data-testid="mock-map-radius">{radiusMeters}</div>
      <div data-testid="mock-map-zoom">{zoom}</div>
      <button
        type="button"
        data-testid="mock-drag-pin-btn"
        onClick={() =>
          onChange?.({
            latitude: 19.198300,
            longitude: 72.948300,
            address: "Lodha Supremus, Road No. 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
            verification: {
              place_id: "ChIJ_dragged_lodha_123",
              building: "Lodha Supremus Tower A",
              unit_floor: "4th Floor",
              street: "Road No. 22",
              locality: "Wagle Industrial Estate",
              city: "Thane",
              state: "Maharashtra",
              pin_code: "400604",
              country: "India",
              display_name: "Lodha Supremus, Road No. 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
            },
          })
        }
      >
        Simulate Drag Pin
      </button>
    </div>
  ),
}));

describe("Inhyma ERP HRMS — Google Maps Platform Universal Location Search", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Step 1: Google Places Autocomplete displays suggestions while typing without showing 'Address not found'", async () => {
    const mockPredictions: any[] = [
      {
        place_id: "ChIJ_lodha_supremus_thane",
        description: "Lodha Supremus, Wagle Industrial Estate, Thane West, Maharashtra, India",
        structured_formatting: {
          main_text: "Lodha Supremus",
          secondary_text: "Wagle Industrial Estate, Thane West, Maharashtra, India",
        },
        types: ["establishment", "point_of_interest"],
      },
      {
        place_id: "ChIJ_lodha_amara_thane",
        description: "Lodha Amara, Kolshet Road, Thane West, Maharashtra, India",
        structured_formatting: {
          main_text: "Lodha Amara",
          secondary_text: "Kolshet Road, Thane West, Maharashtra, India",
        },
        types: ["residential", "establishment"],
      },
    ];

    const searchSpy = vi.spyOn(googleMaps, "searchGooglePlaces").mockResolvedValue(mockPredictions);

    const detailsSpy = vi.spyOn(googleMaps, "fetchGooglePlaceDetails").mockResolvedValue({
      place_id: "ChIJ_lodha_supremus_thane",
      name: "Lodha Supremus",
      formatted_address: "Lodha Supremus, Road No. 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
      geometry: {
        location: {
          lat: () => 19.198251,
          lng: () => 72.948232,
        },
      } as any,
      address_components: [
        { long_name: "Lodha Supremus", short_name: "Lodha Supremus", types: ["premise"] },
        { long_name: "Road No. 22", short_name: "Road No. 22", types: ["route"] },
        { long_name: "Wagle Industrial Estate", short_name: "Wagle Estate", types: ["sublocality_level_1"] },
        { long_name: "Thane", short_name: "Thane", types: ["locality"] },
        { long_name: "Maharashtra", short_name: "MH", types: ["administrative_area_level_1"] },
        { long_name: "400604", short_name: "400604", types: ["postal_code"] },
        { long_name: "India", short_name: "IN", types: ["country"] },
      ],
    } as any);

    render(
      <AddressMapConfirmModal
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        mode="office"
      />
    );

    const nameInput = screen.getByPlaceholderText(/Mumbai BKC Office/i);
    fireEvent.change(nameInput, { target: { value: "Thane Corporate Office" } });

    const addressInput = screen.getByPlaceholderText(/Enter building number/i);
    // User types "Lodha Supremus"
    fireEvent.change(addressInput, { target: { value: "Lodha Supremus" } });

    // CRITICAL REQUIREMENT: No "Address not found" while typing
    expect(screen.queryByText(/We couldn't find an exact match/i)).toBeNull();

    // Suggestions appear while typing
    await waitFor(() => {
      expect(searchSpy).toHaveBeenCalledWith("Lodha Supremus");
      expect(screen.getByTestId("address-suggestions-list")).toBeTruthy();
    });

    const items = screen.getAllByTestId("address-suggestion-item");
    expect(items).toHaveLength(2);
    expect(screen.getByText("Lodha Supremus")).toBeTruthy();
    expect(screen.getByText("Lodha Amara")).toBeTruthy();

    // User selects "Lodha Supremus" suggestion
    fireEvent.click(items[0]);

    // Google Place Details API is called
    await waitFor(() => {
      expect(detailsSpy).toHaveBeenCalledWith("ChIJ_lodha_supremus_thane");
      expect(screen.getByText(/Selected Place:/i)).toBeTruthy();
      expect(screen.getByText(/#ChIJ_lodha_supremus_thane/i)).toBeTruthy();
    });

    // Continue to Map Confirmation
    const continueBtn = screen.getByRole("button", { name: /Continue to Map/i });
    fireEvent.click(continueBtn);

    // Step 2 opens with building-level zoom (17-18)
    await waitFor(() => {
      expect(screen.getByText("LATITUDE")).toBeTruthy();
    });
    expect(screen.getByTestId("mock-map-zoom").textContent).toBe("18");
    expect(screen.getByTestId("mock-map-lat").textContent).toContain("19.198251");
    expect(screen.getByTestId("mock-map-lng").textContent).toContain("72.948232");

    // Reverse Verification Card is rendered with green badge and 2-column details
    expect(screen.getByTestId("reverse-verification-card")).toBeTruthy();
    expect(screen.getByText("✓ Google Verified")).toBeTruthy();
    expect(screen.getByTestId("verify-building").textContent).toBe("Lodha Supremus");
    expect(screen.getByTestId("verify-unit-floor").textContent).toBe("—");
    expect(screen.getByTestId("verify-street").textContent).toBe("Road No. 22");
    expect(screen.getByTestId("verify-locality").textContent).toBe("Wagle Industrial Estate");
    expect(screen.getByTestId("verify-city").textContent).toBe("Thane");
    expect(screen.getByTestId("verify-state").textContent).toBe("Maharashtra");
    expect(screen.getByTestId("verify-pincode").textContent).toBe("400604");
    expect(screen.getByTestId("verify-country").textContent).toBe("India");
    expect(screen.getByTestId("verify-formatted-address")).toBeTruthy();
  });

  it("Step 1: Pasting a full address automatically searches Google Places", async () => {
    const fullPastedAddress =
      "Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604";

    const mockPredictions: any[] = [
      {
        place_id: "ChIJ_pasted_lodha_400604",
        description: fullPastedAddress,
        structured_formatting: {
          main_text: "Lodha Supremus",
          secondary_text: "Road Number 22, Wagle Industrial Estate, Thane West",
        },
        types: ["establishment"],
      },
    ];

    const searchSpy = vi.spyOn(googleMaps, "searchGooglePlaces").mockResolvedValue(mockPredictions);

    render(
      <AddressMapConfirmModal
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        mode="office"
      />
    );

    const addressInput = screen.getByPlaceholderText(/Enter building number/i);

    // Paste full address
    fireEvent.paste(addressInput, {
      clipboardData: {
        getData: () => fullPastedAddress,
      },
    });

    // Automatically searches without requiring manual Enter or click
    await waitFor(() => {
      expect(searchSpy).toHaveBeenCalledWith(fullPastedAddress);
      expect(screen.getByTestId("address-suggestions-list")).toBeTruthy();
    });

    expect(screen.getByText("Lodha Supremus")).toBeTruthy();
  });

  it("Step 3 & Save: Pin drag triggers Reverse Geocoding and saves Place ID, Lat, Lng, Formatted Address, Radius, Location Type", async () => {
    const mockConfirm = vi.fn();

    render(
      <AddressMapConfirmModal
        open={true}
        onClose={vi.fn()}
        onConfirm={mockConfirm}
        mode="office"
        initialData={{
          name: "Thane Regional Office",
          location_type: "OFFICE",
          address: "Lodha Supremus, Wagle Estate, Thane",
          latitude: 19.198251,
          longitude: 72.948232,
          radius_meters: 150,
          place_id: "ChIJ_lodha_original",
          building: "Lodha Supremus",
          street: "Road No. 22",
          locality: "Wagle Industrial Estate",
          city: "Thane",
          state: "Maharashtra",
          pin_code: "400604",
          country: "India",
        }}
      />
    );

    // Proceed to Step 2
    const continueBtn = screen.getByRole("button", { name: /Continue to Map/i });
    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(screen.getByTestId("reverse-verification-card")).toBeTruthy();
    });

    expect(screen.getByTestId("verify-building").textContent).toBe("Lodha Supremus");

    // Change geofence radius to 250m
    const chip250 = screen.getByRole("button", { name: "250m" });
    fireEvent.click(chip250);
    expect(screen.getByTestId("mock-map-radius").textContent).toBe("250");

    // Drag the pin to fine-tune location
    const dragBtn = screen.getByTestId("mock-drag-pin-btn");
    fireEvent.click(dragBtn);

    // Live Reverse Verification updates
    await waitFor(() => {
      expect(screen.getByTestId("verify-building").textContent).toBe("Lodha Supremus Tower A");
      expect(screen.getByTestId("verify-unit-floor").textContent).toBe("4th Floor");
    });

    // Confirm & Save
    const saveBtn = screen.getByRole("button", { name: /Confirm Location/i });
    fireEvent.click(saveBtn);

    // Verifies all 13 required fields persisted:
    // place_id, latitude, longitude, building, unit_floor, street, locality, city, state, country, pin_code, radius_meters, location_type
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Thane Regional Office",
        location_type: "OFFICE",
        place_id: "ChIJ_dragged_lodha_123",
        latitude: 19.1983,
        longitude: 72.9483,
        radius_meters: 250,
        address: "Lodha Supremus, Road No. 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
        building: "Lodha Supremus Tower A",
        unit_floor: "4th Floor",
        street: "Road No. 22",
        locality: "Wagle Industrial Estate",
        city: "Thane",
        state: "Maharashtra",
        pin_code: "400604",
        country: "India",
      })
    );
  });

  it("Step 1: Displays 'No nearby results' only after Google API returns ZERO_RESULTS, never while typing", async () => {
    // Return empty results from Google Places API
    vi.spyOn(googleMaps, "searchGooglePlaces").mockResolvedValue([]);

    render(
      <AddressMapConfirmModal
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        mode="office"
      />
    );

    const addressInput = screen.getByPlaceholderText(/Enter building number/i);

    // Typing begins
    fireEvent.change(addressInput, { target: { value: "nonexistent place xyz 99999" } });

    // Not found / zero results must NOT appear immediately while typing
    expect(screen.queryByTestId("address-zero-results")).toBeNull();

    // After debounce and API resolves with empty results:
    await waitFor(() => {
      expect(screen.getByTestId("address-zero-results")).toBeTruthy();
    });

    expect(screen.getByText(/No nearby results found/i)).toBeTruthy();
  });

  it("Step 3: Correctly parses diverse Indian addresses without placeholder values like 'City', 'State', 'Locality'", () => {
    // 1. Hinjawadi Phase 1 Pune
    const hinjawadiResult: any = {
      place_id: "ChIJ_hinjawadi_pune",
      formatted_address: "Hinjawadi Phase 1, Hinjawadi Rajiv Gandhi Infotech Park, Pune, Maharashtra 411057",
      address_components: [
        { long_name: "Phase 1", short_name: "Phase 1", types: ["sublocality_level_2"] },
        { long_name: "Hinjawadi", short_name: "Hinjawadi", types: ["sublocality_level_1"] },
        { long_name: "Pune", short_name: "Pune", types: ["locality"] },
        { long_name: "Pune", short_name: "Pune", types: ["administrative_area_level_2"] },
        { long_name: "Maharashtra", short_name: "MH", types: ["administrative_area_level_1"] },
        { long_name: "411057", short_name: "411057", types: ["postal_code"] },
        { long_name: "India", short_name: "IN", types: ["country"] },
      ],
      geometry: { location: { lat: 18.5913, lng: 73.7389 } },
    };
    const parsedHinjawadi = googleMaps.parseGoogleAddressComponents(hinjawadiResult);
    expect(parsedHinjawadi.locality).toBe("Hinjawadi");
    expect(parsedHinjawadi.city).toBe("Pune");
    expect(parsedHinjawadi.state).toBe("Maharashtra");
    expect(parsedHinjawadi.pin_code).toBe("411057");
    // Strictly verify no placeholder strings
    expect(parsedHinjawadi.locality).not.toBe("Locality");
    expect(parsedHinjawadi.city).not.toBe("City");
    expect(parsedHinjawadi.state).not.toBe("State");

    // 2. GIDC Vapi (Valsad District, Gujarat)
    const vapiResult: any = {
      place_id: "ChIJ_gidc_vapi",
      formatted_address: "GIDC Industrial Estate, Vapi, Valsad District, Gujarat 396195",
      address_components: [
        { long_name: "GIDC Industrial Estate", short_name: "GIDC", types: ["sublocality_level_1"] },
        { long_name: "Vapi", short_name: "Vapi", types: ["locality"] },
        { long_name: "Valsad", short_name: "Valsad", types: ["administrative_area_level_2"] },
        { long_name: "Gujarat", short_name: "GJ", types: ["administrative_area_level_1"] },
        { long_name: "396195", short_name: "396195", types: ["postal_code"] },
        { long_name: "India", short_name: "IN", types: ["country"] },
      ],
      geometry: { location: { lat: 20.3704, lng: 72.9106 } },
    };
    const parsedVapi = googleMaps.parseGoogleAddressComponents(vapiResult);
    expect(parsedVapi.locality).toBe("GIDC Industrial Estate");
    expect(parsedVapi.city).toBe("Vapi");
    expect(parsedVapi.state).toBe("Gujarat");
    expect(parsedVapi.pin_code).toBe("396195");
    expect(parsedVapi.locality).not.toBe("Locality");
    expect(parsedVapi.city).not.toBe("City");

    // 3. Rural Village Address (without standard locality, relies on Taluka/District)
    const villageResult: any = {
      place_id: "ChIJ_rural_village",
      formatted_address: "At Post Shindewadi, Taluka Bhor, Pune District, Maharashtra 412205",
      address_components: [
        { long_name: "Shindewadi", short_name: "Shindewadi", types: ["sublocality_level_1"] },
        { long_name: "Bhor", short_name: "Bhor", types: ["administrative_area_level_3"] },
        { long_name: "Pune", short_name: "Pune", types: ["administrative_area_level_2"] },
        { long_name: "Maharashtra", short_name: "MH", types: ["administrative_area_level_1"] },
        { long_name: "412205", short_name: "412205", types: ["postal_code"] },
        { long_name: "India", short_name: "IN", types: ["country"] },
      ],
      geometry: { location: { lat: 18.1567, lng: 73.8443 } },
    };
    const parsedVillage = googleMaps.parseGoogleAddressComponents(villageResult);
    expect(parsedVillage.locality).toBe("Shindewadi");
    expect(parsedVillage.city).toBe("Pune");
    expect(parsedVillage.state).toBe("Maharashtra");
    expect(parsedVillage.pin_code).toBe("412205");
    expect(parsedVillage.city).not.toBe("City");
    // 4. Commercial Landmark with Unit / Floor (subpremise + floor) and Premise
    const commercialResult: any = {
      place_id: "ChIJ_commercial_tower",
      formatted_address: "Office 421, 4th Floor, Lodha Supremus, Road No. 22, Wagle Industrial Estate, Thane, Maharashtra 400604",
      address_components: [
        { long_name: "Office 421", short_name: "421", types: ["subpremise"] },
        { long_name: "4th Floor", short_name: "4", types: ["floor"] },
        { long_name: "Lodha Supremus", short_name: "Lodha Supremus", types: ["premise"] },
        { long_name: "Road No. 22", short_name: "Road No. 22", types: ["route"] },
        { long_name: "Wagle Industrial Estate", short_name: "Wagle Estate", types: ["sublocality_level_1"] },
        { long_name: "Thane", short_name: "Thane", types: ["locality"] },
        { long_name: "Maharashtra", short_name: "MH", types: ["administrative_area_level_1"] },
        { long_name: "400604", short_name: "400604", types: ["postal_code"] },
        { long_name: "India", short_name: "IN", types: ["country"] },
      ],
      geometry: { location: { lat: 19.198251, lng: 72.948232 } },
    };
    const parsedCommercial = googleMaps.parseGoogleAddressComponents(commercialResult);
    expect(parsedCommercial.building).toBe("Lodha Supremus");
    expect(parsedCommercial.unit_floor).toBe("Office 421, 4th Floor");
    expect(parsedCommercial.street).toBe("Road No. 22");
    expect(parsedCommercial.locality).toBe("Wagle Industrial Estate");
    expect(parsedCommercial.city).toBe("Thane");
    expect(parsedCommercial.state).toBe("Maharashtra");
    expect(parsedCommercial.pin_code).toBe("400604");
    expect(parsedCommercial.country).toBe("India");
  });

  it("Error Handling: Shows in-modal ERP error notification when Google Maps auth or billing fails without browser alert", async () => {
    const alertSpy = vi.spyOn(window, "alert");

    render(
      <AddressMapConfirmModal
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        mode="office"
      />
    );

    // Simulate Google Maps authFailure broadcast
    googleMaps.notifyGoogleMapsError({
      type: "AUTH_FAILURE",
      message: "Google Maps Platform authentication failed. Please check VITE_GOOGLE_MAPS_API_KEY and billing.",
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Google Maps Platform authentication failed/i)
      ).toBeTruthy();
    });

    // CRITICAL REQUIREMENT: No browser window.alert() was called
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
