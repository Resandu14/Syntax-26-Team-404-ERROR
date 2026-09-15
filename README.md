# CleanSpot

CleanSpot is a hackathon-ready environmental sustainability platform. It takes a citizen report from photo to AI-assisted triage, cleanup-team action, proof-based completion, point reward, reward redemption, and reuse through a real marketplace.

## Run locally

1. Create a Supabase project and run [supabase/schema.sql](supabase/schema.sql) in its SQL Editor.
2. In Supabase Authentication, enable Email + Password. For the fastest live demo, disable email confirmation temporarily.
3. Copy `.env.example` to `.env` and add the Supabase URL, anon key, service-role key, and Hack Club AI key.
4. Set `HACKCLUB_AI_BASE_URL=https://ai.hackclub.com/proxy/v1` and `HACKCLUB_AI_MODEL=gpt-4`. Your Hack Club key must have access to `gpt-4`; when it is unavailable, CleanSpot stores a transparent rules-based estimate so reporting remains available.
5. Run `npm install`, then `npm start`.
6. Open `http://localhost:3000`.

## Hackathon demo setup

Create one citizen account and one cleanup-company account from the registration page. The cleanup company creates its company profile during registration. Seeded rewards appear after the SQL is run. Marketplace listings are real records: sign in as a citizen and use `Sell materials` to create the first listing.

## Security decisions

- Supabase Auth owns passwords and sessions.
- The browser uses only the Supabase anon key for Auth. The service-role and Hack Club keys remain on Express.
- All database writes go through authenticated Express routes. The server independently resolves roles, points, reward costs, report transitions, and duplicate reports.
- Cleanup completion and reward claims use database functions with row locks, preventing double point awards and oversold rewards.
- RLS blocks browser-side point changes, workflow changes, and access to other users' private records.

## Core paths

- `POST /api/analyze-waste` uses the server-side Hack Club GPT-4 integration and returns a validated assessment or transparent fallback.
- `POST /api/reports` uploads evidence, creates an AI assessment, and performs server-side duplicate detection within 125 metres of active similar reports.
- `POST /api/company/reports/:reportId/complete` requires a proof photo and awards 10, 25, or 50 points exactly once.
- `POST /api/rewards/:rewardId/claim` deducts the database-stored reward cost only when stock and points permit it.
- `POST /api/marketplace` creates persistent, user-owned material listings.
