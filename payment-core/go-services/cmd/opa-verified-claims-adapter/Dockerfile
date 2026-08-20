FROM golang:1.24-alpine AS builder
WORKDIR /src
RUN apk add --no-cache ca-certificates git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/opa-verified-claims-adapter ./cmd/opa-verified-claims-adapter

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=builder /out/opa-verified-claims-adapter /opa-verified-claims-adapter
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/opa-verified-claims-adapter"]
