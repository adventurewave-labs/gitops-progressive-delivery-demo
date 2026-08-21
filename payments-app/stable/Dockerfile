# payments-api:v2.3 — STABLE (healthy)
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go mod init payments-api && CGO_ENABLED=0 go build -o server .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/server /server
EXPOSE 8080
CMD ["/server"]
