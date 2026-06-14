// packages/ai/src/index.ts
// ─── CareLink AI Service ──────────────────────────────────────────────────
// Wraps Claude API for bill parsing, plain English translation,
// error detection, and appeal letter generation.

import Anthropic from "@anthropic-ai/sdk";
import type {
  ParseBillRequest,
  ParseBillResponse,
  GenerateAppealRequest,
  GenerateAppealResponse,
  LineItem,
  BillingError,
} from "@carelink/shared";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Bill parsing ──────────────────────────────────────────────────────────

/**
 * Parse a medical bill (image, PDF, or raw text) into structured line items.
 * Uses Claude's vision capability for images/PDFs.
 */
export async function parseBill(req: ParseBillRequest): Promise<ParseBillResponse> {
  const content: Anthropic.MessageParam["content"] = [];

  if (req.imageBase64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: req.imageBase64 },
    });
  }

  if (req.rawText) {
    content.push({ type: "text", text: req.rawText });
  }

  content.push({
    type: "text",
    text: PARSE_BILL_PROMPT,
  });

  const response = await client.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 4096,
    messages:   [{ role: "user", content }],
  });

  const text = response.content
    .filter(b => b.type === "text")
    .map(b => (b as Anthropic.TextBlock).text)
    .join("");

  return parseAiResponse<ParseBillResponse>(text);
}

// ── Plain English translation ──────────────────────────────────────────────

/**
 * Translate a single medical billing code to plain English.
 * Used when the full bill parse does not produce a plain English description.
 */
export async function translateCode(
  code: string,
  codeType: LineItem["codeType"],
  rawDescription: string
): Promise<string> {
  const response = await client.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{
      role: "user",
      content: `Translate this medical billing code to plain English in 1-2 sentences. Be specific about what the procedure or service is. Do not use medical jargon.

Code: ${code} (${codeType})
Raw description: ${rawDescription}

Respond with only the plain English translation, nothing else.`,
    }],
  });

  return (response.content[0] as Anthropic.TextBlock).text.trim();
}

// ── Error detection ───────────────────────────────────────────────────────

/**
 * Analyse line items for common billing errors.
 * Returns errors with severity ratings and estimated overcharges.
 */
export async function detectErrors(
  lineItems: LineItem[],
  provider: string
): Promise<BillingError[]> {
  const response = await client.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `Analyse these medical bill line items from ${provider} for billing errors.

Line items:
${JSON.stringify(lineItems, null, 2)}

Check for:
1. Duplicate charges (same code/service billed multiple times)
2. Unbundling (services billed separately that should be bundled under one code)
3. Upcoding (billed for more expensive service than described)
4. Quantity errors (quantity seems wrong for the service type)
5. Date/service mismatches

${DETECT_ERRORS_PROMPT}`,
    }],
  });

  const text = (response.content[0] as Anthropic.TextBlock).text;
  return parseAiResponse<BillingError[]>(text);
}

// ── Appeal letter generation ───────────────────────────────────────────────

/**
 * Generate a professional appeal letter for billing errors.
 * Letter is addressed to the provider or insurance company.
 */
export async function generateAppealLetter(
  req: GenerateAppealRequest
): Promise<GenerateAppealResponse> {
  const response = await client.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 3000,
    messages: [{
      role: "user",
      content: `Generate a professional, firm medical bill appeal letter for the following situation.

Patient: ${req.patientName}
Provider: ${req.bill.provider}
Service date: ${req.bill.serviceDate}
Total billed: $${(req.bill.totalAmount / 100).toFixed(2)}
${req.insurerId ? `Insurance: ${req.insurerId}` : ""}

Errors found:
${req.errors.map(e => `- ${e.type}: ${e.description}${e.estimatedOvercharge ? ` (estimated overcharge: $${(e.estimatedOvercharge / 100).toFixed(2)})` : ""}`).join("\n")}

${APPEAL_LETTER_PROMPT}`,
    }],
  });

  const text = (response.content[0] as Anthropic.TextBlock).text;
  return parseAiResponse<GenerateAppealResponse>(text);
}

// ── Prompts ───────────────────────────────────────────────────────────────

const PARSE_BILL_PROMPT = `
Extract all information from this medical bill and return a JSON object with this exact structure:
{
  "provider": "string — hospital or clinic name",
  "serviceDate": "string — ISO date YYYY-MM-DD",
  "totalAmount": "number — total billed in cents",
  "lineItems": [
    {
      "code": "string — billing code",
      "codeType": "CPT | ICD10 | HCPCS | DRG | NDC | unknown",
      "description": "string — raw description from bill",
      "plainEnglish": "string — 1-2 sentence plain English explanation for a patient",
      "quantity": "number",
      "billedAmount": "number — in cents",
      "medicareRate": "number or null — Medicare reference rate in cents if you know it",
      "patientOwes": "number — in cents",
      "flagged": "boolean — true if this item seems unusual or potentially erroneous",
      "flagReason": "string or null — why it was flagged"
    }
  ],
  "errors": [
    {
      "type": "duplicate_charge | unbundling | upcoding | wrong_patient | outside_network | experimental_treatment | date_mismatch | quantity_error",
      "severity": "critical | warning | info",
      "description": "string — plain English description of the error",
      "lineItemIds": [],
      "estimatedOvercharge": "number or null — estimated overcharge in cents"
    }
  ],
  "confidence": "number 0-1 — how confident you are in this parse"
}

Return ONLY the JSON object, no preamble, no markdown backticks.
`;

const DETECT_ERRORS_PROMPT = `
Return a JSON array of errors found. Each error:
{
  "type": "duplicate_charge | unbundling | upcoding | wrong_patient | outside_network | experimental_treatment | date_mismatch | quantity_error",
  "severity": "critical | warning | info",
  "description": "plain English description — explain what the error is and why it matters to the patient",
  "lineItemIds": ["array of line item IDs involved"],
  "estimatedOvercharge": null or number in cents
}

Return ONLY the JSON array. If no errors found, return [].
`;

const APPEAL_LETTER_PROMPT = `
Return a JSON object:
{
  "letter": "the complete appeal letter as a string — formal, firm, patient-centered. Include: date, patient info header, clear description of each error with supporting detail, specific request for correction and reprocessing, deadline for response (30 days), contact information placeholder.",
  "keyPoints": ["array of 3-5 bullet points summarizing the strongest arguments for the patient to reference"]
}

Return ONLY the JSON object, no preamble, no markdown backticks.
`;

// ── JSON parsing helper ───────────────────────────────────────────────────

function parseAiResponse<T>(text: string): T {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(clean) as T;
}
