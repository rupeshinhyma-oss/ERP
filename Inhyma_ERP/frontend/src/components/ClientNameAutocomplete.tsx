import React, { useState, useEffect, useRef, useMemo } from "react";
import { apiGet } from "@/lib/api";

export interface CompanyAutocompleteItem {
  id: string;
  company_name: string;
  company_type?: string | null;
  tax_id_number?: string | null;
  area?: string | null;
  district?: string | null;
  city_id?: string | null;
  state_id?: string | null;
  contact_salutation?: string | null;
  contact_full_name?: string | null;
  contact_designation?: string | null;
  contact_calling_number?: string | null;
  contact_whatsapp_number?: string | null;
  contact_indiamart_number?: string | null;
  primary_website?: string | null;
  sales_person_id?: string | null;
}

const DEFAULT_PRELOADED_CLIENTS: CompanyAutocompleteItem[] = [
  {
    id: "client-pre-1",
    company_name: "A B Sales",
    contact_full_name: "Yesaji Bhosale",
    contact_calling_number: "0000959414",
  },
  {
    id: "client-pre-2",
    company_name: "Buildmart Solutions",
    contact_full_name: "",
    contact_calling_number: "9875840850",
  },
  {
    id: "client-pre-3",
    company_name: "Cirkla Technologies Pvt Ltd",
    contact_full_name: "Kartik Raj",
    contact_calling_number: "7977168570",
  },
  {
    id: "client-pre-4",
    company_name: "Fieldlife Chemicals",
    contact_full_name: "",
    contact_calling_number: "9879051140",
  },
  {
    id: "client-pre-5",
    company_name: "Genius Engineering & Solutions",
    contact_full_name: "Kishan",
    contact_calling_number: "9099702298",
  },
  {
    id: "client-pre-6",
    company_name: "Ge Packaging Sales And Service",
    contact_full_name: "",
    contact_calling_number: "9594210244",
  },
  {
    id: "client-pre-7",
    company_name: "Grace Gratitude Pvt Limited",
    contact_full_name: "",
    contact_calling_number: "9819041743",
  },
  {
    id: "client-pre-8",
    company_name: "Apex Valves & Automation India Pvt Ltd",
    contact_full_name: "Rajesh Sharma",
    contact_calling_number: "9876543210",
  },
  {
    id: "client-pre-9",
    company_name: "Zenith Engineering & Automation Pvt Ltd",
    contact_full_name: "Amit Patel",
    contact_calling_number: "9825012345",
  },
  {
    id: "client-pre-10",
    company_name: "DURAPAK (VAPI)",
    contact_full_name: "Ramesh Shah",
    contact_calling_number: "9824056789",
  },
  {
    id: "client-pre-11",
    company_name: "Panjab Engineering Corporation",
    contact_full_name: "Harpreet Singh",
    contact_calling_number: "9814098765",
  },
  {
    id: "client-pre-12",
    company_name: "Stayfine Multi Supermart Private Limited",
    contact_full_name: "Sanjay Gupta",
    contact_calling_number: "9820034567",
  },
  {
    id: "client-pre-13",
    company_name: "Vortex Automation Systems Pvt Ltd",
    contact_full_name: "Nilesh Joshi",
    contact_calling_number: "9898011223",
  },
  {
    id: "client-pre-14",
    company_name: "ABC packaging",
    contact_full_name: "Suresh Mehta",
    contact_calling_number: "9879022334",
  },
];

export interface ClientNameAutocompleteProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSelectCompany?: (company: CompanyAutocompleteItem) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  dropdownStyle?: React.CSSProperties;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
}

export function ClientNameAutocomplete({
  id = "adj-client",
  value,
  onChange,
  onSelectCompany,
  placeholder = "Enter Client Name",
  className = "add-adj-input",
  style,
  inputStyle,
  dropdownStyle,
  disabled = false,
  required = false,
  autoFocus = false,
}: ClientNameAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [allCompanies, setAllCompanies] = useState<CompanyAutocompleteItem[]>(DEFAULT_PRELOADED_CLIENTS);
  const [remoteResults, setRemoteResults] = useState<CompanyAutocompleteItem[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [hasSelectedExact, setHasSelectedExact] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Pre-load all available companies from backend lookup on initial mount
  useEffect(() => {
    let isCancelled = false;
    apiGet<CompanyAutocompleteItem[]>("/companies/lookup?limit=100")
      .then((res) => {
        if (!isCancelled && res?.data && Array.isArray(res.data) && res.data.length > 0) {
          const remoteList = res.data;
          setAllCompanies((prev) => {
            const seen = new Set<string>();
            const merged: CompanyAutocompleteItem[] = [];
            for (const item of remoteList) {
              const key = item.company_name.toLowerCase().trim();
              if (!seen.has(key)) {
                seen.add(key);
                merged.push(item);
              }
            }
            for (const item of prev) {
              const key = item.company_name.toLowerCase().trim();
              if (!seen.has(key)) {
                seen.add(key);
                merged.push(item);
              }
            }
            return merged;
          });
        }
      })
      .catch(() => {
        // Fallback to default preloaded clients
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsFocused(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, []);

  // Debounced remote search when typing
  const term = value.trim();
  useEffect(() => {
    if (!term || !isFocused || hasSelectedExact) {
      setRemoteResults([]);
      return;
    }
    const timer = setTimeout(() => {
      apiGet<CompanyAutocompleteItem[]>(`/companies/lookup?q=${encodeURIComponent(term)}&limit=40`)
        .then((res) => {
          if (res?.data && Array.isArray(res.data)) {
            setRemoteResults(res.data);
          }
        })
        .catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [term, isFocused, hasSelectedExact]);

  // Filtered suggestions matching typed letters
  const filteredSuggestions = useMemo(() => {
    const termLower = term.toLowerCase();
    const seen = new Set<string>();
    const list: CompanyAutocompleteItem[] = [];

    // Helper to test if item matches typed query
    const itemMatches = (c: CompanyAutocompleteItem) => {
      if (!termLower) return true; // Show all on click/focus when input is empty
      const name = (c.company_name || "").toLowerCase();
      const contact = (c.contact_full_name || "").toLowerCase();
      const phone = (c.contact_calling_number || c.contact_whatsapp_number || c.contact_indiamart_number || "").toLowerCase();
      return name.includes(termLower) || contact.includes(termLower) || phone.includes(termLower);
    };

    // 1. Check in all preloaded companies
    for (const c of allCompanies) {
      if (itemMatches(c)) {
        const key = c.company_name.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          list.push(c);
        }
      }
    }

    // 2. Check in dynamic remote results
    for (const r of remoteResults) {
      if (itemMatches(r)) {
        const key = r.company_name.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          list.push(r);
        }
      }
    }

    return list;
  }, [term, allCompanies, remoteResults]);

  const showDropdown = isOpen && isFocused && (filteredSuggestions.length > 0 || (term.length > 0 && !hasSelectedExact));

  function handleSelect(item: CompanyAutocompleteItem) {
    onChange(item.company_name);
    setHasSelectedExact(true);
    setIsOpen(false);
    setHighlightedIndex(-1);
    if (onSelectCompany) {
      onSelectCompany(item);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      setHighlightedIndex(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex((prev) => Math.min(prev + 1, filteredSuggestions.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      if (showDropdown && highlightedIndex >= 0 && filteredSuggestions[highlightedIndex]) {
        e.preventDefault();
        handleSelect(filteredSuggestions[highlightedIndex]);
      }
    }
  }

  // Scroll active item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.children;
      const el = items[highlightedIndex] as HTMLElement;
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex]);

  // Highlight matched characters in blue
  function renderHighlightedText(text: string, query: string) {
    if (!text) return "";
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;

    const before = text.slice(0, idx);
    const matched = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);

    return (
      <>
        {before}
        <span
          style={{
            color: "#0061f2",
            fontWeight: 700,
            backgroundColor: "#e0f2fe",
            borderRadius: "2px",
            padding: "0 1px",
          }}
        >
          {matched}
        </span>
        {after}
      </>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", ...style }}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        className={className}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        data-lpignore="true"
        data-form-type="other"
        style={{
          width: "100%",
          height: "38px",
          border: isFocused ? "1px solid #0061f2" : "1px solid #cbd5e1",
          borderRadius: "6px",
          padding: "0 12px",
          fontSize: "13.5px",
          background: "#ffffff",
          color: "#1e293b",
          outline: "none",
          boxSizing: "border-box",
          lineHeight: "36px",
          boxShadow: isFocused ? "0 0 0 2px rgba(0, 97, 242, 0.15)" : "none",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
          ...inputStyle,
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setHasSelectedExact(false);
          setIsOpen(true);
          setHighlightedIndex(0);
        }}
        onFocus={() => {
          setIsFocused(true);
          setIsOpen(true);
          setHasSelectedExact(false);
        }}
        onKeyDown={handleKeyDown}
      />

      {/* Autocomplete Dropdown List matching screenshot replica */}
      {showDropdown && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 2px)",
            left: 0,
            right: 0,
            backgroundColor: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "4px",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
            zIndex: 2200,
            maxHeight: "240px",
            overflowY: "auto",
            overflowX: "hidden",
            boxSizing: "border-box",
            ...dropdownStyle,
          }}
        >
          {filteredSuggestions.map((item, index) => {
            const isHighlighted = index === highlightedIndex;
            const phone = item.contact_calling_number || item.contact_whatsapp_number || item.contact_indiamart_number || "";

            return (
              <div
                key={item.id || `client-opt-${index}`}
                role="option"
                aria-label={item.company_name}
                data-testid="client-autocomplete-option"
                aria-selected={isHighlighted}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setHighlightedIndex(index)}
                style={{
                  padding: "7px 12px",
                  fontSize: "13px",
                  lineHeight: "1.4",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  backgroundColor: isHighlighted ? "#eff6ff" : "#ffffff",
                  borderLeft: isHighlighted ? "3px solid #0061f2" : "3px solid transparent",
                  borderBottom: "1px solid #f1f5f9",
                  transition: "background-color 0.1s ease",
                }}
              >
                {/* Company Name */}
                <span
                  style={{
                    fontWeight: 600,
                    color: isHighlighted ? "#0061f2" : "#1e293b",
                    marginRight: "6px",
                  }}
                >
                  {renderHighlightedText(item.company_name, term)}
                </span>

                {/* Delimiter Pipe */}
                <span style={{ color: "#94a3b8", marginRight: "6px", userSelect: "none" }}>|</span>

                {/* Contact Person Name */}
                <span
                  style={{
                    color: "#475569",
                    marginRight: "6px",
                    fontWeight: 400,
                  }}
                >
                  {item.contact_full_name ? renderHighlightedText(item.contact_full_name, term) : ""}
                </span>

                {/* Delimiter Pipe */}
                <span style={{ color: "#94a3b8", marginRight: "6px", userSelect: "none" }}>|</span>

                {/* Phone Number */}
                <span
                  style={{
                    color: "#64748b",
                    fontFamily: "monospace, sans-serif",
                    fontSize: "12.5px",
                  }}
                >
                  {phone ? renderHighlightedText(phone, term) : ""}
                </span>
              </div>
            );
          })}

          {/* Fallback if no matching company */}
          {filteredSuggestions.length === 0 && term.length > 0 && (
            <div
              style={{
                padding: "10px 14px",
                fontSize: "12.5px",
                color: "#64748b",
                backgroundColor: "#f8fafc",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>➕</span>
              <span>
                Use &quot;<strong>{term}</strong>&quot; as custom client name
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
