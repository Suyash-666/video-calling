# ConnectCall

A real-time video conferencing application built with Next.js, NestJS, Socket.IO, WebRTC and Supabase.

## Architecture

- **Frontend:** Next.js 16, React, TypeScript and Tailwind CSS.
- **Backend:** NestJS 12 and Socket.IO.
- **Authentication:** Supabase Auth.
- **Database:** Supabase PostgreSQL.
- **Media:** WebRTC peer-to-peer audio and video.
- **Signaling:** Authenticated Socket.IO connections through NestJS.
- **Storage:** Supabase Storage.

## Repository Structure

```text
connectcall/
├── apps/
│   ├── web/                 # Next.js frontend
│   │   ├── src/app/
│   │   ├── src/lib/
│   │   └── package.json
│   └── api/                 # NestJS backend
│       ├── src/
│       └── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Local Development

### Requirements

- Node.js 22 or later
- npm
- A Supabase project

### 1. Frontend

```bash
cd apps/web
npm install
npm run dev
```

Frontend runs at `http://localhost:3000`.

### 2. Backend

Open another terminal:

```bash
cd apps/api
npm install
npm run start:dev
```

Backend runs at `http://localhost:4000`.

## Environment Variables

Create `apps/web/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SIGNAL_URL=http://localhost:4000
```

Create `apps/api/.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_JWKS_URL=https://YOUR_PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json
WEB_ORIGIN=http://localhost:3000
PORT=4000
```

Never commit real environment files or expose the Supabase service-role key in frontend code.

See `.env.example` for the variable reference.

## Production Deployment

### Frontend — Vercel

- Framework: Next.js
- Root Directory: `apps/web`
- Build Command: `npm run build`
- Configure the frontend environment variables in Vercel.

### Backend — Render

- Service type: Web Service
- Root Directory: `apps/api`
- Build Command: `npm install && npm run build`
- Start Command: `npm run start:prod`
- Configure the backend environment variables in Render.
- Set `WEB_ORIGIN` to the deployed frontend origin.

Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SIGNAL_URL` to the deployed backend URL.

## Supabase

ConnectCall uses Supabase Auth, PostgreSQL and Storage.

Configure the appropriate authentication redirect URLs in the Supabase dashboard for your deployed frontend.

The existing `supabase/` directory contains legacy migrations from the previous application. Do not apply those migrations to the current ConnectCall database without reviewing and adapting them first.

## Security Notes

- Keep service-role credentials on the backend only.
- Use HTTPS in production.
- Configure CORS for the deployed frontend origin.
- Never commit `.env`, `.env.local` or other files containing secrets.