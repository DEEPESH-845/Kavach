"""Logs, metrics and the optional tracing/error hooks, in one place.

Logging: KAVACH_LOG_FORMAT=json emits one JSON object per line (what a log pipeline wants);
`text` is the human default. Either way every record can carry a request id.

Metrics: a prometheus_client registry. Counters for the things an operator pages on --
decisions by action, admissions by verdict, webhooks by outcome -- and a latency histogram
per route. Per process: with KAVACH_WORKERS > 1 each worker reports its own numbers, which
is the honest shape without a shared store. ponytail: multiprocess mode if that matters.

Tracing and errors are optional extras (`pip install 'kavach[otel]'`, `'kavach[sentry]'`),
enabled only when their environment variable is set, imported lazily so a deployment that
wants neither carries neither.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import time
from typing import Any

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")

# ------------------------------------------------------------------ logging


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
                  + f".{int(record.msecs):03d}Z",
            "level": record.levelname, "logger": record.name,
            "msg": record.getMessage(),
        }
        rid = request_id.get()
        if rid:
            out["request_id"] = rid
        for k in ("route", "status", "ms", "key", "method"):
            if hasattr(record, k):
                out[k] = getattr(record, k)
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        rid = request_id.get()
        base = super().format(record)
        return f"{base} [{rid}]" if rid else base


def configure_logging(level: int = logging.INFO) -> str:
    fmt = os.environ.get("KAVACH_LOG_FORMAT", "text").strip().lower()
    handler = logging.StreamHandler()
    if fmt == "json":
        handler.setFormatter(JsonFormatter())
    else:
        fmt = "text"
        handler.setFormatter(TextFormatter("%(asctime)s [%(levelname)s] %(name)s %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # uvicorn's own access log duplicates ours and knows nothing about request ids
    logging.getLogger("uvicorn.access").disabled = True
    return fmt


# ------------------------------------------------------------------ metrics

registry = CollectorRegistry()
http_requests = Counter("kavach_http_requests_total", "HTTP requests",
                        ["route", "method", "status"], registry=registry)
http_latency = Histogram("kavach_http_request_seconds", "HTTP request latency",
                         ["route"], registry=registry,
                         buckets=(.001, .0025, .005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5))
decisions = Counter("kavach_decisions_total", "Outbound governor decisions", ["action"],
                    registry=registry)
admissions = Counter("kavach_admissions_total", "Inbound gate verdicts", ["verdict"],
                     registry=registry)
webhooks = Counter("kavach_webhooks_total", "Razorpay webhook deliveries", ["outcome"],
                   registry=registry)
stepups_sent = Counter("kavach_stepup_notifications_total", "Step-up link deliveries",
                       ["channel", "status"], registry=registry)
chain_intact = Gauge("kavach_chain_intact", "1 if the hash chain verifies", registry=registry)
events_total = Gauge("kavach_events_total", "Rows in the event log", registry=registry)
intents_by_status = Gauge("kavach_intents_total", "Intents by status", ["status"],
                          registry=registry)
stepups_pending = Gauge("kavach_stepups_pending", "Step-ups awaiting the principal",
                        registry=registry)
reconciler_runs = Counter("kavach_reconciler_runs_total", "Reconciler cycles", ["outcome"],
                          registry=registry)
reconciler_settled = Counter("kavach_reconciler_settled_total", "Intents the reconciler "
                             "settled", ["status"], registry=registry)
uptime = Gauge("kavach_uptime_seconds", "Seconds since start", registry=registry)


def exposition() -> tuple[bytes, str]:
    return generate_latest(registry), CONTENT_TYPE_LATEST


# ------------------------------------------------------------------ optional hooks

def init_sentry() -> bool:
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logging.getLogger(__name__).warning(
            "SENTRY_DSN is set but sentry-sdk is not installed: pip install 'kavach[sentry]'")
        return False
    sentry_sdk.init(dsn=dsn, traces_sample_rate=0.0, send_default_pii=False,
                    release=f"kavach@{_version()}")
    return True


def init_otel(app: Any) -> bool:
    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip():
        return False
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        logging.getLogger(__name__).warning(
            "OTEL_EXPORTER_OTLP_ENDPOINT is set but the OpenTelemetry packages are not "
            "installed: pip install 'kavach[otel]'")
        return False
    provider = TracerProvider(resource=Resource.create(
        {"service.name": os.environ.get("OTEL_SERVICE_NAME", "kavach"),
         "service.version": _version()}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, excluded_urls="/api/health,/api/metrics")
    return True


def _version() -> str:
    from . import __version__
    return __version__
