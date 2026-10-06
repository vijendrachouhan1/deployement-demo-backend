# ==============================================================
# 0. Base image with shared dependencies
# ==============================================================

FROM node:22-alpine3.18 AS base

RUN apk add --no-cache libc6-compat bash

RUN apk add --no-cache bash curl && curl -1sLf \
'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.alpine.sh' | bash \
&& apk add infisical

WORKDIR /app

# ==============================================================
# 1. Dependency installation
# ==============================================================

FROM base AS deps

WORKDIR /app

COPY package.json ./

RUN npm i 

# ==============================================================
# 3. Build source with env vars from Infisical
# ==============================================================

FROM base AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY . .

RUN npm run build

# Clean up
RUN rm -rf .env tsconfig.tsbuildinfo

# ==============================================================
# 4. Final production image
# ==============================================================

FROM base AS runner

ENV PORT=8000

ENV HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=builder /app .

EXPOSE 8000