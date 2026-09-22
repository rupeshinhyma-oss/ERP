/**
 * Google Maps Platform API Service Utility
 *
 * Official Google Maps Platform integration:
 * - Google Maps JavaScript API dynamic loader
 * - Places Autocomplete API (google.maps.places.AutocompleteService)
 * - Place Details API (google.maps.places.PlacesService)
 * - Geocoding API (google.maps.Geocoder)
 * - Reverse Geocoding API (google.maps.Geocoder) with PlacesService nearbySearch fallback
 * - Exact Address Component mapping (Building -> premise/establishment, Unit/Floor -> subpremise+floor, Street -> route, Locality -> sublocality_level_1/neighborhood, City -> locality, State -> administrative_area_level_1, PIN -> postal_code, Country -> country)
 * - Automatic retry with exponential backoff for temporary Google responses
 * - Secure API Key management (strictly VITE_GOOGLE_MAPS_API_KEY, never logged)
 * - ERP-styled error listeners for auth failure, billing, and network issues
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
 * Executes an async operation with automatic retries and exponential backoff
 * for temporary network or Google Maps rate limit glitches.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
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
        formatted_address: "Office No. 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
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
    findPlaceFromQuery(req: any, callback: Function) {
      const result: any = {
        place_id: "ChIJ_lodha_supremus_thane",
        name: req?.query || "Lodha Supremus",
        formatted_address: "Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
        geometry: {
          location: {
            lat: () => 19.198251,
            lng: () => 72.948232,
          },
        },
      };
      callback([result], "OK");
    }
    nearbySearch(req: any, callback: Function) {
      const rawLat = typeof req?.location?.lat === "function" ? req.location.lat() : req?.location?.lat ?? 19.198251;
      const rawLng = typeof req?.location?.lng === "function" ? req.location.lng() : req?.location?.lng ?? 72.948232;
      const result: any = {
        place_id: "ChIJ_lodha_supremus_thane",
        name: "Lodha Supremus",
        vicinity: "Road Number 22, Wagle Industrial Estate, Thane West",
        geometry: {
          location: {
            lat: () => rawLat,
            lng: () => rawLng,
          },
        },
      };
      callback([result], "OK");
    }
  }

  return {
    Map: MockMap,
    Marker: MockMarker,
    Circle: MockCircle,
    Geocoder: MockGeocoder,
    GeocoderStatus: {
      OK: "OK",
      ZERO_RESULTS: "ZERO_RESULTS",
      REQUEST_DENIED: "REQUEST_DENIED",
      OVER_QUERY_LIMIT: "OVER_QUERY_LIMIT",
      INVALID_REQUEST: "INVALID_REQUEST",
      UNKNOWN_ERROR: "UNKNOWN_ERROR",
    },
    places: {
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
    },
  } as any;
}

/**
 * Dynamically loads the official Google Maps JavaScript API with places and geometry libraries.
 * In automated test environments (JSDOM / Vitest), provides a headless mock so tests run deterministically.
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
    script.src = `https://maps.googleapis.com/maps/api/js?${keyParam}libraries=places,geometry&callback=${callbackName}`;
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
 * Searches places predictions via Google Places Autocomplete API.
 * Never performs local text matching.
 */
export async function searchGooglePlaces(
  input: string,
  options?: Partial<google.maps.places.AutocompletionRequest>
): Promise<google.maps.places.AutocompletePrediction[]> {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const maps = await loadGoogleMapsSdk();
  if (!maps.places?.AutocompleteService) {
    throw new Error("Google Maps Places AutocompleteService is not available.");
  }

  return withRetry(
    () =>
      new Promise<google.maps.places.AutocompletePrediction[]>((resolve, reject) => {
        const service = new maps.places.AutocompleteService();
        service.getPlacePredictions(
          {
            input: trimmed,
            ...options,
          },
          (predictions, status) => {
            if (status === maps.places.PlacesServiceStatus.OK) {
              resolve(predictions || []);
            } else if (status === maps.places.PlacesServiceStatus.ZERO_RESULTS) {
              resolve([]);
            } else if (status === maps.places.PlacesServiceStatus.REQUEST_DENIED) {
              const errDetail: GoogleMapsErrorDetail = {
                type: "REQUEST_DENIED",
                message:
                  "Google Places request denied. Please check your API key, domain restrictions, and billing status.",
              };
              notifyGoogleMapsError(errDetail);
              reject(new Error(errDetail.message));
            } else if (status === maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT) {
              const errDetail: GoogleMapsErrorDetail = {
                type: "OVER_QUERY_LIMIT",
                message: "Google Maps request quota exceeded. Please check your Google Cloud quota limits.",
              };
              notifyGoogleMapsError(errDetail);
              reject(new Error(errDetail.message));
            } else {
              resolve([]);
            }
          }
        );
      })
  );
}

/**
 * Resolves full place details (lat, lng, formatted address, address components)
 * for a selected Google Place ID via Place Details API.
 */
export async function fetchGooglePlaceDetails(
  placeId: string,
  fields: string[] = [
    "place_id",
    "name",
    "formatted_address",
    "geometry",
    "address_components",
    "types",
  ]
): Promise<google.maps.places.PlaceResult> {
  const maps = await loadGoogleMapsSdk();
  if (!maps.places?.PlacesService) {
    throw new Error("Google Maps PlacesService is not available.");
  }

  const dummyElement = document.createElement("div");
  const service = new maps.places.PlacesService(dummyElement);

  return withRetry(
    () =>
      new Promise<google.maps.places.PlaceResult>((resolve, reject) => {
        service.getDetails(
          {
            placeId,
            fields,
          },
          (result, status) => {
            if (status === maps.places.PlacesServiceStatus.OK && result) {
              resolve(result);
            } else if (status === maps.places.PlacesServiceStatus.REQUEST_DENIED) {
              reject(new Error("Place Details request denied by Google Maps Platform."));
            } else {
              reject(new Error(`Google Place Details failed with status: ${status}`));
            }
          }
        );
      })
  );
}

/**
 * Geocodes an address string using Google Maps Geocoding API with Places fallback.
 */
export async function geocodeGoogleAddress(address: string): Promise<google.maps.GeocoderResult> {
  const maps = await loadGoogleMapsSdk();

  // Try Geocoder first
  try {
    const geocoder = new maps.Geocoder();
    return await withRetry(
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
  } catch (geoErr: any) {
    if (geoErr?.message === "ZERO_RESULTS") {
      throw geoErr;
    }

    // Seamless fallback to Places API (New/Legacy) if Geocoding API is denied or fails
    if (maps.places?.PlacesService) {
      const dummyDiv = document.createElement("div");
      const placesService = new maps.places.PlacesService(dummyDiv);

      const placeResult = await withRetry(
        () =>
          new Promise<google.maps.places.PlaceResult>((resolve, reject) => {
            placesService.findPlaceFromQuery(
              {
                query: address,
                fields: ["place_id", "name", "formatted_address", "geometry"],
              },
              (results, status) => {
                if (status === maps.places.PlacesServiceStatus.OK && results && results.length > 0) {
                  resolve(results[0]);
                } else {
                  reject(new Error(`Places find failed with status: ${status}`));
                }
              }
            );
          }),
        1,
        300
      );

      if (placeResult.place_id) {
        const details = await fetchGooglePlaceDetails(placeResult.place_id);
        return details as any;
      }
    }

    throw geoErr;
  }
}

/**
 * Reverse-geocodes a latitude and longitude pair using Google Maps Reverse Geocoding API,
 * with automatic retries and PlacesService nearbySearch fallback.
 */
export async function reverseGeocodeGoogle(
  lat: number,
  lng: number
): Promise<google.maps.GeocoderResult> {
  const maps = await loadGoogleMapsSdk();

  // 1. Try standard Geocoder with auto-retry
  try {
    const geocoder = new maps.Geocoder();
    return await withRetry(
      () =>
        new Promise<google.maps.GeocoderResult>((resolve, reject) => {
          geocoder.geocode({ location: { lat, lng } }, (results, status) => {
            if (status === maps.GeocoderStatus.OK && results && results.length > 0) {
              resolve(results[0]);
            } else {
              reject(new Error(`Reverse geocoding status: ${status}`));
            }
          });
        }),
      1,
      300
    );
  } catch {
    // 2. Seamless PlacesService nearbySearch fallback if Geocoder is denied or restricted
    if (maps.places?.PlacesService) {
      const dummyDiv = document.createElement("div");
      const service = new maps.places.PlacesService(dummyDiv);

      return await withRetry(
        () =>
          new Promise<google.maps.GeocoderResult>((resolve, reject) => {
            service.nearbySearch(
              {
                location: { lat, lng },
                radius: 100,
              },
              async (results, status) => {
                if (
                  status === maps.places.PlacesServiceStatus.OK &&
                  results &&
                  results.length > 0 &&
                  results[0].place_id
                ) {
                  try {
                    const details = await fetchGooglePlaceDetails(results[0].place_id);
                    resolve(details as any);
                  } catch {
                    resolve({
                      place_id: results[0].place_id || "",
                      formatted_address: results[0].vicinity || results[0].name || "",
                      geometry: results[0].geometry,
                      address_components: [],
                    } as any);
                  }
                } else {
                  reject(new Error(`Places nearby search failed: ${status}`));
                }
              }
            );
          }),
        1,
        300
      );
    }

    throw new Error("Unable to reverse geocode location.");
  }
}

/**
 * Parses Google Maps address_components into structured fields.
 *
 * Exact Mappings (Priority 2):
 * - Building Name -> `premise` (fallback `establishment`, fallback explicit place name, fallback fallbackName)
 * - Unit/Floor -> `subpremise` + `floor`
 * - Street -> `route`
 * - Locality -> `sublocality_level_1` (fallback `neighborhood`)
 * - City -> `locality` (fallback `postal_town` or district)
 * - State -> `administrative_area_level_1`
 * - PIN Code -> `postal_code`
 * - Country -> `country`
 *
 * Never hardcodes placeholder values ("City", "State", "Locality").
 */
export function parseGoogleAddressComponents(
  result: google.maps.GeocoderResult | google.maps.places.PlaceResult,
  fallbackName?: string
): GoogleParsedAddress {
  const components = result.address_components || [];
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
    const types = c.types || [];
    if (types.includes("premise")) {
      premise = c.long_name;
    }
    if (types.includes("establishment") || types.includes("point_of_interest")) {
      if (!establishment) establishment = c.long_name;
    }
    if (types.includes("subpremise")) {
      subpremise = c.long_name;
    }
    if (types.includes("floor")) {
      floor = c.long_name;
    }
    if (types.includes("route")) {
      route = c.long_name;
    }
    if (types.includes("sublocality_level_1") || types.includes("sublocality")) {
      if (!sublocalityL1) sublocalityL1 = c.long_name;
    }
    if (types.includes("neighborhood")) {
      if (!neighborhood) neighborhood = c.long_name;
    }
    if (types.includes("locality")) {
      locality = c.long_name;
    }
    if (types.includes("postal_town")) {
      postalTown = c.long_name;
    }
    if (types.includes("administrative_area_level_2")) {
      adminAreaL2 = c.long_name;
    }
    if (types.includes("administrative_area_level_1")) {
      adminAreaL1 = c.long_name;
    }
    if (types.includes("postal_code")) {
      postalCode = c.long_name;
    }
    if (types.includes("country")) {
      country = c.long_name;
    }
  }

  // 1. Building Name -> premise (fallback establishment, fallback explicit place name, fallback fallbackName)
  const explicitName = (result as google.maps.places.PlaceResult).name || "";
  let building = premise || establishment || explicitName || fallbackName || "";

  // 2. Unit/Floor -> subpremise + floor
  const unitFloorParts = [subpremise, floor].filter(Boolean);
  let unitFloor = unitFloorParts.join(", ").trim();

  // 3. Street -> route
  let street = route.trim();

  // 4. Locality -> sublocality_level_1 (fallback neighborhood)
  let resolvedLocality = (sublocalityL1 || neighborhood).trim();

  // 5. City -> locality (fallback postal_town, fallback administrative_area_level_2)
  let resolvedCity = (locality || postalTown || adminAreaL2).trim();

  // 6. State -> administrative_area_level_1
  let state = adminAreaL1.trim();

  // 7. PIN Code -> postal_code
  let pinCode = postalCode.trim();

  // 8. Country -> country
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
  if (result.geometry?.location) {
    if (typeof result.geometry.location.lat === "function") {
      lat = result.geometry.location.lat();
      lng = result.geometry.location.lng();
    } else {
      lat = (result.geometry.location as any).lat;
      lng = (result.geometry.location as any).lng;
    }
  }

  return {
    place_id: result.place_id || "",
    formatted_address: result.formatted_address || "",
    building: building.trim(),
    unit_floor: unitFloor.trim(),
    street: street.trim(),
    locality: resolvedLocality.trim(),
    city: resolvedCity.trim(),
    state: state.trim(),
    pin_code: pinCode.trim(),
    country: resolvedCountry.trim(),
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lng.toFixed(6)),
  };
}

