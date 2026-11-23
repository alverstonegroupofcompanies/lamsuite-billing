/**
 * GST state codes as the documents print them ("32-Kerala").
 *
 * Every till used to hardcode Kerala for walk-in sales, which put the wrong
 * place of supply on a bill from any other state. One table lets each screen
 * name its own store's state instead.
 */
export const GST_STATE_NAMES: Record<string, string> = {
  "01": "Jammu & Kashmir",
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
  "25": "Daman & Diu",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

/** The known two-digit code at the front of a code, label or GSTIN. */
export function stateCodeOf(value?: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (raw.length < 2 || !/^\d{2}/.test(raw)) return null;
  const code = raw.slice(0, 2);
  return GST_STATE_NAMES[code] ? code : null;
}

/** "29" / "29-Karnataka" / "29ABCDE1234F1Z5" -> "29-Karnataka". */
export function stateLabel(value?: string | null, fallbackCode = "32"): string {
  const code = stateCodeOf(value) ?? stateCodeOf(fallbackCode) ?? "32";
  return `${code}-${GST_STATE_NAMES[code]}`;
}
