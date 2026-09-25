"""Accounts, sessions and one-time email tokens, stored with SQLAlchemy.

SQLite at backend/var/app.db by default (AUTH_DB_URL overrides, e.g. a
Postgres URL). Secrets are never stored in the clear: passwords are hashed
with scrypt, and session and email tokens are stored as SHA-256 hashes, so a
copy of the database can't be used to sign in.
"""
import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

DEFAULT_DB = Path(__file__).resolve().parent.parent / "backend" / "var" / "app.db"

# scrypt cost: N=2^17, r=8, p=1 (about 128 MiB, OWASP's recommended setting).
# SCRYPT_LOG_N lowers it for tests only.
SCRYPT_R = 8
SCRYPT_P = 1


def _scrypt_n() -> int:
    return 2 ** int(os.environ.get("SCRYPT_LOG_N", "17"))


def now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """SQLite drops time zones; everything here is stored in UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    organisation: Mapped[str] = mapped_column(String(120), default="")
    role_title: Mapped[str] = mapped_column(String(80), default="")
    plant: Mapped[str] = mapped_column(String(80), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    consent_version: Mapped[str] = mapped_column(String(20))
    consent_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    # Developer accounts (a valid developer access code) also get the dev tools.
    is_developer: Mapped[bool] = mapped_column(Boolean, default=False)
    # "Try the demo" accounts: no email or password of the visitor's, deleted after a day.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class UserSession(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    remember: Mapped[bool] = mapped_column(Boolean, default=False)
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")


class EmailToken(Base):
    __tablename__ = "email_tokens"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(20))  # verify | reset
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class LoginThrottle(Base):
    """Failed sign-ins per email address, kept whether or not an account
    exists, so lockout behaves the same for both and reveals nothing."""

    __tablename__ = "login_throttle"
    email_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    lockouts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AuditEvent(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    event: Mapped[str] = mapped_column(String(40))
    at: Mapped[datetime] = mapped_column(DateTime, default=now)
    ip: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[str] = mapped_column(Text, default="")


class PlantStock(Base):
    """A planner's own figure for a plant's coking-coal stock, used in place of
    the reference figure in data/plants.csv for that person's plans."""

    __tablename__ = "plant_stock"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    plant_name: Mapped[str] = mapped_column(String(80), primary_key=True)
    tonnes: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class DisruptionNotice(Base):
    """A port disruption (strike, closure, dredging) entered by a developer or
    operator; raised as an early warning while it applies."""

    __tablename__ = "disruption_notices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    port: Mapped[str] = mapped_column(String(80))
    start_date: Mapped[datetime] = mapped_column(DateTime)
    end_date: Mapped[datetime] = mapped_column(DateTime)
    title: Mapped[str] = mapped_column(String(160))
    severity: Mapped[str] = mapped_column(String(10))  # high | medium
    source: Mapped[str] = mapped_column(String(300), default="")
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


@lru_cache(maxsize=4)
def _engine(url: str):
    if url.startswith("sqlite:///"):
        Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False})
    else:
        # A hosted database drops idle connections: check each one before use.
        engine = create_engine(url, pool_pre_ping=True, pool_recycle=300)
    Base.metadata.create_all(engine)
    _add_missing_columns(engine)
    return engine


def _add_missing_columns(engine) -> None:
    """create_all makes new tables but never alters existing ones: add columns
    introduced since a database was created (a one-line migration each)."""
    from sqlalchemy import inspect, text

    columns = {c["name"] for c in inspect(engine).get_columns("users")}
    if "is_developer" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_developer BOOLEAN NOT NULL DEFAULT FALSE"))
    if "is_demo" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE"))


def db_url() -> str:
    url = os.environ.get("AUTH_DB_URL") or f"sqlite:///{DEFAULT_DB}"
    # Hosts such as Render and Heroku hand out postgres:// URLs, which SQLAlchemy 2 no longer accepts.
    if url.startswith("postgres://"):
        url = "postgresql://" + url.removeprefix("postgres://")
    return url


def db() -> Session:
    return sessionmaker(bind=_engine(db_url()), expire_on_commit=False)()


# --- secrets --------------------------------------------------------------

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    n = _scrypt_n()
    key = hashlib.scrypt(password.encode(), salt=salt, n=n, r=SCRYPT_R, p=SCRYPT_P, maxmem=2**29, dklen=32)
    return f"scrypt${n}${SCRYPT_R}${SCRYPT_P}${base64.b64encode(salt).decode()}${base64.b64encode(key).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, key = stored.split("$")
        if scheme != "scrypt":
            return False
        test = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), maxmem=2**29, dklen=32
        )
        return hmac.compare_digest(test, base64.b64decode(key))
    except (ValueError, TypeError):
        return False


# Checked against when the email is unknown, so a miss costs the same time as a hit.
_DUMMY_HASH: str | None = None


def dummy_verify(password: str) -> None:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    verify_password(password, _DUMMY_HASH)


def new_token() -> tuple[str, str]:
    """A random token for the user and the SHA-256 hash that is stored."""
    token = secrets.token_urlsafe(32)
    return token, sha256(token)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def normalise_email(email: str) -> str:
    return email.strip().lower()


def find_user(session: Session, email: str) -> User | None:
    return session.scalar(select(User).where(User.email == normalise_email(email)))


def audit(session: Session, event: str, user_id: int | None, ip: str = "", detail: str = "") -> None:
    session.add(AuditEvent(event=event, user_id=user_id, ip=ip, detail=detail))


def issue_email_token(session: Session, user: User, purpose: str, lifetime: timedelta) -> str:
    """A single-use link token; earlier unused tokens for the same purpose stop working."""
    for old in session.scalars(
        select(EmailToken).where(EmailToken.user_id == user.id, EmailToken.purpose == purpose, EmailToken.used_at.is_(None))
    ):
        old.used_at = now()
    token, token_hash = new_token()
    session.add(EmailToken(token_hash=token_hash, user_id=user.id, purpose=purpose, expires_at=now() + lifetime))
    return token


def redeem_email_token(session: Session, token: str, purpose: str) -> User | None:
    row = session.scalar(select(EmailToken).where(EmailToken.token_hash == sha256(token), EmailToken.purpose == purpose))
    if row is None or row.used_at is not None or _aware(row.expires_at) < now():
        return None
    row.used_at = now()
    return session.get(User, row.user_id)


def session_expiry(remember: bool) -> datetime:
    return now() + (timedelta(days=30) if remember else timedelta(hours=12))


def is_expired(s: UserSession) -> bool:
    return _aware(s.expires_at) < now()


def locked_until(row: "LoginThrottle | None") -> datetime | None:
    return _aware(row.locked_until) if row else None


SIGN_IN_RECORDS_KEPT = timedelta(days=180)


def purge_expired() -> None:
    """Deletes expired sessions and links, and sign-in records older than
    180 days, as the privacy notice promises. Run at start-up."""
    from sqlalchemy import delete

    with db() as s:
        # Stored times are naive UTC (SQLite keeps no zone), so compare like with like.
        cutoff = now().replace(tzinfo=None)
        s.execute(delete(UserSession).where(UserSession.expires_at < cutoff))
        s.execute(delete(EmailToken).where(EmailToken.expires_at < cutoff - timedelta(days=1)))
        s.execute(delete(AuditEvent).where(AuditEvent.at < cutoff - SIGN_IN_RECORDS_KEPT))
        s.commit()
