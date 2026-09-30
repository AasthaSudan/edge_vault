.PHONY: setup provision run cloud edge-a edge-b ui-a ui-b seed reset clean test test-unit lint-imports eval-gate eval-assistant eval-reconcile test-p2 test-p3 demo

# The venv keeps its executables in Scripts/ on Windows and bin/ elsewhere
ifeq ($(OS),Windows_NT)
VENV_BIN = .venv/Scripts
else
VENV_BIN = .venv/bin
endif
PYTHON = $(VENV_BIN)/python
UVICORN = $(VENV_BIN)/uvicorn

setup:
	@echo "Checking virtual environment and dependencies..."
	@$(PYTHON) -m pip install -r requirements.txt
	@$(PYTHON) -m pip install -e ./edge

provision:
	@echo "Provisioning FastEmbed model offline cache..."
	$(PYTHON) edge/scripts/provision_models.py

run:
	@echo "Starting EdgeVault FastAPI edge node on port 7001..."
	PYTHONPATH=edge $(UVICORN) edge.main:app --host 127.0.0.1 --port 7001 --reload

cloud:
	@echo "Starting Qdrant Docker and Cloud Sync API..."
	docker compose up -d
	$(PYTHON) cloud/scripts/init_collection.py
	PYTHONPATH=cloud $(UVICORN) sync_api.main:app --host 0.0.0.0 --port 8080 --reload

edge-a:
	DEVICE_ID=device-a PORT=7001 PYTHONPATH=edge $(UVICORN) edge.main:app --host 127.0.0.1 --port 7001 --reload

edge-b:
	DEVICE_ID=device-b PORT=7002 PYTHONPATH=edge $(UVICORN) edge.main:app --host 127.0.0.1 --port 7002 --reload

ui-a:
	@echo "Starting Dashboard for Device A on http://localhost:3000..."
	cd dashboard && NEXT_PUBLIC_EDGE_API=http://127.0.0.1:7001 NEXT_PUBLIC_CLOUD_API=http://127.0.0.1:8080 PORT=3000 npm run dev

ui-b:
	@echo "Starting Dashboard for Device B on http://localhost:3001..."
	# NEXT_DIST_DIR: NEXT_PUBLIC_* values are baked into the build, so two dev servers sharing ".next"
	# would serve each other's bundles and Device B's dashboard could talk to Device A's edge
	cd dashboard && NEXT_DIST_DIR=.next-b NEXT_PUBLIC_EDGE_API=http://127.0.0.1:7002 NEXT_PUBLIC_CLOUD_API=http://127.0.0.1:8080 PORT=3001 npm run dev -- -p 3001

seed:
	@echo "Seeding rehearsed demo memories..."
	DEVICE_ID=device-a PYTHONPATH=edge $(PYTHON) edge/scripts/seed_demo.py
	DEVICE_ID=device-b PYTHONPATH=edge $(PYTHON) edge/scripts/seed_demo.py

reset:
	@echo "Resetting demo state to clean slate..."
	docker compose down -v
	rm -rf data/device-a data/device-b data/cloud_conflicts.db*
	docker compose up -d
	# Wait for Qdrant instead of guessing a delay
	@for i in $$(seq 1 30); do curl -sf http://localhost:6333/collections >/dev/null && break; sleep 1; done
	# The fleet collection lives in a bind mount (./data/cloud_qdrant), which "down -v" does not remove
	@curl -s -X DELETE http://localhost:6333/collections/shared_memory >/dev/null || true
	$(PYTHON) cloud/scripts/init_collection.py
	DEVICE_ID=device-a PYTHONPATH=edge $(PYTHON) edge/scripts/bootstrap_shared.py
	DEVICE_ID=device-b PYTHONPATH=edge $(PYTHON) edge/scripts/bootstrap_shared.py
	@echo "Reset complete. Clean demo fleet ready!"

test:
	@echo "Running Phase 1 validation benchmark suite..."
	PYTHONPATH=edge $(PYTHON) edge/tests/test_search.py

test-unit:
	@echo "Running the unit suite (privacy, taint, durability, gate, lifecycle, PII rules)..."
	DEVICE_ID=unit-tests PYTHONPATH=edge $(PYTHON) -m pytest edge/tests -q --ignore=edge/tests/test_sync.py --ignore=edge/tests/test_search.py

lint-imports:
	@echo "Checking the privacy import contract..."
	PYTHONPATH=edge $(VENV_BIN)/lint-imports

eval-gate:
	@echo "Running Phase 2 AI Memory Gate evaluation suite..."
	PYTHONPATH=edge $(PYTHON) edge/tests/eval_gate.py

eval-assistant:
	@echo "Running the On-Device Assistant evaluation (needs Ollama)..."
	PYTHONPATH=edge $(PYTHON) edge/tests/eval_assistant.py

eval-reconcile:
	@echo "Running the conflict reconciliation evaluation (needs Ollama)..."
	PYTHONPATH=edge $(PYTHON) edge/tests/eval_reconcile.py

test-p2:
	@echo "Running Phase 2 integration tests (PII, dedup, override)..."
	PYTHONPATH=edge $(PYTHON) edge/tests/test_phase2_integration.py

test-p3:
	@echo "Running Phase 3 Edge-Cloud Sync & Conflict test suite..."
	PYTHONPATH=edge $(PYTHON) edge/tests/test_sync.py

demo:
	@echo "Running automated 3-minute rehearsed demo sequence..."
	PYTHONPATH=edge $(PYTHON) edge/scripts/run_demo_sequence.py

clean:
	@echo "Cleaning up local edge data directories..."
	rm -rf data/device-a data/device-b data/cloud_conflicts.db*
