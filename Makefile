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
	$(VENV)/bin/ruff check pkg/ tests/ cmd/

.PHONY: fmt
fmt:  ## autofix what can be autofixed
	$(VENV)/bin/ruff check --fix pkg/ tests/ cmd/

.PHONY: bench
bench:  ## regenerate corpus, train, and benchmark against all baselines
	$(PY) cmd/benchmark.py

.PHONY: mcp
mcp:  ## run the MCP server over stdio
	$(PY) cmd/mcp_server.py

.PHONY: check
check: install lint test bench  ## everything CI runs

.PHONY: clean
clean:  ## remove build and run artefacts, keep the corpus
	rm -rf build dist *.egg-info .pytest_cache .ruff_cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
	rm -f kavach.db kavach.db-wal kavach.db-shm

.PHONY: help
help:
	@grep -hE '^[a-z.]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n",$$1,$$2}'
