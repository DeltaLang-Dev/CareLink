// packages/api/src/index.ts
// ─── CareLink API ─────────────────────────────────────────────────────────
// Fastify REST API — bill upload, parsing, error detection, appeals.

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";
import {
  parseBill,
  detectErrors,
  generateAppealLetter,
} from "@carelink/ai";
import type {
  ParseBillRequest,
  GenerateAppealRequest,
} from "@carelink/shared";

const app    = Fastify({ logger: true });
const prisma = new PrismaClient();

// ── Plugins ───────────────────────────────────────────────────────────────

await app.register(cors,       { origin: true });
await app.register(multipart,  { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// ── Auth middleware ───────────────────────────────────────────────────────
// Clerk verifies the JWT and sets req.userId
// In production, use @clerk/fastify plugin

app.addHook("onRequest", async (req, reply) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    reply.status(401).send({ success: false, error: "Unauthorized", code: "NO_TOKEN" });
    return;
  }
  // TODO: verify Clerk JWT, extract userId
  // For now, extract from header for development
  (req as any).userId = req.headers["x-user-id"] as string ?? "dev-user";
});

// ── Bills ─────────────────────────────────────────────────────────────────

// GET /bills — list user's bills
app.get("/bills", async (req, reply) => {
  const userId = (req as any).userId as string;
  const bills  = await prisma.bill.findMany({
    where:   { userId },
    include: { lineItems: true, errors: true, appeals: true },
    orderBy: { createdAt: "desc" },
  });
  return { success: true, data: bills };
});

// GET /bills/:id — get single bill with full detail
app.get<{ Params: { id: string } }>("/bills/:id", async (req, reply) => {
  const userId = (req as any).userId as string;
  const bill   = await prisma.bill.findFirst({
    where:   { id: req.params.id, userId },
    include: { lineItems: true, errors: true, appeals: true },
  });
  if (!bill) return reply.status(404).send({ success: false, error: "Bill not found", code: "NOT_FOUND" });
  return { success: true, data: bill };
});

// POST /bills — upload and parse a bill
app.post("/bills", async (req, reply) => {
  const userId = (req as any).userId as string;
  const data   = await req.file();
  if (!data) return reply.status(400).send({ success: false, error: "No file uploaded", code: "NO_FILE" });

  const buffer = await data.toBuffer();
  const isPdf  = data.mimetype === "application/pdf";
  const isImg  = data.mimetype.startsWith("image/");

  if (!isPdf && !isImg) {
    return reply.status(400).send({ success: false, error: "File must be an image or PDF", code: "INVALID_TYPE" });
  }

  // Create pending bill record
  const bill = await prisma.bill.create({
    data: {
      userId,
      provider:    "Parsing...",
      serviceDate: new Date(),
      totalAmount: 0,
      amountOwed:  0,
      status:      "PARSING",
    },
  });

  // Async parse — do not await so we return immediately
  parseBillAsync(bill.id, buffer, isPdf).catch(err => {
    app.log.error({ err, billId: bill.id }, "Bill parse failed");
    prisma.bill.update({ where: { id: bill.id }, data: { status: "UPLOADED" } }).catch(() => {});
  });

  return reply.status(202).send({ success: true, data: { id: bill.id, status: "parsing" } });
});

// DELETE /bills/:id
app.delete<{ Params: { id: string } }>("/bills/:id", async (req, reply) => {
  const userId = (req as any).userId as string;
  const bill   = await prisma.bill.findFirst({ where: { id: req.params.id, userId } });
  if (!bill) return reply.status(404).send({ success: false, error: "Bill not found", code: "NOT_FOUND" });
  await prisma.bill.delete({ where: { id: req.params.id } });
  return { success: true, data: null };
});

// ── Appeals ───────────────────────────────────────────────────────────────

// POST /bills/:id/appeals — generate appeal letter
app.post<{ Params: { id: string }; Body: { patientName: string; insurerId?: string } }>(
  "/bills/:id/appeals",
  async (req, reply) => {
    const userId = (req as any).userId as string;
    const bill   = await prisma.bill.findFirst({
      where:   { id: req.params.id, userId },
      include: { lineItems: true, errors: true },
    });
    if (!bill) return reply.status(404).send({ success: false, error: "Bill not found", code: "NOT_FOUND" });

    const appealReq: GenerateAppealRequest = {
      bill:        bill as any,
      errors:      bill.errors as any,
      patientName: req.body.patientName,
      insurerId:   req.body.insurerId,
    };

    const { letter, keyPoints } = await generateAppealLetter(appealReq);

    const appeal = await prisma.appeal.create({
      data: {
        billId:      bill.id,
        draftLetter: letter,
        status:      "DRAFT",
      },
    });

    // Update bill status
    await prisma.bill.update({ where: { id: bill.id }, data: { status: "DISPUTED" } });

    return { success: true, data: { ...appeal, keyPoints } };
  }
);

// PATCH /appeals/:id — update appeal status
app.patch<{ Params: { id: string }; Body: { status: string; outcome?: string; amountSaved?: number } }>(
  "/appeals/:id",
  async (req, reply) => {
    const appeal = await prisma.appeal.update({
      where: { id: req.params.id },
      data: {
        status:      req.body.status as any,
        outcome:     req.body.outcome,
        amountSaved: req.body.amountSaved,
        resolvedAt:  ["APPROVED","DENIED"].includes(req.body.status) ? new Date() : undefined,
      },
    });
    return { success: true, data: appeal };
  }
);

// ── Health check ──────────────────────────────────────────────────────────

app.get("/health", async () => ({ ok: true, version: "0.1.0" }));

// ── Async bill parsing ────────────────────────────────────────────────────

async function parseBillAsync(billId: string, buffer: Buffer, isPdf: boolean) {
  const parseReq: ParseBillRequest = isPdf
    ? { pdfBase64:   buffer.toString("base64") }
    : { imageBase64: buffer.toString("base64") };

  const parsed = await parseBill(parseReq);

  // Detect additional errors
  const lineItemsForDetection = parsed.lineItems.map((li, i) => ({
    ...li,
    id:        `temp-${i}`,
    billId,
    createdAt: new Date().toISOString(),
  }));
  const additionalErrors = await detectErrors(lineItemsForDetection as any, parsed.provider);

  // Persist everything
  await prisma.$transaction([
    prisma.bill.update({
      where: { id: billId },
      data: {
        provider:    parsed.provider,
        serviceDate: new Date(parsed.serviceDate),
        totalAmount: parsed.totalAmount,
        status:      "PARSED",
        parsedAt:    new Date(),
      },
    }),
    ...parsed.lineItems.map(li =>
      prisma.lineItem.create({
        data: {
          billId,
          code:         li.code,
          codeType:     li.codeType?.toUpperCase() as any ?? "UNKNOWN",
          description:  li.description,
          plainEnglish: li.plainEnglish,
          quantity:     li.quantity,
          billedAmount: li.billedAmount,
          medicareRate: li.medicareRate ?? null,
          patientOwes:  li.patientOwes,
          flagged:      li.flagged,
          flagReason:   li.flagReason ?? null,
        },
      })
    ),
    ...[...parsed.errors, ...additionalErrors].map(e =>
      prisma.billingError.create({
        data: {
          billId,
          type:                e.type?.toUpperCase().replace(/-/g,"_") as any,
          severity:            e.severity?.toUpperCase() as any ?? "WARNING",
          description:         e.description,
          lineItemIds:         e.lineItemIds ?? [],
          estimatedOvercharge: e.estimatedOvercharge ?? null,
        },
      })
    ),
  ]);
}

// ── Start ─────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? "3001");
app.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
});
