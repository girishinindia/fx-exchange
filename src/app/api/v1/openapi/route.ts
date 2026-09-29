import { NextResponse } from "next/server";
import { VOUCHER_TYPE_LIST } from "@/lib/ledger";
import { CA_PACK } from "@/lib/reports";

export const dynamic = "force-static";

const bearer = [{ bearerAuth: [] }];
const ok = (schema: object) => ({ "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: schema } } } } } });
const listParams = (extra: object[] = []) => [
  { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
  { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
  ...extra,
];

/** GET /api/v1/openapi — the contract for the mobile app, in OpenAPI 3.1. */
export function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "FX Desk API",
      version: "1.0.0",
      description:
        "Wholesale currency desk: depositors bring the deal currency, deals convert it for clients, clients pay in rupees, " +
        "that money settles the depositors. Every write goes through the same double-entry ledger the portal uses.\n\n" +
        "Sign in with POST /auth/login, then send `Authorization: Bearer <accessToken>`. " +
        "The financial year runs 1 April to 31 March. " +
        "Access tokens last 8 hours; refresh with POST /auth/refresh. Every response is `{data}` or `{error:{code,message}}`, " +
        "and every field name is camelCase. Money and rates are strings, never floats — parse them as decimals.",
    },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } },
        VoucherLine: {
          type: "object",
          required: ["fxAmount", "dc"],
          properties: {
            accountCode: { type: "string", description: "e.g. CASH-USD, CLIENT-REC, DEP-PAY" },
            accountId: { type: "integer" },
            partyId: { type: "integer", description: "required for control accounts" },
            currency: { type: "string", example: "USD" },
            fxAmount: { type: "string", example: "10000.0000" },
            rate: { type: "string", description: "manual rate to the book currency, 6 dp", example: "86.000000" },
            inrAmount: { type: "string", description: "optional; computed as amount × rate" },
            dc: { type: "string", enum: ["D", "C"] },
            remarks: { type: "string" },
          },
        },
        DepositInput: {
          type: "object",
          required: ["depositorId", "fxAmount", "rate"],
          properties: {
            depositorId: { type: "integer" },
            date: { type: "string", format: "date" },
            currency: { type: "string", description: "what the depositor handed over; the dealing currency when left out", example: "USD" },
            fxAmount: { type: "string", description: "amount of that currency", example: "10000.0000" },
            toPrimaryRate: { type: "string", description: "one unit of it in dealing currency — only when the two differ and it is being changed" },
            keep: { type: "boolean", description: "keep the currency as itself instead of changing it into the dealing currency; rate is then ₹ per 1 of it (0023)" },
            rate: { type: "string", description: "manual rate to the book currency, 6 dp", example: "86.000000" },
            referenceNo: { type: "string" },
            narration: { type: "string" },
            rateJustification: { type: "string" },
            clientRef: { type: "string", description: "idempotency key — the same value never records twice" },
          },
        },
        SettlementInput: {
          type: "object",
          required: ["depositorId", "inrAmount"],
          properties: {
            depositorId: { type: "integer" },
            date: { type: "string", format: "date" },
            inrAmount: { type: "string", description: "rupees paid; may be part of what is owed", example: "400000.00" },
            accountCode: { type: "string", description: "the cash/bank account it is paid from (default CASH-<book currency>)" },
            referenceNo: { type: "string" },
            narration: { type: "string" },
            clientRef: { type: "string" },
          },
        },
        DealInput: {
          type: "object",
          required: ["clientId", "fxCurrency", "fxAmount", "fxToInrRate"],
          properties: {
            clientId: { type: "integer" },
            date: { type: "string", format: "date" },
            fxCurrency: { type: "string", description: "the currency the client asked for", example: "EUR" },
            fxAmount: { type: "string", example: "9200.0000" },
            fxToInrRate: { type: "string", description: "rate the client is billed at, 6 dp", example: "95.000000" },
            srcCurrency: { type: "string", description: "the currency the deal is funded from: the one sold when the desk holds it as itself (or it is the dealing currency), else the dealing currency. Left out, the server picks by that rule and returns it (0023)" },
            srcAmount: { type: "string", description: "funding currency this deal spends — required only when it differs from the currency sold", example: "10000.0000" },
            funding: {
              type: "array",
              description: "which deposits pay for it. Leave it out and the oldest deposits with currency left are used.",
              items: { type: "object", required: ["depositId", "fxAllocated"], properties: { depositId: { type: "integer" }, fxAllocated: { type: "string" } } },
            },
            referenceNo: { type: "string" },
            narration: { type: "string" },
            rateJustification: { type: "string" },
            clientRef: { type: "string", description: "idempotency key — the same value never books twice" },
          },
        },
        PayoutInput: {
          type: "object",
          required: ["clientId", "currency", "fxAmount"],
          properties: {
            clientId: { type: "integer" },
            date: { type: "string", format: "date" },
            currency: { type: "string", example: "EUR" },
            fxAmount: { type: "string", description: "may be part of what is owed", example: "5000.0000" },
            accountCode: { type: "string", description: "which cash/bank account it leaves (default CASH-<currency>)" },
            referenceNo: { type: "string" },
            narration: { type: "string" },
            clientRef: { type: "string" },
          },
        },
        ReceiptInput: {
          type: "object",
          required: ["clientId", "inrAmount"],
          properties: {
            clientId: { type: "integer" },
            date: { type: "string", format: "date" },
            inrAmount: { type: "string", example: "400000.00" },
            accountCode: { type: "string", description: "which cash/bank account it lands in (default CASH-<book currency>)" },
            allowAdvance: { type: "boolean", description: "required to take more than the client owes; the extra is recorded as an advance" },
            referenceNo: { type: "string" },
            narration: { type: "string" },
            clientRef: { type: "string" },
          },
        },
        VoucherInput: {
          type: "object",
          required: ["type", "lines"],
          properties: {
            type: { type: "string", enum: VOUCHER_TYPE_LIST },
            date: { type: "string", format: "date" },
            partyId: { type: "integer" },
            narration: { type: "string" },
            referenceNo: { type: "string" },
            rateJustification: { type: "string" },
            clientRef: { type: "string", description: "idempotency key — the same value never posts twice" },
            lines: { type: "array", minItems: 2, items: { $ref: "#/components/schemas/VoucherLine" } },
          },
        },
      },
    },
    security: bearer,
    paths: {
      "/auth/login": {
        post: {
          summary: "Sign in", security: [],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["login", "password"], properties: { login: { type: "string", description: "Email address or mobile number. There is no company code." }, password: { type: "string" } } } } } },
          responses: ok({ type: "object", properties: { accessToken: { type: "string" }, refreshToken: { type: "string" }, expiresIn: { type: "integer" } } }),
        },
      },
      "/auth/refresh": { post: { summary: "New tokens from a refresh token", security: [], responses: ok({ type: "object" }) } },
      "/auth/logout": { post: { summary: "Sign this device out", responses: ok({ type: "object" }) } },
      "/me": { get: { summary: "Signed-in user, company and permissions", responses: ok({ type: "object" }) } },
      "/parties": {
        get: { summary: "Depositors and clients", parameters: listParams([{ name: "kind", in: "query", schema: { type: "string", enum: ["CLIENT", "DEPOSITOR"] } }, { name: "q", in: "query", schema: { type: "string" } }]), responses: ok({ type: "object" }) },
        post: { summary: "Add a party (party.manage)", responses: ok({ type: "object" }) },
      },
      "/sales": { post: { summary: "The counter's Sell: a deal and, when settled on the spot, the hand-over and receipt with it — one transaction (deal.manage; follow-ups need voucher.create)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["deal"], properties: { deal: { $ref: "#/components/schemas/DealInput" }, handOver: { type: "object", nullable: true, properties: { accountCode: { type: "string" } } }, collect: { type: "object", nullable: true, properties: { inrAmount: { type: "string" }, accountCode: { type: "string" }, allowAdvance: { type: "boolean" } } } } } } } }, responses: ok({ type: "object", properties: { deal: { type: "object" }, payout: { type: "object", nullable: true }, receipt: { type: "object", nullable: true } } }) } },
      "/purchases": { post: { summary: "The counter's Buy: a deposit and, when the depositor is paid on the spot, the settlement with it — one transaction (voucher.create)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["deposit"], properties: { deposit: { $ref: "#/components/schemas/DepositInput" }, payNow: { type: "object", nullable: true, required: ["rate"], properties: { rate: { type: "string" }, accountCode: { type: "string" } } } } } } } }, responses: ok({ type: "object", properties: { deposit: { type: "object" }, settlement: { type: "object", nullable: true } } }) } },
      "/day": { get: { summary: "The day sheet — the whiteboard read off the ledger: a column per Cash/Bank account, opening, a row per voucher with its cells and a written remark, in / out / closing, the day's result (report.view)", parameters: [{ name: "date", in: "query", schema: { type: "string", format: "date" } }], responses: ok({ type: "object", properties: { date: { type: "string" }, columns: { type: "array" }, opening: { type: "object" }, rows: { type: "array" }, inflow: { type: "object" }, outflow: { type: "object" }, closing: { type: "object" }, day: { type: "object" } } }) } },
      "/expenses": { post: { summary: "An expense paid from the drawer or the bank — one EXPENSE voucher (voucher.create)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["inrAmount"], properties: { accountCode: { type: "string", description: "the expense head" }, accountId: { type: "integer" }, inrAmount: { type: "string" }, paidFrom: { type: "string", description: "CASH-INR (default) or BANK-INR" }, date: { type: "string", format: "date" }, partyId: { type: "integer" }, narration: { type: "string" }, referenceNo: { type: "string" }, clientRef: { type: "string" } } } } } }, responses: ok({ type: "object", properties: { id: { type: "string" }, voucherNo: { type: "string" }, duplicate: { type: "boolean" } } }) } },
      "/transfers": { post: { summary: "Rupees moved between two rupee accounts, drawer ⇄ bank — one JOURNAL voucher (voucher.create)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["from", "to", "inrAmount"], properties: { from: { type: "string", example: "CASH-INR" }, to: { type: "string", example: "BANK-INR" }, inrAmount: { type: "string" }, date: { type: "string", format: "date" }, narration: { type: "string" }, referenceNo: { type: "string" }, clientRef: { type: "string" } } } } } }, responses: ok({ type: "object", properties: { id: { type: "string" }, voucherNo: { type: "string" }, duplicate: { type: "boolean" } } }) } },
      "/day-close": { post: { summary: "The day valued at the closing rates typed just now — stock per currency, the rupee drawers, the day's result. Nothing is posted and no rate is kept (report.view)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["rates"], properties: { date: { type: "string", format: "date" }, rates: { type: "array", items: { type: "object", properties: { currency: { type: "string" }, rate: { type: "string" } } } } } } } } }, responses: ok({ type: "object", properties: { stock: { type: "array" }, rupees: { type: "array" }, totals: { type: "object" }, day: { type: "object" } } }) } },
      "/parties/walk-in": { get: { summary: "The company's built-in Walk-in party — a client and depositor with no account, made on first use (deal.manage or voucher.create)", responses: ok({ type: "object", properties: { id: { type: "string" }, partyCode: { type: "string" }, fullName: { type: "string" } } }) } },
      "/todo": { get: { summary: "What is still open at the counter — HAND_OVER, COLLECT and PAY lines, one per action (report.view)", responses: ok({ type: "object", properties: { items: { type: "array" }, today: { type: "object" } } }) } },
      "/parties/{id}": {
        get: { summary: "One party, optionally with its ledger; with report.view also `insight` — rupees owed, currency still to deliver per currency, what a depositor is owed in currency, their money round the loop (cycle) and what they have earned the desk (earned)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }, { name: "ledger", in: "query", schema: { type: "string", enum: ["1"] } }, { name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }], responses: ok({ type: "object", properties: { party: { type: "object" }, ledger: { type: "object", nullable: true }, insight: { type: "object", nullable: true, properties: { receivableInr: { type: "string" }, payableInr: { type: "string" }, currencyDue: { type: "array" }, owedFx: { type: "array" }, cycle: { type: "object", nullable: true }, earned: { type: "object", nullable: true } } } } }) },
        patch: { summary: "Edit a party (party.manage)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: ok({ type: "object" }) },
      },
      "/accounts": {
        get: { summary: "Chart of accounts with balances", responses: ok({ type: "object" }) },
        post: { summary: "Add an account (account.manage)", responses: ok({ type: "object" }) },
      },
      "/vouchers": {
        get: { summary: "Vouchers", parameters: listParams([{ name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }, { name: "type", in: "query", schema: { type: "string", enum: VOUCHER_TYPE_LIST } }, { name: "partyId", in: "query", schema: { type: "integer" } }, { name: "q", in: "query", schema: { type: "string" } }]), responses: ok({ type: "object" }) },
        post: { summary: "Post a voucher (voucher.create; DEAL needs deal.manage)", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VoucherInput" } } } }, responses: ok({ type: "object", properties: { id: { type: "string" }, voucherNo: { type: "string" }, duplicate: { type: "boolean" } } }) },
      },
      "/vouchers/{id}/reverse": { post: { summary: "Cancel a posted voucher with an equal and opposite one (voucher.reverse)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reason"], properties: { reason: { type: "string", description: "kept on the record with both vouchers" } } } } } }, responses: ok({ type: "object", properties: { voucherNo: { type: "string" }, reversed: { type: "string" }, reason: { type: "string" } } }) } },
      "/year-end": {
        get: { summary: "Financial years and the currency still open", responses: ok({ type: "object" }) },
        post: { summary: "Close a year, reopen one, or restate currency at closing rates (fy.lock)", requestBody: { required: true, content: { "application/json": { schema: { oneOf: [
          { type: "object", required: ["action", "fyId"], properties: { action: { type: "string", enum: ["lock"] }, fyId: { type: "integer" }, note: { type: "string" } } },
          { type: "object", required: ["action", "fyId", "reason"], properties: { action: { type: "string", enum: ["unlock"] }, fyId: { type: "integer" }, reason: { type: "string" } } },
          { type: "object", required: ["action", "rates"], properties: { action: { type: "string", enum: ["revalue"] }, date: { type: "string", format: "date" }, narration: { type: "string" }, rates: { type: "array", items: { type: "object", required: ["currency", "rate"], properties: { currency: { type: "string" }, rate: { type: "string" } } } } } },
        ] } } } }, responses: ok({ type: "object" }) },
      },
      "/vouchers/{id}": { get: { summary: "One voucher with its lines", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: ok({ type: "object" }) } },
      "/deposits": {
        get: { summary: "Deposits received", parameters: listParams([{ name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }, { name: "depositorId", in: "query", schema: { type: "integer" } }, { name: "open", in: "query", description: "1 = only deposits with currency still unspent", schema: { type: "string", enum: ["1"] } }, { name: "q", in: "query", schema: { type: "string" } }]), responses: ok({ type: "object" }) },
        post: { summary: "Record a deposit (voucher.create)", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/DepositInput" } } } }, responses: ok({ type: "object", properties: { id: { type: "string" }, voucherNo: { type: "string" }, inrAmount: { type: "string" }, duplicate: { type: "boolean" } } }) },
      },
      "/settlements": {
        get: { summary: "Payments made to depositors", parameters: listParams([{ name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }, { name: "q", in: "query", schema: { type: "string" } }]), responses: ok({ type: "object" }) },
        post: { summary: "Pay a depositor, in full or in part (voucher.create)", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SettlementInput" } } } }, responses: ok({ type: "object", properties: { voucherNo: { type: "string" }, inrAmount: { type: "string" }, nowOwed: { type: "string" } } }) },
      },
      "/deals": {
        get: { summary: "Deals booked", parameters: listParams([{ name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }, { name: "clientId", in: "query", schema: { type: "integer" } }, { name: "currency", in: "query", schema: { type: "string" } }, { name: "q", in: "query", schema: { type: "string" } }, { name: "funding", in: "query", description: "'available' returns the deposits a new deal can draw on instead", schema: { type: "string", enum: ["available"] } }]), responses: ok({ type: "object" }) },
        post: { summary: "Book a deal (deal.manage)", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/DealInput" } } } }, responses: ok({ type: "object", properties: { id: { type: "string" }, voucherNo: { type: "string" }, billedInr: { type: "string" }, srcCostInr: { type: "string" }, marginInr: { type: "string" }, duplicate: { type: "boolean" } } }) },
      },
      "/deals/{id}": { get: { summary: "One deal with the deposits that funded it", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: ok({ type: "object" }) } },
      "/payouts": {
        get: { summary: "Currency handed to clients", parameters: listParams([{ name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }, { name: "q", in: "query", schema: { type: "string" } }, { name: "outstanding", in: "query", description: "1 returns what is still to be delivered instead", schema: { type: "string", enum: ["1"] } }, { name: "clientId", in: "query", schema: { type: "integer" } }]), responses: ok({ type: "object" }) },
        post: { summary: "Hand currency over (voucher.create)", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PayoutInput" } } } }, responses: ok({ type: "object", properties: { voucherNo: { type: "string" }, fxAmount: { type: "string" }, nowDueFx: { type: "string" } } }) },
      },
      "/receipts": {
        get: { summary: "Rupees received from clients", parameters: listParams([{ name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }, { name: "q", in: "query", schema: { type: "string" } }, { name: "outstanding", in: "query", description: "1 returns what each client still owes instead", schema: { type: "string", enum: ["1"] } }]), responses: ok({ type: "object" }) },
        post: { summary: "Record a receipt (voucher.create)", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ReceiptInput" } } } }, responses: ok({ type: "object", properties: { voucherNo: { type: "string" }, inrAmount: { type: "string" }, nowOwed: { type: "string" }, advanceInr: { type: "string" } } }) },
      },
      "/reports/client-statement": { get: { summary: "One client's two tracks, each with a running balance", parameters: [{ name: "partyId", in: "query", required: true, schema: { type: "integer" } }, { name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }], responses: ok({ type: "object" }) } },
      "/reports/client-summary": { get: { summary: "Both client tracks: rupees owed to us, and currency we still owe", parameters: [{ name: "q", in: "query", schema: { type: "string" } }, { name: "partyId", in: "query", schema: { type: "integer" } }], responses: ok({ type: "object" }) } },
      "/reports/depositor-summary": { get: { summary: "Brought in, paid back and still owed, per depositor", parameters: [{ name: "q", in: "query", schema: { type: "string" } }], responses: ok({ type: "object" }) } },
      "/reports/depositor-statement": { get: { summary: "One depositor's account with a running balance", parameters: [{ name: "partyId", in: "query", required: true, schema: { type: "integer" } }, { name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }], responses: ok({ type: "object" }) } },
      "/reports/statements": { get: { summary: "The accounting statements — profit & loss, balance sheet, ageing and the rest of the CA pack", parameters: [{ name: "name", in: "query", description: "one statement; omit for the whole pack", schema: { type: "string", enum: [...CA_PACK, "ageing", "clientsummary", "depositorsummary", "depositorprofit", "cycles", "currencydue"] } }, { name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }], responses: ok({ type: "object" }) } },
      "/reports/trial-balance": { get: { summary: "Trial balance", responses: ok({ type: "object" }) } },
      "/reports/party-balances": { get: { summary: "What each party owes or is owed", responses: ok({ type: "object" }) } },
      "/reports/currency-position": { get: { summary: "Holdings by currency plus the liquidity summary", responses: ok({ type: "object" }) } },
      "/users": { get: { summary: "Everybody who can sign in — read-only; people are added and blocked by Genius ITens (user.view)", responses: ok({ type: "object" }) } },
      "/roles": { get: { summary: "The roles at this desk and every permission by module (user.view)", responses: ok({ type: "object" }) } },
      "/currencies": {
        get: { summary: "The company's currencies and the ISO codes still available (currency.manage)", responses: ok({ type: "object" }) },
        post: { summary: "Enable a currency; a cash/bank account is created for it (currency.manage)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["code"], properties: { code: { type: "string", example: "GBP" }, order: { type: "integer", default: 10 } } } } } }, responses: ok({ type: "object", properties: { code: { type: "string" } } }) },
      },
      "/currencies/{id}": { patch: { summary: "Display order and whether the currency can be dealt (currency.manage)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["order", "active"], properties: { order: { type: "integer" }, active: { type: "boolean" } } } } } }, responses: ok({ type: "object" }) } },
      "/company": {
        get: { summary: "Company profile and the rules the books run on (company.manage)", responses: ok({ type: "object" }) },
        patch: { summary: "The profile printed on documents — code, currencies and the financial year are fixed at setup (company.manage)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["legalName"], properties: { legalName: { type: "string" }, displayName: { type: "string" }, gstin: { type: "string" }, pan: { type: "string" }, licenseNo: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, address: { type: "string" }, city: { type: "string" }, state: { type: "string" }, pincode: { type: "string" } } } } } }, responses: ok({ type: "object" }) },
      },
      "/audit": { get: { summary: "The audit trail, newest first (audit.view)", parameters: listParams([{ name: "table", in: "query", schema: { type: "string" } }, { name: "op", in: "query", schema: { type: "string", enum: ["INSERT", "UPDATE", "DELETE"] } }, { name: "user", in: "query", schema: { type: "integer" } }, { name: "record", in: "query", schema: { type: "integer" } }, { name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }]), responses: ok({ type: "object" }) } },
      "/backup": {
        get: { summary: "Who downloaded a backup, and when (backup.manage)", responses: ok({ type: "object" }) },
        post: { summary: "The company backup as a ZIP stream (backup.manage; rate-limited)", parameters: [{ name: "includeAudit", in: "query", schema: { type: "string", enum: ["1"] } }], responses: { "200": { description: "application/zip" } } },
      },
    },
  };
  return NextResponse.json(spec, { headers: { "cache-control": "public, max-age=300" } });
}
