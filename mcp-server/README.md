# LamSuite Billing MCP Server

Official Model Context Protocol (MCP) server for **LamSuite / Alverstone Billing & Pharmacy POS**. This server enables AI assistants (Claude Desktop, Claude Code, Cursor, Windsurf, hosted LLM agents) to query store analytics, manage medicine batch inventory, audit statutory Indian GST reports, and generate POS invoices strictly through the LamSuite backend REST API contract.

---

## 🏗️ Architecture & Safety Principles

- **Zero Direct Database Access**: Talks exclusively to the LamSuite REST API (OpenAPI 3.0.3 contract). Never accesses local SQLite or cloud databases directly.
- **Transports**:
  - **stdio**: Local execution for Claude Desktop and Claude Code CLI.
  - **Streamable HTTP / SSE**: Remote/hosted deployment on container clusters.
- **Read-Only by Default**: Unless `LAMSUITE_READ_ONLY=false` is explicitly passed, write tools are **not even registered** on the server.
- **Destructive Operation Guards**: Critical actions (`cancel_invoice`, `create_stock_adjustment`) require `confirm: true` and an explicit `reason`.
- **Dry-Run Preview**: All write tools support `dry_run: true`, calculating stock and GST impact without persisting changes.
- **Idempotency**: All creation calls support client-supplied idempotency keys (`idempotency_key` / `external_id`) to prevent duplicate bills or double disbursements.
- **Prompt Injection Defense**: All store data (item names, customer remarks, doctor names) is treated as untrusted text, defanged against prompt injection patterns (`SYSTEM:`, `Ignore previous instructions`, etc.), and wrapped in inert data blocks.
- **PII Masking**: Customer phone numbers and emails are automatically masked for cashier and auditor roles.
- **Audit Logging**: Every tool call is logged with timestamp, user role, execution time, and masked parameters.

---

## 📦 Quick Start & Local Run

### Prerequisites
- Node.js 18+ (tested on Node 20 & 22)
- npm 9+

### 1. Build and Run Locally
```bash
cd mcp-server
npm install
npm run build
npm start
```

### 2. Run with Built-in Mock Backend (No Live Server Required)
If you want to test without spinning up the Laravel backend:
```bash
npm start -- --mock
```

### 3. Run with the MCP Inspector
Launch the official interactive visual MCP Inspector:
```bash
npm run inspect
```
Or run headless CLI tests with the inspector:
```bash
npx @modelcontextprotocol/inspector --cli --config ./catalog.json --server lamsuite --method tools/list
```

---

## ⚙️ Environment Variables

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `LAMSUITE_API_URL` | string | `http://localhost:8000/api` | Base URL of the LamSuite backend REST API |
| `LAMSUITE_API_TOKEN` | string | `""` | Bearer token for dedicated API user |
| `LAMSUITE_EMAIL` | string | `""` | Email for automated session login |
| `LAMSUITE_PASSWORD` | string | `""` | Password for automated session login |
| `LAMSUITE_STORE_CODE` | string | `STORE-01` | Store code identifier |
| `LAMSUITE_STORE_ID` | number | `1` | Store branch ID |
| `LAMSUITE_READ_ONLY` | boolean | `true` | When `true`, write tools are omitted completely |
| `LAMSUITE_API_ROLE` | string | `admin` | Active role (`admin`, `manager`, `cashier`, `pharmacist`, `auditor`) |
| `LAMSUITE_TIMEOUT_MS` | number | `15000` | HTTP request timeout in milliseconds |
| `LAMSUITE_RATE_LIMIT` | number | `120` | Max tool calls allowed per minute |
| `LAMSUITE_AUDIT_LOG` | string | `./audit.log` | Destination path for audit trail logs |
| `LAMSUITE_MCP_TRANSPORT` | string | `stdio` | Transport type: `stdio` or `http` |
| `PORT` / `LAMSUITE_MCP_PORT`| number | `3000` | HTTP port when running in `http` transport mode |

---

## 💻 Claude Desktop Configuration

Add the following snippet to your `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Option A: Read-Only Mode (Default & Safe)
```json
{
  "mcpServers": {
    "lamsuite": {
      "command": "node",
      "args": ["/absolute/path/to/lamsuite-billing/mcp-server/dist/index.js"],
      "env": {
        "LAMSUITE_API_URL": "http://localhost:8000/api",
        "LAMSUITE_API_TOKEN": "your_secure_api_token",
        "LAMSUITE_STORE_ID": "1",
        "LAMSUITE_READ_ONLY": "true",
        "LAMSUITE_API_ROLE": "manager"
      }
    }
  }
}
```

### Option B: Write-Enabled Mode (With POS Invoicing & Inventory)
```json
{
  "mcpServers": {
    "lamsuite": {
      "command": "node",
      "args": ["/absolute/path/to/lamsuite-billing/mcp-server/dist/index.js"],
      "env": {
        "LAMSUITE_API_URL": "http://localhost:8000/api",
        "LAMSUITE_API_TOKEN": "your_secure_api_token",
        "LAMSUITE_STORE_ID": "1",
        "LAMSUITE_READ_ONLY": "false",
        "LAMSUITE_API_ROLE": "admin"
      }
    }
  }
}
```

---

## ⚡ Claude Code CLI Setup

Add LamSuite MCP Server to Claude Code using `claude mcp add`:

```bash
claude mcp add lamsuite node /absolute/path/to/lamsuite-billing/mcp-server/dist/index.js \
  -e LAMSUITE_API_URL=http://localhost:8000/api \
  -e LAMSUITE_STORE_ID=1 \
  -e LAMSUITE_READ_ONLY=true \
  -e LAMSUITE_API_ROLE=admin
```

To enable billing & write tools:
```bash
claude mcp add lamsuite node /absolute/path/to/lamsuite-billing/mcp-server/dist/index.js \
  -e LAMSUITE_API_URL=http://localhost:8000/api \
  -e LAMSUITE_STORE_ID=1 \
  -e LAMSUITE_READ_ONLY=false \
  -e LAMSUITE_API_ROLE=admin
```

---

## 🛠️ Tool Reference Table

All tools use the prefix `lamsuite_`. Every list tool supports pagination (`limit`, `cursor`).

### 📖 Read Tools (Always Available)

| Tool Name | Parameters | Hints | Description |
| --- | --- | --- | --- |
| `lamsuite_search_items` | `query?`, `category_id?`, `brand_id?`, `is_active?`, `limit?`, `cursor?` | `readOnly`, `idempotent` | Search catalog items by name, barcode, or generic name. |
| `lamsuite_get_item` | `id?`, `barcode?` | `readOnly`, `idempotent` | Get detailed product info with batches, stock, MRP, sel_rate, and GST%. |
| `lamsuite_low_stock` | `threshold?`, `limit?` | `readOnly`, `idempotent` | List products with on-hand stock at or below reorder level. |
| `lamsuite_near_expiry` | `threshold_days?` (default 60), `limit?` | `readOnly`, `idempotent` | List batches expiring within specified days. |
| `lamsuite_expired_stock` | `limit?` | `readOnly`, `idempotent` | List already-expired batches with stock and MRP loss value. |
| `lamsuite_search_customers` | `query?`, `limit?`, `cursor?` | `readOnly`, `idempotent` | Search customers with outstanding balances (phone masked for non-PII roles). |
| `lamsuite_get_customer` | `customer_id?`, `phone?` | `readOnly`, `idempotent` | Get customer profile, credit ledger, and outstanding balance. |
| `lamsuite_search_suppliers` | `query?`, `limit?`, `cursor?` | `readOnly`, `idempotent` | Search medicine distributors and suppliers. |
| `lamsuite_get_supplier` | `supplier_id` | `readOnly`, `idempotent` | Get supplier profile, credit period, and payable balance. |
| `lamsuite_search_invoices` | `query?`, `start_date?`, `end_date?`, `payment_mode?`, `customer_id?`, `status?`, `limit?` | `readOnly`, `idempotent` | Search sales bills by date range, tender mode, or status. |
| `lamsuite_get_invoice` | `invoice_id?`, `invoice_number?` | `readOnly`, `idempotent` | Full invoice details: line items, batches, tax breakdown (CGST/SGST/IGST). |
| `lamsuite_search_purchases` | `query?`, `supplier_id?`, `start_date?`, `end_date?`, `limit?` | `readOnly`, `idempotent` | Search inward purchase bills. |
| `lamsuite_get_purchase` | `purchase_id?`, `purchase_number?` | `readOnly`, `idempotent` | Get purchase bill with inward batches, purchase rates, and GST. |
| `lamsuite_list_returns` | `type` ('sales_return' \| 'purchase_return'), `start_date?`, `end_date?`, `limit?` | `readOnly`, `idempotent` | List credit notes and debit notes. |
| `lamsuite_sales_summary` | `period` ('today', 'yesterday', 'this_week', 'this_month', 'custom'), `start_date?`, `end_date?` | `readOnly`, `idempotent` | Sales KPIs: gross sales, returns, net sales, taxes, tender splits. |
| `lamsuite_top_selling_items` | `period`, `limit?` | `readOnly`, `idempotent` | Top selling medicines ranked by volume and revenue. |
| `lamsuite_cash_book` | `date?`, `payment_mode?` | `readOnly`, `idempotent` | Cash ledger: opening balance, collections, expenses, closing balance. |
| `lamsuite_daily_summary` | `date?` | `readOnly`, `idempotent` | Daily closing overview: sales, tender splits, returns, alerts. |
| `lamsuite_profit_report` | `start_date?`, `end_date?`, `group_by?` | `readOnly`, `idempotent` | Profitability analysis: revenue, COGS, and gross margin %. |
| `lamsuite_gst_report` | `report_type` ('gstr1', 'hsn_summary', 'purchase_register'), `start_date?`, `end_date?` | `readOnly`, `idempotent` | Statutory Indian GST compliance (GSTR-1 Tables 4, 5, 7, 9 & HSN Summary). |
| `lamsuite_outstanding_report` | `party_type` ('customer', 'supplier', 'all'), `min_balance?` | `readOnly`, `idempotent` | Aging breakdown (0-30, 31-60, 61-90, 90+ days). |
| `lamsuite_stock_ledger` | `product_id?`, `batch_id?`, `start_date?`, `end_date?`, `limit?` | `readOnly`, `idempotent` | Inventory transaction movements (sales, purchases, adjustments). |
| `lamsuite_stock_balance` | `query?`, `category_id?`, `location?`, `limit?` | `readOnly`, `idempotent` | Stock on hand with inventory valuation at cost and MRP. |

---

### ✍️ Write Tools (Only Available when `LAMSUITE_READ_ONLY=false`)

| Tool Name | Key Parameters | Hints | Description |
| --- | --- | --- | --- |
| `lamsuite_create_invoice` | `customer_name`, `items` (qty, loose_qty, batch_no [auto-FEFO if omitted]), `payment_mode`, `dry_run?`, `idempotency_key?` | `idempotent` | Issue POS bill. Automatic FEFO batch selection. Returns dry-run preview if requested. |
| `lamsuite_create_customer` | `name`, `phone`, `gstin?`, `address?`, `credit_limit?`, `dry_run?` | `idempotent` | Register new customer. |
| `lamsuite_create_item` | `name`, `barcode`, `mrp`, `sel_rate`, `ptr?`, `pts?`, `gst_percent`, `units_per_pack?`, `dry_run?` | `idempotent` | Create catalog item with pricing and Indian GST slab. |
| `lamsuite_update_item_price` | `product_id`, `sel_rate?`, `mrp?`, `ptr?`, `dry_run?` | `idempotent` | Update selling or wholesale rates. |
| `lamsuite_record_customer_payment` | `customer_id`, `amount`, `payment_mode`, `reference_no?`, `dry_run?` | `idempotent` | Record credit payment against customer ledger. |
| `lamsuite_record_supplier_payment` | `supplier_id`, `amount`, `payment_mode`, `reference_no?`, `dry_run?` | `idempotent` | Record payout against supplier purchase bills. |
| `lamsuite_create_sales_return` | `original_invoice_id?`, `items`, `refund_mode`, `dry_run?` | `idempotent` | Process sales return (Credit Note) and restore stock. |
| `lamsuite_create_purchase_return` | `supplier_id`, `items`, `dry_run?` | `idempotent` | Issue purchase return (Debit Note) to supplier. |
| `lamsuite_create_stock_adjustment` | `product_id`, `adjustment_type`, `qty`, `reason`, **`confirm: true`**, `dry_run?` | **`destructive`** | Adjust physical stock count. Requires `confirm: true` and `reason`. |
| `lamsuite_cancel_invoice` | `invoice_id`, `reason`, **`confirm: true`**, `dry_run?` | **`destructive`** | Void invoice and restore stock. Requires `confirm: true` and `reason`. |
| `lamsuite_create_purchase` | `supplier_id`, `purchase_number`, `purchase_date`, `items`, `dry_run?` | `idempotent` | Record inward bill with batch numbers, expiry dates, and purchase rates. |

---

## 📚 Resources & Prompts

### Resources
- `lamsuite://store/profile`: Store identity (name, GSTIN, drug licenses, tax mode).
- `lamsuite://tax/hsn-master`: Indian GST slabs (0%, 5%, 12%, 18%, 28%) and pharma HSN codes.
- `lamsuite://payment-modes`: Active payment tender types (Cash, UPI, Card, Credit).
- `lamsuite://sequences`: Document numbering prefixes (`INV`, `CN`, `DN`).

### Prompts
- `daily_closing_report`: Interactive workflow for end-of-day store audit.
- `low_stock_reorder_plan`: Automated purchase recommendation based on consumption and lead times.
- `gst_filing_summary`: Guided preparation and validation of GSTR-1 and HSN summaries.
- `customer_outstanding_followup`: Generate polite payment reminders for overdue balances.

---

## 🐳 Docker Deployment

Build and run using Docker:

```bash
docker build -t lamsuite-mcp .
docker run -p 3000:3000 \
  -e LAMSUITE_MCP_TRANSPORT=http \
  -e LAMSUITE_API_URL=http://your-backend:8000/api \
  -e LAMSUITE_READ_ONLY=true \
  lamsuite-mcp
```

Access the SSE endpoint at `http://localhost:3000/sse` and health check at `http://localhost:3000/health`.

---

## 🧪 Testing

Run all unit tests and integration tests:
```bash
npm test
```

Test coverage includes:
- Zod input schemas and edge-case validation
- Role permission matrix and access control
- Prompt injection attack defanging
- PII masking and secret redaction
- FEFO batch selection chronological sorting
- Indian GST intra-state and inter-state tax engine
- Read-only enforcement (no write tools listed or callable)
- Destructive safety checks (`confirm: true` and `reason` requirements)
- Full protocol handshake with official `@modelcontextprotocol/sdk` client and inspector
