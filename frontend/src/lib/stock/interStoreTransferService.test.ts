import { describe, it, expect, beforeEach } from "vitest";
import { interStoreTransferService, type InterStoreTransfer } from "./interStoreTransferService";
import { storeService } from "../masters/storeService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";

describe("Inter-Store Multi-Product Transfer Engine (STK-TRF-001 - STK-TRF-010)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    await storeService.ensureStoresSeeded();
  });

  const seedSampleCatalog = async () => {
    const prodA: ProductItem = {
      id: "prod_paracetamol",
      barcode: "8901234567890",
      name: "Dolo 650mg Tablet",
      sel_rate: 30,
      mrp: 35,
      ptr: 25,
      pts: 22,
      gst_percent: 12,
      units_per_pack: 15,
      is_active: true,
      current_stock: 150,
    };
    await productsStore.upsertProduct(prodA);

    const batchA1: ProductBatch = {
      id: "batch_dolo_1",
      product_id: "prod_paracetamol",
      batch_no: "DL-101",
      expiry_date: "2027-12-31",
      stock_qty: 100,
      mrp: 35,
      selling_rate: 30,
      purchase_rate: 20,
    };
    await productsStore.upsertBatch(batchA1);

    const batchA2: ProductBatch = {
      id: "batch_dolo_2",
      product_id: "prod_paracetamol",
      batch_no: "DL-102",
      expiry_date: "2028-06-30",
      stock_qty: 50,
      mrp: 35,
      selling_rate: 30,
      purchase_rate: 20,
    };
    await productsStore.upsertBatch(batchA2);

    const prodB: ProductItem = {
      id: "prod_syrup",
      barcode: "8909876543210",
      name: "Benadryl Cough Syrup 100ml",
      sel_rate: 110,
      mrp: 125,
      ptr: 95,
      pts: 88,
      gst_percent: 18,
      units_per_pack: 1,
      is_active: true,
      current_stock: 40,
    };
    await productsStore.upsertProduct(prodB);

    const batchB1: ProductBatch = {
      id: "batch_benadryl_1",
      product_id: "prod_syrup",
      batch_no: "BN-55",
      expiry_date: "2027-04-30",
      stock_qty: 40,
      mrp: 125,
      selling_rate: 110,
      purchase_rate: 80,
    };
    await productsStore.upsertBatch(batchB1);
  };

  describe("Draft Creation & Multi-Product Aggregation", () => {
    it("creates a multi-item transfer draft with intra-state CGST+SGST", async () => {
      await seedSampleCatalog();

      const transfer = await interStoreTransferService.createDraft({
        destination_store_id: "store_north",
        source_store_id: "store_main",
        transport_details: {
          transporter_name: "Swift Express",
          vehicle_number: "KL-09-AB-1234",
        },
        notes: "Urgent restocking for north branch",
        default_rate_basis: "sel_rate",
        lines: [
          {
            product_id: "prod_paracetamol",
            batch_id: "batch_dolo_1",
            transfer_packs: 2, // 2 packs = 30 units
            transfer_loose: 0,
          },
          {
            product_id: "prod_syrup",
            batch_id: "batch_benadryl_1",
            transfer_packs: 5,
            transfer_loose: 0,
          },
        ],
      });

      expect(transfer.id).toBeDefined();
      expect(transfer.status).toBe("draft");
      expect(transfer.gst_treatment).toBe("intra_state");
      expect(transfer.item_count).toBe(2);
      expect(transfer.lines.length).toBe(2);

      // Line 1: Dolo 650 (2 packs @ ₹30 = ₹60, GST 12% -> CGST ₹3.60, SGST ₹3.60)
      const line1 = transfer.lines[0];
      expect(line1.product_name).toBe("Dolo 650mg Tablet");
      expect(line1.transfer_total_qty).toBe(30);
      expect(line1.unit_rate).toBe(30);
      expect(line1.taxable_amount).toBe(60);
      expect(line1.cgst_amount).toBe(3.6);
      expect(line1.sgst_amount).toBe(3.6);
      expect(line1.igst_amount).toBe(0);
      expect(line1.total_amount).toBe(67.2);

      // Line 2: Benadryl (5 pcs @ ₹110 = ₹550, GST 18% -> CGST ₹49.50, SGST ₹49.50)
      const line2 = transfer.lines[1];
      expect(line2.taxable_amount).toBe(550);
      expect(line2.cgst_amount).toBe(49.5);
      expect(line2.sgst_amount).toBe(49.5);
      expect(line2.total_amount).toBe(649);

      // Totals
      expect(transfer.taxable_subtotal).toBe(610);
      expect(transfer.cgst_total).toBe(53.1);
      expect(transfer.sgst_total).toBe(53.1);
      expect(transfer.grand_total).toBe(716.2);
    });

    it("applies inter-state IGST when transferring to a branch with a different state GSTIN", async () => {
      await seedSampleCatalog();

      const transfer = await interStoreTransferService.createDraft({
        destination_store_id: "store_coimbatore", // Tamil Nadu (33)
        source_store_id: "store_main", // Kerala (32)
        lines: [
          {
            product_id: "prod_syrup",
            batch_id: "batch_benadryl_1",
            transfer_packs: 10,
          },
        ],
      });

      expect(transfer.gst_treatment).toBe("inter_state");
      const line = transfer.lines[0];
      expect(line.taxable_amount).toBe(1100);
      expect(line.cgst_amount).toBe(0);
      expect(line.sgst_amount).toBe(0);
      expect(line.igst_amount).toBe(198); // 18% IGST on ₹1100
      expect(line.total_amount).toBe(1298);
      expect(transfer.igst_total).toBe(198);
    });

    it("prevents selecting source store as destination store", async () => {
      await seedSampleCatalog();

      await expect(
        interStoreTransferService.createDraft({
          source_store_id: "store_main",
          destination_store_id: "store_main",
          lines: [],
        })
      ).rejects.toThrow("Destination store cannot be the same as the source store");
    });
  });

  describe("Dispatch & Stock Deductions", () => {
    it("deducts batch stock immediately from source on dispatch and logs TRANSFER_OUT", async () => {
      await seedSampleCatalog();

      const draft = await interStoreTransferService.createDraft({
        destination_store_id: "store_north",
        source_store_id: "store_main",
        lines: [
          {
            product_id: "prod_paracetamol",
            batch_id: "batch_dolo_1",
            transfer_packs: 2, // 30 units from 100 available
          },
        ],
      });

      // Verify stock before dispatch
      let batch = await sqliteStorage.findById<ProductBatch>("product_batches", "batch_dolo_1");
      expect(batch?.stock_qty).toBe(100);

      // Dispatch
      const dispatched = await interStoreTransferService.dispatchTransfer(draft.id, "Staff A");
      expect(dispatched.status).toBe("dispatched");
      expect(dispatched.dispatched_by).toBe("Staff A");

      // Verify source batch stock reduced
      batch = await sqliteStorage.findById<ProductBatch>("product_batches", "batch_dolo_1");
      expect(batch?.stock_qty).toBe(70);

      // Verify product current_stock reduced
      const product = await productsStore.getProductById("prod_paracetamol");
      expect(product?.current_stock).toBe(120);

      // Verify stock ledger transaction
      const txs = await sqliteStorage.findAll<{
        event_type: string;
        qty_delta: number;
        reference_id: string;
      }>("stock_transactions");
      expect(txs.some((t) => t.event_type === "TRANSFER_OUT" && t.qty_delta === -30)).toBe(true);
    });

    it("blocks dispatch when requested quantity exceeds available stock", async () => {
      await seedSampleCatalog();

      const draft = await interStoreTransferService.createDraft({
        destination_store_id: "store_north",
        lines: [
          {
            product_id: "prod_syrup",
            batch_id: "batch_benadryl_1",
            transfer_packs: 50, // exceeds available 40
          },
        ],
      });

      await expect(interStoreTransferService.dispatchTransfer(draft.id)).rejects.toThrow("Insufficient stock");
    });
  });

  describe("Destination Receiving & Variance Reconciliation", () => {
    it("receives transfer in full and adds stock to destination inventory", async () => {
      await seedSampleCatalog();

      const draft = await interStoreTransferService.createDraft({
        destination_store_id: "store_north",
        lines: [
          {
            product_id: "prod_syrup",
            batch_id: "batch_benadryl_1",
            transfer_packs: 10,
          },
        ],
      });

      await interStoreTransferService.dispatchTransfer(draft.id);

      const received = await interStoreTransferService.receiveTransfer(draft.id, [
        {
          line_id: draft.lines[0].id,
          received_packs: 10,
          received_loose: 0,
        },
      ]);

      expect(received.status).toBe("received");
      expect(received.lines[0].accepted_qty).toBe(10);
      expect(received.lines[0].short_qty).toBe(0);

      // Verify TRANSFER_IN recorded
      const txs = await sqliteStorage.findAll<{ event_type: string; qty_delta: number }>("stock_transactions");
      expect(txs.some((t) => t.event_type === "TRANSFER_IN" && t.qty_delta === 10)).toBe(true);
    });

    it("handles short and damaged stock during receipt with variance recording and source return", async () => {
      await seedSampleCatalog();

      const draft = await interStoreTransferService.createDraft({
        destination_store_id: "store_north",
        lines: [
          {
            product_id: "prod_syrup",
            batch_id: "batch_benadryl_1",
            transfer_packs: 20, // 20 dispatched
          },
        ],
      });

      await interStoreTransferService.dispatchTransfer(draft.id);

      // Source stock went from 40 to 20
      let sourceBatch = await sqliteStorage.findById<ProductBatch>("product_batches", "batch_benadryl_1");
      expect(sourceBatch?.stock_qty).toBe(20);

      // Destination receives: 17 received (15 accepted, 2 damaged), 3 short
      const received = await interStoreTransferService.receiveTransfer(draft.id, [
        {
          line_id: draft.lines[0].id,
          received_packs: 17,
          received_loose: 0,
          damaged_packs: 2,
          damaged_loose: 0,
          variance_reason: "3 broken in carton, 2 short packed",
          variance_action: "return_source",
        },
      ]);

      expect(received.status).toBe("received");
      const line = received.lines[0];
      expect(line.accepted_qty).toBe(15);
      expect(line.damaged_qty).toBe(2);
      expect(line.short_qty).toBe(3);

      // Short 3 units should be returned/restored to source store
      sourceBatch = await sqliteStorage.findById<ProductBatch>("product_batches", "batch_benadryl_1");
      expect(sourceBatch?.stock_qty).toBe(23); // 20 + 3 restored

      // Check stock transactions
      const txs = await sqliteStorage.findAll<{ event_type: string; qty_delta: number }>("stock_transactions");
      expect(txs.some((t) => t.event_type === "TRANSFER_IN" && t.qty_delta === 15)).toBe(true);
      expect(txs.some((t) => t.event_type === "TRANSFER_DAMAGE_LOSS" && t.qty_delta === -2)).toBe(true);
      expect(txs.some((t) => t.event_type === "TRANSFER_RETURN_RESTORE" && t.qty_delta === 3)).toBe(true);
    });
  });

  describe("Cancellation & Stock Rollback", () => {
    it("restores source stock when a dispatched transfer is cancelled", async () => {
      await seedSampleCatalog();

      const draft = await interStoreTransferService.createDraft({
        destination_store_id: "store_north",
        lines: [
          {
            product_id: "prod_syrup",
            batch_id: "batch_benadryl_1",
            transfer_packs: 15,
          },
        ],
      });

      await interStoreTransferService.dispatchTransfer(draft.id);

      let batch = await sqliteStorage.findById<ProductBatch>("product_batches", "batch_benadryl_1");
      expect(batch?.stock_qty).toBe(25); // 40 - 15

      // Cancel transfer
      const cancelled = await interStoreTransferService.cancelTransfer(draft.id, "Trip aborted by driver");
      expect(cancelled.status).toBe("cancelled");

      // Verify stock restored
      batch = await sqliteStorage.findById<ProductBatch>("product_batches", "batch_benadryl_1");
      expect(batch?.stock_qty).toBe(40);
    });

    it("disallows cancelling a transfer that was already received", async () => {
      await seedSampleCatalog();

      const draft = await interStoreTransferService.createDraft({
        destination_store_id: "store_north",
        lines: [
          {
            product_id: "prod_syrup",
            batch_id: "batch_benadryl_1",
            transfer_packs: 5,
          },
        ],
      });

      await interStoreTransferService.dispatchTransfer(draft.id);
      await interStoreTransferService.receiveTransfer(draft.id, [
        { line_id: draft.lines[0].id, received_packs: 5, received_loose: 0 },
      ]);

      await expect(interStoreTransferService.cancelTransfer(draft.id)).rejects.toThrow("Cannot cancel");
    });
  });

  describe("FEFO Auto-Splitting Across Multiple Batches", () => {
    it("splits requested quantity across sequential batches in FEFO order", async () => {
      await seedSampleCatalog();

      // Dolo has Batch 1 (100 units, exp 2027) and Batch 2 (50 units, exp 2028)
      // Requesting 8 packs = 120 units (Pack size = 15)
      const splitLines = await interStoreTransferService.autoSplitAcrossBatches("prod_paracetamol", 8, 0);

      expect(splitLines.length).toBe(2);
      // Line 1 takes 100 units (6 packs + 10 loose) from batch 1
      expect(splitLines[0].batch_no).toBe("DL-101");
      expect(splitLines[0].transfer_total_qty).toBe(100);

      // Line 2 takes remaining 20 units (1 pack + 5 loose) from batch 2
      expect(splitLines[1].batch_no).toBe("DL-102");
      expect(splitLines[1].transfer_total_qty).toBe(20);
    });
  });

  describe("CSV & Excel Bulk Line Import", () => {
    it("parses CSV rows, matches products/batches, and reports invalid rows", async () => {
      await seedSampleCatalog();

      const csvData = `
        Barcode,Batch,Qty
        8901234567890,DL-101,2
        8909876543210,BN-55,3
        INVALID_BARCODE,X-99,5
      `;

      const result = await interStoreTransferService.importFromCsv(csvData);
      expect(result.summary.validCount).toBe(2);
      expect(result.summary.invalidCount).toBe(1);
      expect(result.validLines[0].product_name).toBe("Dolo 650mg Tablet");
      expect(result.validLines[1].product_name).toBe("Benadryl Cough Syrup 100ml");
      expect(result.invalidRows[0].error).toContain("Product not found");
    });
  });

  describe("Print Data Generator", () => {
    it("formats transfer as Delivery Challan / Transfer Note for universal print engine", async () => {
      await seedSampleCatalog();

      const transfer = await interStoreTransferService.createDraft({
        destination_store_id: "store_north",
        source_store_id: "store_main",
        transport_details: {
          transporter_name: "KTC Express",
          vehicle_number: "KL-09-XX-9999",
          lr_number: "LR-8822",
        },
        lines: [
          {
            product_id: "prod_paracetamol",
            batch_id: "batch_dolo_1",
            transfer_packs: 4,
          },
        ],
      });

      const printData = interStoreTransferService.generateTransferPrintData(transfer);
      expect(printData.invoice_number).toBe(transfer.transfer_no);
      expect(printData.payment_status).toBe("STOCK TRANSFER / DELIVERY CHALLAN");
      expect(printData.customer_name).toBe("LamStone North Palakkad Branch");
      expect(printData.lines.length).toBe(1);
      expect(printData.terms_and_conditions).toContain("Rule 55");
      expect(printData.terms_and_conditions).toContain("KL-09-XX-9999");
    });
  });
});
