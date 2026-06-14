# CareLink 🏥

> AI-powered medical bill translator — plain English, error detection, cost reduction.

Medical bills are intentionally complex. CareLink decodes them.

## What CareLink does

- **Translates** medical billing codes (CPT, ICD-10, HCPCS) into plain English
- **Detects errors** — duplicate charges, unbundling violations, upcoding patterns
- **Estimates fair price** — compares your charges against Medicare rates and regional averages
- **Guides appeals** — generates appeal letter drafts for denied claims or overbilling
- **Tracks EOBs** — explains Explanation of Benefits documents from insurance companies

## Why it matters

1 in 3 medical bills contains an error. The average overcharge is $1,300.
Most patients never dispute because they cannot understand the bill.
CareLink fixes that.

## Stack

- **Frontend**: React Native (mobile-first, iOS + Android)
- **Backend**: Node.js + TypeScript + Fastify
- **AI**: Claude API (bill parsing, plain English translation, appeal generation)
- **Database**: PostgreSQL (bills, line items, appeals)
- **Auth**: Clerk
- **Storage**: S3 (bill images/PDFs)

## Repo structure

```
carelink/
  apps/
    mobile/          — React Native app
    web/             — Next.js web app (bill upload + dashboard)
  packages/
    api/             — Fastify REST API
    ai/              — Claude integration (parsing, translation, appeals)
    db/              — Prisma schema + migrations
    shared/          — shared TypeScript types
  docs/
    ARCHITECTURE.md  — system design
    BILLING-CODES.md — CPT/ICD-10/HCPCS reference
```

## Getting started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Add: DATABASE_URL, ANTHROPIC_API_KEY, CLERK_SECRET_KEY, AWS_*

# Run migrations
cd packages/db && npx prisma migrate dev

# Start API
cd packages/api && npm run dev

# Start mobile app
cd apps/mobile && npm run ios
```

## License

MIT
