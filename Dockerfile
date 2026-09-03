# syntax=docker/dockerfile:1.7
#
# Kavach, as one image: the static export built by Node, the API served by Python, both
# models TRAINED AT BUILD TIME. The model artefacts are gitignored on purpose -- a pickled
# estimator committed to a repo is an estimator nobody can reproduce -- so the image builds
# them from the corpus, and the same step runs the benchmarks that fail the build if a model
# stops beating every feasible baseline. An image that exists therefore proves its numbers.
#
#   docker build -t kavach .
#   docker run -p 8000:8000 -v kavach-data:/data --env-file .env kavach
#
# Deterministic: pinned base images, `npm ci` from the lockfile, seeded corpora.

# ---------------------------------------------------------------- web: the static export
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------------------------------------------------------------- app: the one process
FROM python:3.12-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# The package first, so a change to the UI does not reinstall scikit-learn.
COPY pyproject.toml README.md LICENSE ./
COPY pkg ./pkg
RUN pip install .

COPY apps ./apps
COPY evals ./evals
COPY scripts/entrypoint.sh ./scripts/entrypoint.sh

# Train both estimators and benchmark them. ~30 s. Fails the build on a regression.
RUN mkdir -p data \
 && python apps/benchmark.py \
 && python apps/gate_benchmark.py \
 && chmod +x scripts/entrypoint.sh

COPY --from=web /app/web/out ./web/out

# The ledger lives on a mounted disk; without one it lives for the life of the container
# and the entrypoint re-seeds it on start. Both cases are documented in documents/11-deploy.md.
ENV KAVACH_DB=/data/kavach.db \
    KAVACH_MODE=replay \
    KAVACH_DEMO=1 \
    PORT=8000
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health',timeout=4).read()" || exit 1

ENTRYPOINT ["./scripts/entrypoint.sh"]
