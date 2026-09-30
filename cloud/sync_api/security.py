"""Cloud deployment settings and fleet authentication.

Every edge device sends `Authorization: Bearer <FLEET_API_KEY>` on the data endpoints
(push, pull, snapshot, conflict resolution). /health and /stats stay public: they return
counts only, and /stats is the public proof that private_on_server == 0.

EDGEVAULT_ENV=production refuses to start without FLEET_API_KEY, and without an explicit
CORS_ORIGINS list, so a misconfigured deployment fails loudly instead of running open.
"""
import hmac
import os
from fastapi import Header, HTTPException

ENV = os.getenv("EDGEVAULT_ENV", "development").lower()
FLEET_API_KEY = os.getenv("FLEET_API_KEY", "")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
CONFLICTS_DB_PATH = os.getenv("CONFLICTS_DB_PATH", "./data/cloud_conflicts.db")

if ENV == "production":
    if len(FLEET_API_KEY) < 32:
        raise RuntimeError("EDGEVAULT_ENV=production requires FLEET_API_KEY (at least 32 characters).")
    if not CORS_ORIGINS or "*" in CORS_ORIGINS:
        raise RuntimeError("EDGEVAULT_ENV=production requires CORS_ORIGINS set to explicit dashboard origins.")
elif not FLEET_API_KEY:
    print("WARNING: FLEET_API_KEY is not set; the sync API accepts unauthenticated devices (development only).")

if not CORS_ORIGINS:
    CORS_ORIGINS = ["*"]  # development default


def require_fleet_key(authorization: str = Header(default="")) -> None:
    """FastAPI dependency for fleet data endpoints."""
    if not FLEET_API_KEY:
        return  # development mode
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token.encode(), FLEET_API_KEY.encode()):
        raise HTTPException(status_code=401, detail="Invalid or missing fleet API key",
                            headers={"WWW-Authenticate": "Bearer"})
