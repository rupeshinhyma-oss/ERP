/**
 * Products master. Ported from masters-products.html.
 *
 * Notes on behaviour carried over:
 *  - Sub-Category options are scoped to the selected Category. The original
 *    called populateSubCategoryOptions() imperatively from the change handler
 *    and again from fillForm(); here the list derives from form.category_id.
 *  - Choosing an HSN code auto-fills Refund VAT % from that code's rate.
 *  - Packaging Unit CBM is computed live from L x W x H / 1,000,000 and the
 *    field stays read-only.
 *  - The payload sends both the `*_cm` dimension keys and the legacy bare
 *    `length`/`width`/`height` keys, and mirrors the Tally name into
 *    `product_name`, exactly as before.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLiveModule } from "@/lib/live/useLive";
import { useModalHistorySync } from "@/lib/hooks";
import { MasterPage, type FormState, type MasterPageHandle } from "@/components/MasterPage";
import { SideDrawer, DetailFieldGrid } from "@/components/SideDrawer";
import { ProductTradeHistoryDrawer } from "@/components/ProductTradeHistoryDrawer";
import { ItemPopoverCell } from "@/components/ItemPopoverCell";
import { SearchableFilterDropdown } from "@/components/SearchableDropdown";
import {
  MultiSelectField,
  SelectField,
  TextAreaField,
  TextField,
  autoTitleCase,
  nullIfBlank,
  numOrNull,
} from "@/components/fields";
import { API_ORIGIN, apiGet, apiPostMultipart } from "@/lib/api";
import { useLookup } from "@/lib/lookups";
import type {
  Brand,
  Hsn,
  Product,
  ProductCategory,
  ProductSubCategory,
  Uom,
} from "@/types";

const EMPTY: FormState = {
  product_code: "",
  product_name_tally: "",
  product_name_invoice: "",
  barcode: "",
  category_id: "",
  sub_category_id: "",
  brand_id: "",
  hsn_id: "",
  uom_id: "",
  secondary_uom_id: "",
  organization_id: "",
  supplier_id: "",
  organization_ids_json: "[]",
  branch_ids_json: "[]",
  purchase_vat_percent: "",
  refund_vat_percent: "",
  license_certificate_required: "",
  conversion_factor: "",
  specification: "",
  description: "",
  packaging_quantity: "",
  packaging_net_weight: "",
  packaging_gross_weight: "",
  length_cm: "",
  width_cm: "",
  height_cm: "",
  packaging_unit_cbm: "",
  color: "",
  material: "",
  minimum_order_quantity: "",
  reorder_level: "",
  standard_cost: "",
  standard_price: "",
  is_purchasable: "true",
  is_sellable: "true",
  status: "active",
  images_json: "[]",
  image_url: "",
  _editing_id: "",
  _initial_product_name_tally: "",
  _initial_product_code: "",
};


/** L x W x H in cm -> cubic metres, to 6dp. Blank unless all three are set. */
function computeCbm(length: string, width: string, height: string): string {
  const l = parseFloat(length) || 0;
  const w = parseFloat(width) || 0;
  const h = parseFloat(height) || 0;
  if (l > 0 && w > 0 && h > 0) {
    return ((l * w * h) / 1000000).toFixed(6);
  }
  return "";
}

export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  let clean = url.trim();
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1).trim();
  }
  if (!clean) return "";
  if (clean.startsWith("data:") || clean.startsWith("http://") || clean.startsWith("https://")) {
    return encodeURI(clean);
  }
  const fullUrl = `${API_ORIGIN}${clean.startsWith("/") ? "" : "/"}${clean}`;
  return encodeURI(fullUrl);
}



function OrgPopoverCell({ orgNames }: { orgNames: string[] }) {
  return (
    <ItemPopoverCell
      items={orgNames}
      icon="🏢"
      itemIcon="🏢"
      title="🏢 Organizations"
      badgeIcon="👁️"
      badgeColor="emerald"
      emptyText="—"
    />
  );
}

interface ProductIdentityFieldsProps {
  f: FormState;
  set: (key: string, value: string) => void;
  errors?: Record<string, string>;
  exactNameDuplicate: string | null;
  setExactNameDuplicate: (name: string | null) => void;
  exactCodeDuplicate: { code: string; name: string } | null;
  setExactCodeDuplicate: (info: { code: string; name: string } | null) => void;
  catalogProducts: Product[];
}

function ProductIdentityFields({
  f,
  set,
  errors = {},
  exactNameDuplicate,
  setExactNameDuplicate,
  exactCodeDuplicate,
  setExactCodeDuplicate,
  catalogProducts,
}: ProductIdentityFieldsProps) {
  const [isNameInputFocused, setIsNameInputFocused] = useState(false);
  const [lookupMatches, setLookupMatches] = useState<Array<{ id: string; name: string; code?: string; status?: string }>>([]);
  const nameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkDuplicateName = useCallback(
    (val: string) => {
      if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current);
      const trimmed = val.trim();
      if (!trimmed) {
        setExactNameDuplicate(null);
        return;
      }
      const cleanTyped = trimmed.toLowerCase().replace(/[\s-]/g, "");
      const editingId = (f._editing_id || "").trim().toLowerCase();
      const initialClean = (f._initial_product_name_tally || "").trim().toLowerCase().replace(/[\s-]/g, "");

      if (editingId && cleanTyped === initialClean) {
        setExactNameDuplicate(null);
        return;
      }

      // Fast check in local catalog
      const localMatch = catalogProducts.find((p) => {
        if (editingId && String(p.id).toLowerCase() === editingId) return false;
        const pName = (p.product_name_tally || p.product_name || "").toLowerCase().replace(/[\s-]/g, "");
        return pName === cleanTyped;
      });
      if (localMatch) {
        setExactNameDuplicate(localMatch.product_name_tally || localMatch.product_name || trimmed);
      } else {
        setExactNameDuplicate(null);
      }

      nameCheckTimer.current = setTimeout(async () => {
        try {
          const { data } = await apiGet<Array<{ id: string; name: string; code: string }>>(
            `/masters/products/names-lookup?search=${encodeURIComponent(trimmed)}&limit=25`
          );
          const list = data || [];
          setLookupMatches(list);
          const exact = list.find((p) => {
            if (editingId && String(p.id).toLowerCase() === editingId) return false;
            const pName = (p.name || "").toLowerCase().replace(/[\s-]/g, "");
            return pName === cleanTyped;
          });
          if (exact) {
            setExactNameDuplicate(exact.name || trimmed);
          } else {
            setExactNameDuplicate(null);
          }
        } catch {
          // ignore network error
        }
      }, 150);
    },
    [f._editing_id, f._initial_product_name_tally, catalogProducts, setExactNameDuplicate]
  );

  const checkDuplicateCode = useCallback(
    (val: string) => {
      if (codeCheckTimer.current) clearTimeout(codeCheckTimer.current);
      const trimmed = val.trim();
      if (!trimmed) {
        setExactCodeDuplicate(null);
        return;
      }
      const cleanCode = trimmed.toLowerCase();
      const editingId = (f._editing_id || "").trim().toLowerCase();
      const initialCodeClean = (f._initial_product_code || "").trim().toLowerCase();

      if (editingId && cleanCode === initialCodeClean) {
        setExactCodeDuplicate(null);
        return;
      }

      // Fast check in local catalog
      const localMatch = catalogProducts.find((p) => {
        if (editingId && String(p.id).toLowerCase() === editingId) return false;
        return (p.product_code || "").trim().toLowerCase() === cleanCode;
      });
      if (localMatch) {
        setExactCodeDuplicate({
          code: localMatch.product_code || trimmed,
          name: localMatch.product_name_tally || localMatch.product_name || "Existing Product",
        });
        return;
      }

      codeCheckTimer.current = setTimeout(async () => {
        try {
          const { data } = await apiGet<Array<{ id: string; name: string; code: string }>>(
            `/masters/products/names-lookup?search=${encodeURIComponent(trimmed)}&limit=25`
          );
          const list = data || [];
          const exact = list.find((p) => {
            if (editingId && String(p.id).toLowerCase() === editingId) return false;
            return (p.code || "").trim().toLowerCase() === cleanCode;
          });
          if (exact) {
            setExactCodeDuplicate({
              code: exact.code || trimmed,
              name: exact.name || "Existing Product",
            });
          } else {
            setExactCodeDuplicate(null);
          }
        } catch {
          // ignore network error
        }
      }, 150);
    },
    [f._editing_id, f._initial_product_code, catalogProducts, setExactCodeDuplicate]
  );

  useEffect(() => {
    return () => {
      if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current);
      if (codeCheckTimer.current) clearTimeout(codeCheckTimer.current);
    };
  }, []);

  const typed = (f.product_name_tally || "").trim();
  const cleanTyped = typed.toLowerCase().replace(/[\s-]/g, "");
  const editingId = (f._editing_id || "").trim().toLowerCase();

interface KnownProductSummary {
  id: string;
  name: string;
  code?: string;
  status?: string;
}

  // Combine catalogProducts and lookupMatches for complete reference view
  const allKnownProducts: KnownProductSummary[] = useMemo(() => {
    const map = new Map<string, KnownProductSummary>();
    for (const p of catalogProducts) {
      const name = (p.product_name_tally || p.product_name || "").trim();
      if (!name) continue;
      map.set(name.toLowerCase(), {
        id: String(p.id),
        name,
        code: p.product_code,
        status: p.status,
      });
    }
    for (const item of lookupMatches) {
      const name = (item.name || "").trim();
      if (!name) continue;
      if (!map.has(name.toLowerCase())) {
        map.set(name.toLowerCase(), {
          id: String(item.id),
          name,
          code: item.code,
        });
      }
    }
    return Array.from(map.values());
  }, [catalogProducts, lookupMatches]);

  const exact = useMemo<KnownProductSummary | null>(() => {
    if (!cleanTyped) return null;
    return allKnownProducts.find((p: KnownProductSummary) => {
      if (editingId && p.id.toLowerCase() === editingId) return false;
      const pClean = p.name.toLowerCase().replace(/[\s-]/g, "");
      return pClean === cleanTyped;
    }) || null;
  }, [cleanTyped, allKnownProducts, editingId]);

  const matches = useMemo<KnownProductSummary[]>(() => {
    return allKnownProducts
      .filter((p: KnownProductSummary) => {
        if (editingId && p.id.toLowerCase() === editingId) return false;
        if (!cleanTyped) return true;
        const pClean = p.name.toLowerCase().replace(/[\s-]/g, "");
        const cClean = (p.code || "").toLowerCase().replace(/[\s-]/g, "");
        return pClean.includes(cleanTyped) || cClean.includes(cleanTyped);
      })
      .sort((a: KnownProductSummary, b: KnownProductSummary) => {
        if (!cleanTyped) return 0;
        const aClean = a.name.toLowerCase().replace(/[\s-]/g, "");
        const bClean = b.name.toLowerCase().replace(/[\s-]/g, "");
        const aStarts = aClean.startsWith(cleanTyped);
        const bStarts = bClean.startsWith(cleanTyped);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }, [allKnownProducts, cleanTyped, editingId]);

  const hasNameError = Boolean(errors.product_name_tally || exactNameDuplicate);

  return (
    <>
      <div className="section-title">Identity</div>
      <div className="form-grid">
        <div className="field" style={{ position: "relative" }}>
          <label
            htmlFor="product_name_tally"
            style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
          >
            Product Name (As per Tally) <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <input
            id="product_name_tally"
            type="text"
            value={f.product_name_tally || ""}
            onChange={(e) => {
              const val = autoTitleCase(e.target.value, "product_name_tally");
              set("product_name_tally", val);
              checkDuplicateName(val);
            }}
            onFocus={(e) => {
              setIsNameInputFocused(true);
              if (!hasNameError) {
                e.target.style.borderColor = "#2563eb";
                e.target.style.boxShadow = "0 0 0 3px rgba(37, 99, 235, 0.15)";
              }
            }}
            onBlur={(e) => {
              setTimeout(() => setIsNameInputFocused(false), 200);
              if (!hasNameError) {
                e.target.style.borderColor = "#cbd5e1";
                e.target.style.boxShadow = "none";
              }
            }}
            placeholder="Search existing or type product name..."
            autoComplete="off"
            style={{
              width: "100%",
              height: "38px",
              padding: "0 12px",
              fontSize: "13px",
              borderRadius: "6px",
              border: hasNameError ? "1.5px solid #ef4444" : "1px solid #cbd5e1",
              backgroundColor: hasNameError ? "#fff5f5" : "#ffffff",
              boxShadow: hasNameError ? "0 0 0 3px rgba(239, 68, 68, 0.15)" : "none",
              color: "#0f172a",
              outline: "none",
              boxSizing: "border-box",
              transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            }}
          />

          {/* Floating Suggestion Dropdown (Untouchable / Non-selectable suggestions) */}
          {isNameInputFocused && matches.length > 0 && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                backgroundColor: "#ffffff",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.08)",
                zIndex: 100,
                maxHeight: "280px",
                overflowY: "auto",
                padding: 0,
              }}
            >
              {exact && (
                <div
                  style={{
                    padding: "8px 12px",
                    background: "#fef2f2",
                    borderBottom: "1px solid #fee2e2",
                    color: "#dc2626",
                    fontSize: "12px",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>⛔</span>
                  <span>Product "{exact.name}" already exists in Master! Cannot save duplicate.</span>
                </div>
              )}
              <div
                style={{
                  padding: "7px 12px",
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#64748b",
                  borderBottom: "1px solid #f1f5f9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "#f8fafc",
                }}
              >
                <span>Existing in Master ({matches.length})</span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    background: "#f1f5f9",
                    color: "#64748b",
                    padding: "1px 6px",
                    borderRadius: "4px",
                    textTransform: "none",
                  }}
                >
                  Reference Only (Non-selectable)
                </span>
              </div>
              <div style={{ padding: "4px 0" }}>
                {matches.map((p: KnownProductSummary) => {
                  const isThisExact = (p.name || "").trim().toLowerCase() === typed.toLowerCase();
                  return (
                    <div
                      key={p.id}
                      style={{
                        padding: "8px 12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: "12.5px",
                        color: isThisExact ? "#dc2626" : "#334155",
                        backgroundColor: isThisExact ? "#fff5f5" : "transparent",
                        borderLeft: isThisExact ? "3px solid #ef4444" : "3px solid transparent",
                        userSelect: "none",
                        pointerEvents: "none",
                        cursor: "default",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
                        <span style={{ color: "#94a3b8", fontSize: "13px" }}>📦</span>
                        <span style={{ fontWeight: isThisExact ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.name}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                        {p.code && (
                          <span
                            style={{
                              fontSize: "10.5px",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              background: "#f1f5f9",
                              color: "#475569",
                              fontWeight: 500,
                            }}
                          >
                            {p.code}
                          </span>
                        )}
                        {p.status && (
                          <span
                            style={{
                              fontSize: "10.5px",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              background: p.status === "active" ? "#ecfdf5" : "#f1f5f9",
                              color: p.status === "active" ? "#059669" : "#64748b",
                              fontWeight: 500,
                            }}
                          >
                            {p.status}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {errors.product_name_tally && !exactNameDuplicate && (
            <div style={{ color: "#ef4444", fontSize: "12px", fontWeight: 600, marginTop: "5px", display: "flex", alignItems: "center", gap: "4px" }}>
              <span>⚠️</span> {errors.product_name_tally}
            </div>
          )}
          {exactNameDuplicate && (
            <div style={{ marginTop: "6px", fontSize: "12.5px", color: "#dc2626", fontWeight: 600, display: "flex", alignItems: "center", gap: "5px" }}>
              <span>⚠️</span> Product "{exactNameDuplicate}" already exists!
            </div>
          )}
        </div>

        <TextField
          id="product_name_invoice"
          label="Product Name (As per Invoice)"
          maxLength={255}
          placeholder="Name for Tax Invoices"
          value={f.product_name_invoice}
          onChange={(v) => set("product_name_invoice", v)}
        />

        <div style={{ position: "relative" }}>
          <TextField
            id="product_code"
            label="Product Code"
            maxLength={50}
            placeholder="e.g. PRD-001"
            value={f.product_code}
            onChange={(v) => {
              set("product_code", v);
              checkDuplicateCode(v);
            }}
            error={errors.product_code}
          />
          {exactCodeDuplicate && (
            <div style={{ marginTop: "6px", fontSize: "12.5px", color: "#dc2626", fontWeight: 600, display: "flex", alignItems: "center", gap: "5px" }}>
              <span>⚠️</span> Product Code "{exactCodeDuplicate.code}" already exists (used by "{exactCodeDuplicate.name}")!
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** Loads a product's photos on demand when the edit form was opened from a lightweight list row. */
function LazyProductImages({ productId, set }: { productId: string; set: (key: string, value: string) => void }) {
  useEffect(() => {
    let active = true;
    (async () => {
      let images: string[] = [];
      try {
        const { data } = await apiGet<Product>(`/masters/products/${productId}`);
        images = Array.isArray(data?.images) && data.images.length > 0
          ? data.images
          : (data?.image_url ? [data.image_url] : []);
      } catch {
        /* fall through: show no photos rather than block editing */
      }
      if (!active) return;
      set("images_json", JSON.stringify(images));
      set("image_url", images[0] || "");
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  return (
    <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)" }}>Loading photos…</div>
  );
}

export function ProductsPage() {
  const categories = useLookup<ProductCategory>("/masters/product-categories", 250, true);
  const subCategories = useLookup<ProductSubCategory>("/masters/product-sub-categories", 500, true);
  const brands = useLookup<Brand>("/masters/brands", 250, true);
  const hsnCodes = useLookup<Hsn>("/masters/hsn", 250, true);
  const uoms = useLookup<Uom>("/masters/uom", 250, true);
  const organizations = useLookup<{ id: string; name: string; branches?: Array<{ id: string; name: string; code_prefix?: string; city?: string }> }>("/masters/company-list", 250, true);
  const [suppliersList, setSuppliersList] = useState<{ id: string; company_name: string; supplier_type?: string; brand_description?: string }[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [exactNameDuplicate, setExactNameDuplicate] = useState<string | null>(null);
  const [exactCodeDuplicate, setExactCodeDuplicate] = useState<{ code: string; name: string } | null>(null);
  const [liveReloadToken, setLiveReloadToken] = useState(0);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  /* Load suppliers list for Primary Supplier dropdown */
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await apiGet<{ id: string; company_name: string; brand_description?: string }[]>("/suppliers/lookup");
        if (active && Array.isArray(data) && data.length > 0) {
          setSuppliersList(data);
          return;
        }
      } catch {
        /* fallback */
      }
      try {
        const { data } = await apiGet<{ id: string; company_name: string; brand_description?: string }[]>("/inventory/product-prices/suppliers-lookup");
        if (active && Array.isArray(data) && data.length > 0) {
          setSuppliersList(data);
          return;
        }
      } catch {
        /* fallback to /suppliers */
      }
      try {
        const res = await apiGet<any>("/suppliers?page=1&page_size=100");
        if (active && res.data) {
          const list = Array.isArray(res.data) ? res.data : (res.data.items || []);
          setSuppliersList(list);
        }
      } catch (err) {
        console.error("Failed to load suppliers lookup:", err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  /* Live Real-time cross-tab synchronization for Products */
  useLiveModule("inventory", () => {
    setLiveReloadToken((k) => k + 1);
  });

  /* Preload initial products for instant duplicate name & code checking */
  const loadCatalogProducts = useCallback(async () => {
    try {
      const { data } = await apiGet<Array<{ id: string; name: string; code: string }>>(
        "/masters/products/names-lookup?limit=50"
      );
      if (Array.isArray(data)) {
        setCatalogProducts(
          data.map((d) => ({
            id: d.id,
            product_name: d.name,
            product_name_tally: d.name,
            product_code: d.code,
          })) as unknown as Product[]
        );
      }
    } catch (err) {
      console.error("Failed to load catalog products:", err);
    }
  }, []);

  useEffect(() => {
    loadCatalogProducts();
  }, [loadCatalogProducts, liveReloadToken]);

  const [categoryFilter, setCategoryFilter] = useState("");
  const [subCategoryFilter, setSubCategoryFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");

  const [drawerProduct, setDrawerProduct] = useState<Product | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const masterHandleRef = useState<{ current: MasterPageHandle | null }>(() => ({
    current: null,
  }))[0];


  // Ask the server to omit heavy base64 photos from table rows (fetched on demand).
  const extraFilters: Record<string, string> = { light_list: "true" };
  if (categoryFilter) extraFilters.category_id = categoryFilter;
  if (subCategoryFilter) extraFilters.sub_category_id = subCategoryFilter;
  if (brandFilter) extraFilters.brand_id = brandFilter;

  /** Fetches the product fresh and opens the detail drawer, matching openProductDetailView() in the source. */
  async function openProductDetailView(productId: string, initialProduct?: Product) {
    setSelectedImageIndex(0);
    setZoomImage(null);
    if (initialProduct) {
      setDrawerProduct(initialProduct);
      setDrawerLoading(false);
    } else {
      setDrawerLoading(true);
      setDrawerProduct(null);
    }
    try {
      const { data } = await apiGet<Product>(`/masters/products/${productId}`);
      setDrawerProduct(data);
    } catch (err) {
      if (!initialProduct) {
        alert(`Failed to load product detail: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setDrawerLoading(false);
    }
  }

  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkProductId = searchParams.get("id");
  const activeFetchProductIdRef = useRef<string | null>(null);

  const handleCloseDrawer = useCallback(() => {
    setDrawerProduct(null);
    setDrawerLoading(false);
    setZoomImage(null);
    setSelectedImageIndex(0);
    activeFetchProductIdRef.current = null;
    setSearchParams((prev) => {
      if (!prev.has("id")) return prev;
      const next = new URLSearchParams(prev);
      next.delete("id");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useModalHistorySync(Boolean(drawerProduct), handleCloseDrawer);

  useEffect(() => {
    const handleNavActiveClick = (e: Event) => {
      const customEvent = e as CustomEvent<{ key?: string; path?: string }>;
      if (customEvent.detail?.key === "masters-products") {
        handleCloseDrawer();
      }
    };
    window.addEventListener("erp:nav-active-click", handleNavActiveClick);
    return () => window.removeEventListener("erp:nav-active-click", handleNavActiveClick);
  }, [handleCloseDrawer]);

  // Universal search deep-link: `?id=` opens that product's detail drawer
  // directly, so clicking a Products result in the topbar search lands on
  // the actual record instead of just the bare list.
  useEffect(() => {
    if (!deepLinkProductId) return;
    if (activeFetchProductIdRef.current === deepLinkProductId) return;
    const targetId = deepLinkProductId;
    activeFetchProductIdRef.current = targetId;

    // Immediately replace URL in history so history.back() never returns to ?id=
    setSearchParams((prev) => {
      if (!prev.has("id")) return prev;
      const next = new URLSearchParams(prev);
      next.delete("id");
      return next;
    }, { replace: true });

    setDrawerLoading(true);
    setDrawerProduct(null);

    (async () => {
      try {
        const { data } = await apiGet<Product>(`/masters/products/${targetId}`);
        if (activeFetchProductIdRef.current === targetId) {
          setDrawerProduct(data);
        }
      } catch (err) {
        console.error("Failed to load product detail:", err);
      } finally {
        if (activeFetchProductIdRef.current === targetId) {
          setDrawerLoading(false);
        }
      }
    })();
  }, [deepLinkProductId, setSearchParams]);

  const masterPage = (
    <MasterPage<Product>
      activeKey="masters-products"
      apiBase="/masters/products"
      permissionPrefix="product"
      exportPermission="product.export"
      bulkActionPermission="product.bulk_action"
      liveModule="inventory"
      entityName="product"
      clientSideSearch={false}
      heading="Products Master"
      newButtonLabel="+ New Product"
      searchPlaceholder="Search code, name, barcode, or Sr. No..."
      reloadToken={String(liveReloadToken)}
      onItemsLoaded={setCatalogProducts}
      useFullPageForm={true}
      hideQuickAdd={true}
      extraFilters={extraFilters}
      toolbarExtras={
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px", width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>Category</label>
            <SearchableFilterDropdown
              value={categoryFilter || null}
              onChange={(val) => {
                setCategoryFilter(val || "");
                if (!val) setSubCategoryFilter("");
              }}
              placeholder="All"
              allLabel="All"
              fetchOptions={async (term) => {
                const q = term.toLowerCase().trim();
                return categories.items
                  .filter((c) => !q || c.name.toLowerCase().includes(q))
                  .map((c) => ({ value: c.id, label: c.name }));
              }}
              fetchLabelForValue={async (val) => {
                const c = categories.items.find((item) => item.id === val);
                return c ? c.name : "";
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>Sub Category</label>
            <SearchableFilterDropdown
              value={subCategoryFilter || null}
              onChange={(val) => setSubCategoryFilter(val || "")}
              placeholder="All"
              allLabel="All"
              fetchOptions={async (term) => {
                const q = term.toLowerCase().trim();
                const pool = categoryFilter
                  ? subCategories.items.filter((sc) => sc.category_id === categoryFilter)
                  : subCategories.items;
                return pool
                  .filter((sc) => !q || sc.name.toLowerCase().includes(q) || (sc.code && sc.code.toLowerCase().includes(q)))
                  .map((sc) => ({ value: sc.id, label: sc.name }));
              }}
              fetchLabelForValue={async (val) => {
                const sc = subCategories.items.find((item) => item.id === val);
                return sc ? sc.name : "";
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>Brand</label>
            <SearchableFilterDropdown
              value={brandFilter || null}
              onChange={(val) => setBrandFilter(val || "")}
              placeholder="All"
              allLabel="All"
              fetchOptions={async (term) => {
                const q = term.toLowerCase().trim();
                return brands.items
                  .filter((b) => !q || b.name.toLowerCase().includes(q))
                  .map((b) => ({ value: b.id, label: b.name }));
              }}
              fetchLabelForValue={async (val) => {
                const b = brands.items.find((item) => item.id === val);
                return b ? b.name : "";
              }}
            />
          </div>
        </div>
      }
      /**
       * The shipped thead carried 11 middle headers for only 10 rendered cells
       * -- "Category / Sub-Cat." has no matching data cell, so every header from
       * it rightwards sits one column left of its data. Reproduced as-is; see
       * the handover notes if you'd rather it were corrected.
       */
      columnHeaders={[
        "Product Name (As Per Tally)",
        "Product Code",
        "Brand",
        "Sub Category",
        "Supplier Brand",
        "HSN Code",
        "UOM",
        "Organization",
        "Pack. Qty",
        "Pack. Gross Weight",
        "Pack. Unit CBM",
      ]}
      actionsHeader="Action"
      columns={[
        {
          header: "Product Name (Tally)",
          sortValue: (p) => p.product_name_tally || p.product_name || "",
          render: (p) => {
            const name = p.product_name_tally || p.product_name || "—";
            const hasLicense = Boolean(p.license_certificate_required && p.license_certificate_required.trim());
            return (
              <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", maxWidth: "360px", minWidth: "240px", flexWrap: "nowrap" }}>
                <a
                  href="#"
                  className="cell-primary"
                  title={name}
                  style={{
                    color: hasLicense ? "#dc2626" : "var(--color-primary)",
                    fontWeight: 700,
                    maxWidth: hasLicense ? "220px" : "320px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    openProductDetailView(p.id, p);
                  }}
                >
                  {name}
                </a>
                {hasLicense && (
                  <span
                    title={`License / Certificate Required: ${p.license_certificate_required}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      background: "#fee2e2",
                      color: "#b91c1c",
                      border: "1px solid #f87171",
                      borderRadius: "4px",
                      padding: "2px 7px",
                      fontSize: "10.5px",
                      fontWeight: 800,
                      letterSpacing: "0.4px",
                      boxShadow: "0 1px 2px rgba(220, 38, 38, 0.15)",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    <span>⚠️</span>
                    <span>LICENSE NEEDED</span>
                  </span>
                )}
              </div>
            );
          },
        },
        {
          header: "Product Code",
          sortValue: (p) => p.product_code || "",
          render: (p) => (
            <span title={p.product_code || ""} style={{ fontWeight: 500, fontFamily: "monospace", fontSize: "13px" }}>
              {p.product_code || "—"}
            </span>
          ),
        },
        {
          header: "Brand",
          sortValue: (p) => brands.items.find((x) => x.id === p.brand_id)?.name || "",
          render: (p) => {
            const b = brands.items.find((x) => x.id === p.brand_id);
            const name = b ? `${b.name}${b.status === "inactive" ? " (Inactive)" : ""}` : "—";
            return (
              <span className="cell-truncate" title={name} style={{ maxWidth: "130px" }}>
                {name}
              </span>
            );
          },
        },
        {
          header: "Sub-Category",
          sortValue: (p) => subCategories.items.find((x) => x.id === p.sub_category_id)?.name || "",
          render: (p) => {
            const sc = subCategories.items.find((x) => x.id === p.sub_category_id);
            const name = sc ? `${sc.name}${sc.status === "inactive" ? " (Inactive)" : ""}` : "—";
            return (
              <span className="cell-truncate" title={name} style={{ maxWidth: "180px", color: "#334155" }}>
                {name}
              </span>
            );
          },
        },
        {
          header: "Supplier Brand",
          sortValue: (p) => {
            const s = suppliersList.find((x) => x.id === p.supplier_id);
            return s?.brand_description?.trim() || p.supplier_name || s?.company_name || "";
          },
          render: (p) => {
            const s = suppliersList.find((x) => x.id === p.supplier_id);
            const brand = s?.brand_description?.trim();
            const comp = s?.company_name?.trim();
            if (brand) {
              const showComp = Boolean(comp && comp.toLowerCase() !== brand.toLowerCase());
              return (
                <span
                  className="cell-truncate"
                  title={showComp ? `${brand} (${comp})` : brand}
                  style={{ maxWidth: "190px", display: "inline-block" }}
                >
                  <strong style={{ fontWeight: 700, color: "#0f172a" }}>{brand}</strong>
                  {showComp && (
                    <span style={{ color: "#64748b", marginLeft: "4px", fontSize: "12px" }}>({comp})</span>
                  )}
                </span>
              );
            }
            const fallback = p.supplier_name || comp;
            return fallback ? (
              <span className="cell-truncate" title={fallback} style={{ maxWidth: "160px", color: "#334155", fontWeight: 400 }}>
                {fallback}
              </span>
            ) : (
              <span style={{ color: "#94a3b8" }}>—</span>
            );
          },
        },
        {
          header: "HSN Code",
          sortValue: (p) => hsnCodes.items.find((x) => x.id === p.hsn_id)?.code || "",
          render: (p) => {
            const code = hsnCodes.items.find((x) => x.id === p.hsn_id)?.code ?? "—";
            return (
              <span title={code} style={{ fontFamily: "monospace", fontSize: "12.5px" }}>
                {code}
              </span>
            );
          },
        },
        {
          header: "UOM",
          sortValue: (p) => uoms.items.find((x) => x.id === p.uom_id)?.code || "",
          render: (p) => {
            const u = uoms.items.find((x) => x.id === p.uom_id);
            const label = u ? `${u.name} (${u.code})` : "—";
            return <span title={label}>{u ? u.code : "—"}</span>;
          },
        },
        {
          header: "Organization",
          sortValue: (p) => {
            const orgIds = p.organization_ids && p.organization_ids.length > 0
              ? p.organization_ids
              : (p.organization_id ? [p.organization_id] : []);
            return orgIds
              .map((id) => organizations.items.find((x) => x.id === id)?.name)
              .filter(Boolean)
              .join(", ");
          },
          render: (p) => {
            const orgIds = p.organization_ids && p.organization_ids.length > 0
              ? p.organization_ids
              : (p.organization_id ? [p.organization_id] : []);
            if (!orgIds.length) return <span style={{ color: "#94a3b8" }}>—</span>;
            const names = orgIds
              .map((id) => organizations.items.find((x) => x.id === id)?.name)
              .filter(Boolean) as string[];
            return <OrgPopoverCell orgNames={names} />;
          },
        },
        {
          header: "Pkg Qty",
          sortValue: (p) => p.packaging_quantity ?? 0,
          render: (p) => (p.packaging_quantity != null ? p.packaging_quantity : "—"),
        },
        {
          header: "Gross Wt (kg)",
          sortValue: (p) => p.packaging_gross_weight ?? 0,
          render: (p) => (p.packaging_gross_weight != null ? p.packaging_gross_weight : "—"),
        },
        {
          header: "Unit CBM",
          sortValue: (p) => p.packaging_unit_cbm ?? 0,
          render: (p) =>
            p.packaging_unit_cbm != null ? Number(p.packaging_unit_cbm).toFixed(6) : "—",
        },
      ]}
      importHeaders={[
        { key: "Product Name (As Per Tally)", label: "Product Name (As Per Tally)", required: true },
        { key: "Product Code", label: "Product Code" },
        { key: "Brand", label: "Brand" },
        { key: "Category", label: "Category", required: true },
        { key: "Sub Category", label: "Sub Category", required: true },
        { key: "HSN Code", label: "HSN Code", required: true },
        { key: "UOM", label: "UOM", required: true },
        { key: "Pack. Qty", label: "Packaging Quantity", required: true },
        { key: "Pack. Net Weight", label: "Packaging Net Weight (kg)" },
        { key: "Pack. Gross Weight", label: "Packaging Gross Weight (kg)", required: true },
        { key: "Length (cm)", label: "Length (cm)" },
        { key: "Width (cm)", label: "Width (cm)" },
        { key: "Height (cm)", label: "Height (cm)" },
        { key: "Pack. Unit CBM", label: "Packaging Unit CBM", required: true },
        { key: "Purchase VAT %", label: "Purchase VAT %" },
        { key: "Refund VAT %", label: "Refund VAT %" },
        { key: "Compliance & License Requirements", label: "Compliance & License Requirements" },
        { key: "Specification", label: "Specification" },
        { key: "Status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => {
        const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
        setExactNameDuplicate(null);
        setExactCodeDuplicate(null);
        return {
          product_code: str(item?.product_code),
          product_name_tally: str(item ? item.product_name_tally || item.product_name : ""),
          product_name_invoice: str(item?.product_name_invoice),
          barcode: str(item?.barcode),
          category_id: str(item?.category_id),
          sub_category_id: str(item?.sub_category_id),
          brand_id: str(item?.brand_id),
          hsn_id: str(item?.hsn_id),
          uom_id: str(item?.uom_id),
          secondary_uom_id: str(item?.secondary_uom_id),
          organization_id: str(item?.organization_id),
          supplier_id: str(item?.supplier_id),
          organization_ids_json: JSON.stringify(
            item
              ? (item.organization_ids && item.organization_ids.length > 0
                ? item.organization_ids
                : (item.organization_id ? [item.organization_id] : []))
              : []
          ),
          branch_ids_json: JSON.stringify(item?.branch_ids || []),
          purchase_vat_percent: str(item?.purchase_vat_percent),
          refund_vat_percent: str(item?.refund_vat_percent),
          license_certificate_required: str(item?.license_certificate_required),
          conversion_factor: str(item?.conversion_factor),
          specification: str(item?.specification),
          description: str(item?.description),
          images_json: item && item.images_omitted && !(Array.isArray(item.images) && item.images.length > 0)
            ? "__lazy__"
            : JSON.stringify(item ? (Array.isArray(item.images) && item.images.length > 0 ? item.images : (item.image_url ? [item.image_url] : [])) : []),
          image_url: str(item ? item.image_url || (item.images && item.images[0]) : ""),
          packaging_quantity: str(item?.packaging_quantity),
          packaging_net_weight: str(item?.packaging_net_weight),
          packaging_gross_weight: str(item?.packaging_gross_weight),
          length_cm: str(item ? item.length_cm ?? item.length : ""),
          width_cm: str(item ? item.width_cm ?? item.width : ""),
          height_cm: str(item ? item.height_cm ?? item.height : ""),
          packaging_unit_cbm: str(item?.packaging_unit_cbm),
          color: str(item?.color),
          material: str(item?.material),
          minimum_order_quantity: str(item?.minimum_order_quantity),
          reorder_level: str(item?.reorder_level),
          standard_cost: str(item?.standard_cost),
          standard_price: str(item?.standard_price),
          is_purchasable: item ? String(item.is_purchasable) : "true",
          is_sellable: item ? String(item.is_sellable) : "true",
          status: item?.status ?? "active",
          _editing_id: item?.id ? String(item.id) : "",
          _initial_product_name_tally: str(item ? item.product_name_tally || item.product_name : ""),
          _initial_product_code: str(item?.product_code),
        };
      }}
      toPayload={(f) => {
        const l = numOrNull(f.length_cm);
        const w = numOrNull(f.width_cm);
        const h = numOrNull(f.height_cm);
        const cbm =
          l && w && h && l > 0 && w > 0 && h > 0
            ? Number(((l * w * h) / 1000000).toFixed(6))
            : numOrNull(f.packaging_unit_cbm);

        if (!f.category_id) throw new Error("Please select a Category.");
        if (!f.sub_category_id) throw new Error("Please select a Sub-Category.");
        if (!f.hsn_id) throw new Error("Please select a HSN Code.");
        if (!f.uom_id) throw new Error("Please select a Primary UOM.");
        if (numOrNull(f.packaging_quantity) === null) throw new Error("Packaging Quantity (unit) is required.");

        const grossWeight = numOrNull(f.packaging_gross_weight);
        if (grossWeight === null || grossWeight <= 0) {
          throw new Error("Packaging Gross Weight (kg) is required and must be greater than 0.");
        }

        if (cbm === null || cbm <= 0) {
          throw new Error("Packaging Unit CBM is required (enter Length, Width, Height to auto-calculate, or enter Packaging Unit CBM directly).");
        }

        // A secondary UOM identical to the primary carries no information.
        let secUomId: string | null = f.secondary_uom_id || null;
        if (secUomId === f.uom_id) secUomId = null;

        const tallyName = f.product_name_tally.trim();
        if (!tallyName) throw new Error("Product Name (As per Tally) is required.");

        if (exactNameDuplicate) {
          throw new Error(`Product "${exactNameDuplicate}" already exists in Product Master! Duplicate products are not allowed.`);
        }
        if (exactCodeDuplicate) {
          throw new Error(`Product Code "${exactCodeDuplicate.code}" already exists in Product Master (used by "${exactCodeDuplicate.name}")! Duplicate Product Code is not allowed.`);
        }

        const cleanTally = tallyName.toLowerCase().replace(/[\s-]/g, "");
        const editingId = (f._editing_id || "").trim().toLowerCase();
        const initialClean = (f._initial_product_name_tally || "").trim().toLowerCase().replace(/[\s-]/g, "");

        if (!editingId || cleanTally !== initialClean) {
          const duplicate = catalogProducts.find((p) => {
            if (editingId && String(p.id).toLowerCase() === editingId) return false;
            const pName = (p.product_name_tally || p.product_name || "").toLowerCase().replace(/[\s-]/g, "");
            return pName === cleanTally;
          });

          if (duplicate) {
            throw new Error(`Product "${tallyName}" already exists in Product Master! Duplicate products are not allowed.`);
          }
        }

        const codeClean = (f.product_code || "").trim().toLowerCase();
        const initialCodeClean = (f._initial_product_code || "").trim().toLowerCase();

        if (codeClean && (!editingId || codeClean !== initialCodeClean)) {
          const duplicateCode = catalogProducts.find((p) => {
            if (editingId && String(p.id).toLowerCase() === editingId) return false;
            const pCode = (p.product_code || "").trim().toLowerCase();
            return pCode === codeClean;
          });
          if (duplicateCode) {
            throw new Error(`Product Code "${f.product_code}" already exists in Product Master (used by "${duplicateCode.product_name_tally || duplicateCode.product_name}")! Duplicate Product Code is not allowed.`);
          }
        }

        return {
          product_code: nullIfBlank(f.product_code),
          product_name_tally: tallyName,
          product_name_invoice: nullIfBlank(f.product_name_invoice),
          product_name: tallyName,
          barcode: nullIfBlank(f.barcode),
          category_id: f.category_id,
          sub_category_id: f.sub_category_id || null,
          brand_id: f.brand_id || null,
          hsn_id: f.hsn_id || null,
          uom_id: f.uom_id,
          secondary_uom_id: secUomId,
          supplier_id: f.supplier_id || null,

          organization_id: (() => {
            try {
              const list = JSON.parse(f.organization_ids_json || "[]");
              return list[0] || null;
            } catch {
              return f.organization_id || null;
            }
          })(),
          organization_ids: (() => {
            try { return JSON.parse(f.organization_ids_json || "[]"); }
            catch { return []; }
          })(),
          branch_ids: (() => {
            try { return JSON.parse(f.branch_ids_json || "[]"); }
            catch { return []; }
          })(),
          purchase_vat_percent: numOrNull(f.purchase_vat_percent) ?? 0,
          refund_vat_percent: numOrNull(f.refund_vat_percent) ?? 0,
          license_certificate_required: nullIfBlank(f.license_certificate_required),
          conversion_factor: numOrNull(f.conversion_factor),
          specification: nullIfBlank(f.specification),
          description: nullIfBlank(f.description),
          // "__lazy__" = photos were omitted from the list row and never loaded: leave them untouched.
          ...(f.images_json === "__lazy__"
            ? {}
            : {
                images: (() => {
                  try { return JSON.parse(f.images_json || "[]"); }
                  catch { return f.image_url ? [f.image_url] : []; }
                })(),
                image_url: nullIfBlank(f.image_url),
              }),
          packaging_quantity: numOrNull(f.packaging_quantity),
          packaging_net_weight: numOrNull(f.packaging_net_weight),
          packaging_gross_weight: numOrNull(f.packaging_gross_weight),
          length_cm: l,
          width_cm: w,
          height_cm: h,
          length: l,
          width: w,
          height: h,
          packaging_unit_cbm: cbm,
          color: nullIfBlank(f.color),
          material: nullIfBlank(f.material),
          minimum_order_quantity: numOrNull(f.minimum_order_quantity),
          reorder_level: numOrNull(f.reorder_level),
          standard_cost: numOrNull(f.standard_cost),
          standard_price: numOrNull(f.standard_price),
          is_purchasable: f.is_purchasable === "true",
          is_sellable: f.is_sellable === "true",
          status: f.status,
        };
      }}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.product_name_tally?.trim()) {
          errs.product_name_tally = "Product Name (As per Tally) is required.";
        } else if (exactNameDuplicate) {
          errs.product_name_tally = `Product "${exactNameDuplicate}" already exists!`;
        }
        if (exactCodeDuplicate) {
          errs.product_code = `Product Code "${exactCodeDuplicate.code}" already exists!`;
        }
        if (!f.category_id) {
          errs.category_id = "Please select a Category.";
        }
        if (!f.sub_category_id) {
          errs.sub_category_id = "Please select a Sub-Category.";
        }
        if (!f.hsn_id) {
          errs.hsn_id = "Please select a HSN Code.";
        }
        if (!f.uom_id) {
          errs.uom_id = "Please select a Primary UOM.";
        }
        if (numOrNull(f.packaging_quantity) === null) {
          errs.packaging_quantity = "Packaging Quantity (unit) is required.";
        }
        const grossWeight = numOrNull(f.packaging_gross_weight);
        if (grossWeight === null || grossWeight <= 0) {
          errs.packaging_gross_weight = "Packaging Gross Weight (kg) is required.";
        }
        const l = numOrNull(f.length_cm);
        const w = numOrNull(f.width_cm);
        const h = numOrNull(f.height_cm);
        const cbm =
          l && w && h && l > 0 && w > 0 && h > 0
            ? Number(((l * w * h) / 1000000).toFixed(6))
            : numOrNull(f.packaging_unit_cbm);
        if (cbm === null || cbm <= 0) {
          errs.packaging_unit_cbm = "Packaging Unit CBM is required.";
        }
        return errs;
      }}
      renderFields={(f, set, errors = {}) => {
        const scopedSubCategories = f.category_id
          ? subCategories.items.filter((sc) => sc.category_id === f.category_id && (sc.status === "active" || sc.id === f.sub_category_id))
          : [];

        /** Dimension change also refreshes the read-only CBM preview. */
        const setDimension = (id: "length_cm" | "width_cm" | "height_cm", value: string) => {
          const next = { length_cm: f.length_cm, width_cm: f.width_cm, height_cm: f.height_cm };
          next[id] = value;
          set(id, value);
          const cbm = computeCbm(next.length_cm, next.width_cm, next.height_cm);
          if (cbm) set("packaging_unit_cbm", cbm);
        };

        return (
          <>
            <ProductIdentityFields
              f={f}
              set={set}
              errors={errors}
              exactNameDuplicate={exactNameDuplicate}
              setExactNameDuplicate={setExactNameDuplicate}
              exactCodeDuplicate={exactCodeDuplicate}
              setExactCodeDuplicate={setExactCodeDuplicate}
              catalogProducts={catalogProducts}
            />

            <div className="section-title">Classification, Sourcing &amp; Tax</div>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              {/* Row 1: Brand, Category, Sub-Category, Primary Supplier */}
              <SelectField id="brand_id" label="Brand" value={f.brand_id} onChange={(v) => set("brand_id", v)} error={errors.brand_id}>
                <option value="">-- Select Brand --</option>
                {brands.items
                  .filter((b) => b.status === "active" || b.id === f.brand_id)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}{b.status === "inactive" ? " (Inactive)" : ""}
                    </option>
                  ))}
              </SelectField>
              <SelectField
                id="category_id"
                label="Category *"
                required
                value={f.category_id}
                error={errors.category_id}
                onChange={(v) => {
                  set("category_id", v);
                  set("sub_category_id", "");
                }}
              >
                <option value="">-- Select Category --</option>
                {categories.items
                  .filter((c) => c.status === "active" || c.id === f.category_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.status === "inactive" ? " (Inactive)" : ""}
                    </option>
                  ))}
              </SelectField>
              <SelectField
                id="sub_category_id"
                label="Sub-Category *"
                required
                disabled={!f.category_id}
                value={f.sub_category_id}
                onChange={(v) => set("sub_category_id", v)}
                error={errors.sub_category_id}
              >
                <option value="">
                  {f.category_id ? "-- Select Sub-Category --" : "-- Please select Category first --"}
                </option>
                {f.category_id
                  ? scopedSubCategories.map((sc) => (
                      <option key={sc.id} value={sc.id}>
                        {sc.name}{sc.status === "inactive" ? " (Inactive)" : ""}
                      </option>
                    ))
                  : null}
              </SelectField>
              <SelectField
                id="supplier_id"
                label="Supplier Brand"
                value={f.supplier_id}
                onChange={(v) => set("supplier_id", v)}
              >
                <option value="">-- Select Supplier Brand (Optional) --</option>
                {suppliersList.map((s) => {
                  const brand = s.brand_description?.trim();
                  const comp = s.company_name?.trim();
                  const hasBrand = Boolean(brand);
                  const showCompInParens = Boolean(hasBrand && comp && comp.toLowerCase() !== brand!.toLowerCase());
                  const searchLabel = hasBrand ? (showCompInParens ? `${brand} (${comp})` : brand!) : (comp || "");

                  return (
                    <option key={s.id} value={s.id} label={searchLabel}>
                      {hasBrand ? (
                        <span>
                          <strong style={{ fontWeight: 700, color: "#0f172a" }}>{brand}</strong>
                          {showCompInParens && (
                            <span style={{ color: "#64748b", marginLeft: "5px" }}>({comp})</span>
                          )}
                        </span>
                      ) : (
                        <span>{comp}</span>
                      )}
                    </option>
                  );
                })}
              </SelectField>

              {/* Row 2: HSN Code, Purchase VAT %, Refund VAT %, Organization (spans 2 columns) */}
              <SelectField
                id="hsn_id"
                label="HSN Code *"
                value={f.hsn_id}
                error={errors.hsn_id}
                onChange={(v) => {
                  set("hsn_id", v);
                  const picked = hsnCodes.items.find((h) => h.id === v);
                  set("purchase_vat_percent", String(picked?.purchase_vat_percent ?? 0));
                  set("refund_vat_percent", String(picked?.refund_vat_percent ?? 0));
                }}
              >
                <option value="">-- Select HSN Code --</option>
                {hsnCodes.items.map((h) => (
                  <option key={h.id} value={h.id}>
                    {`${h.code} - ${h.description || ""} (Purchase VAT: ${h.purchase_vat_percent || 0}%, Refund VAT: ${h.refund_vat_percent || 0}%)`}
                  </option>
                ))}
              </SelectField>
              <TextField id="purchase_vat_percent" label="Purchase VAT %" type="number" step="0.01" min={0} max={100} placeholder="Auto from HSN or manual" value={f.purchase_vat_percent} onChange={(v) => set("purchase_vat_percent", v)} />
              <TextField id="refund_vat_percent" label="Refund VAT %" type="number" step="0.01" min={0} max={100} placeholder="Auto from HSN or manual" value={f.refund_vat_percent} onChange={(v) => set("refund_vat_percent", v)} />
              <div style={{ gridColumn: "span 2" }}>
                <MultiSelectField
                  id="organization_ids_json"
                  label="Organization"
                  placeholder="-- Select Organizations --"
                  values={(() => {
                    try { return JSON.parse(f.organization_ids_json || "[]"); }
                    catch { return []; }
                  })()}
                  options={organizations.items.map((org) => ({ id: org.id, name: org.name }))}
                  onChange={(newVals) => {
                    set("organization_ids_json", JSON.stringify(newVals));
                    set("organization_id", newVals[0] || "");

                    // Automatically check / pre-select all branches belonging to the selected organization(s)
                    const selectedOrgs = organizations.items.filter((org) => newVals.includes(org.id));
                    const autoBranchIds: string[] = selectedOrgs.flatMap((org: any) => {
                      const branches: any[] = org.branches || [];
                      return branches.map((b: any) => b.id || `${org.id}_${b.name}`);
                    });
                    set("branch_ids_json", JSON.stringify(autoBranchIds));
                  }}
                />
              </div>

              {/* Dependent Branch Selection */}
              {(() => {
                const selectedOrgIds: string[] = (() => {
                  try { return JSON.parse(f.organization_ids_json || "[]"); }
                  catch { return []; }
                })();
                const selectedOrgs = organizations.items.filter((org) => selectedOrgIds.includes(org.id));
                const availableBranchOptions: { id: string; name: string }[] = selectedOrgs.flatMap((org: any) => {
                  const brList: any[] = org.branches || [];
                  return brList.map((b: any) => ({
                    id: b.id || `${org.id}_${b.name}`,
                    name: `${org.name} — ${b.name}${b.code_prefix ? ` (${b.code_prefix})` : ""}`,
                  }));
                });

                return (
                  <div className="form-grid" style={{ gridTemplateColumns: "1fr", marginTop: "14px" }}>
                    <MultiSelectField
                      id="branch_ids_json"
                      label="Branches / Operating Locations"
                      placeholder={availableBranchOptions.length > 0 ? "-- Select Branches --" : "-- Select Organization First --"}
                      values={(() => {
                        try { return JSON.parse(f.branch_ids_json || "[]"); }
                        catch { return []; }
                      })()}
                      options={availableBranchOptions}
                      onChange={(newVals) => set("branch_ids_json", JSON.stringify(newVals))}
                    />
                  </div>
                );
              })()}
            </div>

            <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <div>
                <div className="section-title" style={{ marginTop: 0 }}>Compliance &amp; License Requirements</div>
                <TextAreaField
                  id="license_certificate_required"
                  label="Compliance &amp; License Requirements"
                  rows={3}
                  placeholder="e.g. Import License, Drug Certificate. Highlighted RED in Inquiry if set."
                  value={f.license_certificate_required}
                  onChange={(v) => set("license_certificate_required", v)}
                />
              </div>
              <div>
                <div className="section-title" style={{ marginTop: 0 }}>Specifications</div>
                <TextAreaField
                  id="specification"
                  label="Specification"
                  rows={3}
                  placeholder="Enter detailed product specifications..."
                  value={f.specification}
                  onChange={(v) => set("specification", v)}
                />
              </div>
            </div>

            <div className="section-title">Packaging &amp; Physical Attributes</div>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <SelectField id="uom_id" label="UOM (Unit of Measure) *" required value={f.uom_id} onChange={(v) => set("uom_id", v)} error={errors.uom_id}>
                <option value="">-- Select UOM --</option>
                {uoms.items.map((u) => (
                  <option key={u.id} value={u.id}>
                    {`${u.name} (${u.code})`}
                  </option>
                ))}
              </SelectField>
              <TextField id="packaging_quantity" label="Packaging Quantity (unit) *" required type="number" step="0.001" min={0} value={f.packaging_quantity} onChange={(v) => set("packaging_quantity", v)} error={errors.packaging_quantity} />
              <TextField id="packaging_net_weight" label="Packaging Net Weight (kg)" type="number" step="0.001" min={0} value={f.packaging_net_weight} onChange={(v) => set("packaging_net_weight", v)} />
              <TextField id="packaging_gross_weight" label="Packaging Gross Weight (kg) *" required type="number" step="0.001" min={0.001} value={f.packaging_gross_weight} onChange={(v) => set("packaging_gross_weight", v)} error={errors.packaging_gross_weight} />
            </div>


            <div className="section-title" style={{ marginTop: "16px" }}>Dimensions For CBM</div>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <TextField id="length_cm" label="Length (cm)" type="number" step="0.001" min={0} className="cbm-calc" value={f.length_cm} onChange={(v) => setDimension("length_cm", v)} />
              <TextField id="width_cm" label="Width (cm)" type="number" step="0.001" min={0} className="cbm-calc" value={f.width_cm} onChange={(v) => setDimension("width_cm", v)} />
              <TextField id="height_cm" label="Height (cm)" type="number" step="0.001" min={0} className="cbm-calc" value={f.height_cm} onChange={(v) => setDimension("height_cm", v)} />
              <TextField
                id="packaging_unit_cbm"
                label="Packaging Unit CBM *"
                required
                type="number"
                step="0.000001"
                min={0.000001}
                placeholder="Auto-calculated or enter directly"
                value={f.packaging_unit_cbm}
                onChange={(v) => set("packaging_unit_cbm", v)}
                error={errors.packaging_unit_cbm}
              />
            </div>

            <div className="section-title">Image Of Product (Max 5 images, &lt;5MB each)</div>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <label style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
                  Product Images (Photos)
                </label>
                {f.images_json === "__lazy__" && (
                  <LazyProductImages productId={f._editing_id} set={set} />
                )}
                {(() => {
                  let imageList: string[] = [];
                  try {
                    imageList = JSON.parse(f.images_json || "[]");
                  } catch {
                    imageList = f.image_url ? [f.image_url] : [];
                  }

                  return (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "center" }}>
                      {imageList.map((imgUrl, index) => (
                        <div
                          key={index}
                          style={{
                            position: "relative",
                            width: "110px",
                            height: "110px",
                            borderRadius: "8px",
                            border: "1px solid #cbd5e0",
                            background: "#f8fafc",
                            overflow: "hidden",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                          }}
                        >
                          <img src={resolveImageUrl(imgUrl)} alt={`Product Preview ${index + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          <button
                            type="button"
                            style={{
                              position: "absolute",
                              top: "4px",
                              right: "4px",
                              background: "rgba(220, 38, 38, 0.9)",
                              color: "#ffffff",
                              border: "none",
                              borderRadius: "50%",
                              width: "22px",
                              height: "22px",
                              cursor: "pointer",
                              fontSize: "12px",
                              fontWeight: "bold",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                            }}
                            title="Remove Image"
                            onClick={() => {
                              const updated = imageList.filter((_, i) => i !== index);
                              set("images_json", JSON.stringify(updated));
                              set("image_url", updated[0] || "");
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}

                      {imageList.length < 5 && (
                        <div>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            id="product_multi_image_file"
                            style={{ display: "none" }}
                            onChange={async (e) => {
                              const rawFiles = Array.from(e.target.files || []);
                              if (rawFiles.length === 0) return;

                              const availableSlots = 5 - imageList.length;
                              if (availableSlots <= 0) {
                                alert("Maximum limit of 5 images per product reached.");
                                e.target.value = "";
                                return;
                              }

                              if (rawFiles.length > availableSlots) {
                                alert(`You selected ${rawFiles.length} images, but only ${availableSlots} more image(s) can be added (max 5 total).`);
                              }

                              const filesToProcess = rawFiles.slice(0, availableSlots);
                              const newBase64s: string[] = [];

                              for (const file of filesToProcess) {
                                if (file.size > 5 * 1024 * 1024) {
                                  alert(`File "${file.name}" exceeds 5MB size limit and was skipped.`);
                                  continue;
                                }

                                const base64Data = await new Promise<string>((resolve) => {
                                  const reader = new FileReader();
                                  reader.onload = (ev) => resolve((ev.target?.result as string) || "");
                                  reader.readAsDataURL(file);
                                });

                                if (base64Data) {
                                  newBase64s.push(base64Data);
                                }
                              }

                              if (newBase64s.length > 0) {
                                const combinedList = [...imageList, ...newBase64s];
                                set("images_json", JSON.stringify(combinedList));
                                set("image_url", combinedList[0]);

                                // Upload files to server in background and replace base64 with server URLs if successful
                                filesToProcess.forEach((file, idx) => {
                                  const base64Str = newBase64s[idx];
                                  if (!base64Str) return;

                                  const formData = new FormData();
                                  formData.append("file", file);
                                  apiPostMultipart<{ url: string }>("/masters/products/upload-image", formData)
                                    .then((res) => {
                                      if (res.data?.url) {
                                        const serverUrl = res.data.url;
                                        // Read latest image list and swap matching base64
                                        const currentList: string[] = [...combinedList];
                                        const matchIdx = currentList.indexOf(base64Str);
                                        if (matchIdx !== -1) {
                                          currentList[matchIdx] = serverUrl;
                                          set("images_json", JSON.stringify(currentList));
                                          set("image_url", currentList[0]);
                                        }
                                      }
                                    })
                                    .catch((err) => {
                                      console.warn("Background upload fell back to local preview:", err);
                                    });
                                });
                              }

                              e.target.value = "";
                            }}
                          />
                          <label
                            htmlFor="product_multi_image_file"
                            style={{
                              width: "110px",
                              height: "110px",
                              borderRadius: "8px",
                              border: "2px dashed #3b82f6",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "#eff6ff",
                              cursor: "pointer",
                              color: "#2563eb",
                              fontSize: "12px",
                              fontWeight: 600,
                              textAlign: "center",
                              padding: "8px",
                            }}
                          >
                            <span style={{ fontSize: "20px" }}>📷</span>
                            <span>+ Add Image</span>
                            <span style={{ fontSize: "10px", color: "#64748b", fontWeight: 400 }}>({imageList.length}/5, &lt;5MB)</span>
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </>
        );
      }}
      getRowStyle={(item) => {
        if (item.license_certificate_required && item.license_certificate_required.trim()) {
          return {
            backgroundColor: "#fff1f2",
            borderLeft: "4px solid #ef4444",
          };
        }
        return {};
      }}
      getRowClassName={(item) =>
        item.license_certificate_required && item.license_certificate_required.trim()
          ? "row-danger"
          : ""
      }
      onReady={(handle) => {
        masterHandleRef.current = handle;
      }}
    />
  );

  // Resolve display names for the drawer's related-entity fields the same
  // way the row columns do (in-memory lookups already loaded for the table).
  const p = drawerProduct;
  const cat = p ? categories.items.find((c) => c.id === p.category_id) : undefined;
  const subCat = p ? subCategories.items.find((sc) => sc.id === p.sub_category_id) : undefined;
  const brand = p ? brands.items.find((b) => b.id === p.brand_id) : undefined;
  const hsn = p ? hsnCodes.items.find((h) => h.id === p.hsn_id) : undefined;
  const uom = p ? uoms.items.find((u) => u.id === p.uom_id) : undefined;
  const secondaryUom = p && p.secondary_uom_id ? uoms.items.find((u) => u.id === p.secondary_uom_id) : undefined;

  const length = p ? p.length_cm ?? p.length : null;
  const width = p ? p.width_cm ?? p.width : null;
  const height = p ? p.height_cm ?? p.height : null;
  const hasDimensions = Boolean(length || width || height);

  const imageList: string[] = (() => {
    if (!p) return [];
    if (Array.isArray(p.images) && p.images.length > 0) {
      return p.images.filter(Boolean);
    }
    if (typeof (p as any).images === "string" && (p as any).images.startsWith("[")) {
      try {
        const parsed = JSON.parse((p as any).images);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed.filter(Boolean);
      } catch {
        // ignore
      }
    }
    if (p.image_url && p.image_url.trim()) {
      return [p.image_url.trim()];
    }
    return [];
  })();
  const hasImages = imageList.length > 0;
  const activeImg = imageList[selectedImageIndex] || imageList[0] || "";

  const resolvedOrgNames = (() => {
    if (!p) return [];
    const orgIds = p.organization_ids && p.organization_ids.length > 0
      ? p.organization_ids
      : (p.organization_id ? [p.organization_id] : []);
    return orgIds
      .map((id) => organizations.items.find((x) => x.id === id)?.name)
      .filter(Boolean) as string[];
  })();

  const matchingBranchesList = (() => {
    if (!p) return [];
    const branchIds = p.branch_ids || [];
    if (!branchIds.length) return [];
    const allBranches = organizations.items.flatMap((org: any) => org.branches || []);
    return branchIds
      .map((bId) => {
        const found = allBranches.find((b: any) => b.id === bId || `${bId}`.endsWith(b.name));
        return found ? `${found.name}${found.code_prefix ? ` (${found.code_prefix})` : ""}` : null;
      })
      .filter(Boolean) as string[];
  })();

  return (
    <>
      {masterPage}

      <SideDrawer
        open={drawerLoading || Boolean(drawerProduct)}
        title={
          p ? `Product Detail #${p.product_code || p.id.slice(0, 6)}` : "Product Detail"
        }
        subtitle={
          p ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "3px" }}>
              <span>Product Code: <strong>{p.product_code || "—"}</strong></span>
              {(hsn?.code || (p as any)?.hsn_code || (p as any)?.hsn) && (
                <>
                  <span>•</span>
                  <span>HSN Code: <strong>{hsn?.code || (p as any)?.hsn_code || (p as any)?.hsn}</strong></span>
                </>
              )}
              <span>•</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  background: p.status === "active" ? "#dcfce7" : "#f1f5f9",
                  color: p.status === "active" ? "#166534" : "#64748b",
                }}
              >
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: p.status === "active" ? "#16a34a" : "#94a3b8" }} />
                {p.status === "active" ? "Active" : "Inactive"}
              </span>
              {drawerLoading && (
                <span style={{ fontSize: "11.5px", color: "#0284c7", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <span>⏳</span> Loading full details...
                </span>
              )}
            </div>
          ) : ""
        }
        editLabel="✏️ Edit Product"
        cardStyle={{ maxWidth: "720px", width: "100%" }}
        onClose={handleCloseDrawer}
        onEdit={() => {
          const id = p?.id;
          handleCloseDrawer();
          if (id) masterHandleRef.current?.openEdit(id);
        }}
      >
        {drawerLoading || !p ? (
          <div className="muted" style={{ textAlign: "center", padding: "40px" }}>
            Loading product details...
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", paddingBottom: "24px" }}>
            {/* CARD 1: Hero Identity & Photo */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              }}
            >
              <div style={{ display: "flex", gap: "18px", alignItems: "flex-start", flexWrap: "wrap" }}>
                {hasImages && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                    <div
                      onClick={() => setZoomImage(resolveImageUrl(activeImg))}
                      title="Click to view enlarged photo"
                      style={{
                        width: "124px",
                        height: "124px",
                        minWidth: "124px",
                        background: "#f8fafc",
                        border: "1px solid #cbd5e1",
                        borderRadius: "10px",
                        position: "relative",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "zoom-in",
                        boxShadow: "0 2px 5px rgba(0,0,0,0.05)",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <img
                        src={resolveImageUrl(activeImg)}
                        alt={p.product_name_tally || p.product_name || "Product"}
                        style={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          objectFit: "contain",
                          padding: "4px",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          bottom: "4px",
                          right: "4px",
                          background: "rgba(15, 23, 42, 0.75)",
                          color: "#ffffff",
                          borderRadius: "4px",
                          padding: "2px 5px",
                          fontSize: "10px",
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          gap: "3px",
                          backdropFilter: "blur(2px)",
                        }}
                      >
                        <span>🔍</span>
                        <span>Zoom</span>
                      </div>
                    </div>

                    {/* Thumbnail switcher if multiple images */}
                    {imageList.length > 1 && (
                      <div style={{ display: "flex", gap: "6px", maxWidth: "124px", overflowX: "auto", paddingBottom: "2px" }}>
                        {imageList.map((img, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setSelectedImageIndex(idx)}
                            style={{
                              width: "26px",
                              height: "26px",
                              padding: "1px",
                              borderRadius: "4px",
                              border: selectedImageIndex === idx ? "2px solid #2563eb" : "1px solid #cbd5e1",
                              background: "#ffffff",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              overflow: "hidden",
                            }}
                          >
                            <img
                              src={resolveImageUrl(img)}
                              alt={`Thumb ${idx + 1}`}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Identity info */}
                <div style={{ flex: 1, minWidth: "260px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        padding: "2px 8px",
                        borderRadius: "12px",
                        fontSize: "12px",
                        fontWeight: 700,
                        background: p.status === "active" ? "#dcfce7" : "#f1f5f9",
                        color: p.status === "active" ? "#166534" : "#64748b",
                        border: p.status === "active" ? "1px solid #bbf7d0" : "1px solid #cbd5e1",
                      }}
                    >
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: p.status === "active" ? "#16a34a" : "#94a3b8" }} />
                      {p.status === "active" ? "Active" : "Inactive"}
                    </span>

                    {p.product_code && (
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: 500,
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          border: "1px solid #bfdbfe",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <span>🏷️</span>
                        <strong>Product Code:</strong> {p.product_code}
                      </span>
                    )}

                    {(hsn?.code || (p as any)?.hsn_code || (p as any)?.hsn) && (
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: 500,
                          background: "#f0fdfa",
                          color: "#0f766e",
                          border: "1px solid #99f6e4",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <span>🧾</span>
                        <strong>HSN Code:</strong> {hsn?.code || (p as any)?.hsn_code || (p as any)?.hsn}
                      </span>
                    )}

                    {p.barcode && p.barcode !== (hsn?.code || (p as any)?.hsn_code || (p as any)?.hsn) && (
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "6px",
                          fontSize: "11.5px",
                          fontWeight: 500,
                          background: "#f8fafc",
                          color: "#475569",
                          border: "1px solid #e2e8f0",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <span>🔢</span>
                        <strong>Barcode:</strong> {p.barcode}
                      </span>
                    )}
                  </div>

                  <h3
                    style={{
                      fontSize: "17px",
                      fontWeight: 700,
                      color: "#0f172a",
                      margin: "0 0 4px 0",
                      lineHeight: 1.3,
                    }}
                  >
                    {p.product_name_tally || p.product_name || "—"}
                  </h3>

                  {p.product_name_invoice && p.product_name_invoice !== (p.product_name_tally || p.product_name) && (
                    <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "8px" }}>
                      <strong style={{ color: "#475569" }}>Invoice Name:</strong> {p.product_name_invoice}
                    </div>
                  )}

                  {/* Badges line: Category, Sub Category, Brand */}
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                    {cat && (
                      <span style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", color: "#334155" }}>
                        📁 <strong>Category:</strong> {cat.name}
                      </span>
                    )}
                    {subCat && (
                      <span style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", color: "#334155" }}>
                        📂 <strong>Sub-Cat:</strong> {subCat.name}
                      </span>
                    )}
                    {brand && (
                      <span style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", color: "#334155" }}>
                        ⭐ <strong>Brand:</strong> {brand.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* CARD 2: Operating Locations & Assigned Branches */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              }}
            >
              <h4
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  margin: "0 0 12px 0",
                  color: "#0f172a",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                🏢 Operating Locations &amp; Assigned Branches
              </h4>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "4px" }}>
                    Organization(s):
                  </span>
                  {resolvedOrgNames.length > 0 ? (
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {resolvedOrgNames.map((name, i) => (
                        <span
                          key={i}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "3px 9px",
                            borderRadius: "6px",
                            background: "#f1f5f9",
                            border: "1px solid #cbd5e1",
                            fontSize: "12.5px",
                            fontWeight: 600,
                            color: "#1e293b",
                          }}
                        >
                          🏛️ {name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: "#94a3b8", fontSize: "13px" }}>—</span>
                  )}
                </div>

                <div>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "4px" }}>
                    Assigned Branches:
                  </span>
                  {matchingBranchesList.length > 0 ? (
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {matchingBranchesList.map((branchStr, i) => (
                        <span
                          key={i}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "3px 10px",
                            borderRadius: "6px",
                            background: "#f0fdf4",
                            border: "1px solid #bbf7d0",
                            fontSize: "12.5px",
                            fontWeight: 600,
                            color: "#166534",
                          }}
                        >
                          🏢 {branchStr}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 10px",
                        borderRadius: "6px",
                        background: "#f8fafc",
                        border: "1px dashed #cbd5e1",
                        color: "#64748b",
                        fontSize: "12.5px",
                        fontStyle: "italic",
                      }}
                    >
                      <span>🌐</span> All Branches / General Distribution (No restrictions)
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* CARD 3: Packaging & Physical Dimensions */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              }}
            >
              <h4
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  margin: "0 0 12px 0",
                  color: "#0f172a",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                📐 Packaging &amp; Physical Dimensions
              </h4>

              <DetailFieldGrid
                fields={[
                  {
                    label: "Primary UOM",
                    value: uom ? `${uom.name} (${uom.code})` : "—",
                  },
                  {
                    label: "Secondary UOM",
                    value: secondaryUom
                      ? `${secondaryUom.name} (${secondaryUom.code})${p.conversion_factor ? ` • (1 : ${p.conversion_factor})` : ""}`
                      : "—",
                  },
                  {
                    label: "Packaging Quantity",
                    value: p.packaging_quantity != null ? p.packaging_quantity : "—",
                  },
                  {
                    label: "Packaging Net Weight (kg)",
                    value: p.packaging_net_weight != null ? `${p.packaging_net_weight} kg` : "—",
                  },
                  {
                    label: "Packaging Gross Weight (kg)",
                    value: p.packaging_gross_weight != null ? `${p.packaging_gross_weight} kg` : "—",
                  },
                  {
                    label: "Dimensions (L × W × H cm)",
                    value: hasDimensions ? `${length || 0} × ${width || 0} × ${height || 0} cm` : "—",
                  },
                  {
                    label: "Packaging Unit CBM",
                    value: (
                      <span style={{ color: "var(--color-primary)", fontWeight: 700, fontSize: "14px" }}>
                        {p.packaging_unit_cbm != null ? `${Number(p.packaging_unit_cbm).toFixed(6)} CBM` : "—"}
                      </span>
                    ),
                  },
                  {
                    label: "Min Order Quantity (MOQ)",
                    value: p.minimum_order_quantity != null ? p.minimum_order_quantity : "—",
                  },
                ]}
              />
            </div>

            {/* CARD 4: Classification, Sourcing & Tax */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              }}
            >
              <h4
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  margin: "0 0 12px 0",
                  color: "#0f172a",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                🏷️ Classification, Sourcing &amp; Tax
              </h4>

              <DetailFieldGrid
                fields={[
                  {
                    label: "Supplier Brand",
                    value: (() => {
                      const s = suppliersList.find((x) => x.id === p.supplier_id);
                      const brand = s?.brand_description?.trim();
                      const comp = s?.company_name?.trim();
                      if (brand) {
                        const showComp = Boolean(comp && comp.toLowerCase() !== brand.toLowerCase());
                        return (
                          <span>
                            <strong style={{ fontWeight: 700, color: "#0f172a" }}>{brand}</strong>
                            {showComp && (
                              <span style={{ color: "#64748b", marginLeft: "5px" }}>({comp})</span>
                            )}
                          </span>
                        );
                      }
                      return p.supplier_name || comp || "—";
                    })(),
                  },
                  {
                    label: "HSN Code",
                    value: hsn ? `${hsn.code}${hsn.description ? ` (${hsn.description})` : ""}` : "—",
                  },
                  {
                    label: "GST Rate",
                    value: hsn?.gst_percent != null ? `${hsn.gst_percent}%` : "—",
                  },
                  {
                    label: "Purchase VAT %",
                    value: (
                      <span
                        style={{
                          color: "#1e40af",
                          fontWeight: 700,
                          background: "#dbeafe",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          display: "inline-block",
                        }}
                      >
                        {p.purchase_vat_percent != null ? `${p.purchase_vat_percent}%` : "0%"}
                      </span>
                    ),
                  },
                  {
                    label: "Refund VAT %",
                    value: (
                      <span
                        style={{
                          color: "#166534",
                          fontWeight: 700,
                          background: "#dcfce7",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          display: "inline-block",
                        }}
                      >
                        {p.refund_vat_percent != null ? `${p.refund_vat_percent}%` : "0%"}
                      </span>
                    ),
                  },
                  {
                    label: "Standard Price",
                    value: p.standard_price != null ? `₹${p.standard_price}` : "—",
                  },
                  {
                    label: "Standard Cost",
                    value: p.standard_cost != null ? `₹${p.standard_cost}` : "—",
                  },
                  {
                    label: "Color / Material",
                    value: [p.color, p.material].filter(Boolean).join(" • ") || "—",
                  },
                  {
                    label: "Purchasable / Sellable",
                    value: `${p.is_purchasable !== false ? "Purchasable" : "Not Purchasable"} • ${p.is_sellable !== false ? "Sellable" : "Not Sellable"}`,
                  },
                ]}
              />
            </div>

            {/* CARD 5: Compliance, Licenses & Specifications */}
            {(p.license_certificate_required || p.specification || p.description) && (
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "16px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <h4
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    margin: "0",
                    color: "#0f172a",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  📜 Compliance, Licenses &amp; Specifications
                </h4>

                {p.license_certificate_required && (
                  <div
                    style={{
                      padding: "12px 14px",
                      background: "#fff1f2",
                      border: "1px solid #fecdd3",
                      borderRadius: "8px",
                      color: "#9f1239",
                      fontSize: "13px",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                    }}
                  >
                    <span style={{ fontSize: "18px", lineHeight: 1 }}>⚠️</span>
                    <div>
                      <strong style={{ display: "block", marginBottom: "2px" }}>
                        Required License / Statutory Certificate:
                      </strong>
                      <span>{p.license_certificate_required}</span>
                    </div>
                  </div>
                )}

                {p.specification && (
                  <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "4px" }}>
                      Technical Specifications:
                    </span>
                    <p style={{ margin: 0, fontSize: "13px", color: "#0f172a", whiteSpace: "pre-wrap" }}>
                      {p.specification}
                    </p>
                  </div>
                )}

                {p.description && (
                  <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "4px" }}>
                      General Description &amp; Notes:
                    </span>
                    <p style={{ margin: 0, fontSize: "13px", color: "#0f172a", whiteSpace: "pre-wrap" }}>
                      {p.description}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* CARD 6: System Timestamps & Action Footer */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "12px",
                paddingTop: "14px",
                borderTop: "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: "12px", color: "#64748b" }}>
                {p.created_at && (
                  <span>
                    Created: <strong>{new Date(p.created_at).toLocaleDateString()}</strong>
                  </span>
                )}
                {p.updated_at && (
                  <span style={{ marginLeft: "10px" }}>
                    • Updated: <strong>{new Date(p.updated_at).toLocaleDateString()}</strong>
                  </span>
                )}
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setHistoryDrawerOpen(true)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 14px",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  📜 Trade &amp; Price History
                </button>
              </div>
            </div>
          </div>
        )}
      </SideDrawer>

      <ProductTradeHistoryDrawer
        productId={p?.id || null}
        productName={p ? p.product_name_tally || p.product_name || "" : ""}
        productCode={p?.product_code}
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
      />

      {/* Photo Zoom Lightbox Modal */}
      {zoomImage && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomImage(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            cursor: "zoom-out",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              maxWidth: "90vw",
              maxHeight: "90vh",
              background: "#ffffff",
              borderRadius: "12px",
              padding: "16px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              cursor: "default",
            }}
          >
            <button
              type="button"
              onClick={() => setZoomImage(null)}
              aria-label="Close image preview"
              style={{
                position: "absolute",
                top: "-12px",
                right: "-12px",
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: "#0f172a",
                color: "#ffffff",
                border: "2px solid #ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "16px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
              }}
            >
              ✕
            </button>
            <img
              src={zoomImage}
              alt="Enlarged Product"
              style={{
                maxWidth: "85vw",
                maxHeight: "78vh",
                objectFit: "contain",
                borderRadius: "8px",
              }}
            />
            {p && (
              <div style={{ marginTop: "12px", fontSize: "13.5px", fontWeight: 600, color: "#1e293b", textAlign: "center" }}>
                {p.product_name_tally || p.product_name || "Product Image"}
                {p.product_code && <span style={{ color: "#64748b", marginLeft: "6px" }}>({p.product_code})</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}