// packages/shared/src/types.ts
// ─── CareLink Shared Types ────────────────────────────────────────────────
// Single source of truth for types used across API, AI, mobile, and web.

// ── Bill ──────────────────────────────────────────────────────────────────

export interface Bill {
  id:          string;
  userId:      string;
  provider:    string;           // hospital / clinic name
  serviceDate: string;           // ISO date
  totalAmount: number;           // cents
  amountOwed:  number;           // after insurance, in cents
  status:      BillStatus;
  imageUrl?:   string;           // S3 URL of uploaded bill image
  pdfUrl?:     string;           // S3 URL of uploaded PDF
  parsedAt?:   string;           // ISO datetime when AI parsed it
  createdAt:   string;
  updatedAt:   string;
  lineItems:   LineItem[];
  errors:      BillingError[];
  appeals:     Appeal[];
}

export type BillStatus =
  | "uploaded"      // just uploaded, not yet parsed
  | "parsing"       // AI is processing
  | "parsed"        // parsed, showing results
  | "disputed"      // user has opened a dispute
  | "resolved";     // dispute resolved

// ── Line Item ─────────────────────────────────────────────────────────────

export interface LineItem {
  id:              string;
  billId:          string;
  code:            string;           // CPT / ICD-10 / HCPCS code
  codeType:        BillingCodeType;
  description:     string;           // raw description from bill
  plainEnglish:    string;           // AI-generated plain English
  quantity:        number;
  billedAmount:    number;           // cents — what provider charged
  allowedAmount?:  number;           // cents — what insurance allows
  medicareRate?:   number;           // cents — Medicare reference rate
  patientOwes:     number;           // cents — after insurance
  flagged:         boolean;          // flagged as potentially erroneous
  flagReason?:     string;           // why it was flagged
  createdAt:       string;
}

export type BillingCodeType = "CPT" | "ICD10" | "HCPCS" | "DRG" | "NDC" | "unknown";

// ── Billing Error ─────────────────────────────────────────────────────────

export interface BillingError {
  id:          string;
  billId:      string;
  type:        BillingErrorType;
  severity:    "critical" | "warning" | "info";
  description: string;           // plain English description
  lineItemIds: string[];         // which line items are involved
  estimatedOvercharge?: number;  // cents — how much this error may cost patient
  createdAt:   string;
}

export type BillingErrorType =
  | "duplicate_charge"       // same service billed twice
  | "unbundling"             // separate billing for services that should be bundled
  | "upcoding"               // billed for more expensive service than delivered
  | "wrong_patient"          // patient data mismatch
  | "outside_network"        // out-of-network provider not disclosed
  | "experimental_treatment" // insurance exclusion not flagged
  | "date_mismatch"          // service date doesn't match records
  | "quantity_error";        // quantity billed doesn't match service

// ── Appeal ────────────────────────────────────────────────────────────────

export interface Appeal {
  id:            string;
  billId:        string;
  errorIds:      string[];
  status:        AppealStatus;
  draftLetter:   string;         // AI-generated appeal letter
  submittedAt?:  string;
  resolvedAt?:   string;
  outcome?:      string;         // what happened
  amountSaved?:  number;         // cents recovered
  createdAt:     string;
  updatedAt:     string;
}

export type AppealStatus =
  | "draft"
  | "ready"
  | "submitted"
  | "pending"
  | "approved"
  | "denied"
  | "escalated";

// ── User ──────────────────────────────────────────────────────────────────

export interface User {
  id:          string;   // Clerk user ID
  email:       string;
  name?:       string;
  plan:        "free" | "pro";
  billsCount:  number;
  totalSaved:  number;   // cents recovered across all appeals
  createdAt:   string;
}

// ── API response wrappers ─────────────────────────────────────────────────

export interface ApiResponse<T> {
  data:    T;
  success: true;
}

export interface ApiError {
  error:   string;
  code:    string;
  success: false;
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// ── AI payloads ───────────────────────────────────────────────────────────

export interface ParseBillRequest {
  imageBase64?: string;   // base64 encoded bill image
  pdfBase64?:   string;   // base64 encoded PDF
  rawText?:     string;   // if already extracted
}

export interface ParseBillResponse {
  provider:    string;
  serviceDate: string;
  totalAmount: number;
  lineItems:   Omit<LineItem, "id" | "billId" | "createdAt">[];
  errors:      Omit<BillingError, "id" | "billId" | "createdAt">[];
  confidence:  number;    // 0–1, how confident the AI is in the parse
}

export interface GenerateAppealRequest {
  bill:      Bill;
  errors:    BillingError[];
  patientName: string;
  insurerId?:  string;
}

export interface GenerateAppealResponse {
  letter:    string;       // full appeal letter text
  keyPoints: string[];     // bullet points for patient to reference
}
