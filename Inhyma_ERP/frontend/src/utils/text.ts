/** Text formatting & string helpers for ERP frontend */

export function autoTitleCase(text: string, id?: string, type?: string): string {
  if (!text) return "";

  const lowerId = (id || "").toLowerCase();
  const lowerType = (type || "text").toLowerCase();

  if (
    lowerType === "email" ||
    lowerType === "password" ||
    lowerType === "number" ||
    lowerType === "url" ||
    lowerType === "tel" ||
    lowerType === "select" ||
    lowerId.endsWith("_id") ||
    lowerId.includes("type") ||
    lowerId.includes("status") ||
    lowerId.includes("salutation") ||
    lowerId.includes("gender") ||
    lowerId.includes("email") ||
    lowerId.includes("website") ||
    lowerId.includes("url") ||
    lowerId.includes("password") ||
    lowerId.includes("phone") ||
    lowerId.includes("calling") ||
    lowerId.includes("whatsapp") ||
    lowerId.includes("wechat") ||
    text.includes("@") ||
    text.startsWith("http://") ||
    text.startsWith("https://")
  ) {
    return text;
  }

  // Auto capitalize first letter of each word
  return text.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

/** Trim helper used by every toPayload(): "" becomes null, not an empty string. */
export function nullIfBlank(value: string | undefined): string | null {
  const trimmed = (value || "").trim();
  return trimmed === "" ? null : trimmed;
}

/** parseFloat that yields null for a blank field rather than NaN. */
export function numOrNull(value: string | undefined): number | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Converts numeric currency amounts to standard Indian English words (e.g., "Zero Rupees Only", "Two Lakh Seventy One Thousand Rupees Only") */
export function numberToIndianWords(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Zero Rupees Only";
  }

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
  ];

  function convertTwoDigits(num: number): string {
    if (num < 20) return ones[num];
    const unit = num % 10;
    const ten = Math.floor(num / 10);
    return tens[ten] + (unit ? " " + ones[unit] : "");
  }

  function convertThreeDigits(num: number): string {
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    let res = "";
    if (hundred) res += ones[hundred] + " Hundred";
    if (rest) {
      if (res) res += " ";
      res += convertTwoDigits(rest);
    }
    return res;
  }

  const rounded = Math.round(amount);
  let crore = Math.floor(rounded / 10000000);
  let lakh = Math.floor((rounded % 10000000) / 100000);
  let thousand = Math.floor((rounded % 100000) / 1000);
  let hundred = rounded % 1000;

  const parts: string[] = [];
  if (crore) parts.push(convertThreeDigits(crore) + " Crore");
  if (lakh) parts.push(convertTwoDigits(lakh) + " Lakh");
  if (thousand) parts.push(convertTwoDigits(thousand) + " Thousand");
  if (hundred) parts.push(convertThreeDigits(hundred));

  return (parts.join(" ") || "Zero") + " Rupees Only";
}

