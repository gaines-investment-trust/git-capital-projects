# GIT Capital Projects Platform — production image (Next.js standalone)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders only; real values come from Azure at runtime.
RUN DATABASE_URL=postgres://build/build AUTH_SECRET=build-time-placeholder-secret npx next build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Migrations run as a separate Container Apps job using the same image.
COPY --from=build /app/db ./db
COPY --from=build /app/scripts ./scripts
COPY --from=deps /app/node_modules/pg ./node_modules/pg
USER app
EXPOSE 3000
CMD ["node", "server.js"]
