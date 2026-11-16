import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStockAdjustmentTool } from "../../src/tools/write/stock.js";
import { ValidationError } from "../../src/client/errors.js";
import { idempotencyStore } from "../../src/utils/idempotency.js";

function context(createStockAdjustment = vi.fn()) {
  return {
    createStockAdjustment,
    ctx: {
      client: { createStockAdjustment },
      config: { role: "admin", storeId: 1, readOnly: false },
    } as any,
  };
}

const baseArgs = {
  reason: "Monthly stock audit",
  confirm: true,
  dry_run: false,
};

describe("lamsuite_create_stock_adjustment multi-line parity", () => {
  beforeEach(() => {
    idempotencyStore.clear();
  });

  it("posts a multi-line adjustment document to /stock/adjustments", async () => {
    const { createStockAdjustment, ctx } = context(
      vi.fn().mockResolvedValue({
        status: "posted",
        document_id: "adj_mcp_1",
        lines_count: 2,
        adjustments_posted: 2,
        total_qty: -5,
        total_value: 320,
      })
    );

    const res = await createStockAdjustmentTool.handler(
      {
        ...baseArgs,
        document_id: "adj_mcp_1",
        notes: "Quarter end",
        document_date: "2026-11-14",
        lines: [
          {
            product_id: "10",
            batch_id: "100",
            adjustment_qty: -10,
            reason: "Damaged",
            notes: "Torn strips",
          },
          {
            product_id: "20",
            batch_no: "AMX-01",
            adjustment_qty: 5,
            reason: "Found Stock",
          },
        ],
      },
      ctx
    );

    expect(createStockAdjustment).toHaveBeenCalledTimes(1);
    expect(createStockAdjustment).toHaveBeenCalledWith({
      document_id: "adj_mcp_1",
      mode: "adjustment",
      reason: "Monthly stock audit",
      notes: "Quarter end",
      document_date: "2026-11-14",
      lines: [
        {
          product_id: "10",
          batch_id: "100",
          adjustment_qty: -10,
          reason: "Damaged",
          notes: "Torn strips",
        },
        {
          product_id: "20",
          batch_no: "AMX-01",
          adjustment_qty: 5,
          reason: "Found Stock",
        },
      ],
    });

    expect(res.structuredContent).toMatchObject({
      document_id: "adj_mcp_1",
      status: "posted",
      mode: "adjustment",
      lines_count: 2,
    });
    expect(res.content[0].text).toContain("Stock Adjustment Posted");
  });

  it("converts the legacy reduce form into one negative line", async () => {
    const { createStockAdjustment, ctx } = context(
      vi.fn().mockResolvedValue({ status: "posted", lines_count: 1, document_id: "adj_legacy" })
    );

    await createStockAdjustmentTool.handler(
      {
        ...baseArgs,
        product_id: "10",
        batch_no: "PAR-01",
        adjustment_type: "reduce",
        qty: 7,
      },
      ctx
    );

    const payload = createStockAdjustment.mock.calls[0][0];
    expect(payload.mode).toBe("adjustment");
    expect(payload.lines).toEqual([
      {
        product_id: "10",
        batch_no: "PAR-01",
        adjustment_qty: -7,
        reason: "Monthly stock audit",
      },
    ]);
    expect(payload.lines[0]).not.toHaveProperty("batch_id");
    expect(payload.lines[0]).not.toHaveProperty("unit_cost");
  });

  it("converts the legacy set form into a physical-count line", async () => {
    const { createStockAdjustment, ctx } = context(
      vi.fn().mockResolvedValue({ status: "posted", lines_count: 1, document_id: "adj_set" })
    );

    await createStockAdjustmentTool.handler(
      {
        ...baseArgs,
        product_id: "10",
        batch_no: "PAR-01",
        adjustment_type: "set",
        qty: 96,
      },
      ctx
    );

    const payload = createStockAdjustment.mock.calls[0][0];
    expect(payload.mode).toBe("physical_count");
    expect(payload.lines).toEqual([
      {
        product_id: "10",
        batch_no: "PAR-01",
        counted_qty: 96,
        reason: "Monthly stock audit",
      },
    ]);
  });

  it("rejects physical-count mode lines that have no counted quantity", async () => {
    const { createStockAdjustment, ctx } = context();

    await expect(
      createStockAdjustmentTool.handler(
        {
          ...baseArgs,
          mode: "physical_count",
          lines: [{ product_id: "10", adjustment_qty: -2 }],
        },
        ctx
      )
    ).rejects.toThrow(/counted_qty/);

    expect(createStockAdjustment).not.toHaveBeenCalled();
  });

  it("rejects lines that carry neither an adjustment nor a counted quantity", async () => {
    const { createStockAdjustment, ctx } = context();

    await expect(
      createStockAdjustmentTool.handler(
        {
          ...baseArgs,
          lines: [{ product_id: "10", notes: "empty" }],
        },
        ctx
      )
    ).rejects.toThrow(/adjustment_qty/);

    expect(createStockAdjustment).not.toHaveBeenCalled();
  });

  it("previews a dry run without writing to the API", async () => {
    const { createStockAdjustment, ctx } = context();

    const res = await createStockAdjustmentTool.handler(
      {
        ...baseArgs,
        mode: "physical_count",
        dry_run: true,
        document_id: "adj_dry",
        lines: [
          { product_id: "10", batch_no: "PAR-01", counted_qty: 96 },
          { product_id: "20", batch_no: "AMX-01", counted_qty: 45 },
        ],
      },
      ctx
    );

    expect(createStockAdjustment).not.toHaveBeenCalled();
    expect(res.structuredContent).toMatchObject({
      dry_run: true,
      document_id: "adj_dry",
      mode: "physical_count",
    });
    expect(res.content[0].text).toContain("DRY RUN PREVIEW");
    expect(res.content[0].text).toContain("counted 96");
  });

  it("surfaces server policy rejections with the line errors attached", async () => {
    const { ctx } = context(
      vi.fn().mockRejectedValue(
        new ValidationError("The given data was invalid.", {
          errors: {
            policy: ["Adjustment of 25 exceeds the maximum 5 units per line."],
            lines: ["Row 1: quantity is required."],
          },
        })
      )
    );

    await expect(
      createStockAdjustmentTool.handler(
        {
          ...baseArgs,
          lines: [{ product_id: "10", adjustment_qty: -25 }],
        },
        ctx
      )
    ).rejects.toMatchObject({
      name: "ValidationError",
      details: {
        line_errors: ["Row 1: quantity is required."],
      },
    });

    await expect(
      createStockAdjustmentTool.handler(
        {
          ...baseArgs,
          lines: [{ product_id: "10", adjustment_qty: -25 }],
        },
        ctx
      )
    ).rejects.toThrow(/blocked by store policy.*exceeds the maximum 5 units/);
  });

  it("reports pending approval without claiming stock changed", async () => {
    const { ctx } = context(
      vi.fn().mockResolvedValue({
        status: "pending_approval",
        document_id: "adj_pending",
        lines_count: 2,
        adjustments_posted: 0,
      })
    );

    const res = await createStockAdjustmentTool.handler(
      {
        ...baseArgs,
        document_id: "adj_pending",
        lines: [
          { product_id: "10", adjustment_qty: -10 },
          { product_id: "20", adjustment_qty: 5 },
        ],
      },
      ctx
    );

    expect(res.structuredContent).toMatchObject({
      status: "pending_approval",
      lines_count: 2,
    });
    expect(res.content[0].text).toContain("Submitted for Approval");
    expect(res.content[0].text).toContain("Stock is unchanged");
  });

  it("replays an idempotent adjustment without re-posting", async () => {
    const { createStockAdjustment, ctx } = context(
      vi.fn().mockResolvedValue({ status: "posted", document_id: "adj_idem", lines_count: 1 })
    );
    const args = {
      ...baseArgs,
      idempotency_key: "idem-stock-1",
      lines: [{ product_id: "10", adjustment_qty: -2 }],
    };

    await createStockAdjustmentTool.handler(args, ctx);
    const replay = await createStockAdjustmentTool.handler(args, ctx);

    expect(createStockAdjustment).toHaveBeenCalledTimes(1);
    expect(replay.content[0].text).toContain("IDEMPOTENT RETRY");
  });
});
