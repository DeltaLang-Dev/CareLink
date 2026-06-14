# CareLink Architecture

## Overview

CareLink is a monorepo built with Turborepo. All packages share types and utilities.

## System flow

```
User uploads bill (image/PDF)
        │
        ▼
   API receives file
        │
        ▼
   Store bill record (status: PARSING)
        │
        ▼
   Claude parses bill (vision API)
   ├── Extract line items with codes
   ├── Translate codes to plain English
   ├── Detect obvious errors
   └── Estimate Medicare reference rates
        │
        ▼
   Run additional error detection pass
   ├── Duplicate charge analysis
   ├── Unbundling check
   └── Quantity validation
        │
        ▼
   Store line items + errors (status: PARSED)
        │
        ▼
   User reviews results in app
        │
    (optional)
        ▼
   User requests appeal letter
        │
        ▼
   Claude generates appeal letter
   ├── References specific errors
   ├── Cites billing regulations
   └── Includes patient rights language
        │
        ▼
   User downloads/sends appeal
```

## Package responsibilities

| Package | Responsibility |
|---|---|
| `packages/shared` | TypeScript types used everywhere |
| `packages/db` | Prisma schema + client |
| `packages/ai` | Claude API wrapper (parse, translate, detect, appeal) |
| `packages/api` | Fastify REST API |
| `apps/mobile` | React Native mobile app |
| `apps/web` | Next.js web dashboard |

## AI prompting strategy

All AI calls use structured JSON output — Claude is instructed to return only JSON with no preamble. This allows safe `JSON.parse()` on the response without regex.

Error detection runs in two passes:
1. **Bill parse pass** — Claude sees the full bill and flags obvious issues while parsing
2. **Dedicated detection pass** — Claude receives only the structured line items and runs deeper analysis

This two-pass approach catches more errors than a single combined prompt.

## Data model

Bills → LineItems (many)
     → BillingErrors (many)
     → Appeals (many) → BillingErrors (many-many)

## Security

- All bill images are stored in private S3 (no public URLs)
- API requires Clerk JWT on every request
- Database has row-level isolation by userId
- No bill data is logged (PHI compliance)
