FROM node:20-alpine

# Install PostgreSQL client for health checks
RUN apk add --no-cache postgresql-client

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /usr/src/app
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD pg_isready -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME || exit 1

# Start application
CMD ["node", "server.js"]