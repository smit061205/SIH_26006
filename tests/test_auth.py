import secrets
from datetime import timedelta

import pytest

from src.password_policy import check_password
from src.users import EmailToken, db, sha256
from tests.auth_helpers import PASSWORD, new_client, signed_in_client


def _signup(client, email, password=PASSWORD, **extra):
    return client.post(
        "/api/auth/signup",
        json={"name": "Asha Rao", "email": email, "password": password, "accept_privacy": True, "accept_terms": True, **extra},
    )


def _email():
    return f"user-{secrets.token_hex(4)}@example.com"


# --- password rules: 8+ characters with a capital, a number and a special ------

@pytest.mark.parametrize(
    ("password", "needs"),
    [
        ("Sh0rt!", "at least 8 characters"),
        ("mango#tree42", "a capital letter"),
        ("Mango#Treetop", "a number"),
        ("MangoTree42", "a special character"),
    ],
)
def test_each_composition_rule_is_named(password, needs):
    problem = check_password(password)
    assert problem is not None and needs in problem


@pytest.mark.parametrize(
    "password",
    [
        "Password@123",  # common, padded
        "Qwerty123!",  # common, padded
        "Aaaaaaaa1!",  # run
        "Freightwise@2026",  # service name
        "Asharao@123",  # the person's name
    ],
)
def test_weak_passwords_rejected(password):
    assert check_password(password, "asha.rao@example.com", "Asha Rao") is not None


def test_password_meeting_every_rule_accepted():
    assert check_password("Mango#Tree42", "asha.rao@example.com", "Asha Rao") is None


# --- sign-up and verification -------------------------------------------------

def test_signup_requires_consent():
    c = new_client()
    r = c.post("/api/auth/signup", json={"name": "A", "email": _email(), "password": PASSWORD, "accept_privacy": False, "accept_terms": True})
    assert r.status_code == 400


def test_signup_does_not_reveal_existing_accounts():
    c = new_client()
    email = _email()
    first = _signup(c, email).json()
    second = _signup(c, email).json()
    assert first["message"] == second["message"]
    assert "dev_link" in first and "dev_link" not in second


def test_cannot_sign_in_before_verifying():
    c = new_client()
    email = _email()
    _signup(c, email)
    r = c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 403


def test_verification_link_works_once():
    c = new_client()
    token = _signup(c, _email()).json()["dev_link"].split("token=")[1]
    assert c.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    assert c.post("/api/auth/verify-email", json={"token": token}).status_code == 400


# --- sign-in, sessions, access ------------------------------------------------

def test_data_needs_a_session():
    anonymous = new_client()
    assert anonymous.get("/api/reference").status_code == 401
    assert anonymous.get("/api/health").status_code == 200
    assert anonymous.get("/api/public/summary").status_code == 200
    assert signed_in_client().get("/api/reference").status_code == 200


def test_changes_need_the_request_header():
    c = signed_in_client()
    body = {"cargo_tonnes": 75000, "month": 9, "origin": "x", "plant_name": "y"}
    assert c.post("/api/rank", json=body, headers={"X-Requested-With": ""}).status_code == 403


def test_session_cookie_is_httponly_and_samesite():
    c = new_client()
    email = _email()
    token = _signup(c, email).json()["dev_link"].split("token=")[1]
    c.post("/api/auth/verify-email", json={"token": token})
    r = c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie


def test_wrong_password_and_unknown_email_get_the_same_answer():
    c = signed_in_client(email := _email())
    wrong = c.post("/api/auth/login", json={"email": email, "password": "Not-the-password1"})
    unknown = c.post("/api/auth/login", json={"email": _email(), "password": "Not-the-password1"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_lockout_after_five_failures_even_with_right_password():
    c = signed_in_client(email := _email())
    for _ in range(5):
        c.post("/api/auth/login", json={"email": email, "password": "Wrong-wrong-1"})
    r = c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 429


def test_logout_ends_the_session():
    c = signed_in_client()
    assert c.post("/api/auth/logout").status_code == 200
    assert c.get("/api/auth/me").status_code == 401


def test_signing_out_clears_the_cookie_with_the_attributes_it_was_set_with(monkeypatch):
    # A Secure cookie is only cleared by a Set-Cookie that is Secure too.
    monkeypatch.setenv("COOKIE_SECURE", "1")
    c = signed_in_client()
    cleared = c.post("/api/auth/logout").headers["set-cookie"].lower()
    assert "fw_session=" in cleared and "secure" in cleared and "httponly" in cleared and "samesite=lax" in cleared


def test_hosted_postgres_urls_are_accepted(monkeypatch):
    from src.users import db_url

    monkeypatch.setenv("AUTH_DB_URL", "postgres://u:p@db.example:5432/fw")
    assert db_url() == "postgresql://u:p@db.example:5432/fw"
    monkeypatch.setenv("AUTH_DB_URL", "postgresql://u:p@db.example:5432/fw")
    assert db_url() == "postgresql://u:p@db.example:5432/fw"


def test_sessions_list_marks_the_current_one():
    c = signed_in_client()
    sessions = c.get("/api/auth/sessions").json()["sessions"]
    assert len(sessions) == 1 and sessions[0]["current"]


# --- passwords ----------------------------------------------------------------

def test_reset_flow_revokes_sessions_and_link_is_single_use():
    email = _email()
    c = signed_in_client(email)
    link = new_client().post("/api/auth/forgot-password", json={"email": email}).json()["dev_link"]
    token = link.split("token=")[1]
    new_password = "Orange-kettle7"
    assert new_client().post("/api/auth/reset-password", json={"token": token, "password": new_password}).status_code == 200
    assert c.get("/api/auth/me").status_code == 401  # old session revoked
    assert new_client().post("/api/auth/reset-password", json={"token": token, "password": new_password}).status_code == 400
    assert signed_in_client_after_reset(email, new_password)


def signed_in_client_after_reset(email, password):
    c = new_client()
    return c.post("/api/auth/login", json={"email": email, "password": password}).status_code == 200


def test_forgot_password_does_not_reveal_accounts():
    r = new_client().post("/api/auth/forgot-password", json={"email": _email()}).json()
    assert "dev_link" not in r and r["message"]


def test_expired_reset_link_refused():
    email = _email()
    signed_in_client(email)
    token = new_client().post("/api/auth/forgot-password", json={"email": email}).json()["dev_link"].split("token=")[1]
    with db() as s:
        row = s.query(EmailToken).filter_by(token_hash=sha256(token)).one()
        row.expires_at = row.expires_at - timedelta(hours=1)
        s.commit()
    assert new_client().post("/api/auth/reset-password", json={"token": token, "password": "Orange-kettle7"}).status_code == 400


def test_change_password_keeps_this_session_and_ends_others():
    email = _email()
    here = signed_in_client(email)
    elsewhere = new_client()
    elsewhere.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    r = here.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "Velvet-anchor8"})
    assert r.status_code == 200
    assert here.get("/api/auth/me").status_code == 200
    assert elsewhere.get("/api/auth/me").status_code == 401


# --- privacy rights (DPDP) ------------------------------------------------------

def test_export_contains_account_and_activity():
    c = signed_in_client()
    data = c.get("/api/auth/export").json()
    assert data["account"]["consent_version"]
    assert any(e["event"] == "login" for e in data["activity"])


def test_delete_account_needs_password_and_removes_it():
    email = _email()
    c = signed_in_client(email)
    assert c.request("DELETE", "/api/auth/account", json={"password": "Wrong-wrong-1"}).status_code == 400
    assert c.request("DELETE", "/api/auth/account", json={"password": PASSWORD}).status_code == 200
    assert new_client().post("/api/auth/login", json={"email": email, "password": PASSWORD}).status_code == 401


def test_profile_update():
    c = signed_in_client()
    body = c.patch("/api/auth/me", json={"plant": "Bhilai Steel Plant", "role_title": "Chartering"}).json()
    assert body["plant"] == "Bhilai Steel Plant" and body["role_title"] == "Chartering"


def test_session_state_is_null_when_signed_out_and_the_user_when_signed_in():
    anon = new_client()
    r = anon.get("/api/auth/session")
    assert r.status_code == 200 and r.json() == {"user": None}
    client = signed_in_client()
    user = client.get("/api/auth/session").json()["user"]
    assert user["email"].endswith("@example.com")
    assert "password_hash" not in user


# --- developer access ---------------------------------------------------------

def _dev_signup(c, email, code):
    return c.post(
        "/api/auth/signup",
        json={"name": "Dev Person", "email": email, "password": PASSWORD, "accept_privacy": True, "accept_terms": True, "developer_code": code},
    )


def test_developer_code_gives_a_ready_developer_account():
    c = new_client()
    email = _email()
    r = _dev_signup(c, email, "test-dev-code")
    assert r.status_code == 200 and r.json()["developer"] is True and "dev_link" not in r.json()
    # No email step: sign in straight away.
    assert c.post("/api/auth/login", json={"email": email, "password": PASSWORD}).status_code == 200
    me = c.get("/api/auth/me").json()
    assert me["is_developer"] is True and me["email_verified"] is True


def test_wrong_developer_code_is_refused_and_creates_nothing():
    c = new_client()
    email = _email()
    r = _dev_signup(c, email, "not-the-code")
    assert r.status_code == 400
    assert c.post("/api/auth/login", json={"email": email, "password": PASSWORD}).status_code == 401


def test_no_developer_code_works_when_none_is_configured(monkeypatch):
    monkeypatch.setenv("DEVELOPER_ACCESS_CODE", "")
    assert _dev_signup(new_client(), _email(), "anything").status_code == 400


def test_existing_account_can_add_developer_access():
    c = signed_in_client()
    assert c.get("/api/auth/me").json()["is_developer"] is False
    assert c.post("/api/auth/developer", json={"code": "wrong"}).status_code == 400
    r = c.post("/api/auth/developer", json={"code": "test-dev-code"})
    assert r.status_code == 200 and r.json()["is_developer"] is True


# --- email links --------------------------------------------------------------

def test_email_link_shown_without_a_mail_server_outside_production(monkeypatch):
    monkeypatch.delenv("DEV_SHOW_EMAIL_LINKS", raising=False)
    monkeypatch.setenv("APP_ENV", "development")
    assert "dev_link" in _signup(new_client(), _email()).json()
    monkeypatch.setenv("APP_ENV", "production")
    assert "dev_link" not in _signup(new_client(), _email()).json()


def test_mail_failure_is_logged_not_raised(monkeypatch, caplog):
    from src import mailer

    def boom(*_):
        raise OSError("mail server down")

    monkeypatch.setattr(mailer, "_smtp_send", boom)
    mailer._deliver("x@example.com", "Subject", "text", "<p>html</p>")
    assert "failed" in caplog.text


def test_developer_code_completes_an_unconfirmed_account_but_never_a_confirmed_one():
    c = new_client()
    email = _email()
    _signup(c, email)  # never confirmed
    r = c.post(
        "/api/auth/signup",
        json={"name": "Dev Person", "email": email, "password": "Mango#Tree42", "accept_privacy": True, "accept_terms": True, "developer_code": "test-dev-code"},
    )
    assert r.status_code == 200 and r.json()["developer"] is True
    assert c.post("/api/auth/login", json={"email": email, "password": "Mango#Tree42"}).status_code == 200
    # Now confirmed: the code can't reset it again.
    again = new_client().post(
        "/api/auth/signup",
        json={"name": "Someone", "email": email, "password": "Other#Pass77", "accept_privacy": True, "accept_terms": True, "developer_code": "test-dev-code"},
    )
    assert again.status_code == 409


def test_email_links_are_hidden_unless_development(monkeypatch):
    monkeypatch.delenv("DEV_SHOW_EMAIL_LINKS", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    # No APP_ENV (a deploy that forgot it): a reset link must never come back in the response.
    email = _email()
    _signup(new_client(), email)
    assert "dev_link" not in new_client().post("/api/auth/forgot-password", json={"email": email}).json()


def test_confirmation_and_reset_emails_are_rate_limited():
    email = _email()
    _signup(new_client(), email)
    links = [new_client().post("/api/auth/forgot-password", json={"email": email}).json().get("dev_link") for _ in range(5)]
    assert all(links[:3]) and not any(links[3:])


def test_blank_names_are_refused():
    r = new_client().post(
        "/api/auth/signup",
        json={"name": "   ", "email": _email(), "password": PASSWORD, "accept_privacy": True, "accept_terms": True},
    )
    assert r.status_code == 422
