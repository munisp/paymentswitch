FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Copy go mod files
COPY go.mod ./
RUN go mod download

# Copy source code
COPY . .

# The image must contain the real ledger service. A compile failure stops the build;
# it must never be replaced by a health-only stub that could mask a broken ledger.
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o go-ledger-service ./cmd/mojaloop-service

# Final stage
FROM alpine:3.19

RUN apk --no-cache add ca-certificates tzdata curl

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/go-ledger-service .

# Create non-root user
RUN adduser -D -g '' appuser
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run the binary
ENTRYPOINT ["./go-ledger-service"]
