"""Sends account emails (verify address, reset password).

Configure SMTP with SMTP_HOST, SMTP_PORT (587, STARTTLS), SMTP_USER,
SMTP_PASSWORD and MAIL_FROM - for Gmail: smtp.gmail.com, your address and a
16-character App Password (see the README). Without SMTP_HOST (local
development) the email is written to the server log instead, and outside
production the page shows the link, so it can still be followed.

Mail goes out on a worker thread: a slow or failing mail server never holds up
or breaks the request, and failures are logged.
"""
import html
import logging
import os
import smtplib
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage

log = logging.getLogger("freightwise.mail")
logging.basicConfig(level=logging.INFO)


def smtp_configured() -> bool:
    """A mail server with an account to send from (SMTP_NO_AUTH=1 for relays that need none)."""
    return bool(os.environ.get("SMTP_HOST")) and (bool(os.environ.get("SMTP_USER")) or os.environ.get("SMTP_NO_AUTH") == "1")


_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="mail")


def send_email(to: str, subject: str, text: str, html: str) -> None:
    if not smtp_configured():
        log.info("Email (SMTP not configured) to %s: %s\n%s", to, subject, text)
        return
    _pool.submit(_deliver, to, subject, text, html)


def _deliver(to: str, subject: str, text: str, html: str) -> None:
    try:
        _smtp_send(to, subject, text, html)
        log.info("Email sent to %s: %s", to, subject)
    except Exception:  # noqa: BLE001 - any mail failure is logged, never raised into a request
        log.exception("Email to %s failed (%s). Check SMTP_* settings in .env.", to, subject)


def _smtp_send(to: str, subject: str, text: str, html: str) -> None:
    msg = EmailMessage()
    msg["From"] = os.environ.get("MAIL_FROM") or f"Freightwise <{os.environ.get('SMTP_USER', 'no-reply@localhost')}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(os.environ["SMTP_HOST"], port, timeout=20) as smtp:
        smtp.starttls()
        if os.environ.get("SMTP_USER"):
            smtp.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
        smtp.send_message(msg)


def _html(heading: str, body: str, link: str, action: str, note: str) -> str:
    heading, body, note, link = (html.escape(v) for v in (heading, body, note, link))
    return f"""<!doctype html><html><body style="font-family:Arial,sans-serif;color:#15171b;background:#f6f5f1;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border:1px solid #ddd9d0;border-radius:4px;padding:24px">
<p style="font-family:Georgia,serif;font-size:20px;font-weight:600;margin:0 0 16px">Freightwise</p>
<p style="font-size:16px;font-weight:600;margin:0 0 8px">{heading}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 20px">{body}</p>
<p><a href="{link}" style="background:#1e3a5f;color:#fff;padding:10px 16px;border-radius:3px;text-decoration:none;font-size:15px">{action}</a></p>
<p style="font-size:13px;color:#60656e;line-height:1.5;margin-top:20px">{note}<br>If the button doesn't work, copy this link: {link}</p>
</div></body></html>"""


def verification_email(to: str, name: str, link: str) -> None:
    body = "Confirm this is your email address to finish creating your Freightwise account."
    note = "The link works once and expires in 24 hours. If you didn't sign up, ignore this email."
    send_email(
        to,
        "Confirm your email for Freightwise",
        f"Hello {name},\n\n{body}\n\n{link}\n\n{note}\n",
        _html(f"Hello {name},", body, link, "Confirm email", note),
    )


def reset_email(to: str, name: str, link: str) -> None:
    body = "Someone asked to reset the password for your Freightwise account. Choose a new password with this link."
    note = "The link works once and expires in 30 minutes. If this wasn't you, ignore this email; your password stays the same."
    send_email(
        to,
        "Reset your Freightwise password",
        f"Hello {name},\n\n{body}\n\n{link}\n\n{note}\n",
        _html(f"Hello {name},", body, link, "Choose a new password", note),
    )


def password_changed_email(to: str, name: str) -> None:
    text = (
        f"Hello {name},\n\nThe password for your Freightwise account was just changed and other devices were signed out. "
        "If this wasn't you, reset your password now and contact your administrator.\n"
    )
    send_email(to, "Your Freightwise password was changed", text, f"<p>{html.escape(text).replace(chr(10), '<br>')}</p>")
