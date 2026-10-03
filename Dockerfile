# =========================================
# Stage 1: Build FLOW
# =========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy project source
COPY . .

# Compile TypeScript → JavaScript
RUN npm run build


# =========================================
# Stage 2: Production image
# =========================================
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist

# FLOW API port
EXPOSE 8000

# Default process
CMD ["node", "dist/server.js"]