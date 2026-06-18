IMAGE ?= axe-mcp:local
CONTAINER ?= axe-mcp
PROFILE_VOLUME ?= axe-mcp-profile

MCP_PORT ?= 3000
NOVNC_PORT ?= 6080
VNC_PORT ?= 5900
CDP_PORT ?= 9222

TARGET_URL ?= https://example.com
AXE_SERVER_URL ?=
AXE_LOGIN_EMAIL ?=
AXE_LOGIN_PASSWORD ?=
ON_PREM ?= 0

.PHONY: build start wait-ready stop restart logs ps shell

build:
	docker build -t $(IMAGE) .

start:
	$(MAKE) stop
	docker run -d \
		--name $(CONTAINER) \
		-p $(MCP_PORT):3000 \
		-p $(NOVNC_PORT):6080 \
		-p $(VNC_PORT):5900 \
		-p $(CDP_PORT):9222 \
		-e TARGET_URL="$(TARGET_URL)" \
		-e AXE_SERVER_URL="$(AXE_SERVER_URL)" \
		-e AXE_LOGIN_EMAIL="$(AXE_LOGIN_EMAIL)" \
		-e AXE_LOGIN_PASSWORD="$(AXE_LOGIN_PASSWORD)" \
		-e ON_PREM="$(ON_PREM)" \
		-v $(PROFILE_VOLUME):/home/pwuser/.axe-mcp-browser \
		$(IMAGE)
	@echo "MCP:    http://127.0.0.1:$(MCP_PORT)/mcp"
	@echo "Health: http://127.0.0.1:$(MCP_PORT)/healthz"
	@echo "noVNC:  http://127.0.0.1:$(NOVNC_PORT)/"
	@echo "VNC:    127.0.0.1:$(VNC_PORT)"
	@echo "CDP:    http://127.0.0.1:$(CDP_PORT)"
	@$(MAKE) wait-ready

wait-ready:
	@echo "Waiting for prepared browser/devtools/axe panel..."
	@for i in $$(seq 1 60); do \
		if docker exec $(CONTAINER) test -f /tmp/axe-mcp/ready.json >/dev/null 2>&1; then \
			docker exec $(CONTAINER) cat /tmp/axe-mcp/ready.json; \
			exit 0; \
		fi; \
		if docker exec $(CONTAINER) test -f /tmp/axe-mcp/bootstrap-error.json >/dev/null 2>&1; then \
			echo "Browser preparation failed; container is still running for visual validation."; \
			docker exec $(CONTAINER) cat /tmp/axe-mcp/bootstrap-error.json; \
			echo "noVNC: http://127.0.0.1:$(NOVNC_PORT)/"; \
			exit 1; \
		fi; \
		if ! docker ps --format '{{.Names}}' | grep -qx '$(CONTAINER)'; then \
			echo "Container exited before readiness."; \
			docker logs $(CONTAINER) 2>/dev/null || true; \
			exit 1; \
		fi; \
		sleep 1; \
	done; \
	echo "Timed out waiting for /tmp/axe-mcp/ready.json"; \
	docker logs $(CONTAINER) --tail 120; \
	exit 1

stop:
	docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
	docker volume rm -f $(PROFILE_VOLUME) >/dev/null 2>&1 || true

restart: stop start

logs:
	docker logs -f $(CONTAINER)

ps:
	docker ps --filter name=$(CONTAINER)

shell:
	docker exec -it $(CONTAINER) bash
