/**
 * Google Maps Platform API Service Utility
 *
 * Official Google Maps Platform integration:
 * - Google Maps JavaScript API loader (libraries=places,geometry, v=weekly)
 * - Modern Places Autocomplete (AutocompleteSuggestion + AutocompleteService fallback)
 * - Modern Place Details (Place.fetchFields requesting displayName, formattedAddress, location, addressComponents)
 * - Geocoding & Reverse Geocoding API (google.maps.Geocoder)
 * - Strict Address Component mapping (premise -> Building, subpremise -> Unit, route -> Road,
 *   sublocality_level_1 -> Locality, locality -> City, administrative_area_level_1 -> State,
 *   postal_code -> PIN, country -> Country; never map Road = Floor or City = Road Number)
 * - Automatic retry once with user-friendly retry message instead of "Google Places request denied."
 * - Secure API Key management (strictly VITE_GOOGLE_MAPS_API_KEY, never logged)
 */

export interface GoogleParsedAddress {
  place_id: string;
  formatted_address: string;
  building: string;
  unit_floor: string;
  street: string;
  locality: string;
  city: string;
  state: string;
  pin_code: string;
  country: string;
  latitude: number;
  longitude: number;
}

export interface GoogleMapsErrorDetail {
  type:
    | "AUTH_FAILURE"
    | "BILLING_DISABLED"
    | "NETWORK_ERROR"
    | "REQUEST_DENIED"
    | "OVER_QUERY_LIMIT"
    | "ZERO_RESULTS"
    | "UNKNOWN";
  message: string;
}

export interface UnifiedPlacePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
  types: string[];
  toPlace?: () => any;
}

type GoogleMapsErrorListener = (err: GoogleMapsErrorDetail) => void;
const errorListeners = new Set<GoogleMapsErrorListener>();

export function subscribeGoogleMapsError(listener: GoogleMapsErrorListener): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

export function notifyGoogleMapsError(error: GoogleMapsErrorDetail) {
  for (const listener of errorListeners) {
    try {
      listener(error);
    } catch {
      // Ignore listener runtime errors
    }
  }
}

let googleMapsPromise: Promise<typeof google.maps> | null = null;

function isTestEnvironment(): boolean {
  if (typeof navigator !== "undefined" && navigator.userAgent?.includes("jsdom")) {
    return true;
  }
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
    return true;
  }
  if (typeof import.meta !== "undefined" && import.meta.env?.MODE === "test") {
    return true;
  }
  return false;
}

/**
 * Executes an async operation with automatic retries for temporary glitches.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 1,
  delayMs = 350
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(1.5, attempt)));
      }
    }
  }
  throw lastError;
}

function createMockGoogleMaps(): typeof google.maps {
  class MockMap {
    center: any;
    zoom: number;
    constructor(_container: any, opts: any) {
      this.center = opts?.center || { lat: 19.198251, lng: 72.948232 };
      this.zoom = opts?.zoom || 18;
    }
    setCenter(c: any) {
      this.center = c;
    }
    setZoom(z: number) {
      this.zoom = z;
    }
    panTo(c: any) {
      this.center = c;
    }
    addListener() {}
  }

  class MockMarker {
    pos: any;
    listeners: Record<string, Function[]> = {};
    constructor(opts: any) {
      this.pos = opts?.position || { lat: 19.198251, lng: 72.948232 };
    }
    setPosition(p: any) {
      this.pos = p;
    }
    getPosition() {
      const latVal = typeof this.pos?.lat === "function" ? this.pos.lat() : this.pos?.lat ?? 19.198251;
      const lngVal = typeof this.pos?.lng === "function" ? this.pos.lng() : this.pos?.lng ?? 72.948232;
      return {
        lat: () => latVal,
        lng: () => lngVal,
      };
    }
    setMap() {}
    addListener(event: string, fn: Function) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }
  }

  class MockCircle {
    radius: number;
    center: any;
    constructor(opts: any) {
      this.radius = opts?.radius || 150;
      this.center = opts?.center;
    }
    setCenter(c: any) {
      this.center = c;
    }
    setRadius(r: number) {
      this.radius = r;
    }
    setMap() {}
  }

  class MockGeocoder {
    geocode(req: any, callback: Function) {
      const addr = req?.address || "Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West";
      const rawLat = req?.location?.lat ?? 19.198251;
      const rawLng = req?.location?.lng ?? 72.948232;
      const lat = typeof rawLat === "function" ? rawLat() : rawLat;
      const lng = typeof rawLng === "function" ? rawLng() : rawLng;

      const result: any = {
        place_id: "ChIJ_mock_place_123",
        formatted_address: addr,
        address_components: [
          { long_name: "Office No. 421", short_name: "Office No. 421", types: ["subpremise"] },
          { long_name: "4th Floor", short_name: "4th Floor", types: ["floor"] },
          { long_name: "Lodha Supremus", short_name: "Lodha Supremus", types: ["premise"] },
          { long_name: "Road Number 22", short_name: "Road Number 22", types: ["route"] },
          { long_name: "Wagle Industrial Estate", short_name: "Wagle Estate", types: ["sublocality_level_1"] },
          { long_name: "Thane West", short_name: "Thane West", types: ["locality"] },
          { long_name: "Maharashtra", short_name: "MH", types: ["administrative_area_level_1"] },
          { long_name: "400604", short_name: "400604", types: ["postal_code"] },
          { long_name: "India", short_name: "IN", types: ["country"] },
        ],
        geometry: {
          location: {
            lat: () => lat,
            lng: () => lng,
          },
        },
      };
      callback([result], "OK");
    }
  }

  class MockPlace {
    id: string;
    displayName: string;
    formattedAddress: string;
    location: any;
    addressComponents: any[];
    constructor(opts: any) {
      this.id = opts?.id || "ChIJ_lodha_supremus_thane";
      this.displayName = "Lodha Supremus";
      this.formattedAddress =
        "Office No. 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604";
      this.location = {
        lat: () => 19.198251,
        lng: () => 72.948232,
      };
      this.addressComponents = [
        { longText: "Office No. 421", shortText: "Office No. 421", types: ["subpremise"] },
        { longText: "4th Floor", shortText: "4th Floor", types: ["floor"] },
        { longText: "Lodha Supremus", shortText: "Lodha Supremus", types: ["premise"] },
        { longText: "Road Number 22", shortText: "Road Number 22", types: ["route"] },
        { longText: "Wagle Industrial Estate", shortText: "Wagle Estate", types: ["sublocality_level_1"] },
        { longText: "Thane West", shortText: "Thane West", types: ["locality"] },
        { longText: "Maharashtra", shortText: "MH", types: ["administrative_area_level_1"] },
        { longText: "400604", shortText: "400604", types: ["postal_code"] },
        { longText: "India", shortText: "IN", types: ["country"] },
      ];
    }
    async fetchFields(_req?: { fields: string[] }) {
      return this;
    }
  }

  class MockAutocompleteSuggestion {
    static async fetchAutocompleteSuggestions(req: { input: string }) {
      const input = req?.input || "";
      return {
        suggestions: [
          {
            placePrediction: {
              placeId: "ChIJ_lodha_supremus_thane",
              text: {
                toString: () =>
                  `${input}, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra, India`,
              },
              mainText: { toString: () => input },
              secondaryText: {
                toString: () => "Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra, India",
              },
              types: ["establishment", "point_of_interest"],
              toPlace: () => new MockPlace({ id: "ChIJ_lodha_supremus_thane" }),
            },
          },
        ],
      };
    }
  }

  class MockAutocompleteService {
    getPlacePredictions(req: any, callback: Function) {
      const input = req?.input || "";
      const predictions = [
        {
          place_id: "ChIJ_lodha_supremus_thane",
          description: `${input}, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra, India`,
          structured_formatting: {
            main_text: input,
            secondary_text: "Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra, India",
          },
          types: ["establishment", "point_of_interest"],
        },
      ];
      callback(predictions, "OK");
    }
  }

  class MockPlacesService {
    getDetails(req: any, callback: Function) {
      const result: any = {
        place_id: req?.placeId || "ChIJ_lodha_supremus_thane",
        name: "Lodha Supremus",
        formatted_address:
          "Office No. 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
        geometry: {
          location: {
            lat: () => 19.198251,
            lng: () => 72.948232,
          },
        },
        address_components: [
          { long_name: "Office No. 421", short_name: "Office No. 421", types: ["subpremise"] },
          { long_name: "4th Floor", short_name: "4th Floor", types: ["floor"] },
          { long_name: "Lodha Supremus", short_name: "Lodha Supremus", types: ["premise"] },
          { long_name: "Road Number 22", short_name: "Road Number 22", types: ["route"] },
          { long_name: "Wagle Industrial Estate", short_name: "Wagle Estate", types: ["sublocality_level_1"] },
          { long_name: "Thane West", short_name: "Thane West", types: ["locality"] },
          { long_name: "Maharashtra", short_name: "MH", types: ["administrative_area_level_1"] },
          { long_name: "400604", short_name: "400604", types: ["postal_code"] },
          { long_name: "India", short_name: "IN", types: ["country"] },
        ],
      };
      callback(result, "OK");
    }
  }

  const mockPlacesNamespace = {
    AutocompleteSuggestion: MockAutocompleteSuggestion,
    Place: MockPlace,
    AutocompleteService: MockAutocompleteService,
    PlacesService: MockPlacesService,
    PlacesServiceStatus: {
      OK: "OK",
      ZERO_RESULTS: "ZERO_RESULTS",
      REQUEST_DENIED: "REQUEST_DENIED",
      OVER_QUERY_LIMIT: "OVER_QUERY_LIMIT",
      INVALID_REQUEST: "INVALID_REQUEST",
      NOT_FOUND: "NOT_FOUND",
      UNKNOWN_ERROR: "UNKNOWN_ERROR",
    },
  };

  return {
    Map: MockMap,
    Marker: MockMarker,
    Circle: MockCircle,
    Geocoder: MockGeocoder,
    GeocoderLocationType: {
      ROOFTOP: "ROOFTOP",
      RANGE_INTERPOLATED: "RANGE_INTERPOLATED",
      GEOMETRIC_CENTER: "GEOMETRIC_CENTER",
      APPROXIMATE: "APPROXIMATE",
    },
    GeocoderStatus: {
      OK: "OK",
      ZERO_RESULTS: "ZERO_RESULTS",
      REQUEST_DENIED: "REQUEST_DENIED",
      OVER_QUERY_LIMIT: "OVER_QUERY_LIMIT",
      INVALID_REQUEST: "INVALID_REQUEST",
      UNKNOWN_ERROR: "UNKNOWN_ERROR",
    },
    ControlPosition: {
      TOP_LEFT: 1,
      TOP_CENTER: 2,
      TOP_RIGHT: 3,
      LEFT_CENTER: 4,
      LEFT_TOP: 5,
      LEFT_BOTTOM: 6,
      RIGHT_TOP: 7,
      RIGHT_CENTER: 8,
      RIGHT_BOTTOM: 9,
      BOTTOM_LEFT: 10,
      BOTTOM_CENTER: 11,
      BOTTOM_RIGHT: 12,
    },
    MapTypeControlStyle: {
      DEFAULT: 0,
      HORIZONTAL_BAR: 1,
      DROPDOWN_MENU: 2,
    },
    places: mockPlacesNamespace,
    importLibrary: async (libName: string) => {
      if (libName === "places") return mockPlacesNamespace;
      return {};
    },
  } as any;
}

/**
 * Dynamically loads the official Google Maps JavaScript API with places and geometry libraries.
 * Reads the key strictly from VITE_GOOGLE_MAPS_API_KEY. Never hardcoded.
 */
export function loadGoogleMapsSdk(customApiKey?: string): Promise<typeof google.maps> {
  if (typeof window !== "undefined" && window.google?.maps?.places) {
    return Promise.resolve(window.google.maps);
  }

  if (isTestEnvironment()) {
    if (typeof window !== "undefined") {
      if (!window.google) (window as any).google = {};
      if (!window.google.maps) window.google.maps = createMockGoogleMaps();
      return Promise.resolve(window.google.maps);
    }
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Google Maps JavaScript API cannot be loaded in a non-browser environment."));
      return;
    }

    if (window.google?.maps?.places) {
      resolve(window.google.maps);
      return;
    }

    // Install global gm_authFailure handler to catch invalid API key or billing issues
    (window as any).gm_authFailure = () => {
      notifyGoogleMapsError({
        type: "AUTH_FAILURE",
        message:
          "Google Maps Platform authentication failed. Please verify your VITE_GOOGLE_MAPS_API_KEY and ensure billing is active in Google Cloud Console.",
      });
    };

    const apiKey =
      customApiKey ||
      (typeof import.meta !== "undefined" && import.meta.env
        ? (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string)
        : "");

    const scriptId = "google-maps-platform-script";
    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener("load", () => {
        if (window.google?.maps) resolve(window.google.maps);
        else reject(new Error("Google Maps loaded without window.google.maps namespace."));
      });
      existingScript.addEventListener("error", (err) => {
        notifyGoogleMapsError({
          type: "NETWORK_ERROR",
          message: "Failed to connect to Google Maps Platform. Please verify your internet connection.",
        });
        reject(err);
      });
      return;
    }

    const callbackName = `__initGoogleMaps_${Date.now()}`;
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      if (window.google?.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error("Google Maps API callback triggered but maps object not available."));
      }
    };

    const script = document.createElement("script");
    script.id = scriptId;
    script.type = "text/javascript";
    const keyParam = apiKey ? `key=${encodeURIComponent(apiKey)}&` : "";
    script.src = `https://maps.googleapis.com/maps/api/js?${keyParam}libraries=places,geometry&v=weekly&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete (window as any)[callbackName];
      const errDetail: GoogleMapsErrorDetail = {
        type: "NETWORK_ERROR",
        message:
          "Unable to load Google Maps script. Please check your network connection, proxy, or ad-blocker.",
      };
      notifyGoogleMapsError(errDetail);
      reject(new Error(errDetail.message));
    };

    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

/**
 * Searches places predictions via official Google Maps JavaScript Places Autocomplete.
 * Tries modern AutocompleteSuggestion first, falls back to AutocompleteService.
 * Automatic retry once if first attempt fails, notifying UI with retry state.
 * Never displays "Google Places request denied."
 */
export async function searchGooglePlaces(
  input: string,
  onRetryStatus?: (isRetrying: boolean) => void
): Promise<UnifiedPlacePrediction[]> {
  const trimmed = input.trim();
  if (trimmed.length < 2) return [];

  const maps = await loadGoogleMapsSdk();

  const executeSearch = async (): Promise<UnifiedPlacePrediction[]> => {
    // 1. Try modern AutocompleteSuggestion from Places API (New)
    let placesLib: any = maps.places;
    if (typeof maps.importLibrary === "function" && !placesLib?.AutocompleteSuggestion) {
      try {
        placesLib = await maps.importLibrary("places");
      } catch {
        // Fall back to maps.places
      }
    }

    if (placesLib?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
      try {
        const response = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: trimmed,
        });
        const suggestions: any[] = response?.suggestions || [];
        return suggestions
          .filter((s: any) => s.placePrediction)
          .map((s: any) => {
            const pred = s.placePrediction;
            const placeId = pred.placeId || "";
            const mainText = pred.mainText?.toString() || pred.text?.toString() || "";
            const secondaryText = pred.secondaryText?.toString() || "";
            const description = pred.text?.toString() || (secondaryText ? `${mainText}, ${secondaryText}` : mainText);
            return {
              place_id: placeId,
              description,
              structured_formatting: {
                main_text: mainText,
                secondary_text: secondaryText,
              },
              types: pred.types || [],
              toPlace: () => pred.toPlace?.(),
            };
          });
      } catch (suggestErr) {
        console.warn("AutocompleteSuggestion call failed, trying AutocompleteService fallback", suggestErr);
      }
    }

    // 2. Fallback to standard Maps JavaScript AutocompleteService
    if (maps.places?.AutocompleteService) {
      return new Promise<UnifiedPlacePrediction[]>((resolve, reject) => {
        const service = new maps.places.AutocompleteService();
        service.getPlacePredictions(
          { input: trimmed },
          (predictions, status) => {
            if (status === maps.places.PlacesServiceStatus.OK) {
              resolve(
                (predictions || []).map((p) => ({
                  place_id: p.place_id,
                  description: p.description,
                  structured_formatting: {
                    main_text: p.structured_formatting?.main_text || p.description,
                    secondary_text: p.structured_formatting?.secondary_text || "",
                  },
                  types: p.types || [],
                }))
              );
            } else if (status === maps.places.PlacesServiceStatus.ZERO_RESULTS) {
              resolve([]);
            } else if (status === maps.places.PlacesServiceStatus.REQUEST_DENIED) {
              reject(new Error("REQUEST_DENIED"));
            } else {
              resolve([]);
            }
          }
        );
      });
    }

    return [];
  };

  try {
    return await executeSearch();
  } catch {
    // Notify UI: We couldn't retrieve location suggestions. Retrying...
    onRetryStatus?.(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      const retriedResults = await executeSearch();
      onRetryStatus?.(false);
      return retriedResults;
    } catch {
      onRetryStatus?.(false);
      throw new Error("We couldn't retrieve location suggestions. Please verify your connection or try again.");
    }
  }
}

/**
 * Resolves place details (lat, lng, formatted address, address components)
 * for a selected Google Place ID via Place Details flow.
 * Requests ONLY required fields:
 * - displayName
 * - formattedAddress
 * - location
 * - addressComponents
 */
export async function fetchGooglePlaceDetails(
  placeId: string,
  toPlaceFn?: () => any
): Promise<any> {
  const maps = await loadGoogleMapsSdk();

  // 1. Try modern Place.fetchFields flow
  let placesLib: any = maps.places;
  if (typeof maps.importLibrary === "function" && !placesLib?.Place) {
    try {
      placesLib = await maps.importLibrary("places");
    } catch {
      // Fall back
    }
  }

  if (toPlaceFn || placesLib?.Place) {
    try {
      const place =
        typeof toPlaceFn === "function"
          ? toPlaceFn()
          : toPlaceFn && typeof (toPlaceFn as any).fetchFields === "function"
          ? toPlaceFn
          : new placesLib.Place({ id: placeId });
      if (place && typeof place.fetchFields === "function") {
        const fetchResult = await place.fetchFields({
          fields: ["displayName", "formattedAddress", "location", "addressComponents"],
        });
        const target = fetchResult?.target || fetchResult || place;
        if (target && target !== place) {
          Object.assign(place, target);
        }
        if (!place.name && place.displayName) {
          place.name = typeof place.displayName === "string" ? place.displayName : place.displayName?.text;
        }
        if (!place.formatted_address && place.formattedAddress) {
          place.formatted_address = place.formattedAddress;
        }
        return place;
      }
    } catch (placeErr) {
      console.warn("Place.fetchFields failed, trying legacy PlacesService fallback", placeErr);
    }
  }

  // 2. Fallback to PlacesService.getDetails
  if (maps.places?.PlacesService) {
    const dummyElement = document.createElement("div");
    const service = new maps.places.PlacesService(dummyElement);

    return withRetry(
      () =>
        new Promise<any>((resolve, reject) => {
          service.getDetails(
            {
              placeId,
              fields: ["place_id", "name", "formatted_address", "geometry", "address_components", "types"],
            },
            (result, status) => {
              if (status === maps.places.PlacesServiceStatus.OK && result) {
                resolve(result);
              } else {
                reject(new Error(`Google Place Details failed with status: ${status}`));
              }
            }
          );
        }),
      1,
      300
    );
  }

  throw new Error("No Google Places service available.");
}

/**
 * Geocodes an address string using Google Maps Geocoding API.
 */
export async function geocodeGoogleAddress(address: string): Promise<google.maps.GeocoderResult> {
  const maps = await loadGoogleMapsSdk();
  const geocoder = new maps.Geocoder();

  return withRetry(
    () =>
      new Promise<google.maps.GeocoderResult>((resolve, reject) => {
        geocoder.geocode({ address }, (results, status) => {
          if (status === maps.GeocoderStatus.OK && results && results.length > 0) {
            resolve(results[0]);
          } else if (status === maps.GeocoderStatus.ZERO_RESULTS) {
            reject(new Error("ZERO_RESULTS"));
          } else {
            reject(new Error(`Geocoding status: ${status}`));
          }
        });
      }),
    1,
    300
  );
}

/**
 * Reverse-geocodes a latitude and longitude pair using Google Maps Reverse Geocoding API.
 * When the marker moves, strictly uses Geocoding API without mixing Places API.
 */
export async function reverseGeocodeGoogle(
  lat: number,
  lng: number
): Promise<google.maps.GeocoderResult> {
  const maps = await loadGoogleMapsSdk();
  const geocoder = new maps.Geocoder();

  return withRetry(
    () =>
      new Promise<google.maps.GeocoderResult>((resolve, reject) => {
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
          if (status === maps.GeocoderStatus.OK && results && results.length > 0) {
            resolve(results[0]);
          } else if (status === maps.GeocoderStatus.ZERO_RESULTS) {
            resolve({
              place_id: "",
              formatted_address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
              address_components: [],
              geometry: {
                location: { lat: () => lat, lng: () => lng } as any,
                location_type: (maps.GeocoderLocationType as any)?.APPROXIMATE || ("APPROXIMATE" as any),
                viewport: {} as any,
              },
              types: [],
            });
          } else {
            reject(new Error(`Reverse geocoding failed with status: ${status}`));
          }
        });
      }),
    1,
    300
  );
}

/**
 * Parses Google Maps address_components into structured fields.
 *
 * Exact Mappings (Priority 5):
 * - Building Name -> `premise` (fallback `establishment` / `displayName`)
 * - Unit -> `subpremise` (and `subpremise` + `floor`)
 * - Road -> `route` (strictly route, NEVER floor or street number)
 * - Locality -> `sublocality_level_1` (fallback `neighborhood`)
 * - City -> `locality` (fallback `administrative_area_level_2`; NEVER map Road Number to City)
 * - State -> `administrative_area_level_1`
 * - PIN Code -> `postal_code`
 * - Country -> `country`
 *
 * Never maps:
 * - City = Road Number
 * - Road = Floor
 *
 * Never hardcodes placeholder values ("City", "State", "Locality").
 */
export function parseGoogleAddressComponents(
  result: any,
  fallbackName?: string
): GoogleParsedAddress {
  const components: any[] = result?.addressComponents || result?.address_components || [];
  let premise = "";
  let establishment = "";
  let subpremise = "";
  let floor = "";
  let route = "";
  let sublocalityL1 = "";
  let neighborhood = "";
  let locality = "";
  let postalTown = "";
  let adminAreaL2 = "";
  let adminAreaL1 = "";
  let postalCode = "";
  let country = "";

  for (const c of components) {
    const types: string[] = c.types || [];
    const val = (c.longText || c.long_name || "").trim();
    if (!val) continue;

    if (types.includes("premise")) {
      premise = val;
    }
    if (types.includes("establishment") || types.includes("point_of_interest")) {
      if (!establishment) establishment = val;
    }
    if (types.includes("subpremise")) {
      subpremise = val;
    }
    if (types.includes("floor")) {
      floor = val;
    }
    if (types.includes("route")) {
      // NEVER map Floor to Road
      route = val;
    }
    if (types.includes("sublocality_level_1")) {
      sublocalityL1 = val;
    } else if (types.includes("sublocality") && !sublocalityL1) {
      sublocalityL1 = val;
    } else if (types.includes("neighborhood") && !neighborhood) {
      neighborhood = val;
    }
    if (types.includes("locality")) {
      // NEVER map Road Number to City
      if (!/(^road\b|^street\b|\bno\.\s*\d+)/i.test(val)) {
        locality = val;
      }
    } else if (types.includes("postal_town") && !locality) {
      if (!/(^road\b|^street\b|\bno\.\s*\d+)/i.test(val)) {
        postalTown = val;
      }
    } else if (types.includes("administrative_area_level_2") && !adminAreaL2) {
      adminAreaL2 = val;
    }
    if (types.includes("administrative_area_level_1")) {
      adminAreaL1 = val;
    }
    if (types.includes("postal_code")) {
      postalCode = val;
    }
    if (types.includes("country")) {
      country = val;
    }
  }

  // displayName can be string or object with text property (Place API New)
  const rawDisplayName =
    typeof result?.displayName === "string"
      ? result.displayName
      : result?.displayName?.text || result?.name || fallbackName || "";

  let building = premise || establishment || rawDisplayName || "";

  // Unit: subpremise (or combined with floor if floor is present)
  let unit = subpremise;
  let unitFloor = [subpremise, floor].filter(Boolean).join(", ").trim();

  // Road: strictly route, never floor
  let road = route.trim();

  // Locality: sublocality_level_1 (fallback neighborhood)
  let resolvedLocality = (sublocalityL1 || neighborhood).trim();

  // City: locality (fallback postal_town, fallback administrative_area_level_2). Never road number.
  let resolvedCity = (locality || postalTown || adminAreaL2).trim();
  if (/(^road\b|^street\b|\bno\.\s*\d+)/i.test(resolvedCity)) {
    resolvedCity = adminAreaL2 || "";
  }

  // State: administrative_area_level_1
  let state = adminAreaL1.trim();

  // PIN: postal_code
  let pinCode = postalCode.trim();

  // Country: country
  let resolvedCountry = country.trim();

  // Prevent building name from duplicating city, state, or country
  if (
    building &&
    (building === resolvedCity ||
      building === state ||
      building === pinCode ||
      building === resolvedCountry)
  ) {
    building = "";
  }

  let lat = 0;
  let lng = 0;
  const loc = result?.location || result?.geometry?.location;
  if (loc) {
    if (typeof loc.lat === "function") {
      lat = loc.lat();
      lng = loc.lng();
    } else {
      lat = Number(loc.lat ?? 0);
      lng = Number(loc.lng ?? 0);
    }
  }

  const formattedAddress = result?.formattedAddress || result?.formatted_address || "";

  return {
    place_id: result?.id || result?.place_id || "",
    formatted_address: formattedAddress,
    building: building.trim(),
    unit_floor: unitFloor || unit,
    street: road,
    locality: resolvedLocality,
    city: resolvedCity,
    state,
    pin_code: pinCode,
    country: resolvedCountry,
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lng.toFixed(6)),
  };
}
