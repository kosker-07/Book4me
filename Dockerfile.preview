FROM node:22-alpine
WORKDIR /app
COPY src/ ./src/
COPY tools/build.js tools/preview-server.js ./tools/
RUN node tools/build.js
ENV NODE_ENV=production
CMD ["node", "tools/preview-server.js"]
