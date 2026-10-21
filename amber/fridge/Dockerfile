# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# THE API ORIGIN IS NOT NEEDED HERE.
#
# It used to be: NEXT_PUBLIC_AMBER_API is inlined by Next during this build, so
# it had to cross into the build as an ARG, and a guard failed the build when
# it was missing. The guard worked -- it failed the very next deploy -- but it
# made shipping anything at all contingent on the platform forwarding build
# arguments, which is the wrong thing for a build to depend on.
#
# The origin is now read per request by app/api/config/route.ts from an
# ordinary AMBER_API service variable. Set it in Railway's variables like any
# other; it takes effect on restart, with no rebuild.

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
