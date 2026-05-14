FROM oven/bun:1-slim AS deps
WORKDIR /app
COPY package.json ./
RUN bun install --production --frozen-lockfile || bun install --production

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
EXPOSE 3001
CMD ["bun", "run", "src/index.ts"]
