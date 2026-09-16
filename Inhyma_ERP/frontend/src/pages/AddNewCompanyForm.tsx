import React, { useState, useEffect } from "react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useAuth } from "@/lib/hooks";

interface AddNewCompanyFormProps {
  onBack: () => void;
  onSaved: (company: any) => void;
  initialCompanyId?: string | null;
}

interface SocialMediaItem {
  platform: string;
  link: string;
}

const GST_STATE_MAP: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli",
  "27": "Maharashtra",
  "28": "Andhra Pradesh",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

export function AddNewCompanyForm({ onBack, onSaved, initialCompanyId }: AddNewCompanyFormProps) {
  const { profile } = useAuth();

  // Form fields matching exact screenshot layout
  const [companyName, setCompanyName] = useState("");
  const [salutation, setSalutation] = useState("Mr");
  const [fullName, setFullName] = useState("");
  const [designation, setDesignation] = useState("");
  const [gstNo, setGstNo] = useState("");

  const [contactDirect, setContactDirect] = useState("");
  const [contactIndiaMart, setContactIndiaMart] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");

  const [email, setEmail] = useState("");
  const [webpageIndiaMart, setWebpageIndiaMart] = useState("");

  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [stateId, setStateId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [districtName, setDistrictName] = useState("");
  const [cityId, setCityId] = useState("");
  const [pincode, setPincode] = useState("");

  // Other Details
  const [currentStatus, setCurrentStatus] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [category, setCategory] = useState("");
  const [clientGrade, setClientGrade] = useState("");

  const [potential, setPotential] = useState("");
  const [businessCategoryId, setBusinessCategoryId] = useState("");
  const [productManufactureOrSupply, setProductManufactureOrSupply] = useState("");
  const [machinesBuyingFrom, setMachinesBuyingFrom] = useState("");

  const [sparesBuyingFrom, setSparesBuyingFrom] = useState("");
  const [productsInterested, setProductsInterested] = useState("");
  const [gstRegistrationDate, setGstRegistrationDate] = useState("");
  const [ageOfCompany, setAgeOfCompany] = useState("");

  // Social Media Repeater
  const [socialMediaList, setSocialMediaList] = useState<SocialMediaItem[]>([
    { platform: "", link: "" },
  ]);

  // Observations / Remarks
  const [overallRemarks, setOverallRemarks] = useState("");

  // Sales Person
  const [salesPersonId, setSalesPersonId] = useState("");

  // Options loaded from backend
  const [states, setStates] = useState<Array<{ id: string; name: string; code?: string }>>([]);
  const [districts, setDistricts] = useState<Array<{ id: string; name: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string }>>([]);
  const [salesPersons, setSalesPersons] = useState<Array<{ id: string; full_name: string; username: string }>>([]);
  const [companyCategories, setCompanyCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [productCategories, setProductCategories] = useState<Array<{ id: string; name: string }>>([]);

  // UI status
  const [submitting, setSubmitting] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 1. Fetch initial dropdown data: States, Sales Persons, Categories
  useEffect(() => {
    // States
    apiGet<Array<{ id: string; name: string; code?: string }>>("/masters/states?page_size=250&status=active")
      .then((res) => {
        if (res?.data) {
          setStates([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch(() => {});

    // Sales persons
    apiGet<Array<{ id: string; full_name: string; username: string }>>("/companies/sales-persons")
      .then((res) => {
        if (res?.data && res.data.length > 0) {
          setSalesPersons(res.data);
          if (!salesPersonId && profile) {
            const match = res.data.find((u) => u.id === profile.id || u.username === profile.username);
            if (match) setSalesPersonId(match.id);
            else if (res.data[0]) setSalesPersonId(res.data[0].id);
          }
        }
      })
      .catch(() => {
        apiGet<any[]>("/users/all")
          .then((res) => {
            if (res?.data) {
              const mapped = res.data.map((u) => ({
                id: u.id,
                username: u.username,
                full_name: u.full_name || u.username,
              }));
              setSalesPersons(mapped);
              if (!salesPersonId && mapped[0]) setSalesPersonId(mapped[0].id);
            }
          })
          .catch(() => {});
      });

    // Company categories
    apiGet<Array<{ id: string; name: string }>>("/masters/company-categories?page_size=250&status=active")
      .then((res) => {
        if (res?.data) {
          setCompanyCategories([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch(() => {});

    // Product categories
    apiGet<Array<{ id: string; name: string }>>("/masters/product-categories?page_size=250&status=active")
      .then((res) => {
        if (res?.data) {
          setProductCategories([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch(() => {});
  }, [profile]);

  // 2. Cascade: State -> Districts
  useEffect(() => {
    if (!stateId) {
      setDistricts([]);
      setDistrictId("");
      setDistrictName("");
      setCities([]);
      setCityId("");
      return;
    }

    apiGet<Array<{ id: string; name: string }>>(`/masters/districts/lookup?state_id=${stateId}`)
      .then((res) => {
        if (res?.data) {
          setDistricts([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        } else {
          setDistricts([]);
        }
      })
      .catch(() => setDistricts([]));
  }, [stateId]);

  // 3. Cascade: District -> Cities
  useEffect(() => {
    if (!stateId || (!districtId && !districtName)) {
      setCities([]);
      setCityId("");
      return;
    }

    const dObj = districts.find(
      (d) => d.id === districtId || (districtName && d.name.toLowerCase() === districtName.trim().toLowerCase())
    );
    const resolvedDistId = dObj?.id || districtId;

    if (resolvedDistId) {
      apiGet<Array<{ id: string; name: string }>>(`/masters/cities/lookup?district_id=${resolvedDistId}`)
        .then((res) => {
          if (res?.data && res.data.length > 0) {
            setCities([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
          } else if (districtName) {
            // Fallback: district itself as an option
            setCities([{ id: resolvedDistId, name: districtName }]);
          } else {
            setCities([]);
          }
        })
        .catch(() => {
          if (districtName) {
            setCities([{ id: resolvedDistId, name: districtName }]);
          } else {
            setCities([]);
          }
        });
    }
  }, [stateId, districtId, districtName, districts]);

  // If editing existing company, load its data
  useEffect(() => {
    if (!initialCompanyId) return;

    apiGet<any>(`/companies/${initialCompanyId}`)
      .then((res) => {
        const c = res.data;
        if (!c) return;

        setCompanyName(c.company_name || "");
        setSalutation(c.contact_salutation || "Mr");
        setFullName(c.contact_full_name || "");
        setDesignation(c.contact_designation || "");
        setGstNo(c.tax_id_number || "");

        setContactDirect(c.contact_calling_number || "");
        setContactIndiaMart(c.contact_indiamart_number || "");
        setWhatsappNumber(c.contact_whatsapp_number || "");
        setCompanyWebsite(c.primary_website || "");

        setEmail(c.emails && c.emails.length > 0 ? c.emails[0] : "");
        setWebpageIndiaMart(c.secondary_website || "");

        setAddress(c.address || "");
        setArea(c.area || "");
        setStateId(c.state_id || "");
        setDistrictName(c.district || "");
        setCityId(c.city_id || "");
        setPincode(c.pincode || c.town || "");

        setCurrentStatus(c.current_status || "");
        setBusinessType(c.company_type || "");
        setCategory(c.company_category || "");
        setClientGrade(c.company_grade || "");

        setPotential(c.potential || "");
        if (c.category_ids && c.category_ids.length > 0) {
          setBusinessCategoryId(c.category_ids[0]);
        }
        setProductManufactureOrSupply(c.product_manufacture_or_supply || c.brand_description || "");
        setMachinesBuyingFrom(c.machines_buying_from || "");

        setSparesBuyingFrom(c.spares_buying_from || "");
        setProductsInterested(c.products_interested || "");
        setGstRegistrationDate(c.gst_registration_date || "");
        setAgeOfCompany(c.age_of_company || "");

        if (Array.isArray(c.social_media) && c.social_media.length > 0) {
          setSocialMediaList(c.social_media);
        }

        setOverallRemarks(c.overall_remarks || "");
        setSalesPersonId(c.sales_person_id || "");
      })
      .catch(() => {});
  }, [initialCompanyId]);

  // Auto calculate Age of Company when GST Registration Date changes
  const handleGstDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setGstRegistrationDate(val);
    if (!val) return;

    const regDate = new Date(val);
    if (!isNaN(regDate.getTime())) {
      const now = new Date();
      let years = now.getFullYear() - regDate.getFullYear();
      let months = now.getMonth() - regDate.getMonth();
      if (months < 0) {
        years--;
        months += 12;
      }
      if (years <= 0) {
        setAgeOfCompany(`${Math.max(1, months)} Months`);
      } else {
        setAgeOfCompany(months > 0 ? `${years} Years ${months} Months` : `${years} Years`);
      }
    }
  };

  // Copy Primary -> WhatsApp
  const handleCopyPrimary = () => {
    if (!contactDirect.trim()) {
      setNotification({
        type: "info",
        message: "Please enter Contact Number (Direct) first.",
      });
      return;
    }
    setWhatsappNumber(contactDirect.trim());
    setNotification({
      type: "success",
      message: "Direct contact number copied to WhatsApp Number.",
    });
  };

  // Fetch Data from GST No
  const handleFetchGstData = (explicitGst?: any) => {
    let raw = typeof explicitGst === "string" ? explicitGst : gstNo;
    if (!raw || typeof raw !== "string") {
      const gstInputEl = document.querySelector<HTMLInputElement>('input[placeholder*="24AACPB1049G1ZF"]');
      if (gstInputEl && gstInputEl.value) {
        raw = gstInputEl.value;
        setGstNo(gstInputEl.value.toUpperCase());
      }
    }
    const cleanGst = (typeof raw === "string" ? raw : "").trim().toUpperCase();
    if (!cleanGst) {
      setNotification({ type: "error", message: "Please enter a GST Number first." });
      return;
    }
    if (cleanGst.length < 2) {
      setNotification({ type: "error", message: "GST Number must have at least 2 digits for state identification." });
      return;
    }

    const stateCode = cleanGst.slice(0, 2);
    const detectedStateName = GST_STATE_MAP[stateCode];

    if (!detectedStateName) {
      setNotification({
        type: "info",
        message: `GST state code "${stateCode}" not recognized in standard GST map.`,
      });
      return;
    }

    const findAndSetState = (stateList: Array<{ id: string; name: string; code?: string }>) => {
      const foundState = stateList.find(
        (s) =>
          s.name.toLowerCase().includes(detectedStateName.toLowerCase()) ||
          detectedStateName.toLowerCase().includes(s.name.toLowerCase()) ||
          s.code === stateCode
      );

      if (foundState) {
        setStateId(foundState.id);
        setNotification({
          type: "success",
          message: `GSTIN validated! State automatically identified as ${foundState.name} (Code ${stateCode}).`,
        });
      } else {
        setNotification({
          type: "info",
          message: `GST State code ${stateCode} is ${detectedStateName}, please select the matching State from the dropdown.`,
        });
      }
    };

    if (states.length === 0) {
      apiGet<Array<{ id: string; name: string; code?: string }>>("/masters/states?page_size=250&status=active")
        .then((res) => {
          if (res?.data) {
            const sorted = [...res.data].sort((a, b) => a.name.localeCompare(b.name));
            setStates(sorted);
            findAndSetState(sorted);
          }
        })
        .catch(() => {});
    } else {
      findAndSetState(states);
    }
  };

  // Social media handlers
  const handleSocialMediaChange = (index: number, field: keyof SocialMediaItem, value: string) => {
    setSocialMediaList((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAddSocialMedia = () => {
    setSocialMediaList((prev) => [...prev, { platform: "", link: "" }]);
  };

  const handleRemoveSocialMedia = (index: number) => {
    setSocialMediaList((prev) => {
      if (prev.length <= 1) {
        return [{ platform: "", link: "" }];
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  // Save & Exit handler
  const handleSaveAndExit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotification(null);
    const newErrors: Record<string, string> = {};

    if (!companyName.trim()) {
      newErrors.companyName = "Company Name is required.";
    }
    if (!gstNo.trim()) {
      newErrors.gstNo = "GST No is required.";
    }
    if (!stateId) {
      newErrors.stateId = "State is required.";
    }
    if (!cityId) {
      newErrors.cityId = "City is required.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setNotification({
        type: "error",
        message: "Please fill in all mandatory fields marked with an asterisk (*).",
      });
      return;
    }

    setErrors({});
    setSubmitting(true);

    try {
      const payload: Record<string, any> = {
        company_name: companyName.trim(),
        contact_salutation: salutation || null,
        contact_full_name: fullName.trim() || null,
        contact_designation: designation.trim() || null,
        tax_id_number: gstNo.trim().toUpperCase() || null,
        contact_calling_number: contactDirect.trim() || null,
        contact_indiamart_number: contactIndiaMart.trim() || null,
        contact_whatsapp_number: whatsappNumber.trim() || null,
        primary_website: companyWebsite.trim() || null,
        emails: email.trim() ? [email.trim()] : [],
        secondary_website: webpageIndiaMart.trim() || null,
        address: address.trim() || null,
        area: area.trim() || null,
        state_id: stateId || null,
        district: districtName.trim() || null,
        city_id: cityId || null,
        pincode: pincode.trim() || null,
        town: pincode.trim() || null,

        current_status: currentStatus || null,
        company_type: businessType || null,
        company_category: category || null,
        company_grade: clientGrade || null,
        potential: potential || null,
        category_ids: businessCategoryId ? [businessCategoryId] : [],

        product_manufacture_or_supply: productManufactureOrSupply.trim() || null,
        brand_description: productManufactureOrSupply.trim() || null,
        machines_buying_from: machinesBuyingFrom.trim() || null,
        spares_buying_from: sparesBuyingFrom.trim() || null,
        products_interested: productsInterested.trim() || null,
        gst_registration_date: gstRegistrationDate.trim() || null,
        age_of_company: ageOfCompany.trim() || null,

        social_media: socialMediaList.filter((s) => s.platform || s.link.trim()),
        overall_remarks: overallRemarks.trim() || null,
        sales_person_id: salesPersonId || null,
      };

      let res;
      if (initialCompanyId) {
        res = await apiPatch(`/companies/${initialCompanyId}`, payload);
      } else {
        res = await apiPost("/companies", payload);
      }

      onSaved(res.data);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Failed to save company profile. Please check the fields.";
      setNotification({ type: "error", message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page" style={{ width: "100%", padding: "20px 24px", maxWidth: "1600px", margin: "0 auto" }}>
      {/* Top Header Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
          {initialCompanyId ? "Edit Company" : "Add New Company"}
        </h1>
        <button
          type="button"
          onClick={onBack}
          style={{
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            color: "#475569",
            fontWeight: 600,
            fontSize: "13px",
            padding: "8px 20px",
            borderRadius: "6px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          }}
        >
          ← BACK
        </button>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            marginBottom: "20px",
            fontSize: "13.5px",
            fontWeight: 500,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor:
              notification.type === "error"
                ? "#fef2f2"
                : notification.type === "success"
                ? "#f0fdf4"
                : "#f0f9ff",
            color:
              notification.type === "error"
                ? "#991b1b"
                : notification.type === "success"
                ? "#166534"
                : "#075985",
            border: `1px solid ${
              notification.type === "error"
                ? "#fecaca"
                : notification.type === "success"
                ? "#bbf7d0"
                : "#bae6fd"
            }`,
          }}
        >
          <span>{notification.message}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "16px",
              color: "inherit",
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Form Card */}
      <div
        className="card"
        style={{
          background: "#ffffff",
          padding: "28px",
          borderRadius: "8px",
          border: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <form onSubmit={handleSaveAndExit} noValidate>
          {/* TOP SECTION: COMPANY & CONTACT DETAILS (4-COL GRID) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              columnGap: "20px",
              rowGap: "16px",
            }}
          >
            {/* Row 1, Col 1: Company Name * */}
            <div>
              <label style={labelStyle}>
                Company Name <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                style={getInputStyle(!!errors.companyName)}
              />
              {errors.companyName && <span style={errorTextStyle}>{errors.companyName}</span>}
            </div>

            {/* Row 1, Col 2: Full Name (IndiaMart Or Other) */}
            <div>
              <label style={labelStyle}>Full Name (IndiaMart Or Other)</label>
              <div style={{ display: "flex" }}>
                <select
                  value={salutation}
                  onChange={(e) => setSalutation(e.target.value)}
                  style={{
                    ...selectStyle,
                    width: "70px",
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                    borderRight: "none",
                    padding: "6px 8px",
                  }}
                >
                  <option value="Mr">Mr</option>
                  <option value="Ms">Ms</option>
                  <option value="Mrs">Mrs</option>
                  <option value="Dr">Dr</option>
                  <option value="Shri">Shri</option>
                  <option value="Smt">Smt</option>
                </select>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  style={{
                    ...inputStyle,
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                    flex: 1,
                  }}
                />
              </div>
            </div>

            {/* Row 1, Col 3: Designation */}
            <div>
              <label style={labelStyle}>Designation</label>
              <input
                type="text"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Row 1, Col 4: GST No * + Fetch Data Button */}
            <div>
              <label style={labelStyle}>
                GST No <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <div style={{ display: "flex" }}>
                <input
                  type="text"
                  value={gstNo}
                  onChange={(e) => setGstNo(e.target.value.toUpperCase())}
                  placeholder="e.g. 24AACPB1049G1ZF"
                  style={{
                    ...getInputStyle(!!errors.gstNo),
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                    flex: 1,
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleFetchGstData()}
                  style={{
                    background: "#475569",
                    color: "#ffffff",
                    border: "none",
                    padding: "0 14px",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    borderTopRightRadius: "6px",
                    borderBottomRightRadius: "6px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "background 0.2s",
                  }}
                  title="Validate GSTIN and detect State"
                >
                  Fetch Data
                </button>
              </div>
              {errors.gstNo && <span style={errorTextStyle}>{errors.gstNo}</span>}
            </div>

            {/* Row 2, Col 1: Contact Number (Direct) */}
            <div>
              <label style={labelStyle}>Contact Number (Direct)</label>
              <input
                type="text"
                value={contactDirect}
                onChange={(e) => setContactDirect(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Row 2, Col 2: Contact Number (IndiaMart) */}
            <div>
              <label style={labelStyle}>Contact Number (IndiaMart)</label>
              <input
                type="text"
                value={contactIndiaMart}
                onChange={(e) => setContactIndiaMart(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Row 2, Col 3: WhatsApp Number + Copy Primary */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>WhatsApp Number</label>
                <button
                  type="button"
                  onClick={handleCopyPrimary}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "#0d6efd",
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Copy Primary
                </button>
              </div>
              <input
                type="text"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Row 2, Col 4: Company Website */}
            <div>
              <label style={labelStyle}>Company Website</label>
              <input
                type="text"
                value={companyWebsite}
                onChange={(e) => setCompanyWebsite(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Row 3: Email (Span 3 cols) + Webpage (Span 1 col) */}
            <div style={{ gridColumn: "span 3" }}>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ gridColumn: "span 1" }}>
              <label style={labelStyle}>Webpage (India Mart Or Other)</label>
              <input
                type="text"
                value={webpageIndiaMart}
                onChange={(e) => setWebpageIndiaMart(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Row 4: Address (Span 2 cols) + Area (Span 1 col) + State * (Span 1 col) */}
            <div style={{ gridColumn: "span 2" }}>
              <label style={labelStyle}>Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ gridColumn: "span 1" }}>
              <label style={labelStyle}>Area</label>
              <input
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ gridColumn: "span 1" }}>
              <label style={labelStyle}>
                State <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <select
                value={stateId}
                onChange={(e) => {
                  setStateId(e.target.value);
                  setDistrictId("");
                  setDistrictName("");
                  setCityId("");
                }}
                style={getSelectStyle(!!errors.stateId)}
              >
                <option value="">Select</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {errors.stateId && <span style={errorTextStyle}>{errors.stateId}</span>}
            </div>

            {/* Row 5: District + City * + Pincode */}
            <div style={{ gridColumn: "span 1" }}>
              <label style={labelStyle}>District</label>
              <select
                value={districtId}
                onChange={(e) => {
                  const selId = e.target.value;
                  setDistrictId(selId);
                  const found = districts.find((d) => d.id === selId);
                  setDistrictName(found ? found.name : "");
                  setCityId("");
                }}
                disabled={!stateId}
                style={selectStyle}
              >
                <option value="">Select</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: "span 1" }}>
              <label style={labelStyle}>
                City <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <select
                value={cityId}
                onChange={(e) => setCityId(e.target.value)}
                disabled={!stateId || (!districtId && !districtName)}
                style={getSelectStyle(!!errors.cityId)}
              >
                <option value="">Select</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.cityId && <span style={errorTextStyle}>{errors.cityId}</span>}
            </div>

            <div style={{ gridColumn: "span 1" }}>
              <label style={labelStyle}>Pincode</label>
              <input
                type="text"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* SECTION: OTHER DETAILS */}
          <div style={{ marginTop: "32px" }}>
            <h2
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: "#1e293b",
                margin: "0 0 16px 0",
              }}
            >
              Other Details
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                columnGap: "20px",
                rowGap: "16px",
              }}
            >
              {/* Row 1: Current Status, Business Type, Category, Client Grade */}
              <div>
                <label style={labelStyle}>Current Status</label>
                <select
                  value={currentStatus}
                  onChange={(e) => setCurrentStatus(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">Select</option>
                  <option value="new">New</option>
                  <option value="existing">Existing</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="lead">Lead</option>
                  <option value="prospect">Prospect</option>
                  <option value="client">Client</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Business Type</label>
                <select
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">Select</option>
                  <option value="manufacturer">Manufacturer</option>
                  <option value="trader">Trader</option>
                  <option value="dealer">Dealer</option>
                  <option value="agent">Agent</option>
                  <option value="exporter">Exporter</option>
                  <option value="wholesaler">Wholesaler</option>
                  <option value="distributor">Distributor</option>
                  <option value="service_provider">Service Provider</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">Select</option>
                  {companyCategories.map((cc) => (
                    <option key={cc.id} value={cc.name}>
                      {cc.name}
                    </option>
                  ))}
                  {companyCategories.length === 0 && (
                    <>
                      <option value="B2B">B2B</option>
                      <option value="B2C">B2C</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Client Grade</label>
                <select
                  value={clientGrade}
                  onChange={(e) => setClientGrade(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">Select</option>
                  <option value="A">Grade A</option>
                  <option value="B">Grade B</option>
                  <option value="C">Grade C</option>
                  <option value="A+">Grade A+</option>
                </select>
              </div>

              {/* Row 2: Potential, Business Categories, Product Manufacture, Machines */}
              <div>
                <label style={labelStyle}>Potential</label>
                <select
                  value={potential}
                  onChange={(e) => setPotential(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">Select</option>
                  <option value="yes">High</option>
                  <option value="medium">Medium</option>
                  <option value="no">Low</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Business Categories</label>
                <select
                  value={businessCategoryId}
                  onChange={(e) => setBusinessCategoryId(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">Select</option>
                  {productCategories.map((pc) => (
                    <option key={pc.id} value={pc.id}>
                      {pc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Product They Manufacture Or Supply</label>
                <input
                  type="text"
                  value={productManufactureOrSupply}
                  onChange={(e) => setProductManufactureOrSupply(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Machines Currently Buying From</label>
                <input
                  type="text"
                  value={machinesBuyingFrom}
                  onChange={(e) => setMachinesBuyingFrom(e.target.value)}
                  style={inputStyle}
                />
              </div>

              {/* Row 3: Spares Currently Buying From, Products Interested, GST Reg Date, Age of Company */}
              <div>
                <label style={labelStyle}>Spares Currently Buying From</label>
                <input
                  type="text"
                  value={sparesBuyingFrom}
                  onChange={(e) => setSparesBuyingFrom(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Products Interested To Buy From Us</label>
                <input
                  type="text"
                  value={productsInterested}
                  onChange={(e) => setProductsInterested(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>GST Registration Date</label>
                <input
                  type="date"
                  value={gstRegistrationDate}
                  onChange={handleGstDateChange}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Age Of Company</label>
                <input
                  type="text"
                  value={ageOfCompany}
                  onChange={(e) => setAgeOfCompany(e.target.value)}
                  placeholder="e.g. 5 Years"
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          {/* SECTION: SOCIAL MEDIA DETAILS */}
          <div style={{ marginTop: "32px" }}>
            <h2
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: "#1e293b",
                margin: "0 0 16px 0",
              }}
            >
              Social Media Details
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "800px" }}>
              {socialMediaList.map((item, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <select
                    value={item.platform}
                    onChange={(e) => handleSocialMediaChange(idx, "platform", e.target.value)}
                    style={{ ...selectStyle, width: "200px" }}
                  >
                    <option value="">Select</option>
                    <option value="LinkedIn">LinkedIn</option>
                    <option value="Facebook">Facebook</option>
                    <option value="Instagram">Instagram</option>
                    <option value="Twitter">Twitter / X</option>
                    <option value="YouTube">YouTube</option>
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="Website">Website</option>
                    <option value="IndiaMART">IndiaMART</option>
                    <option value="TradeIndia">TradeIndia</option>
                    <option value="Other">Other</option>
                  </select>

                  <input
                    type="text"
                    value={item.link}
                    onChange={(e) => handleSocialMediaChange(idx, "link", e.target.value)}
                    placeholder="Enter your link..."
                    style={{ ...inputStyle, flex: 1 }}
                  />

                  <button
                    type="button"
                    onClick={() => handleRemoveSocialMedia(idx)}
                    style={{
                      background: "#dc3545",
                      border: "none",
                      color: "#ffffff",
                      width: "38px",
                      height: "38px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "opacity 0.2s",
                    }}
                    title="Remove social link"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              ))}

              <div>
                <button
                  type="button"
                  onClick={handleAddSocialMedia}
                  style={{
                    background: "#0d6efd",
                    border: "none",
                    color: "#ffffff",
                    width: "38px",
                    height: "38px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: "4px",
                  }}
                  title="Add another social link"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* SECTION: OVERALL OBSERVATIONS / REMARKS / KEY STRENGTHS */}
          <div style={{ marginTop: "28px" }}>
            <label style={labelStyle}>Overall Observations / Remarks / Key Strengths</label>
            <textarea
              rows={3}
              value={overallRemarks}
              onChange={(e) => setOverallRemarks(e.target.value)}
              style={{
                width: "100%",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                padding: "10px 12px",
                fontSize: "13.5px",
                fontFamily: "inherit",
                resize: "vertical",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* SECTION: SALES PERSON */}
          <div style={{ marginTop: "20px", maxWidth: "340px" }}>
            <label style={labelStyle}>Sales Person</label>
            <select
              value={salesPersonId}
              onChange={(e) => setSalesPersonId(e.target.value)}
              style={selectStyle}
            >
              <option value="">Select</option>
              {salesPersons.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.full_name || sp.username}
                </option>
              ))}
            </select>
          </div>

          {/* BOTTOM ACTION BUTTONS: Save & Exit, Cancel */}
          <div style={{ marginTop: "32px", display: "flex", alignItems: "center", gap: "16px" }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: "#0d6efd",
                color: "#ffffff",
                border: "none",
                fontWeight: 600,
                fontSize: "14px",
                padding: "10px 24px",
                borderRadius: "6px",
                cursor: submitting ? "not-allowed" : "pointer",
                boxShadow: "0 2px 4px rgba(13, 110, 253, 0.2)",
                transition: "background 0.2s",
              }}
            >
              {submitting ? "Saving..." : "Save & Exit"}
            </button>
            <button
              type="button"
              onClick={onBack}
              disabled={submitting}
              style={{
                background: "none",
                border: "none",
                color: "#475569",
                fontWeight: 600,
                fontSize: "14px",
                cursor: "pointer",
                padding: "10px 16px",
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

// Consistent Form Field Styles matching screenshots
const labelStyle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 500,
  color: "#334155",
  marginBottom: "6px",
  display: "block",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: "38px",
  border: "1px solid #cbd5e1",
  borderRadius: "6px",
  padding: "6px 12px",
  fontSize: "13.5px",
  backgroundColor: "#ffffff",
  boxSizing: "border-box",
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  height: "38px",
  border: "1px solid #cbd5e1",
  borderRadius: "6px",
  padding: "6px 12px",
  fontSize: "13.5px",
  backgroundColor: "#ffffff",
  boxSizing: "border-box",
  outline: "none",
  cursor: "pointer",
};

function getInputStyle(hasError: boolean): React.CSSProperties {
  return {
    ...inputStyle,
    borderColor: hasError ? "#dc2626" : "#cbd5e1",
    backgroundColor: hasError ? "#fff5f5" : "#ffffff",
  };
}

function getSelectStyle(hasError: boolean): React.CSSProperties {
  return {
    ...selectStyle,
    borderColor: hasError ? "#dc2626" : "#cbd5e1",
    backgroundColor: hasError ? "#fff5f5" : "#ffffff",
  };
}

const errorTextStyle: React.CSSProperties = {
  color: "#dc2626",
  fontSize: "12px",
  marginTop: "4px",
  display: "block",
};
