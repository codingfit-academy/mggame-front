# ─────────────────────────────────────────────────────────────
# templates/front-react/Dockerfile
# Vite + React Multi-stage Build — nginx SPA 서버
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Build ────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./

RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else echo "Lock file not found." && exit 1; \
  fi

COPY . .

RUN \
  if [ -f yarn.lock ]; then yarn build; \
  elif [ -f package-lock.json ]; then npm run build; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm build; \
  fi

# ── Stage 2: Serve ────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

# SPA 라우팅 설정
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 빌드 결과물 복사
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3000 || exit 1

CMD ["nginx", "-g", "daemon off;"]
