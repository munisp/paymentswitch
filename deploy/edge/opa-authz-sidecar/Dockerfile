FROM golang:1.23.6-alpine3.21 AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/opa-authz-sidecar ./main.go

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/opa-authz-sidecar /opa-authz-sidecar
USER 65532:65532
ENTRYPOINT ["/opa-authz-sidecar"]
