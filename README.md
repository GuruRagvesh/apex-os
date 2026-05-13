# NEXUS — TechnoEdge Internal Business Management Platform

> A full-stack internal platform for managing tickets, projects, leave requests,
> team workloads, and AI-assisted operations — built for TechnoEdge.

[![Backend](https://img.shields.io/badge/Backend-NestJS%2010-e0234e?logo=nestjs)](https://nestjs.com)
[![Frontend](https://img.shields.io/badge/Frontend-Next.js%2014-black?logo=next.js)](https://nextjs.org)
[![Database](https://img.shields.io/badge/Database-PostgreSQL-4169e1?logo=postgresql)](https://postgresql.org)
[![ORM](https://img.shields.io/badge/ORM-Prisma-2d3748?logo=prisma)](https://prisma.io)

---

## Features

| Module | Description |
|--------|-------------|
| 🎫 **Tickets** | Full lifecycle — create, assign, approve/reject, SLA timers, CSV export, file attachments |
| 📋 **Kanban** | Drag-and-drop board with optimistic updates |
| 📁 **Projects** | Project tracking with member management and linked tickets |
| 🏖️ **Leave** | Leave requests with approval workflow |
| 👥 **Users & Roles** | 4-tier RBAC (Admin → Manager → Team Lead → Employee) |
| 🤖 **AI Assistant** | Priority suggestions, ticket summaries, daily digest email (OpenAI) |
| 🔔 **Notifications** | Real-time via Socket.IO + email via SMTP |
| 📊 **Dashboard** | Role-based views with charts, workload, activity feed |

---

## Tech Stack

**Backend** — `backend/`
- NestJS 10 + TypeScript
- Prisma ORM + PostgreSQL
- JWT authentication (access + refresh tokens)
- Socket.IO (real-time notifications)
- Nodemailer (email)
- OpenAI `gpt-4o-mini` (AI features)
- Cloudinary (file attachments)
- Helmet + Compression (production hardening)

**Frontend** — `frontend/`
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- TanStack Query (React Query v5)
- Zustand (auth state)
- @dnd-kit/core (Kanban drag-and-drop)
- Recharts (dashboard charts)
- Socket.IO client (real-time)

---

## Local Development Setup

### Prerequisites
- Node.js ≥ 18
- PostgreSQL 14+
- npm ≥ 9

### 1. Clone & Install

```bash
git clone https://github.com/technoedge/nexus-app.git
cd nexus-app

# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Configure Environment

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env — set DATABASE_URL, JWT_SECRET, etc.

# Frontend
cp frontend/.env.example frontend/.env.local
# Edit frontend/.env.local — set NEXT_PUBLIC_API_URL if needed
```

### 3. Database Setup

```bash
cd backend

# Run migrations
npx prisma migrate deploy

# Seed with demo data
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
```

### 4. Start Development Servers

```bash
# Terminal 1 — Backend (http://localhost:3001)
cd backend && npm run start:dev

# Terminal 2 — Frontend (http://localhost:3000)
cd frontend && npm run dev
```

### 5. Verify

- Frontend: http://localhost:3000
- API Health: http://localhost:3001/api/health
- Swagger: http://localhost:3001/api/docs

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | JWT signing secret (min 32 chars) |
| `JWT_REFRESH_SECRET` | ✅ | Refresh token secret |
| `JWT_EXPIRES_IN` | ✅ | Access token TTL (e.g. `15m`) |
| `JWT_REFRESH_EXPIRES_IN` | ✅ | Refresh token TTL (e.g. `7d`) |
| `PORT` | ✅ | Server port (default `3001`) |
| `NODE_ENV` | ✅ | `development` or `production` |
| `FRONTEND_URL` | ✅ | Frontend origin for CORS |
| `OPENAI_API_KEY` | ⭕ | OpenAI key for AI features (graceful fallback if absent) |
| `SMTP_HOST` | ⭕ | SMTP host (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | ⭕ | SMTP port (e.g. `587`) |
| `SMTP_USER` | ⭕ | SMTP username / Gmail address |
| `SMTP_PASS` | ⭕ | SMTP app password |
| `CLOUDINARY_CLOUD_NAME` | ⭕ | Cloudinary cloud name for file uploads |
| `CLOUDINARY_API_KEY` | ⭕ | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | ⭕ | Cloudinary API secret |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | ✅ | Backend API base URL (e.g. `http://localhost:3001/api`) |
| `NEXT_PUBLIC_WS_URL` | ⭕ | WebSocket origin (e.g. `http://localhost:3001`) |

---

## Default Login Credentials

> ⚠️ **Change all passwords immediately after first deployment.**

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@technoedge.com` | `Admin@123` |
| Manager | `manager@technoedge.com` | `Manager@123` |
| Team Lead | `teamlead@technoedge.com` | `Lead@123` |
| Employee | `arjun@technoedge.com` | `Employee@123` |

---

## Production Deployment

### Backend → Railway

1. Create a new project at [railway.app](https://railway.app)
2. Add a **PostgreSQL** service — copy `DATABASE_URL` from Railway dashboard
3. Add a **Web Service** pointing to the `backend/` directory
   - Build command: `npm run build`
   - Start command: `node dist/main`
4. Set all required environment variables (see table above)
   - Set `NODE_ENV=production`
   - Set `FRONTEND_URL=https://nexus.technoedge.in`
5. Deploy → Railway auto-assigns a URL like `https://nexus-api.up.railway.app`
6. Run the seed once via Railway CLI:
   ```bash
   railway run npx prisma migrate deploy
   railway run npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
   ```

### Frontend → Vercel

1. Import the repository at [vercel.com](https://vercel.com)
2. Set **Root Directory** to `frontend`
3. Framework Preset: **Next.js** (auto-detected)
4. Add environment variables:
   - `NEXT_PUBLIC_API_URL` = `https://nexus-api.up.railway.app/api`
   - `NEXT_PUBLIC_WS_URL` = `https://nexus-api.up.railway.app`
5. Deploy → Vercel assigns `https://nexus.vercel.app`
6. Add a custom domain `nexus.technoedge.in` in Vercel project settings

### Post-Deploy Checklist

- [ ] `GET /api/health` returns `{ "status": "ok", "database": "connected" }`
- [ ] Login with `admin@technoedge.com` works
- [ ] Create a test ticket and verify email notification arrives
- [ ] Kanban drag-and-drop works in production build
- [ ] AI priority suggestion returns a response (if `OPENAI_API_KEY` set)
- [ ] Change all default passwords

---

## Project Structure

```
nexus-app/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.ts              # Production seed (upserts)
│   │   └── reset-seed.ts        # Dev-only full reset
│   └── src/
│       ├── modules/
│       │   ├── auth/            # JWT auth
│       │   ├── users/           # User management
│       │   ├── roles/           # RBAC roles
│       │   ├── departments/     # Department management
│       │   ├── projects/        # Project tracking
│       │   ├── tickets/         # Ticket lifecycle + SLA + history
│       │   ├── comments/        # Ticket comments
│       │   ├── leave/           # Leave requests
│       │   ├── notifications/   # In-app notifications
│       │   ├── dashboard/       # Analytics endpoints
│       │   ├── gateway/         # Socket.IO gateway
│       │   ├── email/           # Nodemailer service
│       │   ├── uploads/         # Cloudinary file uploads
│       │   ├── ai/              # OpenAI AI features + cron digest
│       │   └── health/          # Health check endpoint
│       ├── prisma/              # PrismaModule + PrismaService
│       ├── app.module.ts
│       └── main.ts
└── frontend/
    ├── app/
    │   ├── (auth)/              # Login page
    │   └── (dashboard)/         # Protected pages
    │       ├── dashboard/       # Role-based dashboard
    │       ├── tickets/         # Ticket list + detail + new
    │       ├── kanban/          # Drag-and-drop Kanban
    │       ├── projects/        # Project list + detail
    │       ├── leave/           # Leave management
    │       └── admin/           # Admin: users, roles, departments
    ├── components/
    │   ├── layout/              # Sidebar, TopBar, providers
    │   └── ui/                  # Reusable UI components
    ├── lib/
    │   └── api.ts               # Axios client + all API wrappers
    └── store/
        └── auth.store.ts        # Zustand auth state
```

---

## Development Scripts

```bash
# Backend
npm run start:dev     # Hot-reload dev server
npm run build         # Production build
npm run start:prod    # Start production build
npx prisma studio     # Open Prisma Studio (DB GUI)
npx prisma migrate dev --name <name>  # Create a new migration

# Frontend
npm run dev           # Dev server
npm run build         # Production build
npm run start         # Start production build
npm run lint          # ESLint
```

---

## License

Internal use only — TechnoEdge © 2024–2025. All rights reserved.
