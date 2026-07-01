.PHONY: dev server web build test tidy fmt

# Local dev: run the Go API (dev-user bypass, on-demand fetch) and the Vite web
# server in two terminals.
server:
	GOWORK=off OTIUM_DEV_USER=fisher OTIUM_DB_PATH=./data/otium.db OTIUM_FETCH_INTERVAL_MIN=0 go run ./cmd/server

web:
	cd web && npm run dev

build:
	GOWORK=off CGO_ENABLED=0 go build -o bin/server ./cmd/server
	cd web && npm run build

test:
	GOWORK=off go test ./...

tidy:
	GOWORK=off go mod tidy

fmt:
	gofmt -w .
