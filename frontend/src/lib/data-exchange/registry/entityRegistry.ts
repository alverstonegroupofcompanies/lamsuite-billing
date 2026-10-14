import type { EntityDefinition, EntityCategory } from "./types";
import { itemsDefinition } from "./definitions/items";
import { batchesDefinition } from "./definitions/batches";
import {
  customersDefinition,
  suppliersDefinition,
  doctorsDefinition,
  patientsDefinition,
} from "./definitions/parties";
import {
  groupsDefinition,
  brandsDefinition,
  manufacturersDefinition,
  unitsDefinition,
} from "./definitions/categorisation";
import {
  discountSchemasDefinition,
  banksDefinition,
  expenseHeadsDefinition,
} from "./definitions/financeMasters";
import {
  salesInvoicesDefinition,
  purchasesDefinition,
  salesReturnsDefinition,
  purchaseReturnsDefinition,
  quotationsDefinition,
} from "./definitions/transactions";
import { stockEventsDefinition } from "./definitions/stockEvents";
import {
  customerOpeningBalancesDefinition,
  supplierOpeningBalancesDefinition,
} from "./definitions/openingBalances";
import { reportsExportDefinition } from "./definitions/reportsMeta";

export class EntityRegistry {
  private definitions = new Map<string, EntityDefinition>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    // 1. Catalog & Stock Masters
    this.register(itemsDefinition);
    this.register(batchesDefinition);

    // 2. Parties
    this.register(customersDefinition);
    this.register(suppliersDefinition);
    this.register(doctorsDefinition);
    this.register(patientsDefinition);

    // 3. Categorisation
    this.register(groupsDefinition);
    this.register(brandsDefinition);
    this.register(manufacturersDefinition);
    this.register(unitsDefinition);

    // 4. Finance Masters
    this.register(discountSchemasDefinition);
    this.register(banksDefinition);
    this.register(expenseHeadsDefinition);

    // 5. Transactions
    this.register(salesInvoicesDefinition);
    this.register(purchasesDefinition);
    this.register(salesReturnsDefinition);
    this.register(purchaseReturnsDefinition);
    this.register(quotationsDefinition);

    // 6. Stock Movements & Balances
    this.register(stockEventsDefinition);
    this.register(customerOpeningBalancesDefinition);
    this.register(supplierOpeningBalancesDefinition);

    // 7. Reports
    this.register(reportsExportDefinition);
  }

  /**
   * Register a new or custom entity definition.
   * A new data type requires only one call to this method.
   */
  register(definition: EntityDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  get(id: string): EntityDefinition | undefined {
    return this.definitions.get(id);
  }

  require(id: string): EntityDefinition {
    const def = this.definitions.get(id);
    if (!def) {
      throw new Error(`Data Exchange entity definition not found for id: "${id}"`);
    }
    return def;
  }

  getAll(): EntityDefinition[] {
    return Array.from(this.definitions.values());
  }

  getByCategory(category: EntityCategory): EntityDefinition[] {
    return this.getAll().filter((def) => def.category === category);
  }

  getImportable(): EntityDefinition[] {
    return this.getAll().filter((def) => def.category !== "reports");
  }

  getExportable(): EntityDefinition[] {
    return this.getAll();
  }

  /**
   * Check if a given user/role permissions array allows managing this entity.
   */
  canAccess(definition: EntityDefinition, permissions?: string[]): boolean {
    if (!permissions || permissions.includes("all") || permissions.includes("super_admin")) {
      return true;
    }
    return permissions.includes(definition.requiredPermission);
  }
}

export const entityRegistry = new EntityRegistry();
