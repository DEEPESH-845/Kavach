"""Reaching the principal: the step-up link, delivered somewhere other than a QR code.

Four channels behind one call. `email` is stdlib smtplib; `sms` and `whatsapp` are Twilio's
REST API over urllib (no SDK: it is one POST); `webhook` hands the whole request to a URL
the merchant owns, signed, so any channel Kavach has not heard of is one adapter away on
their side rather than ours.

What travels is deliberately small: who is asking, for how much, at which merchant, and the
approval URL. The mandate envelope never leaves the server, exactly as with the QR.

Delivery runs on a background thread so an SMTP or Twilio round trip never sits on the
request path; the outcome is written to `stepup_notifications` and shown beside the token.
ponytail: a daemon thread per send. A queue with retries if volume ever warrants one.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import smtplib
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from email.message import EmailMessage
from typing import Any

from .. import db, observability

log = logging.getLogger(__name__)

CHANNELS: tuple[str, ...] = ("email", "sms", "whatsapp", "webhook")
QUEUED, SENT, FAILED = "queued", "sent", "failed"
TIMEOUT = 15

SCHEMA = """
CREATE TABLE IF NOT EXISTS stepup_notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    token        TEXT    NOT NULL,
    channel      TEXT    NOT NULL,
    recipient    TEXT    NOT NULL,
    status       TEXT    NOT NULL,      -- queued | sent | failed
    provider_id  TEXT,
    error        TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stepup_notifications_token ON stepup_notifications (token);
"""


class NotifyError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def init(conn: db.Connection) -> None:
    conn.executescript(SCHEMA)


# ------------------------------------------------------------------ the message

def compose(view: dict[str, Any], approve_url: str) -> dict[str, str]:
    """Subject and body, plain text, phone-sized. `view` is stepup.view()'s dict."""
    items = view.get("items") or []
    names = ", ".join(str(i.get("name") or i.get("description")) for i in items[:3])
    if len(items) > 3:
        names += f" and {len(items) - 3} more"
    amount = f"₹{view['amount_minor'] / 100:,.2f}"
    minutes = max(1, int(view.get("seconds_left", 600)) // 60)
    return {
        "subject": f"Approve {amount} for {view['agent_id']}?",
        "body": (f"Your agent {view['agent_id']} wants to pay {amount} at "
                 f"{view['merchant_id']} for {names or 'a cart'}.\n"
                 f"Purpose on the mandate: {view.get('purpose', '')}\n\n"
                 f"Approve or decline here (expires in {minutes} min):\n{approve_url}\n\n"
                 f"If you did not expect this, decline it. Nothing is charged until you "
                 f"approve."),
    }


# ------------------------------------------------------------------ transports

def _email(to: str, msg: dict[str, str], _payload: dict[str, Any]) -> str:
    url = os.environ.get("KAVACH_SMTP_URL", "")
    if not url:
        raise NotifyError("channel_unconfigured", "email needs KAVACH_SMTP_URL "
                          "(smtp://user:pass@host:587?from=kavach@example.com)")
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("smtp", "smtps") or not u.hostname:
        raise NotifyError("channel_unconfigured", "KAVACH_SMTP_URL must be smtp:// or smtps://")
    sender = urllib.parse.parse_qs(u.query).get("from", [u.username or "kavach@localhost"])[0]
    em = EmailMessage()
    em["From"], em["To"], em["Subject"] = sender, to, msg["subject"]
    em.set_content(msg["body"])
    cls = smtplib.SMTP_SSL if u.scheme == "smtps" else smtplib.SMTP
    with cls(u.hostname, u.port or (465 if u.scheme == "smtps" else 587),
             timeout=TIMEOUT) as s:
        if u.scheme == "smtp":
            s.starttls()
        if u.username:
            s.login(urllib.parse.unquote(u.username), urllib.parse.unquote(u.password or ""))
        s.send_message(em)
    return f"smtp:{u.hostname}"


def _twilio(kind: str):
    def send(to: str, msg: dict[str, str], _payload: dict[str, Any]) -> str:
        sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
        tok = os.environ.get("TWILIO_AUTH_TOKEN", "")
        sender = os.environ.get(f"TWILIO_FROM_{kind.upper()}", "")
        if not (sid and tok and sender):
            raise NotifyError("channel_unconfigured",
                              f"{kind} needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and "
                              f"TWILIO_FROM_{kind.upper()}")
        prefix = "whatsapp:" if kind == "whatsapp" else ""
        data = urllib.parse.urlencode({
            "From": sender if sender.startswith(prefix) else prefix + sender,
            "To": to if to.startswith(prefix) else prefix + to,
            "Body": msg["body"]}).encode()
        req = urllib.request.Request(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json", data=data,
            method="POST")
        import base64
        req.add_header("Authorization",
                       "Basic " + base64.b64encode(f"{sid}:{tok}".encode()).decode())
        out = _post(req, "twilio")
        return str(out.get("sid", ""))
    return send


def _webhook(to: str, msg: dict[str, str], payload: dict[str, Any]) -> str:
    url = os.environ.get("KAVACH_STEPUP_WEBHOOK_URL", "")
    secret = os.environ.get("KAVACH_STEPUP_WEBHOOK_SECRET", "")
    if not url:
        raise NotifyError("channel_unconfigured", "webhook needs KAVACH_STEPUP_WEBHOOK_URL")
    body = json.dumps({"to": to, "message": msg, **payload}, sort_keys=True).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    if secret:
        sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        req.add_header("X-Kavach-Signature", f"sha256={sig}")
    _post(req, "webhook")
    return url


def _post(req: urllib.request.Request, who: str) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            text = r.read().decode()
    except urllib.error.HTTPError as e:
        raise NotifyError("provider_error", f"{who} answered {e.code}: "
                          f"{e.read().decode()[:200]}") from None
    except urllib.error.URLError as e:
        raise NotifyError("provider_error", f"{who} unreachable: {e.reason}") from None
    try:
        return json.loads(text) if text else {}
    except json.JSONDecodeError:
        return {}


Transport = Callable[[str, dict[str, str], dict[str, Any]], str]
TRANSPORTS: dict[str, Transport] = {
    "email": _email, "sms": _twilio("sms"), "whatsapp": _twilio("whatsapp"),
    "webhook": _webhook,
}


# ------------------------------------------------------------------ the record

def validate(channel: str, to: str) -> None:
    if channel not in CHANNELS:
        raise NotifyError("unknown_channel", f"channel must be one of {', '.join(CHANNELS)}")
    to = to.strip()
    if not to or len(to) > 320:
        raise NotifyError("invalid_recipient", "a recipient is required")
    if channel == "email" and ("@" not in to or " " in to):
        raise NotifyError("invalid_recipient", "email needs an address")
    if channel in ("sms", "whatsapp"):
        digits = to.removeprefix("whatsapp:").replace(" ", "")
        if not (digits.startswith("+") and digits[1:].isdigit() and 8 <= len(digits) <= 16):
            raise NotifyError("invalid_recipient", f"{channel} needs an E.164 number "
                              "like +919876543210")
    if channel == "webhook" and to not in ("merchant", "default") and len(to) > 200:
        raise NotifyError("invalid_recipient", "webhook recipient is a label, not a URL")


def mask(channel: str, to: str) -> str:
    """What the public token view shows: enough to recognise, not enough to reuse."""
    if channel == "email" and "@" in to:
        user, domain = to.split("@", 1)
        return f"{user[:1]}…@{domain}"
    if channel in ("sms", "whatsapp"):
        d = to.removeprefix("whatsapp:")
        return f"{d[:3]}…{d[-2:]}"
    return to


def public_url(approve_path: str) -> str:
    base = os.environ.get("KAVACH_PUBLIC_URL", "").strip().rstrip("/")
    if not base:
        raise NotifyError("public_url_unset",
                          "KAVACH_PUBLIC_URL must name this deployment's public origin "
                          "(https://kavach.example.com) so the link in the message opens")
    return f"{base}{approve_path}"


def _record(conn: db.Connection, token: str, channel: str, to: str, now: int) -> int:
    row = conn.execute(
        "INSERT INTO stepup_notifications (token, channel, recipient, status, created_at, "
        "updated_at) VALUES (?,?,?,?,?,?) RETURNING id",
        (token, channel, to, QUEUED, now, now)).fetchone()
    return int(row["id"])


def _finish(conn: db.Connection, nid: int, status: str, *, channel: str,
            provider_id: str | None, error: str | None, now: int) -> None:
    observability.stepups_sent.labels(channel=channel, status=status).inc()
    conn.execute("UPDATE stepup_notifications SET status=?, provider_id=?, error=?, "
                 "updated_at=? WHERE id=?", (status, provider_id, error, now, nid))


def deliveries(conn: db.Connection, token: str) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM stepup_notifications WHERE token=? ORDER BY id",
                        (token,)).fetchall()
    return [{"id": r["id"], "channel": r["channel"], "to": mask(r["channel"], r["recipient"]),
             "status": r["status"], "provider_id": r["provider_id"], "error": r["error"],
             "created_at": r["created_at"], "updated_at": r["updated_at"]} for r in rows]


def dispatch(conn: db.Connection, *, token: str, channel: str, to: str,
             view: dict[str, Any], approve_path: str, now: int,
             open_conn: Callable[[], db.Connection], background: bool = True
             ) -> dict[str, Any]:
    """Validate, record `queued`, send (on a thread unless `background=False`), record the
    outcome. Returns the queued record; the outcome is read back via deliveries()."""
    validate(channel, to)
    to = to.strip()
    url = public_url(approve_path)
    msg = compose(view, url)
    payload = {"token": token, "approve_url": url, "agent_id": view["agent_id"],
               "principal_id": view.get("principal_id"), "merchant_id": view["merchant_id"],
               "amount_minor": view["amount_minor"], "expires_at": view["expires_at"]}
    nid = _record(conn, token, channel, to, now)

    def work() -> None:
        c = open_conn()
        try:
            try:
                pid = TRANSPORTS[channel](to, msg, payload)
                _finish(c, nid, SENT, channel=channel, provider_id=pid, error=None,
                        now=int(time.time()))
            except NotifyError as e:
                log.warning("step-up %s via %s failed: %s", token[:6], channel, e.message)
                _finish(c, nid, FAILED, channel=channel, provider_id=None,
                        error=f"{e.code}: {e.message}", now=int(time.time()))
            except Exception as e:  # noqa: BLE001 - a transport bug must not go unrecorded
                log.exception("step-up %s via %s crashed", token[:6], channel)
                _finish(c, nid, FAILED, channel=channel, provider_id=None,
                        error=f"internal: {e}", now=int(time.time()))
        finally:
            c.close()

    if background:
        threading.Thread(target=work, name=f"notify-{nid}", daemon=True).start()
    else:
        work()
    return {"id": nid, "channel": channel, "to": mask(channel, to), "status": QUEUED}
