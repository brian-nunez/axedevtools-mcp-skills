IMAGE ?= axe-mcp:local
CONTAINER ?= axe-mcp

MCP_PORT ?= 3000
NOVNC_PORT ?= 6080
VNC_PORT ?= 5900
CDP_PORT ?= 9222

TARGET_URL ?= https://example.com
AXE_SERVER_URL ?=
AXE_LOGIN_EMAIL ?=
AXE_LOGIN_PASSWORD ?=

.PHONY: build start stop restart logs ps shell

build:
	docker build -t $(IMAGE) .

start:
	docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
	docker run --rm -d \
		--name $(CONTAINER) \
		-p $(MCP_PORT):3000 \
		-p $(NOVNC_PORT):6080 \
		-p $(VNC_PORT):5900 \
		-p $(CDP_PORT):9222 \
		-e TARGET_URL="$(TARGET_URL)" \
		-e AXE_SERVER_URL="$(AXE_SERVER_URL)" \
		-e AXE_LOGIN_EMAIL="$(AXE_LOGIN_EMAIL)" \
		-e AXE_LOGIN_PASSWORD="$(AXE_LOGIN_PASSWORD)" \
		-v axe-mcp-profile:/home/pwuser/.axe-mcp-browser \
		$(IMAGE)
	@echo "MCP:    http://127.0.0.1:$(MCP_PORT)/mcp"
	@echo "Health: http://127.0.0.1:$(MCP_PORT)/healthz"
	@echo "noVNC:  http://127.0.0.1:$(NOVNC_PORT)/"
	@echo "VNC:    127.0.0.1:$(VNC_PORT)"
	@echo "CDP:    http://127.0.0.1:$(CDP_PORT)"

stop:
	docker rm -f $(CONTAINER)

restart: stop start

logs:
	docker logs -f $(CONTAINER)

ps:
	docker ps --filter name=$(CONTAINER)

shell:
	docker exec -it $(CONTAINER) bash
