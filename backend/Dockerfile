# Build Stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Run Stage
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
# We copy the memory directory structure as well, so it can log incidents
RUN mkdir -p memory

EXPOSE 3001
ENV PORT=3001
ENV NODE_ENV=production

CMD ["npm", "start"]
