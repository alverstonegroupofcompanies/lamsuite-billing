import { sqliteStorage } from "../db/sqliteStorage";
import { companySettingsService } from "../settings/companySettingsService";
import { getResolvedApiBaseUrl } from "../../config/env";
import { storeRegistryService } from "../auth/storeRegistryService";

export interface BranchStore {
  id: string;
  name: string;
  code: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  state_code: string; // e.g. "32" for Kerala, "33" for Tamil Nadu
  state_name?: string;
  gstin: string;
  drug_license_numbers?: string[];
  fssai_no?: string;
  is_main: boolean;
  is_active: boolean;
  created_at?: number;
}

export const INITIAL_BRANCH_STORES: BranchStore[] = [
  {
    id: "store_main",
    name: "LamStone Pharmacy & Clinic (Main Store)",
    code: "MAIN",
    phone: "9876543210",
    email: "main@lamstone.in",
    address: "Main Road, Palakkad, Kerala - 678001",
    city: "Palakkad",
    state_code: "32",
    state_name: "Kerala",
    gstin: "32AAAAA0000A1Z5",
    drug_license_numbers: ["20B-123456", "21B-123457"],
    fssai_no: "10020041000123",
    is_main: true,
    is_active: true,
  },
  {
    id: "store_north",
    name: "LamStone North Palakkad Branch",
    code: "NORTH",
    phone: "9876543211",
    email: "north@lamstone.in",
    address: "North Bypass Junction, Palakkad, Kerala - 678005",
    city: "Palakkad",
    state_code: "32",
    state_name: "Kerala",
    gstin: "32AAAAA0000A1Z5", // Same entity/GSTIN -> Stock Transfer Note
    drug_license_numbers: ["20B-223456", "21B-223457"],
    fssai_no: "10020041000124",
    is_main: false,
    is_active: true,
  },
  {
    id: "store_south_hub",
    name: "LamStone South Logistics Central Hub",
    code: "SOUTH_HUB",
    phone: "9876543212",
    email: "logistics@lamstone.in",
    address: "Kinfra Industrial Park, Kanjikode, Kerala - 678621",
    city: "Kanjikode",
    state_code: "32",
    state_name: "Kerala",
    gstin: "32AAAAA0000A1Z5",
    drug_license_numbers: ["20B-323456", "21B-323457"],
    fssai_no: "10020041000125",
    is_main: false,
    is_active: true,
  },
  {
    id: "store_coimbatore",
    name: "LamStone Coimbatore Medicare & Retail",
    code: "CBE_BR",
    phone: "9876543213",
    email: "cbe@lamstone.in",
    address: "Avinashi Road, Peelamedu, Coimbatore, Tamil Nadu - 641004",
    city: "Coimbatore",
    state_code: "33",
    state_name: "Tamil Nadu",
    gstin: "33AAAAA0000A1Z4", // Distinct State GSTIN -> Inter-State Delivery Challan / IGST
    drug_license_numbers: ["20B-TN-456789", "21B-TN-456790"],
    fssai_no: "10020041000126",
    is_main: false,
    is_active: true,
  },
  {
    id: "store_downtown",
    name: "LamStone Downtown Clinic & Medicos",
    code: "DOWNTOWN",
    phone: "9876543214",
    email: "downtown@lamstone.in",
    address: "City Centre Mall, Fort Road, Palakkad, Kerala - 678001",
    city: "Palakkad",
    state_code: "32",
    state_name: "Kerala",
    gstin: "32AAAAA0000A1Z5",
    drug_license_numbers: ["20B-523456", "21B-523457"],
    fssai_no: "10020041000127",
    is_main: false,
    is_active: true,
  },
];

export class StoreService {
  private seeded = false;

  async fetchBranchesFromApi(): Promise<BranchStore[]> {
    try {
      const baseUrl = getResolvedApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/branches`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return [];
      const json = await res.json();
      const rawStores = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
      if (rawStores.length === 0) return [];

      const branches: BranchStore[] = rawStores.map((s: any) => ({
        id: String(s.id),
        name: s.name,
        code: s.code || `STORE-${s.id}`,
        phone: s.phone || "",
        email: s.email || undefined,
        address: s.address || "",
        city: s.city || "",
        state_code: s.state_code || "32",
        state_name: s.state_name || (s.state_code === "33" ? "Tamil Nadu" : "Kerala"),
        gstin: s.gstin || "",
        drug_license_numbers: Array.isArray(s.drug_license_numbers) ? s.drug_license_numbers : [],
        fssai_no: s.fssai_no || undefined,
        is_main: Boolean(s.is_main),
        is_active: Boolean(s.is_active !== false),
      }));

      // Cache real branches in local SQLite
      for (const b of branches) {
        await sqliteStorage.insertRecord("stores", b.id, b as unknown as Record<string, unknown>).catch(() => {});
      }

      return branches;
    } catch (_) {
      return [];
    }
  }

  async ensureStoresSeeded(): Promise<void> {
    if (this.seeded) return;
    try {
      // 1. Try pulling fresh active stores from backend database
      const live = await this.fetchBranchesFromApi();
      if (live.length > 0) {
        this.seeded = true;
        return;
      }

      // 2. Check local SQLite cache
      const existing = await sqliteStorage.findAll<BranchStore>("stores");
      if (existing.length === 0) {
        for (const store of INITIAL_BRANCH_STORES) {
          await sqliteStorage.insertRecord("stores", store.id, store as unknown as Record<string, unknown>);
        }
      }
      this.seeded = true;
    } catch (_) {
      this.seeded = true;
    }
  }

  async getAllStores(): Promise<BranchStore[]> {
    // 1. Try pulling fresh active stores from DB
    const live = await this.fetchBranchesFromApi();
    if (live.length > 0) {
      return live.filter((s) => s.is_active !== false);
    }

    // 2. Fall back to local SQLite cache
    await this.ensureStoresSeeded();
    try {
      const stores = await sqliteStorage.findAll<BranchStore>("stores");
      if (stores && stores.length > 0) {
        return stores.filter((s) => s.is_active !== false);
      }
    } catch (_) {}

    // 3. Registered stores from client registry
    const reg = storeRegistryService.getStores();
    if (reg && reg.length > 0) {
      return reg.map((r) => ({
        id: String(r.id),
        name: r.name,
        code: r.code,
        phone: "",
        address: "",
        city: "",
        state_code: "32",
        gstin: "",
        is_main: r.is_hub,
        is_active: r.is_active,
      }));
    }

    return INITIAL_BRANCH_STORES.filter((s) => s.is_active);
  }

  async getStoreById(id: string): Promise<BranchStore | null> {
    const all = await this.getAllStores();
    return all.find((s) => String(s.id) === String(id) || s.code === id) || null;
  }

  async getCurrentStore(): Promise<BranchStore> {
    const regActive = storeRegistryService.getActiveStore();
    const settings = companySettingsService.getSettings();
    const currentId = String(regActive?.id || settings.store_id || "1");
    const currentCode = regActive?.code || "STORE-01";

    const all = await this.getAllStores();
    const found = all.find((s) => String(s.id) === currentId || s.code === currentCode);
    if (found) return found;

    return {
      id: currentId,
      name: regActive?.name || settings.store_name || "Main Store",
      code: currentCode,
      phone: settings.phone || "",
      email: settings.email,
      address: settings.address || "",
      city: (settings as any).city || "",
      state_code: settings.state_code || "32",
      gstin: settings.gstin || "32AAAAA0000A1Z5",
      drug_license_numbers: settings.drug_license_numbers || [],
      fssai_no: settings.fssai_no,
      is_main: true,
      is_active: true,
    };
  }

  async getDestinationStores(sourceStoreId: string): Promise<BranchStore[]> {
    const all = await this.getAllStores();
    return all.filter((s) => s.id !== sourceStoreId && s.is_active);
  }

  determineGstTreatment(
    sourceStore: BranchStore,
    destinationStore: BranchStore
  ): {
    treatment: "intra_state" | "inter_state";
    isSameGstin: boolean;
    description: string;
  } {
    const isSameState = (sourceStore.state_code || "32") === (destinationStore.state_code || "32");
    const isSameGstin =
      Boolean(sourceStore.gstin && destinationStore.gstin) &&
      sourceStore.gstin.trim().toUpperCase() === destinationStore.gstin.trim().toUpperCase();

    if (!isSameState || (!isSameGstin && sourceStore.state_code !== destinationStore.state_code)) {
      return {
        treatment: "inter_state",
        isSameGstin: false,
        description: `Inter-State Stock Transfer (${sourceStore.state_name || sourceStore.state_code} → ${destinationStore.state_name || destinationStore.state_code}). IGST applies under Section 31(7) / Rule 55.`,
      };
    }

    if (isSameGstin) {
      return {
        treatment: "intra_state",
        isSameGstin: true,
        description: "Intra-State Branch Transfer (Same GSTIN). Internal Stock Transfer Note / Delivery Challan under Rule 55.",
      };
    }

    return {
      treatment: "intra_state",
      isSameGstin: false,
      description: "Intra-State Distinct Person Transfer (CGST + SGST applies).",
    };
  }
}

export const storeService = new StoreService();
