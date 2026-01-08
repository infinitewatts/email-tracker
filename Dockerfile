FROM node:22-alpine

WORKDIR /app

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Create data directory for SQLite
RUN mkdir -p /data

ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "src/server.js"]
