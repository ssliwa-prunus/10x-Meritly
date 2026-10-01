# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v6 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run smoke` - Smoke test the auth flow against a running server (`BASE_URL`, defaults to `http://localhost:4321`)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

`npx supabase start` (and `npx supabase db reset`) applies the migrations in `supabase/migrations/` and loads `supabase/seed.sql`, which creates four local accounts, all with the password `Meritly-Local-Passw0rd!`:

| Account                     | Role         | Notes                                                               |
| --------------------------- | ------------ | ------------------------------------------------------------------- |
| `admin@meritly.local`       | `admin`      |                                                                     |
| `supervisor@meritly.local`  | `supervisor` | Owns "Local Demo Project" (two active milestones) and two employees |
| `supervisor2@meritly.local` | `supervisor` | Owns nothing; use it for cross-owner checks and reassignments       |
| `employee@meritly.local`    | `employee`   | Linked to the active employee record below                          |

It also seeds two employee records owned by `supervisor@meritly.local`:

- `…0031` "Local Employee" (`employee@meritly.local`): invited and active, assigned 0.60 + 0.50 on the two milestones, so the >100% flag shows at 110%.
- `…0032` "Pending Invitee" (`pending@meritly.local`): not invited yet and has no account. Use it to test the invite flow.

The seed is for local development and CI only.

### Employee invites in local development

Invites are sent by the `invite-employee` Supabase Edge Function, which `npm run dev` does not run. Serve it next to the dev server:

```bash
npx supabase functions serve
```

Local Supabase does not send real email. Open the test inbox at `http://127.0.0.1:54324`, open the invite and follow its link: it goes to `/auth/confirm` and then `/auth/set-password` on `http://localhost:4321`.

Run the database RLS tests (pgTAP) against the running local stack with:

```bash
npx supabase test db
```

### Roles

Access roles (`admin`, `supervisor`, `employee`) live in `public.profiles.role`. Every new signup gets a profile with role `employee`. Until an admin UI exists, promote a user in the hosted project by running this in the Supabase SQL editor:

```sql
update public.profiles set role = 'admin' where email = '<email>';
```

Never store roles in `user_metadata`: users can edit it themselves.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                                                          |
| `/auth/signup`        | Email/password sign-up form                                                                          |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                                                  |
| `/auth/confirm`       | Invite link target: exchanges the `token_hash` for a session, then redirects to `/auth/set-password` |
| `/auth/set-password`  | Set-password form for a newly invited employee (requires sign-in)                                    |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated)                              |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

### Production deploy runbook (S-03 invites)

Employee invites need Resend as Supabase Auth's SMTP provider, the invite template, the S-03 migrations and the `invite-employee` Edge Function in the hosted project. Run these steps in order. **[HUMAN]** steps are dashboard or account work; **[AGENT/HUMAN]** steps are commands.

1. **[HUMAN]** Create a Resend account and add a domain you control. Publish its SPF/DKIM DNS records until Resend shows the domain as verified, then create an API key.
2. **[HUMAN]** Supabase dashboard → **Authentication → SMTP Settings**: enable custom SMTP with host `smtp.resend.com`, port `465`, user `resend`, the Resend API key as the password, and a sender address on the verified domain.
3. **[HUMAN]** Supabase dashboard → **Authentication → Email Templates → Invite user**: use the same link as `supabase/templates/invite.html`:

   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Accept the invite</a>
   ```

   In **Authentication → URL Configuration**, confirm the Site URL is `https://meritly.meritly.workers.dev` and that it is in Redirect URLs.

4. **[AGENT/HUMAN]** Link the project and apply all pending migrations (this also applies any earlier migrations that were never pushed), then check that none are pending:

   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   npx supabase migration list
   ```

5. **[AGENT/HUMAN]** Deploy the Edge Function:

   ```bash
   npx supabase functions deploy invite-employee
   ```

6. **[AGENT/HUMAN]** Build and deploy the Worker:

   ```bash
   npm run build && npx wrangler deploy
   ```

7. **[HUMAN]** In the production SQL editor, promote your own account to `supervisor` (roles have no UI):

   ```sql
   update public.profiles set role = 'supervisor' where email = '<email>';
   ```

8. **[HUMAN]** On the production URL, register an employee with an external mailbox you control, send the invite, accept it, set a password and sign in. Check that the employee lands on the dashboard and that the employee's `activated_at` is set.

The Worker still needs only `SUPABASE_URL` and `SUPABASE_KEY`. The secret key stays in Supabase, where the Edge Function runs.

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that walks the whole auth flow (sign-up, sign-in, protected page, sign-out) over HTTP. Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
BASE_URL=http://localhost:4321 npm run smoke
```

It needs a reachable Supabase instance (local or cloud) with email confirmation disabled.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## CI

GitHub Actions runs two jobs on every push and PR to `master`:

- **ci** — lint, `astro check` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI, builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke` against it. No secrets required.

## License

MIT
