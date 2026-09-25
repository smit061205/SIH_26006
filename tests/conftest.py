import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Accounts live in a throwaway database for the test run, and password hashing
# uses a lower scrypt cost so the suite stays fast.
os.environ.setdefault("AUTH_DB_URL", f"sqlite:///{tempfile.mkdtemp(prefix='fw-test-')}/app.db")
os.environ.setdefault("SCRYPT_LOG_N", "12")
os.environ["DEV_SHOW_EMAIL_LINKS"] = "1"
# Set (not removed), so a local .env can never switch on real mail or change the code in tests.
os.environ["SMTP_HOST"] = ""
os.environ["BREVO_API_KEY"] = ""
os.environ["APP_ENV"] = "test"
os.environ["DEVELOPER_ACCESS_CODE"] = "test-dev-code"
# The password-account flows are off in production (live demo only); the tests keep them covered.
os.environ["PASSWORD_ACCOUNTS"] = "1"

import pytest

from src.data_loader import (
    load_cost_assumptions,
    load_gangavaram_tariff,
    load_origin_transit_days,
    load_plants,
    load_ports,
    load_port_to_plant_rail,
    load_vessel_classes,
)


@pytest.fixture(scope="session")
def ports_df():
    return load_ports()


@pytest.fixture(scope="session")
def vessels_df():
    return load_vessel_classes()


@pytest.fixture(scope="session")
def plants_df():
    return load_plants()


@pytest.fixture(scope="session")
def rail_df():
    return load_port_to_plant_rail()


@pytest.fixture(scope="session")
def origin_transit_df():
    return load_origin_transit_days()


@pytest.fixture(scope="session")
def cost_assumptions():
    return load_cost_assumptions()


@pytest.fixture(scope="session")
def tariff_df():
    return load_gangavaram_tariff()


@pytest.fixture(scope="session")
def default_origin(origin_transit_df):
    return origin_transit_df["origin"].iloc[0]


@pytest.fixture(scope="session")
def default_plant(plants_df):
    return plants_df["name"].iloc[0]


@pytest.fixture(autouse=True)
def _fresh_network_limit():
    """Every test client shares one address; start each test with a clean per-network limit."""
    from backend import auth

    auth._ip_attempts.clear()
    auth._mail_attempts.clear()
    auth._demo_attempts.clear()
    yield
