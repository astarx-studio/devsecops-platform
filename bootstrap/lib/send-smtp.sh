#!/usr/bin/env bash
# Send a plain-text email via the stack SMTP_* vars (Mailgun/SES/etc.).
# Usage: send_smtp "Subject" "Body" ["a@x.com,b@y.com"]
# Returns 0 on success. Does not print the password.

send_smtp() {
  local subject="${1:?subject}"
  local body="${2:?body}"
  local rcpt="${3:-${WATCHDOG_NOTIFY_EMAILS:-}}"
  rcpt="${rcpt// /}"
  if [[ -z "${rcpt}" ]]; then
    echo "[send-smtp] no recipients (WATCHDOG_NOTIFY_EMAILS empty) — skip" >&2
    return 1
  fi
  if [[ -z "${SMTP_HOST:-}" || -z "${SMTP_FROM_EMAIL:-}" ]]; then
    echo "[send-smtp] SMTP_HOST / SMTP_FROM_EMAIL not set — skip" >&2
    return 1
  fi

  local from_name="${SMTP_FROM_NAME:-DevOps Platform}"
  local from_email="${SMTP_FROM_EMAIL}"
  local host="${SMTP_HOST}"
  local port="${SMTP_PORT:-587}"
  local user="${SMTP_USER:-}"
  local pass="${SMTP_PASSWORD:-}"
  local domain="${SMTP_DOMAIN:-}"

  if command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
    local py
    py="$(command -v python3 2>/dev/null || command -v python)"
    SMTP_HOST="${host}" SMTP_PORT="${port}" SMTP_USER="${user}" SMTP_PASSWORD="${pass}" \
      SMTP_FROM_NAME="${from_name}" SMTP_FROM_EMAIL="${from_email}" SMTP_DOMAIN="${domain}" \
      SMTP_SUBJECT="${subject}" SMTP_BODY="${body}" SMTP_RCPT="${rcpt}" \
      "${py}" - <<'PY'
import os, smtplib, ssl, sys
from email.message import EmailMessage

host = os.environ["SMTP_HOST"]
port = int(os.environ.get("SMTP_PORT") or "587")
user = os.environ.get("SMTP_USER") or ""
password = os.environ.get("SMTP_PASSWORD") or ""
from_name = os.environ.get("SMTP_FROM_NAME") or "DevOps Platform"
from_email = os.environ["SMTP_FROM_EMAIL"]
subject = os.environ["SMTP_SUBJECT"]
body = os.environ["SMTP_BODY"]
rcpts = [x for x in os.environ["SMTP_RCPT"].split(",") if x]

msg = EmailMessage()
msg["Subject"] = subject
msg["From"] = f"{from_name} <{from_email}>"
msg["To"] = ", ".join(rcpts)
msg.set_content(body)

ctx = ssl.create_default_context()
try:
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=45, context=ctx) as s:
            if user:
                s.login(user, password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=45) as s:
            s.ehlo()
            s.starttls(context=ctx)
            s.ehlo()
            if user:
                s.login(user, password)
            s.send_message(msg)
except Exception as e:
    print(f"[send-smtp] {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(1)
PY
    return $?
  fi

  echo "[send-smtp] python not found — cannot send" >&2
  return 1
}
