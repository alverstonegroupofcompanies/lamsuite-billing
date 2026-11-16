export interface PromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  template: (args: Record<string, string>) => {
    description?: string;
    messages: Array<{
      role: "user" | "assistant";
      content: {
        type: "text";
        text: string;
      };
    }>;
  };
}

export const STORE_PROMPTS: PromptDefinition[] = [
  {
    name: "daily_closing_report",
    description: "Generate an end-of-day store closing audit report with sales summary, tender reconciliation, and alerts.",
    arguments: [
      {
        name: "date",
        description: "Audit date in YYYY-MM-DD format (defaults to today)",
        required: false,
      },
    ],
    template: (args) => {
      const targetDate = args.date || new Date().toISOString().slice(0, 10);
      return {
        description: `Daily closing audit for ${targetDate}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Please generate a complete Daily Closing Audit Report for LamSuite Billing on ${targetDate}.\n\n` +
                `Follow these steps:\n` +
                `1. Call \`lamsuite_daily_summary\` for ${targetDate} to inspect total sales, tender breakdown, and invoice counts.\n` +
                `2. Call \`lamsuite_cash_book\` to reconcile cash drawer opening, cash sales, and closing cash.\n` +
                `3. Call \`lamsuite_low_stock\` to check any critical items running low.\n` +
                `4. Call \`lamsuite_near_expiry\` with threshold_days=30 to review urgent expiry batches.\n` +
                `5. Provide a clean, executive summary table suitable for the store owner.`,
            },
          },
        ],
      };
    },
  },
  {
    name: "low_stock_reorder_plan",
    description: "Analyze products running low on stock and draft purchase order recommendations for distributors.",
    arguments: [
      {
        name: "threshold_days",
        description: "Lead time buffer in days (default 15)",
        required: false,
      },
      {
        name: "category",
        description: "Filter by category name (e.g. Antibiotics, Analgesics)",
        required: false,
      },
    ],
    template: (args) => {
      const days = args.threshold_days || "15";
      const cat = args.category ? ` in category "${args.category}"` : "";
      return {
        description: `Low stock purchase reorder plan`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Generate a Stock Reorder Recommendation Plan${cat}.\n\n` +
                `1. Call \`lamsuite_low_stock\` to find all products at or below their reorder level.\n` +
                `2. For each low-stock item, inspect its current stock, reorder level, and supplier details using \`lamsuite_get_item\`.\n` +
                `3. Group recommended order quantities by preferred supplier.\n` +
                `4. Calculate estimated purchase order values using item PTR rates.`,
            },
          },
        ],
      };
    },
  },
  {
    name: "gst_filing_summary",
    description: "Prepare and audit monthly GST figures (GSTR-1, HSN summary, B2B vs B2C) for GST portal filing.",
    arguments: [
      {
        name: "month",
        description: "Month (e.g. '10' or 'October')",
        required: true,
      },
      {
        name: "year",
        description: "Year (e.g. '2026')",
        required: true,
      },
    ],
    template: (args) => {
      return {
        description: `GST filing audit for ${args.month}/${args.year}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Please audit our GST tax figures for ${args.month} ${args.year}.\n\n` +
                `1. Fetch the store profile using \`lamsuite://store/profile\` to identify store state code and GSTIN.\n` +
                `2. Call \`lamsuite_gst_report\` with report_type="gstr1" to verify Tables 4 (B2B), 5 (B2C Large), 7 (B2C Small), and 9 (Credit/Debit Notes).\n` +
                `3. Call \`lamsuite_gst_report\` with report_type="hsn_summary" to verify HSN code summaries.\n` +
                `4. Highlight any missing customer GSTINs or mismatch in CGST/SGST/IGST splits.`,
            },
          },
        ],
      };
    },
  },
  {
    name: "customer_outstanding_followup",
    description: "Identify overdue customer balances and generate polite payment reminder drafts.",
    arguments: [
      {
        name: "min_amount",
        description: "Minimum pending balance threshold in INR (default 500)",
        required: false,
      },
      {
        name: "days_overdue",
        description: "Minimum days overdue (default 30)",
        required: false,
      },
    ],
    template: (args) => {
      const minAmt = args.min_amount || "500";
      return {
        description: `Customer outstanding follow-up`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Review all pending customer balances above ₹${minAmt}.\n\n` +
                `1. Call \`lamsuite_outstanding_report\` with party_type="customer" and min_balance=${minAmt}.\n` +
                `2. For each overdue customer, review their outstanding balance and aging buckets.\n` +
                `3. Generate polite, professional WhatsApp/SMS payment reminder templates for each customer with their pending amount and store UPI payment details.`,
            },
          },
        ],
      };
    },
  },
  {
    name: "staff_session_policy",
    description:
      "Explain the one-active-counter staff login contract (endpoints, the 409 ACTIVE_SESSION_ELSEWHERE response, force_out rules and how to release a stuck workstation).",
    arguments: [
      {
        name: "store_code",
        description: "Store code used at the terminal (optional, informational only)",
        required: false,
      },
    ],
    template: (args) => {
      const store = args.store_code ? ` for store \`${args.store_code}\`` : "";
      return {
        description: "One-active-counter staff login contract",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Document the LamSuite staff session contract${store}. Do not ask for or invent PINs, passwords or tokens.\n\n` +
                `1. Staff sign in at a terminal with \`POST /staff/login\` sending \`store_id\` (id or code), \`username\` or \`user_id\`, \`pin\` or \`password\`, and an optional \`counter_id\`.\n` +
                `2. LamSuite enforces one active counter per staff account. If the account is already active on another device within the last 30 minutes, the call returns HTTP 409 with \`error: "ACTIVE_SESSION_ELSEWHERE"\`, an \`active_session\` payload (session id, device, counter, last_active_at) and \`can_force_out\`.\n` +
                `3. \`force_out: true\` is only honoured for privileged roles (store_owner, owner, admin, super_admin, manager); it ends the other device session and clears its tokens. Multi-counter login is allowed only for roles listed in the \`allow_multi_counter_roles\` company setting.\n` +
                `4. Managers holding a privileged token can release a stuck terminal with \`POST /device-sessions/{id}/force-logout\` (or \`lock\` / \`unlock\` / \`revoke\`), or via the MCP tool \`lamsuite_device_session_action\`.\n` +
                `5. Terminals heartbeat with \`POST /device-sessions/heartbeat\` and sign out with \`POST /staff/logout\` or \`POST /device-sessions/logout\`.\n` +
                `6. Use \`lamsuite_list_device_sessions\` to show the current sessions before suggesting any remote action.`,
            },
          },
        ],
      };
    },
  },
];
