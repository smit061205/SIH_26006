"""Accounts API: sign-up, email verification, sign-in, sessions, password
reset, and the privacy rights (export, delete) under India's DPDP Act.

Follows OWASP's authentication and session guidance: generic sign-in errors,
no way to learn which emails have accounts, per-address throttling and
lockout, HttpOnly session cookies, and all sessions revoked when the
password changes.
"""
import hmac
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from typing import Annotated

from pydantic import BaseModel, EmailStr, Field, StringConstraints
from sqlalchemy import delete, select

from src import mailer
from src.password_policy import check_password
from src.users import (
    AuditEvent,
    EmailToken,
    LoginThrottle,
    PlantStock,
    User,
    UserSession,
    _aware,
    audit,
    db,
    dummy_verify,
    find_user,
    hash_password,
    is_expired,
    issue_email_token,
    locked_until,
    new_token,
    normalise_email,
    now,
    purge_expired,
    redeem_email_token,
    session_expiry,
    sha256,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Housekeeping the privacy notice promises: expired sessions and old sign-in
# records go - at start-up and then once a day while the server runs.
def _purge_daily() -> None:
    try:
        purge_expired()
    finally:
        timer = threading.Timer(24 * 3600, _purge_daily)
        timer.daemon = True
        timer.start()


_purge_daily()

# A name with at least one visible character.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]

COOKIE = "fw_session"
CONSENT_VERSION = "2026-09-24"
MAX_FAILURES = 5
BASE_LOCKOUT = timedelta(minutes=15)
MAX_LOCKOUT = timedelta(hours=24)
IDLE_TIMEOUT = timedelta(hours=12)
IP_LIMIT = 30  # sign-in attempts per IP per 10 minutes
_ip_attempts: dict[str, deque] = defaultdict(deque)


def app_url() -> str:
    return os.environ.get("APP_URL", "http://localhost:5173").rstrip("/")


def _show_links() -> bool:
    """Return email links in the response (so the page can show them) only in
    development (APP_ENV=development) with no mail server. Anywhere else a
    response carrying a reset link would let anyone take over an account, so
    the default is off. DEV_SHOW_EMAIL_LINKS=0/1 overrides, for tests."""
    if mailer.mail_configured():
        return False
    flag = os.environ.get("DEV_SHOW_EMAIL_LINKS")
    if flag in ("0", "1"):
        return flag == "1"
    return os.environ.get("APP_ENV", "production").lower() == "development"


MAIL_PER_EMAIL = 3  # confirmation or reset emails per address per hour
MAIL_PER_IP = 20  # per network per hour
_mail_attempts: dict[str, deque] = defaultdict(deque)


def _mail_limited(email: str, ip: str) -> bool:
    """Stops anyone flooding an inbox with confirmation or reset emails."""
    limited = False
    cutoff = time.monotonic() - 3600
    for key, cap in ((f"e:{sha256(normalise_email(email))}", MAIL_PER_EMAIL), (f"i:{ip}", MAIL_PER_IP)):
        window = _mail_attempts[key]
        while window and window[0] < cutoff:
            window.popleft()
        if len(window) >= cap:
            limited = True
    if not limited:
        _mail_attempts[f"e:{sha256(normalise_email(email))}"].append(time.monotonic())
        _mail_attempts[f"i:{ip}"].append(time.monotonic())
    return limited


def _developer_code_ok(code: str) -> bool:
    """The developer access code from DEVELOPER_ACCESS_CODE; none is valid when it isn't set."""
    expected = os.environ.get("DEVELOPER_ACCESS_CODE", "")
    return bool(expected) and hmac.compare_digest(code.strip().encode(), expected.encode())


def _ip(request: Request) -> str:
    return request.client.host if request.client else ""


def _cookie_attrs() -> dict:
    """Attributes the session cookie is set with; clearing it must repeat them or browsers keep it."""
    return {
        "httponly": True,
        "secure": os.environ.get("COOKIE_SECURE") == "1",
        "samesite": os.environ.get("COOKIE_SAMESITE", "lax"),
        "path": "/",
    }


def _set_cookie(response: Response, token: str, remember: bool) -> None:
    response.set_cookie(COOKIE, token, max_age=int(timedelta(days=30).total_seconds()) if remember else None, **_cookie_attrs())


def current_user(request: Request) -> User | None:
    """The signed-in user for a request, sliding the idle timeout; None if not signed in."""
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    with db() as s:
        sess = s.scalar(select(UserSession).where(UserSession.token_hash == sha256(token)))
        if sess is None or is_expired(sess):
            return None
        idle = now() - _aware(sess.last_seen)
        if not sess.remember and idle > IDLE_TIMEOUT:
            return None
        # Slide the idle timeout, but write at most once a minute: pages fire
        # several requests at once and SQLite serialises writes.
        if idle > timedelta(minutes=1):
            if not sess.remember:
                sess.expires_at = max(_aware(sess.expires_at), now() + IDLE_TIMEOUT)
            sess.last_seen = now()
            s.commit()
        user = s.get(User, sess.user_id)
        request.state.session_id = sess.id
        return user


def require_user(request: Request) -> User:
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return user


def _public(u: User) -> dict:
    return {
        "email": u.email,
        "name": u.name,
        "organisation": u.organisation,
        "role_title": u.role_title,
        "plant": u.plant,
        "email_verified": u.email_verified_at is not None,
        "created_at": u.created_at.isoformat(),
        "is_developer": bool(u.is_developer),
        "is_demo": bool(u.is_demo),
    }


# --- sign-up and verification ---------------------------------------------

class SignupRequest(BaseModel):
    name: Name
    email: EmailStr
    organisation: str = Field("", max_length=120)
    role_title: str = Field("", max_length=80)
    plant: str = Field("", max_length=80)
    password: str = Field(max_length=256)
    accept_privacy: bool
    accept_terms: bool
    developer_code: str = Field("", max_length=100)


CHECK_EMAIL = "If this email can be used, we've sent a link to confirm it. Check your inbox."


@router.post("/signup")
def signup(req: SignupRequest, request: Request):
    if not (req.accept_privacy and req.accept_terms):
        raise HTTPException(status_code=400, detail="Please agree to the privacy notice and the terms to create an account.")
    problem = check_password(req.password, req.email, req.name)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    email = normalise_email(req.email)
    if req.developer_code.strip():
        return _developer_signup(req, email, request)
    link = None
    with db() as s:
        existing = find_user(s, email)
        if existing is None:
            user = User(
                email=email,
                name=req.name.strip(),
                organisation=req.organisation.strip(),
                role_title=req.role_title.strip(),
                plant=req.plant.strip(),
                password_hash=hash_password(req.password),
                consent_version=CONSENT_VERSION,
                consent_at=now(),
            )
            s.add(user)
            s.flush()
            token = issue_email_token(s, user, "verify", timedelta(hours=24))
            audit(s, "signup", user.id, _ip(request))
            s.commit()
            link = f"{app_url()}/verify-email?token={token}"
            mailer.verification_email(email, user.name, link)
        else:
            # Same answer and similar time whether or not the account exists.
            hash_password(req.password)
    body = {"message": CHECK_EMAIL}
    if _show_links() and link:
        body["dev_link"] = link
    return body


def _check_developer_code(code: str, request: Request) -> None:
    # Wrong guesses count against the same per-network limit as sign-in attempts.
    if _ip_limited(_ip(request)):
        raise HTTPException(status_code=429, detail="Too many attempts from this network. Try again in a few minutes.")
    if not _developer_code_ok(code):
        raise HTTPException(status_code=400, detail="That developer code isn't right.")


def _developer_signup(req: SignupRequest, email: str, request: Request) -> dict:
    """With a valid developer code the account is ready at once: confirmed, with developer access."""
    _check_developer_code(req.developer_code, request)
    with db() as s:
        existing = find_user(s, email)
        if existing is not None and existing.email_verified_at is not None:
            # Only someone holding the developer code learns this; a confirmed account is never taken over.
            raise HTTPException(
                status_code=409,
                detail="An account already uses this email. Sign in, then add the developer code on your Account page.",
            )
        if existing is not None:
            # Signed up before but never confirmed (e.g. the email didn't arrive): the developer
            # code finishes that account with the details and password given now.
            existing.name = req.name.strip()
            existing.organisation = req.organisation.strip()
            existing.role_title = req.role_title.strip()
            existing.plant = req.plant.strip()
            existing.password_hash = hash_password(req.password)
            existing.consent_version = CONSENT_VERSION
            existing.consent_at = now()
            existing.email_verified_at = now()
            existing.is_developer = True
            s.execute(delete(UserSession).where(UserSession.user_id == existing.id))
            s.execute(delete(LoginThrottle).where(LoginThrottle.email_hash == sha256(email)))
            audit(s, "signup", existing.id, _ip(request), "developer, completed an unconfirmed account")
            s.commit()
            return {"message": "Your developer account is ready. Sign in to start.", "developer": True}
        user = User(
            email=email,
            name=req.name.strip(),
            organisation=req.organisation.strip(),
            role_title=req.role_title.strip(),
            plant=req.plant.strip(),
            password_hash=hash_password(req.password),
            consent_version=CONSENT_VERSION,
            consent_at=now(),
            email_verified_at=now(),
            is_developer=True,
        )
        s.add(user)
        s.flush()
        audit(s, "signup", user.id, _ip(request), "developer")
        s.commit()
    return {"message": "Your developer account is ready. Sign in to start.", "developer": True}


class DeveloperRequest(BaseModel):
    code: str = Field(min_length=1, max_length=100)


@router.post("/developer")
def become_developer(req: DeveloperRequest, request: Request, user: User = Depends(require_user)):
    """Adds developer access to the signed-in account."""
    _no_demo(user)
    _check_developer_code(req.code, request)
    with db() as s:
        u = s.get(User, user.id)
        u.is_developer = True
        if u.email_verified_at is None:
            u.email_verified_at = now()
        audit(s, "developer_access", u.id, _ip(request))
        s.commit()
        return _public(u)


class TokenRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)


@router.post("/verify-email")
def verify_email(req: TokenRequest, request: Request):
    with db() as s:
        user = redeem_email_token(s, req.token, "verify")
        if user is None:
            raise HTTPException(status_code=400, detail="This link has expired or was already used. Ask for a new one.")
        if user.email_verified_at is None:
            user.email_verified_at = now()
        audit(s, "email_verified", user.id, _ip(request))
        s.commit()
    return {"message": "Email confirmed. You can sign in now."}


class EmailRequest(BaseModel):
    email: EmailStr


@router.post("/resend-verification")
def resend_verification(req: EmailRequest, request: Request):
    link = None
    # Over the limit: the same answer, but nothing is sent.
    if _mail_limited(req.email, _ip(request)):
        return {"message": CHECK_EMAIL}
    with db() as s:
        user = find_user(s, req.email)
        if user is not None and user.email_verified_at is None:
            token = issue_email_token(s, user, "verify", timedelta(hours=24))
            s.commit()
            link = f"{app_url()}/verify-email?token={token}"
            mailer.verification_email(user.email, user.name, link)
    body = {"message": CHECK_EMAIL}
    if _show_links() and link:
        body["dev_link"] = link
    return body


# --- sign-in ----------------------------------------------------------------

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=256)
    remember: bool = False


def _ip_limited(ip: str) -> bool:
    cutoff = time.monotonic() - 600
    if len(_ip_attempts) > 5000:
        # Forget networks with no recent attempts, so the table can't grow without bound.
        for key in [k for k, w in _ip_attempts.items() if not w or w[-1] < cutoff]:
            del _ip_attempts[key]
    window = _ip_attempts[ip]
    while window and window[0] < cutoff:
        window.popleft()
    window.append(time.monotonic())
    return len(window) > IP_LIMIT


@router.post("/login")
def login(req: LoginRequest, request: Request, response: Response):
    ip = _ip(request)
    if _ip_limited(ip):
        raise HTTPException(status_code=429, detail="Too many attempts from this network. Try again in a few minutes.")
    email = normalise_email(req.email)
    key = sha256(email)
    with db() as s:
        throttle = s.get(LoginThrottle, key) or LoginThrottle(email_hash=key, failures=0, lockouts=0)
        s.add(throttle)
        until = locked_until(throttle)
        if until and until > now():
            minutes = max(1, int((until - now()).total_seconds() // 60) + 1)
            raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {minutes} minutes or reset your password.")
        user = find_user(s, email)
        ok = verify_password(req.password, user.password_hash) if user else (dummy_verify(req.password) or False)
        if not ok:
            throttle.failures += 1
            if throttle.failures >= MAX_FAILURES:
                throttle.lockouts += 1
                throttle.failures = 0
                throttle.locked_until = now() + min(BASE_LOCKOUT * 2 ** (throttle.lockouts - 1), MAX_LOCKOUT)
            audit(s, "login_failed", user.id if user else None, ip)
            s.commit()
            raise HTTPException(status_code=401, detail="Email or password is incorrect.")
        if user.email_verified_at is None:
            s.commit()
            raise HTTPException(status_code=403, detail="Confirm your email first. We can send the link again.")
        throttle.failures = 0
        throttle.lockouts = 0
        throttle.locked_until = None
        token, token_hash = new_token()
        s.add(
            UserSession(
                token_hash=token_hash,
                user_id=user.id,
                expires_at=session_expiry(req.remember),
                remember=req.remember,
                user_agent=request.headers.get("user-agent", "")[:300],
                ip=ip,
            )
        )
        # A session cookie from before sign-in is not carried over.
        old = request.cookies.get(COOKIE)
        if old:
            s.execute(delete(UserSession).where(UserSession.token_hash == sha256(old)))
        audit(s, "login", user.id, ip)
        s.commit()
        body = _public(user)
    _set_cookie(response, token, req.remember)
    return body


@router.post("/logout")
def logout(request: Request, response: Response, fw_session: str | None = Cookie(default=None)):
    if fw_session:
        with db() as s:
            sess = s.scalar(select(UserSession).where(UserSession.token_hash == sha256(fw_session)))
            if sess:
                audit(s, "logout", sess.user_id, _ip(request))
                s.delete(sess)
            s.commit()
    response.delete_cookie(COOKIE, **_cookie_attrs())
    return {"message": "Signed out."}


# --- "Try the demo" ------------------------------------------------------------
# One click, no email: a throwaway account signed in at once, so anyone can see
# the planner working. Each visitor gets their own (their plant stock and plans
# don't mix with anyone else's); accounts older than a day are deleted.

DEMO_TTL = timedelta(days=1)
DEMO_PER_IP = 10  # demo accounts per network per hour
_demo_attempts: dict[str, deque] = defaultdict(deque)


def _erase_user(s, user: User) -> None:
    """Remove an account and everything tied to it; sign-in records stay as anonymous events."""
    s.execute(delete(UserSession).where(UserSession.user_id == user.id))
    s.execute(delete(EmailToken).where(EmailToken.user_id == user.id))
    s.execute(delete(PlantStock).where(PlantStock.user_id == user.id))
    for e in s.scalars(select(AuditEvent).where(AuditEvent.user_id == user.id)):
        e.user_id = None
        e.ip = ""
    s.execute(delete(LoginThrottle).where(LoginThrottle.email_hash == sha256(user.email)))
    s.delete(user)


@router.post("/demo")
def start_demo(request: Request, response: Response):
    ip = _ip(request)
    cutoff = time.monotonic() - 3600
    window = _demo_attempts[ip]
    while window and window[0] < cutoff:
        window.popleft()
    if len(window) >= DEMO_PER_IP:
        raise HTTPException(status_code=429, detail="Too many demo sessions from this network. Try again later.")
    window.append(time.monotonic())
    with db() as s:
        for old in s.scalars(select(User).where(User.is_demo.is_(True), User.created_at < now() - DEMO_TTL)).all():
            _erase_user(s, old)
        user = User(
            email=f"demo-{secrets.token_hex(8)}@demo.invalid",
            name="Demo planner",
            # Not a hash: no password can match it, so the account is reachable only through
            # this session. (Hashing a random one would cost seconds of CPU on a small server.)
            password_hash="!demo",
            email_verified_at=now(),
            consent_version=CONSENT_VERSION,
            consent_at=now(),
            is_demo=True,
        )
        s.add(user)
        s.flush()
        token, token_hash = new_token()
        s.add(
            UserSession(
                token_hash=token_hash,
                user_id=user.id,
                expires_at=session_expiry(False),
                remember=False,
                user_agent=request.headers.get("user-agent", "")[:300],
                ip=ip,
            )
        )
        audit(s, "demo_start", user.id, ip)
        s.commit()
        body = _public(user)
    _set_cookie(response, token, False)
    return body


def _no_demo(user: User) -> None:
    if user.is_demo:
        raise HTTPException(status_code=403, detail="The demo account can't do this. Create your own account to use it.")


@router.get("/me")
def me(user: User = Depends(require_user)):
    return _public(user)


@router.get("/session")
def session_state(request: Request):
    """Who is signed in, or null: always 200, so a visitor's browser logs no error."""
    user = current_user(request)
    return {"user": _public(user) if user else None}


class ProfileUpdate(BaseModel):
    name: Name | None = None
    organisation: str | None = Field(None, max_length=120)
    role_title: str | None = Field(None, max_length=80)
    plant: str | None = Field(None, max_length=80)


@router.patch("/me")
def update_me(req: ProfileUpdate, user: User = Depends(require_user)):
    with db() as s:
        u = s.get(User, user.id)
        for field, value in req.model_dump(exclude_none=True).items():
            setattr(u, field, value.strip())
        s.commit()
        return _public(u)


# --- passwords --------------------------------------------------------------

@router.post("/forgot-password")
def forgot_password(req: EmailRequest, request: Request):
    link = None
    if _mail_limited(req.email, _ip(request)):
        return {"message": "If an account uses this email, we've sent a link to reset the password."}
    with db() as s:
        user = find_user(s, req.email)
        if user is not None:
            token = issue_email_token(s, user, "reset", timedelta(minutes=30))
            audit(s, "reset_requested", user.id, _ip(request))
            s.commit()
            link = f"{app_url()}/reset-password?token={token}"
            mailer.reset_email(user.email, user.name, link)
    body = {"message": "If an account uses this email, we've sent a link to reset the password."}
    if _show_links() and link:
        body["dev_link"] = link
    return body


class ResetRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(max_length=256)


def _revoke_sessions(s, user_id: int, keep_id: int | None = None) -> None:
    q = delete(UserSession).where(UserSession.user_id == user_id)
    if keep_id is not None:
        q = q.where(UserSession.id != keep_id)
    s.execute(q)


@router.post("/reset-password")
def reset_password(req: ResetRequest, request: Request):
    with db() as s:
        user = redeem_email_token(s, req.token, "reset")
        if user is None:
            raise HTTPException(status_code=400, detail="This link has expired or was already used. Ask for a new one.")
        problem = check_password(req.password, user.email, user.name)
        if problem:
            s.rollback()
            raise HTTPException(status_code=400, detail=problem)
        user.password_hash = hash_password(req.password)
        # Following the link proves the address, too.
        user.email_verified_at = user.email_verified_at or now()
        _revoke_sessions(s, user.id)
        s.execute(delete(LoginThrottle).where(LoginThrottle.email_hash == sha256(user.email)))
        audit(s, "password_reset", user.id, _ip(request))
        s.commit()
        mailer.password_changed_email(user.email, user.name)
    return {"message": "Password changed. Sign in with your new password."}


class ChangePassword(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)


@router.post("/change-password")
def change_password(req: ChangePassword, request: Request, user: User = Depends(require_user)):
    _no_demo(user)
    if not verify_password(req.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    problem = check_password(req.new_password, user.email, user.name)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    with db() as s:
        u = s.get(User, user.id)
        u.password_hash = hash_password(req.new_password)
        _revoke_sessions(s, u.id, keep_id=getattr(request.state, "session_id", None))
        audit(s, "password_changed", u.id, _ip(request))
        s.commit()
        mailer.password_changed_email(u.email, u.name)
    return {"message": "Password changed. Other devices have been signed out."}


# --- sessions and privacy rights ---------------------------------------------

@router.get("/sessions")
def list_sessions(request: Request, user: User = Depends(require_user)):
    current = getattr(request.state, "session_id", None)
    with db() as s:
        rows = s.scalars(select(UserSession).where(UserSession.user_id == user.id).order_by(UserSession.last_seen.desc()))
        return {
            "sessions": [
                {
                    "id": r.id,
                    "current": r.id == current,
                    "created_at": _aware(r.created_at).isoformat(),
                    "last_seen": _aware(r.last_seen).isoformat(),
                    "user_agent": r.user_agent,
                    "ip": r.ip,
                }
                for r in rows
                if not is_expired(r)
            ]
        }


@router.delete("/sessions/{session_id}")
def end_session(session_id: int, user: User = Depends(require_user)):
    with db() as s:
        row = s.get(UserSession, session_id)
        if row is None or row.user_id != user.id:
            raise HTTPException(status_code=404, detail="Session not found.")
        s.delete(row)
        s.commit()
    return {"message": "Signed out on that device."}


@router.get("/export")
def export_data(user: User = Depends(require_user)):
    """Everything held about the person (DPDP right of access)."""
    with db() as s:
        sessions = s.scalars(select(UserSession).where(UserSession.user_id == user.id)).all()
        events = s.scalars(select(AuditEvent).where(AuditEvent.user_id == user.id).order_by(AuditEvent.at)).all()
        return {
            "account": {**_public(user), "consent_version": user.consent_version, "consent_at": _aware(user.consent_at).isoformat()},
            "sessions": [{"created_at": _aware(r.created_at).isoformat(), "user_agent": r.user_agent, "ip": r.ip} for r in sessions],
            "activity": [{"event": e.event, "at": _aware(e.at).isoformat(), "ip": e.ip} for e in events],
        }


class DeleteRequest(BaseModel):
    password: str = Field(max_length=256)


@router.delete("/account")
def delete_account(req: DeleteRequest, request: Request, response: Response, user: User = Depends(require_user)):
    """Erase the account and withdraw consent (DPDP). Sign-in records are
    kept only as anonymous events without the person's id."""
    if not user.is_demo and not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Your password is incorrect.")
    with db() as s:
        _erase_user(s, s.get(User, user.id))
        audit(s, "account_deleted", None, "")
        s.commit()
    response.delete_cookie(COOKIE, **_cookie_attrs())
    return {"message": "Your account and personal data have been deleted."}
