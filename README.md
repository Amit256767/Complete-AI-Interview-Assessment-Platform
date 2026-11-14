# HirePrep AI

HirePrep AI is a React/Vite candidate app and Express/TypeScript API. Prisma stores users, resumes, curated questions, generated interview attempts, responses, and scores in PostgreSQL. Gemini question generation and answer evaluation run only on the API server.

## Local setup

Requirements: Node.js 20.6+ (the backend scripts use Node's `--env-file` option), npm, and a Neon or local PostgreSQL database.

1. Install dependencies from the repository root with `npm install` (the root npm workspace lockfile is `package-lock.json`).
2. Copy the backend template: `Copy-Item backend/.env.example backend/.env`.
3. Set `DATABASE_URL`, `JWT_SECRET`, and optionally `GEMINI_API_KEY` in `backend/.env`.
4. Generate the Prisma client and validate the schema:
   - `npm run db:generate -w backend`
   - `npm run db:validate -w backend`
5. Review the target database and existing migration before applying it. For a disposable/local development database, `npm run db:migrate -w backend` runs `prisma migrate dev`. For a configured Neon database with checked-in migrations, `npm run db:deploy -w backend` runs `prisma migrate deploy`. Neither command is run automatically by app startup.
6. Optionally seed the curated question bank with `npm run db:seed -w backend` after migration.
7. Run both apps using `npm run dev`; frontend defaults to port 5173 and API to port 4000.

The backend scripts load `backend/.env`; Prisma CLI also reads the schema and environment in the backend workspace. Keep `.env` files out of source control. `.gitignore` ignores them.

## Neon PostgreSQL setup

1. Create a Neon project and branch in the Neon Console.
2. Open **Connect**, select the branch, database, and role, and copy its connection string. Neon provides pooled connection details by default; the URL includes the endpoint host, database, role/password, and TLS options.
3. Put the copied URL in `backend/.env` as `DATABASE_URL`, replacing the example value. The expected shape is:

   ```dotenv
   DATABASE_URL="postgresql://<role>:<password>@<endpoint>-pooler.<region>.aws.neon.tech/<database>?sslmode=require&channel_binding=require"
   ```

   Use the exact string Neon provides rather than literal angle-bracket placeholders. Do not paste it into chat or commit it. Neon’s connection dialog and URL format are described in its [official connection guide](https://neon.com/docs/connect/connect-from-any-app).
4. `backend/prisma/schema.prisma` reads `env("DATABASE_URL")`. No migration has been run against your database as part of this work. Once you have configured the connection and explicitly approved applying the migration, run `npm run db:deploy -w backend` to apply the checked-in migration.

The development script uses `prisma migrate dev`, which is intended for development and may use a shadow database. Do not use it casually against a database containing data.

## Gemini configuration

Set `GEMINI_API_KEY` in `backend/.env`; the code reads this exact server-side variable. `GEMINI_MODEL` is optional and defaults to `gemini-3.8-flash`. Never prefix the key with `VITE_` or put it in a frontend file. Without the key, AI routes return a clear service-not-configured response; provider calls have not been verified in this environment.

## Mock interview usage

Each mock interview generates exactly 8 questions in one Gemini request. Answer evaluation currently uses local deterministic scoring and does not call Gemini. Retries and fallback model requests can add provider requests. Each authenticated user is limited to 10 successfully generated interviews per UTC day. A separate shared application guard defaults to 15 Gemini request attempts per UTC day (`GEMINI_DAILY_REQUEST_BUDGET`); set that environment variable in Render to a positive integer to configure it. This 15-request default is a conservative app-level circuit breaker, not a claim about Google's quota. It is shared across all users and counts outbound attempts, including provider failures and retries, because those calls may have reached Google. Duplicate idempotent starts are resolved before reserving a Gemini request. See authenticated `GET /api/usage` for today's global request count/budget and your own request/token totals.

Configure `GEMINI_RETRY_ATTEMPTS` (default 3), `GEMINI_RETRY_BASE_DELAY_MS` (default 500), and `GEMINI_DAILY_REQUEST_BUDGET` in the backend environment. `GEMINI_FALLBACK_MODEL` defaults to `gemini-3.7-flash`; set it blank to disable fallback. Gemini limits vary by model, tier, and project and are shared per Google Cloud project, not per API key. Inspect the active model's RPD/RPM/TPM limits and other callers in AI Studio before setting a production budget. Keep the app budget below the remaining project request allowance after reserving capacity for other workloads; do not infer provider quota from the app's default of 15. Transient rate limits honor `Retry-After` where supplied and are retried within the configured attempt limit; daily project quota exhaustion is not retried.

Apply the checked-in interview usage migration to the target PostgreSQL database before deploying this backend version. App startup does not run migrations automatically.

Generate a long random `JWT_SECRET` (at least 32 characters) for local auth. `PORT`, `FRONTEND_URL`, and `MAX_UPLOAD_MB` are also defined in the backend env template.


## Render backend deployment

Create a Render **Web Service** with the repository root as its root directory (`.`) so the npm workspace manifest and root `package-lock.json` are available. Use build command `npm ci --include=dev && npm run db:generate --workspace @hireprep/backend && npm run build --workspace @hireprep/backend` and start command `npm start --workspace @hireprep/backend`. Prisma generation runs against `backend/prisma/schema.prisma`; TypeScript emits the server to `backend/dist/src/index.js`, which the backend start script runs. The API binds to `0.0.0.0` and uses Render's `PORT` (defaulting to 4000 locally).

Set `DATABASE_URL`, a unique random `JWT_SECRET` of at least 32 characters, `GEMINI_API_KEY`, and `FRONTEND_URL` in Render. Put every deployed frontend origin there, comma-separated, for example `https://your-site.netlify.app,https://your-site.vercel.app` (scheme and hostname only, no path or trailing slash). `CLIENT_URL` is also accepted as an additional comma-separated origin list. Keep the existing Netlify origin when adding the exact Vercel origin. Localhost ports 5173 and 3000 are allowed for development. The backend uses an explicit origin allowlist with credentials enabled, and CORS middleware answers OPTIONS preflight requests. `GEMINI_MODEL` and `MAX_UPLOAD_MB` are optional. Use `/api/health` as the health check path. Database migrations are not run on startup; review and apply checked-in migrations separately.

For Vercel, set `VITE_API_URL=https://complete-ai-interview-assessment-platform.onrender.com/api` in the frontend project's Production environment (and Preview if previews should use this backend), then redeploy. The frontend API client reads this variable at build time and normalizes the `/api` suffix. Do not put backend secrets in Vercel frontend variables; `VITE_` values are public.
## Data flow and API

Authenticated endpoints use `Authorization: Bearer <token>`.

- Signup/login read and write `User` records; passwords are bcrypt-hashed and are not returned.
- Dashboard/history query the signed-in user's `Attempt` and `Resume` records.
- PDF uploads are signature-checked, parsed for text, and stored as extracted text and skill metadata in `Resume`, scoped to the authenticated user.
- Mock interview generation reserves a daily slot, creates exactly 8 candidate-safe questions in one Gemini call, and stores answer keys in `AttemptQuestion`.
- Submission checks attempt ownership and deadline, requires all 8 answers, stores `Response` rows, and evaluates the full interview once with a validated Gemini response. Duplicate submissions return the cached result.
- Gemini request statuses, model names, and token usage are recorded in `GeminiApiUsage` and aggregated in `DailyUsage`.

Endpoints:

- `GET /api/health`
- `POST /api/auth/signup` — `{name,email,password}`
- `POST /api/auth/login` — `{email,password}`
- `GET /api/dashboard`
- `GET /api/usage` (authenticated global daily request count/budget and signed-in user's request/token totals)
- `GET /api/questions`
- `POST /api/resumes` — multipart PDF field `resume`
- `POST /api/assessments/generate` - `{role,category,difficulty,count:8,durationMinutes,resumeId?,jobDescription?}`; requires an `Idempotency-Key` header.
- `POST /api/assessments/:id/submit` — `{answers:[{questionId,selectedIndex}]}`

## Checks

- `npm test` runs backend unit and API route tests.
- `npm run build` runs backend and frontend TypeScript checks and production builds.
- `npm run db:validate -w backend` validates the Prisma schema without connecting to Neon.
- `npm run db:generate -w backend` generates Prisma Client.

The API tests use a mocked Prisma client and do not require Neon credentials. A live Neon connection check and live Gemini calls require their respective credentials and working network access.

## Known limitations

Voice recording/transcription, downloadable PDF reports, adaptive follow-up questions, admin workflows, and full question-bank randomization remain incomplete. The interview UI currently handles generated MCQs. The frontend build emits a large-bundle advisory (573 KB); code splitting has not yet been added. The current client stores bearer tokens in localStorage; use secure, same-site cookies before production deployment. No deployment has been performed.




