.PHONY: setup provision run cloud edge-a edge-b ui-a ui-b seed reset clean test eval-gate test-p2 test-p3

PYTHON = .venv/bin/python
UVICORN = .venv/bin/uvicorn

setup:
	@echo "Checking virtual environment and dependencies..."
	@.venv/bin/pip install -e ./edge

provision:
	@echo "Provisioning FastEmbed model offline cache..."
	$(PYTHON) edge/scripts/provision_models.py

run:
	@echo "Starting EdgeVault FastAPI edge node on port 7001..."
	PYTHONPATH=edge $(UVICORN) edge.main:app --host 0.0.0.0 --port 7001 --reload

cloud:
	@echo "Starting Qdrant Docker and Cloud Sync API..."
	docker compose up -d
	$(PYTHON) cloud/scripts/init_collection.py
	PYTHONPATH=cloud $(UVICORN) sync_api.main:app --host 0.0.0.0 --port 8080 --reload

edge-a:
	DEVICE_ID=device-a PORT=7001 PYTHONPATH=edge $(UVICORN) edge.main:app --host 0.0.0.0 --port 7001 --reload

edge-b:
	DEVICE_ID=device-b PORT=7002 PYTHONPATH=edge $(UVICORN) edge.main:app --host 0.0.0.0 --port 7002 --reload

ui-a:
	@echo "Starting Dashboard for Device A on http://localhost:3000..."
	cd dashboard && NEXT_PUBLIC_EDGE_API=http://localhost:7001 NEXT_PUBLIC_CLOUD_API=http://localhost:8080 PORT=3000 npm run dev

ui-b:
	@echo "Starting Dashboard for Device B on http://localhost:3001..."
	cd dashboard && NEXT_PUBLIC_EDGE_API=http://localhost:7002 NEXT_PUBLIC_CLOUD_API=http://localhost:8080 PORT=3001 npm run dev -- -p 3001

seed:
	@echo "Seeding rehearsed demo memories..."
	DEVICE_ID=device-a PYTHONPATH=edge $(PYTHON) edge/scripts/seed_demo.py
	DEVICE_ID=device-b PYTHONPATH=edge $(PYTHON) edge/scripts/seed_demo.py

reset:
	@echo "Resetting demo state to clean slate..."
	docker compose down -v
	rm -rf data/device-a data/device-b data/cloud_conflicts.db*
	docker compose up -d
	sleep 2
	$(PYTHON) cloud/scripts/init_collection.py
	DEVICE_ID=device-a PYTHONPATH=edge $(PYTHON) edge/scripts/bootstrap_shared.py
	DEVICE_ID=device-b PYTHONPATH=edge $(PYTHON) edge/scripts/bootstrap_shared.py
	@echo "Reset complete. Clean demo fleet ready!"

test:
	@echo "Running Phase 1 validation benchmark suite..."
	PYTHONPATH=edge $(PYTHON) edge/tests/test_search.py

eval-gate:
	@echo "Running Phase 2 AI Memory Gate evaluation suite..."
	PYTHONPATH=edge $(PYTHON) edge/tests/eval_gate.py

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
