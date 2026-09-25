"""A TestClient that is signed in, the way the web app is: through the real
sign-up, verification and sign-in endpoints, not by bypassing the check."""
import secrets

from fastapi.testclient import TestClient

from backend.main import app

HEADERS = {"X-Requested-With": "freightwise"}
PASSWORD = "Harbour-lantern9"


def new_client() -> TestClient:
    return TestClient(app, headers=HEADERS)


def signed_in_client(email: str | None = None, password: str = PASSWORD) -> TestClient:
    client = new_client()
    email = email or f"analyst-{secrets.token_hex(4)}@example.com"
    body = client.post(
        "/api/auth/signup",
        json={"name": "Test Analyst", "email": email, "password": password, "accept_privacy": True, "accept_terms": True},
    ).json()
    token = body["dev_link"].split("token=")[1]
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    assert client.post("/api/auth/login", json={"email": email, "password": password}).status_code == 200
    return client
