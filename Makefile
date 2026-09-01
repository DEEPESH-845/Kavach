.DEFAULT_GOAL := help
VENV := .venv
PY   := $(VENV)/bin/python
PIP  := $(VENV)/bin/pip

$(VENV):
	python3 -m venv $(VENV)

.PHONY: install
install: $(VENV)  ## install the package and dev tooling
	$(PIP) -q install -e ".[dev]"

.PHONY: test
test:  ## run the test suite
	$(PY) -m pytest tests/

.PHONY: lint
lint:  ## static checks
	$(VENV)/bin/ruff check pkg/ tests/ apps/

.PHONY: fmt
fmt:  ## autofix what can be autofixed
	$(VENV)/bin/ruff check --fix pkg/ tests/ apps/

.PHONY: bench
bench:  ## regenerate corpus, train, and benchmark against all baselines
	$(PY) apps/benchmark.py

.PHONY: gate-bench
gate-bench:  ## regenerate the cart corpus, train entailment, benchmark against the rules
	$(PY) apps/gate_benchmark.py

.PHONY: mcp
mcp:  ## run the MCP server over stdio
	$(PY) apps/mcp_server.py

.PHONY: seed
seed:  ## rebuild the reference ledger by running the real decision pipeline
	$(PY) apps/demo_data.py

.PHONY: ui
ui:  ## build the web UI into web/out
	cd web && npm install --no-audit --no-fund --silent && npm run build

.PHONY: api
api:  ## run the API alone against the current database
	$(PY) apps/api_server.py

.PHONY: dev
dev:  ## development: API on :8000 and the Next dev server on :3000, together
	@echo "  API      http://127.0.0.1:8000"
	@echo "  console  http://localhost:3000/dashboard"
	@echo ""
	@# Both in one process group so Ctrl-C stops both. Running `next dev` alone is the
	@# usual way to end up staring at "Kavach API is not reachable": the console reads a
	@# live backend, so the backend has to be up too.
	@trap 'kill 0' EXIT INT TERM; \
	  $(PY) apps/api_server.py & \
	  (cd web && npm run dev) & \
	  wait

.PHONY: run
run: seed ui  ## THE ONE COMMAND: seed, build, and serve the whole product on :8000
	@echo ""
	@echo "  Kavach  ->  http://127.0.0.1:8000"
	@echo "  landing    /            console    /dashboard"
	@echo "  attacks    /dashboard/adversary    proof      /dashboard/proof"
	@echo ""
	$(PY) apps/api_server.py

# `make demo` predates `make run` and is kept so older docs and muscle memory keep working.
.PHONY: demo
demo: run

.PHONY: latency
latency:  ## measure decision-path latency and single-core throughput
	$(PY) apps/latency.py

.PHONY: scenarios
scenarios:  ## run every adversary scenario headless and print the verdicts
	$(PY) -m kavach.services.scenarios

.PHONY: site
site: ui  ## build the landing page and serve it on :4173 (static only, no API)
	@echo "  http://localhost:4173"
	$(PY) -m http.server 4173 -d web/out

.PHONY: check
check: install lint test bench gate-bench  ## everything CI runs

.PHONY: clean
clean:  ## remove build and run artefacts, keep the corpus
	rm -rf build dist *.egg-info .pytest_cache .ruff_cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
	rm -f kavach.db kavach.db-wal kavach.db-shm

.PHONY: help
help:
	@grep -hE '^[a-z.-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n",$$1,$$2}'
