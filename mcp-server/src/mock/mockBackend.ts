import express, { type Request, type Response } from "express";
import cors from "cors";
import type { Server } from "http";

export interface MockBackendOptions {
  port?: number;
}

export class MockLamSuiteBackend {
  public app: express.Express;
  public server?: Server;
  public port: number;

  // In-memory data store
  public storeProfile = {
    id: 1,
    name: "LamStone Pharmacy & Retail",
    code: "STORE-01",
    phone: "9876543210",
    email: "store@lamstone.in",
    address: "Main Road, Palakkad, Kerala",
    state_code: "32",
    gstin: "32AAAAA0000A1Z5",
    drug_license_numbers: ["20B-123456", "21B-123457"],
    fssai_no: "10020041000123",
    tax_mode: "inclusive" as const,
    invoice_prefix: "INV",
    enabled_menu_items: ["pos", "purchases", "stock", "reports", "masters", "settings"],
  };

  public products: any[] = [
    {
      id: "prod_dolo650",
      name: "Dolo 650 Tablet",
      print_name: "Dolo 650mg",
      barcode: "8901234567890",
      hsn_sac_code: "30049099",
      mrp: 35.0,
      sel_rate: 30.0,
      ptr: 24.0,
      pts: 22.5,
      gst_percent: 12,
      units_per_pack: 15,
      generic_name: "Paracetamol 650mg",
      rack_location: "RACK-A",
      shelf_location: "SHELF-1",
      reorder_level: 25,
      current_stock: 70,
      is_active: true,
      batches: [
        {
          id: "batch_dl099",
          product_id: "prod_dolo650",
          batch_no: "DL099",
          mfg_date: "2025-01-01",
          expiry_date: "2027-03-31", // Earliest valid batch -> FEFO choice!
          stock_qty: 20,
          mrp: 35.0,
          selling_rate: 30.0,
        },
        {
          id: "batch_dl101",
          product_id: "prod_dolo650",
          batch_no: "DL101",
          mfg_date: "2025-06-01",
          expiry_date: "2027-08-31",
          stock_qty: 50,
          mrp: 35.0,
          selling_rate: 30.0,
        },
        {
          id: "batch_dl080_exp",
          product_id: "prod_dolo650",
          batch_no: "DL080",
          mfg_date: "2023-01-01",
          expiry_date: "2024-01-01", // Expired
          stock_qty: 15,
          mrp: 32.0,
          selling_rate: 28.0,
        },
      ],
    },
    {
      id: "prod_azithro500",
      name: "Azithromycin 500mg Tablet",
      barcode: "8909876543210",
      hsn_sac_code: "30049099",
      mrp: 120.0,
      sel_rate: 110.0,
      gst_percent: 12,
      units_per_pack: 3,
      generic_name: "Azithromycin 500mg",
      reorder_level: 10,
      current_stock: 3, // Low stock
      is_active: true,
      batches: [
        {
          id: "batch_az01",
          product_id: "prod_azithro500",
          batch_no: "AZ-501",
          expiry_date: "2027-12-31",
          stock_qty: 3,
          mrp: 120.0,
          selling_rate: 110.0,
        },
      ],
    },
    {
      id: "prod_pan40",
      name: "Pan 40 Tablet",
      barcode: "8901112223334",
      hsn_sac_code: "30049099",
      mrp: 95.0,
      sel_rate: 85.0,
      gst_percent: 12,
      units_per_pack: 15,
      generic_name: "Pantoprazole 40mg",
      reorder_level: 15,
      current_stock: 4, // Low stock
      is_active: true,
      batches: [
        {
          id: "batch_pan01",
          product_id: "prod_pan40",
          batch_no: "P40-99",
          expiry_date: "2026-11-30", // Near expiry (approx 60 days)
          stock_qty: 4,
          mrp: 95.0,
          selling_rate: 85.0,
        },
      ],
    },
    {
      id: "prod_amox500",
      name: "Amoxicillin 500mg Capsule",
      barcode: "8902223334445",
      hsn_sac_code: "30049099",
      mrp: 75.0,
      sel_rate: 68.0,
      gst_percent: 12,
      units_per_pack: 10,
      reorder_level: 8,
      current_stock: 2, // Low stock
      is_active: true,
      batches: [],
    },
    {
      id: "prod_cetirizine",
      name: "Cetirizine 10mg Tablet",
      barcode: "8903334445556",
      hsn_sac_code: "30049099",
      mrp: 20.0,
      sel_rate: 18.0,
      gst_percent: 12,
      units_per_pack: 10,
      reorder_level: 20,
      current_stock: 5, // Low stock
      is_active: true,
      batches: [],
    },
    {
      id: "prod_vitaminc",
      name: "Limcee Vitamin C 500mg",
      barcode: "8904445556667",
      hsn_sac_code: "30049099",
      mrp: 25.0,
      sel_rate: 22.0,
      gst_percent: 5,
      units_per_pack: 15,
      reorder_level: 10,
      current_stock: 1, // Low stock
      is_active: true,
      batches: [],
    },
  ];

  public customers = [
    {
      id: "cust_walkin",
      name: "Walk-in Customer",
      phone: "9876543210",
      outstanding_balance: 0,
      is_active: true,
    },
    {
      id: "cust_1",
      name: "Rahul Sharma",
      phone: "9847012345",
      gstin: "32ABCDE1234F1Z5",
      address: "12 Gandhi Nagar, Palakkad",
      outstanding_balance: 1500,
      credit_limit: 5000,
      is_active: true,
    },
    {
      id: "cust_2",
      name: "Dr. Priya Nair",
      phone: "9447123456",
      address: "City Hospital Rd, Palakkad",
      outstanding_balance: 3200,
      credit_limit: 10000,
      is_active: true,
    },
  ];

  public suppliers = [
    {
      id: "sup_1",
      name: "MedPlus Wholesale Distributors",
      phone: "9446011223",
      gstin: "32AAACM1234F1Z1",
      address: "Industrial Estate, Palakkad",
      credit_period_days: 30,
      outstanding_balance: 24500,
      is_active: true,
    },
    {
      id: "sup_2",
      name: "Alverstone Pharma Logistics",
      phone: "9447099887",
      gstin: "32AABCA5678B1Z9",
      address: "Cochin Hub, Kerala",
      credit_period_days: 21,
      outstanding_balance: 12000,
      is_active: true,
    },
  ];

  public invoices: any[] = [];
  public purchases: any[] = [];
  public stockAdjustments: any[] = [];
  public customerPayments: any[] = [];
  public supplierPayments: any[] = [];
  public idempotencyKeys: Set<string> = new Set();
  public invoiceCounter = 1001;

  constructor(options: MockBackendOptions = {}) {
    this.port = options.port || 8000;
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use((req, _res, next) => {
      if (req.url.startsWith("/api/")) {
        req.url = req.url.slice(4);
      } else if (req.url === "/api") {
        req.url = "/";
      }
      next();
    });
    this.seedInitialInvoices();
    this.setupRoutes();
  }

  private seedInitialInvoices() {
    const today = new Date().toISOString().slice(0, 10);
    this.invoices = [
      {
        id: "inv_1000",
        invoice_number: "INV-1000",
        invoice_date: today,
        customer_id: "cust_walkin",
        customer_name: "Walk-in Customer",
        payment_mode: "Cash",
        subtotal: 150.0,
        discount_total: 0.0,
        tax_total: 16.07,
        cgst_total: 8.04,
        sgst_total: 8.04,
        igst_total: 0.0,
        round_off: 0.0,
        grand_total: 150.0,
        paid_amount: 150.0,
        status: "issued",
        items: [
          {
            product_id: "prod_dolo650",
            product_name: "Dolo 650 Tablet",
            batch_no: "DL099",
            qty: 5,
            unit_price: 30.0,
            gst_percent: 12,
            total_amount: 150.0,
          },
        ],
      },
    ];
  }

  private setupRoutes() {
    // Auth login
    this.app.post("/login", (req: Request, res: Response) => {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(422).json({ message: "Invalid credentials" });
      }
      return res.json({
        token: `mock_token_${Date.now()}`,
        user: { id: 1, name: "Store Admin", email, role: "admin" },
        store: this.storeProfile,
      });
    });

    // Store profile
    this.app.get("/store", (_req: Request, res: Response) => {
      res.json(this.storeProfile);
    });

    this.app.put("/store", (req: Request, res: Response) => {
      Object.assign(this.storeProfile, req.body);
      res.json({ success: true, store: this.storeProfile });
    });

    // Products
    this.app.get("/products", (req: Request, res: Response) => {
      const { query } = req.query;
      let list = this.products.filter((p) => p.is_active);
      if (query && typeof query === "string") {
        const q = query.toLowerCase();
        list = list.filter(
          (p) =>
            (p.name?.toLowerCase().includes(q) ?? false) ||
            (p.barcode?.toLowerCase().includes(q) ?? false) ||
            (p.generic_name?.toLowerCase().includes(q) ?? false)
        );
      }
      res.json({ data: list, total: list.length, current_page: 1 });
    });

    this.app.get("/products/:id", (req: Request, res: Response) => {
      const idOrBarcode = decodeURIComponent(String(req.params.id));
      const prod = this.products.find(
        (p) => p.id === idOrBarcode || p.barcode === idOrBarcode
      );
      if (!prod) {
        return res.status(404).json({ message: `Product '${idOrBarcode}' not found` });
      }
      res.json(prod);
    });

    this.app.post("/products", (req: Request, res: Response) => {
      const body = req.body;
      if (!body.name || !body.barcode || body.sel_rate === undefined) {
        return res.status(422).json({ message: "Validation error: name, barcode, and sel_rate are required." });
      }
      const newProd = {
        id: `prod_${Date.now()}`,
        name: body.name,
        barcode: body.barcode,
        mrp: Number(body.mrp) || Number(body.sel_rate),
        sel_rate: Number(body.sel_rate),
        ptr: body.ptr ? Number(body.ptr) : undefined,
        pts: body.pts ? Number(body.pts) : undefined,
        gst_percent: Number(body.gst_percent) || 12,
        units_per_pack: Number(body.units_per_pack) || 1,
        hsn_sac_code: body.hsn_sac_code || "30049099",
        generic_name: body.generic_name,
        rack_location: body.rack_location,
        shelf_location: body.shelf_location,
        reorder_level: Number(body.reorder_level) || 10,
        current_stock: 0,
        is_active: true,
        batches: [],
      };
      this.products.push(newProd);
      res.status(201).json(newProd);
    });

    this.app.put("/products/:id", (req: Request, res: Response) => {
      const prod = this.products.find((p) => p.id === req.params.id);
      if (!prod) {
        return res.status(404).json({ message: "Product not found" });
      }
      Object.assign(prod, req.body);
      res.json(prod);
    });

    this.app.post("/products/:id/batches", (req: Request, res: Response) => {
      const prod = this.products.find((p) => p.id === req.params.id);
      if (!prod) {
        return res.status(404).json({ message: "Product not found" });
      }
      const newBatch = {
        id: `batch_${Date.now()}`,
        product_id: prod.id,
        batch_no: req.body.batch_no,
        mfg_date: req.body.mfg_date,
        expiry_date: req.body.expiry_date,
        stock_qty: Number(req.body.stock_qty) || 0,
        mrp: Number(req.body.mrp) || prod.mrp,
        selling_rate: Number(req.body.selling_rate) || prod.sel_rate,
      };
      if (!prod.batches) prod.batches = [];
      prod.batches.push(newBatch);
      prod.current_stock = (prod.current_stock || 0) + newBatch.stock_qty;
      res.status(201).json(newBatch);
    });

    // Stock alerts
    this.app.get("/stock/products/low-stock", (req: Request, res: Response) => {
      const threshold = req.query.threshold ? Number(req.query.threshold) : undefined;
      const low = this.products.filter((p) => {
        if (!p.is_active) return false;
        const current = p.current_stock ?? 0;
        const limit = threshold !== undefined ? threshold : (p.reorder_level ?? 10);
        return current <= limit;
      });
      res.json(low);
    });

    this.app.get("/stock/batches/near-expiry", (req: Request, res: Response) => {
      const days = Number(req.query.threshold_days) || 60;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const result: any[] = [];
      for (const prod of this.products) {
        for (const batch of prod.batches || []) {
          if (days === 0) {
            // Expired stock only
            if (batch.expiry_date < new Date().toISOString().slice(0, 10)) {
              result.push({ ...batch, product_name: prod.name });
            }
          } else {
            if (
              batch.stock_qty > 0 &&
              batch.expiry_date <= cutoffStr &&
              batch.expiry_date >= new Date().toISOString().slice(0, 10)
            ) {
              result.push({ ...batch, product_name: prod.name });
            }
          }
        }
      }
      res.json(result);
    });

    // Invoices
    this.app.get("/invoices", (req: Request, res: Response) => {
      let list = [...this.invoices];
      const { customer_id, status } = req.query;
      if (customer_id) list = list.filter((i) => i.customer_id === customer_id);
      if (status && status !== "all") list = list.filter((i) => i.status === status);
      res.json({ data: list, total: list.length, current_page: 1 });
    });

    this.app.get("/invoices/:id", (req: Request, res: Response) => {
      const idOrNo = decodeURIComponent(String(req.params.id));
      const inv = this.invoices.find(
        (i) => String(i.id) === idOrNo || i.invoice_number === idOrNo
      );
      if (!inv) return res.status(404).json({ message: "Invoice not found" });
      res.json(inv);
    });

    this.app.post("/invoices", (req: Request, res: Response) => {
      const body = req.body;
      const key = body.external_id || body.idempotency_key;

      if (key && this.idempotencyKeys.has(key)) {
        const existing = this.invoices.find((i) => i.external_id === key);
        if (existing) {
          return res.status(200).json(existing);
        }
      }

      // Check stock limits & deduct
      if (Array.isArray(body.lines || body.items)) {
        const lines = body.lines || body.items;
        for (const line of lines) {
          const prod = this.products.find((p) => p.id === line.product_id);
          if (prod && line.batch_no) {
            const batch = prod.batches?.find((b: any) => b.batch_no === line.batch_no);
            if (batch) {
              if (batch.stock_qty < line.qty) {
                return res.status(422).json({
                  message: `Stock limit exceeded for batch ${line.batch_no}. Available: ${batch.stock_qty}, Requested: ${line.qty}`,
                });
              }
              batch.stock_qty -= line.qty;
              prod.current_stock = (prod.current_stock || 0) - line.qty;
            }
          }
        }
      }

      const invNo = `INV-${this.invoiceCounter++}`;
      const newInvoice = {
        id: `inv_${Date.now()}`,
        external_id: key,
        invoice_number: invNo,
        invoice_date: body.invoice_date || new Date().toISOString().slice(0, 10),
        customer_id: body.customer_id || "cust_walkin",
        customer_name: body.customer_name || "Walk-in Customer",
        customer_gstin: body.customer_gstin,
        place_of_supply: body.place_of_supply || "32",
        subtotal: Number(body.subtotal) || 0,
        discount_total: Number(body.discount_total) || 0,
        tax_total: Number(body.tax_total) || 0,
        cgst_total: Number(body.cgst_total) || 0,
        sgst_total: Number(body.sgst_total) || 0,
        igst_total: Number(body.igst_total) || 0,
        round_off: Number(body.round_off) || 0,
        grand_total: Number(body.grand_total) || 0,
        paid_amount: Number(body.paid_amount) || Number(body.grand_total) || 0,
        payment_mode: body.payment_mode || "Cash",
        status: "issued",
        patient_name: body.patient_name,
        doctor_name: body.doctor_name,
        doctor_reg_no: body.doctor_reg_no,
        items: body.lines || body.items || [],
        created_at: new Date().toISOString(),
      };

      if (key) {
        this.idempotencyKeys.add(key);
      }

      this.invoices.unshift(newInvoice);
      res.status(201).json(newInvoice);
    });

    this.app.post("/invoices/:id/cancel", (req: Request, res: Response) => {
      // Role verification
      const userRole = req.headers["x-user-role"] as string;
      if (userRole === "cashier" || userRole === "auditor") {
        return res.status(403).json({
          message: `Permission denied: Role '${userRole}' cannot cancel invoices.`,
        });
      }

      const inv = this.invoices.find(
        (i) => String(i.id) === req.params.id || i.invoice_number === req.params.id
      );
      if (!inv) return res.status(404).json({ message: "Invoice not found" });

      const { reason } = req.body;
      if (!reason || reason.trim() === "") {
        return res.status(422).json({ message: "A valid cancellation reason is required" });
      }

      inv.status = "cancelled";
      inv.cancellation_reason = reason;

      // Restore stock
      for (const line of inv.items || []) {
        const prod = this.products.find((p) => p.id === line.product_id);
        if (prod && line.batch_no) {
          const batch = prod.batches?.find((b: any) => b.batch_no === line.batch_no);
          if (batch) {
            batch.stock_qty += line.qty;
            prod.current_stock = (prod.current_stock || 0) + line.qty;
          }
        }
      }

      res.json({ success: true, status: "cancelled", invoice_id: inv.id });
    });

    // Customers
    this.app.get("/customers", (req: Request, res: Response) => {
      const { query } = req.query;
      let list = [...this.customers];
      if (query && typeof query === "string") {
        const q = query.toLowerCase();
        list = list.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
      }
      res.json({ data: list, total: list.length });
    });

    this.app.get("/customers/:id", (req: Request, res: Response) => {
      const cust = this.customers.find(
        (c) => c.id === req.params.id || c.phone === req.params.id
      );
      if (!cust) return res.status(404).json({ message: "Customer not found" });
      res.json(cust);
    });

    this.app.post("/customers", (req: Request, res: Response) => {
      const { name, phone, gstin, address, credit_limit } = req.body;
      if (!name || !phone) {
        return res.status(422).json({ message: "Customer name and phone are required." });
      }
      const newCust = {
        id: `cust_${Date.now()}`,
        name,
        phone,
        gstin,
        address,
        outstanding_balance: 0,
        credit_limit: credit_limit ? Number(credit_limit) : 0,
        is_active: true,
      };
      this.customers.push(newCust);
      res.status(201).json(newCust);
    });

    // Suppliers
    this.app.get("/suppliers", (req: Request, res: Response) => {
      res.json({ data: this.suppliers, total: this.suppliers.length });
    });

    this.app.get("/suppliers/:id", (req: Request, res: Response) => {
      const sup = this.suppliers.find((s) => s.id === req.params.id);
      if (!sup) return res.status(404).json({ message: "Supplier not found" });
      res.json(sup);
    });

    // Purchases
    this.app.get("/purchases", (_req: Request, res: Response) => {
      res.json({ data: this.purchases, total: this.purchases.length });
    });

    this.app.get("/purchases/:id", (req: Request, res: Response) => {
      const p = this.purchases.find(
        (item) => String(item.id) === req.params.id || item.purchase_number === req.params.id
      );
      if (!p) return res.status(404).json({ message: "Purchase bill not found" });
      res.json(p);
    });

    this.app.post("/purchases", (req: Request, res: Response) => {
      const body = req.body;
      const newPur = {
        id: `pb_${Date.now()}`,
        purchase_number: body.purchase_number,
        purchase_date: body.purchase_date,
        supplier_id: body.supplier_id,
        grand_total: body.grand_total,
        items: body.items,
        status: "received",
      };
      this.purchases.push(newPur);
      res.status(201).json(newPur);
    });

    // Stock adjustments
    this.app.post("/stock/adjustments", (req: Request, res: Response) => {
      const userRole = req.headers["x-user-role"] as string;
      if (userRole === "cashier" || userRole === "auditor") {
        return res.status(403).json({
          message: `Permission denied: Role '${userRole}' cannot make stock adjustments.`,
        });
      }

      const { product_id, batch_no, adjustment_type, qty, reason } = req.body;
      if (!reason) {
        return res.status(422).json({ message: "Reason is required for stock adjustment" });
      }

      const prod = this.products.find((p) => p.id === product_id);
      if (!prod) return res.status(404).json({ message: "Product not found" });

      const batch = prod.batches?.find((b: any) => b.batch_no === batch_no);
      if (batch) {
        if (adjustment_type === "add") {
          batch.stock_qty += Number(qty);
          prod.current_stock = (prod.current_stock || 0) + Number(qty);
        } else if (adjustment_type === "reduce") {
          batch.stock_qty = Math.max(0, batch.stock_qty - Number(qty));
          prod.current_stock = Math.max(0, (prod.current_stock || 0) - Number(qty));
        } else if (adjustment_type === "set") {
          const delta = Number(qty) - batch.stock_qty;
          batch.stock_qty = Number(qty);
          prod.current_stock = (prod.current_stock || 0) + delta;
        }
      }

      const adj = {
        id: `adj_${Date.now()}`,
        product_id,
        batch_no,
        adjustment_type,
        qty,
        reason,
        created_at: new Date().toISOString(),
      };
      this.stockAdjustments.push(adj);
      res.status(201).json({ success: true, adjustment: adj });
    });

    // Reports
    this.app.get("/reports/daily-collection", (req: Request, res: Response) => {
      const today = new Date().toISOString().slice(0, 10);
      const start = (req.query.start_date as string) || today;
      const end = (req.query.end_date as string) || today;

      const activeInvoices = this.invoices.filter(
        (i) => i.invoice_date >= start && i.invoice_date <= end && i.status !== "cancelled"
      );

      const grossSales = activeInvoices.reduce((sum, i) => sum + Number(i.grand_total || 0), 0);
      const byTender = {
        Cash: activeInvoices.filter((i) => i.payment_mode === "Cash").reduce((s, i) => s + i.grand_total, 0),
        UPI: activeInvoices.filter((i) => i.payment_mode === "UPI").reduce((s, i) => s + i.grand_total, 0),
        Card: activeInvoices.filter((i) => i.payment_mode === "Card").reduce((s, i) => s + i.grand_total, 0),
        Credit: activeInvoices.filter((i) => i.payment_mode === "Credit").reduce((s, i) => s + i.grand_total, 0),
      };

      res.json({
        date_range: { start_date: start, end_date: end },
        total_invoices_count: activeInvoices.length,
        gross_sales: grossSales,
        total_returns: 0,
        net_sales: grossSales,
        by_tender: byTender,
        total_taxable: activeInvoices.reduce((s, i) => s + (i.subtotal || 0), 0),
        total_tax: activeInvoices.reduce((s, i) => s + (i.tax_total || 0), 0),
        total_round_off: 0,
      });
    });

    this.app.get("/reports/gstr-1", (_req: Request, res: Response) => {
      res.json({
        tax_period: { month: "October", year: "2026" },
        table_4_b2b: [],
        table_5_b2c_large: [],
        table_7_b2c_small: [
          { place_of_supply: "32", taxable_value: 133.93, tax_amount: 16.07 },
        ],
        table_9_credit_debit_notes: [],
      });
    });

    this.app.get("/reports/hsn-summary", (_req: Request, res: Response) => {
      res.json([
        {
          hsn_code: "30049099",
          description: "Medicaments of other substances",
          uqc: "NOS",
          total_qty: 5,
          total_value: 150.0,
          taxable_value: 133.93,
          integrated_tax: 0,
          central_tax: 8.04,
          state_tax: 8.04,
          cess_amount: 0,
        },
      ]);
    });

    this.app.get("/reports/customer-aging", (_req: Request, res: Response) => {
      res.json({
        party_type: "customer",
        records: this.customers.map((c) => ({
          customer_id: c.id,
          name: c.name,
          phone: c.phone,
          outstanding_balance: c.outstanding_balance || 0,
          buckets: {
            current_0_30: c.outstanding_balance || 0,
            overdue_31_60: 0,
            overdue_61_90: 0,
            overdue_90_plus: 0,
          },
        })),
      });
    });

    this.app.get("/reports/top-selling", (req: Request, res: Response) => {
      const limit = Number(req.query.limit) || 10;
      res.json([
        {
          product_id: "prod_dolo650",
          name: "Dolo 650 Tablet",
          qty_sold: 520,
          revenue: 15600.0,
          margin_percent: 25.0,
        },
        {
          product_id: "prod_pan40",
          name: "Pan 40 Tablet",
          qty_sold: 210,
          revenue: 17850.0,
          margin_percent: 22.0,
        },
      ].slice(0, limit));
    });

    this.app.get("/reports/cash-book", (_req: Request, res: Response) => {
      res.json({
        date: new Date().toISOString().slice(0, 10),
        opening_cash: 5000.0,
        cash_sales: 150.0,
        upi_collections: 0.0,
        expenses: 0.0,
        closing_cash: 5150.0,
      });
    });

    this.app.get("/reports/daily-summary", (req: Request, res: Response) => {
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      res.json({
        date,
        total_sales: 150.0,
        invoice_count: 1,
        cash_collection: 150.0,
        upi_collection: 0.0,
        card_collection: 0.0,
        credit_collection: 0.0,
        low_stock_count: 5,
        near_expiry_count: 1,
      });
    });

    this.app.get("/reports/profit", (_req: Request, res: Response) => {
      res.json({
        total_revenue: 150.0,
        total_cogs: 112.5,
        gross_profit: 37.5,
        gross_margin_percent: 25.0,
      });
    });

    this.app.get("/stock/ledger", (_req: Request, res: Response) => {
      res.json([
        {
          id: "tx_1",
          date: new Date().toISOString(),
          product_name: "Dolo 650 Tablet",
          batch_no: "DL099",
          type: "SALE",
          qty: -5,
          balance: 20,
          reference: "INV-1000",
        },
      ]);
    });

    this.app.get("/stock/balance", (_req: Request, res: Response) => {
      res.json(
        this.products.map((p) => ({
          product_id: p.id,
          name: p.name,
          current_stock: p.current_stock || 0,
          sel_rate: p.sel_rate,
          mrp: p.mrp,
          stock_value_selling: (p.current_stock || 0) * p.sel_rate,
        }))
      );
    });

    // Payments
    this.app.post("/payments/customer", (req: Request, res: Response) => {
      const { customer_id, amount, payment_mode } = req.body;
      const cust = this.customers.find((c) => c.id === customer_id);
      if (cust) {
        cust.outstanding_balance = Math.max(0, (cust.outstanding_balance || 0) - Number(amount));
      }
      const record = {
        id: `pay_${Date.now()}`,
        customer_id,
        amount,
        payment_mode,
        created_at: new Date().toISOString(),
      };
      this.customerPayments.push(record);
      res.status(201).json({ success: true, payment: record });
    });

    this.app.post("/payments/supplier", (req: Request, res: Response) => {
      const { supplier_id, amount, payment_mode } = req.body;
      const sup = this.suppliers.find((s) => s.id === supplier_id);
      if (sup) {
        sup.outstanding_balance = Math.max(0, (sup.outstanding_balance || 0) - Number(amount));
      }
      const record = {
        id: `spay_${Date.now()}`,
        supplier_id,
        amount,
        payment_mode,
        created_at: new Date().toISOString(),
      };
      this.supplierPayments.push(record);
      res.status(201).json({ success: true, payment: record });
    });

    // Returns
    this.app.get("/returns", (_req: Request, res: Response) => {
      res.json({ data: [], total: 0 });
    });

    this.app.post("/returns/sales", (req: Request, res: Response) => {
      res.status(201).json({
        success: true,
        credit_note_number: `CN-${Date.now().toString().slice(-4)}`,
        refund_amount: req.body.refund_amount || 0,
      });
    });

    this.app.post("/returns/purchase", (req: Request, res: Response) => {
      res.status(201).json({
        success: true,
        debit_note_number: `DN-${Date.now().toString().slice(-4)}`,
      });
    });

    this.app.get("/counters", (_req: Request, res: Response) => {
      res.json([
        {
          id: "cntr_01",
          counter_name: "Counter 01 (Store Hub)",
          counter_code: "C01",
          is_hub: true,
          status: "active",
          current_user: "Muhammad Anshad",
          user_role: "admin",
          drawer_cash: 14500,
        },
        {
          id: "cntr_02",
          counter_name: "Counter 02",
          counter_code: "C02",
          is_hub: false,
          status: "active",
          current_user: "Ananya Nair",
          user_role: "cashier",
          drawer_cash: 8200,
        },
      ]);
    });

    this.app.get("/shifts", (_req: Request, res: Response) => {
      res.json([
        {
          id: "shift_1",
          counter_id: "cntr_01",
          user_name: "Muhammad Anshad",
          opening_cash: 2000,
          expected_cash: 14500,
          status: "open",
        },
      ]);
    });
  }

  async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, "127.0.0.1", () => {
        const addr = this.server?.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
        }
        resolve(`http://127.0.0.1:${this.port}`);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
