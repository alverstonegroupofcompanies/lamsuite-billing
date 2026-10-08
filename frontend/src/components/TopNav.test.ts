import { describe, it, expect } from "vitest";
import { isNavGroup, NavGroupItem, NavDirectItem } from "./TopNav";
import { LayoutDashboard, FileText, Undo2, Building2, Truck, ArrowUpFromLine } from "lucide-react";

describe("TopNav Navigation Structure", () => {
  it("correctly identifies group items vs direct items", () => {
    const directItem: NavDirectItem = {
      id: "dashboard",
      name: "Dashboard",
      path: "/dashboard",
      key: "Home",
      icon: LayoutDashboard,
    };

    const groupItem: NavGroupItem = {
      id: "sales_group",
      name: "Sales & Bills",
      icon: FileText,
      children: [
        {
          id: "bills",
          name: "Past Bills & Invoices",
          path: "/bills",
          key: "F6",
          icon: FileText,
        },
        {
          id: "sales_returns",
          name: "Sales Returns & Credit Notes",
          path: "/returns/sales",
          key: "F7",
          icon: Undo2,
        },
        {
          id: "customer_debit_notes",
          name: "Customer Debit Notes (B2B)",
          path: "/returns/debit-notes",
          key: "Shift+F7",
          icon: Building2,
        },
      ],
    };

    expect(isNavGroup(directItem)).toBe(false);
    expect(isNavGroup(groupItem)).toBe(true);
    expect(groupItem.children).toHaveLength(3);
    expect(groupItem.children.map((c) => c.key)).toEqual(["F6", "F7", "Shift+F7"]);
  });

  it("ensures group items have non-empty keys and valid paths", () => {
    const purchasesGroup: NavGroupItem = {
      id: "purchases_group",
      name: "Purchases",
      icon: Truck,
      children: [
        {
          id: "purchases",
          name: "Inward Purchases",
          path: "/purchases",
          key: "F2",
          icon: Truck,
        },
        {
          id: "purchase_returns",
          name: "Purchase Returns (Debit Notes)",
          path: "/returns/purchases",
          key: "Shift+F2",
          icon: ArrowUpFromLine,
        },
      ],
    };

    expect(purchasesGroup.children[0].key).toBe("F2");
    expect(purchasesGroup.children[1].key).toBe("Shift+F2");
    expect(purchasesGroup.children[0].path).toBe("/purchases");
    expect(purchasesGroup.children[1].path).toBe("/returns/purchases");
  });
});
