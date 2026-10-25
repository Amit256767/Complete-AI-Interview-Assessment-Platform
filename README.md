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

Set `GEMINI_API_KEY` in `backend/.env`; the code reads this exact server-side variable. `GEMINI_MODEL` is optional and defaults to `gemini-2.0-flash`. Never prefix the key with `VITE_` or put it in a frontend file. Without the key, AI routes return a clear service-not-configured response; provider calls have not been verified in this environment.

Generate a long random `JWT_SECRET` (at least 32 characters) for local auth. `PORT`, `FRONTEND_URL`, and `MAX_UPLOAD_MB` are also defined in the backend env template.


## Render backend deployment

Create a Render **Web Service** with the repository root as its root directory (`.`) so the npm workspace manifest and root `package-lock.json` are available. Use build command `npm ci --include=dev && npm run db:generate --workspace @hireprep/backend && npm run build --workspace @hireprep/backend` and start command `npm start --workspace @hireprep/backend`. Prisma generation runs against `backend/prisma/schema.prisma`; TypeScript emits the server to `backend/dist/src/index.js`, which the backend start script runs. The API binds to `0.0.0.0` and uses Render's `PORT` (defaulting to 4000 locally).

Set `DATABASE_URL`, a unique random `JWT_SECRET` of at least 32 characters, `GEMINI_API_KEY`, and `FRONTEND_URL` in Render. Set `FRONTEND_URL` to the exact deployed Netlify origin (scheme and hostname, no path or trailing slash); multiple origins may be comma-separated. `GEMINI_MODEL` and `MAX_UPLOAD_MB` are optional. Use `/api/health` as the health check path. Database migrations are not run on startup; review and apply checked-in migrations separately.
## Data flow and API

Authenticated endpoints use `Authorization: Bearer <token>`.

- Signup/login read and write `User` records; passwords are bcrypt-hashed and are not returned.
- Dashboard/history query the signed-in user's `Attempt` and `Resume` records.
- PDF uploads are signature-checked, parsed for text, and stored as extracted text and skill metadata in `Resume`, scoped to the authenticated user.
- Question generation sends candidate-safe questions to the client and stores answer keys in `AttemptQuestion`.
- Submission checks attempt ownership and deadline, compares selections to saved answer keys, and transactionally stores `Response` rows and the final `Attempt.score`.
- `POST /api/evaluate` evaluates a descriptive answer using the Gemini rubric and schema validation.

Endpoints:

- `GET /api/health`
- `POST /api/auth/signup` — `{name,email,password}`
- `POST /api/auth/login` — `{email,password}`
- `GET /api/dashboard`
- `GET /api/questions`
- `POST /api/resumes` — multipart PDF field `resume`
- `POST /api/assessments/generate` — `{role,category,difficulty,count,durationMinutes,resumeId?,jobDescription?}`
- `POST /api/assessments/:id/submit` — `{answers:[{questionId,selectedIndex}]}`
- `POST /api/evaluate` — `{prompt,answer}`

## Checks

- `npm test` runs backend unit and API route tests.
- `npm run build` runs backend and frontend TypeScript checks and production builds.
- `npm run db:validate -w backend` validates the Prisma schema without connecting to Neon.
- `npm run db:generate -w backend` generates Prisma Client.

The API tests use a mocked Prisma client and do not require Neon credentials. A live Neon connection check and live Gemini calls require their respective credentials and working network access.

## Known limitations

Voice recording/transcription, downloadable PDF reports, adaptive follow-up questions, admin workflows, and full question-bank randomization remain incomplete. The interview UI currently handles generated MCQs. The frontend build emits a large-bundle advisory (573 KB); code splitting has not yet been added. The current client stores bearer tokens in localStorage; use secure, same-site cookies before production deployment. No deployment has been performed.




