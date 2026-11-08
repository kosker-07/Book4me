# BED4BOOK API image.
# Builds from the official Node 22 image so the build does not depend on
# downloading build tools from GitHub Releases at build time.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:server && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 8080
# Railway runs "npm run db:migrate:compiled" as the pre-deploy command.
CMD ["npm", "run", "start:server"]
