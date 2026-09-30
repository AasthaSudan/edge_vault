"""Tests must never write into a real device's data.

Without this, `pytest edge/tests` on a developer machine picks up DEVICE_ID=device-a from .env and
creates test notes, outbox rows and chat sessions in the live device. A test run uses a throwaway
device unless one is chosen explicitly (CI sets DEVICE_ID; `make test-unit` uses "unit-tests").
Set before any `edge` module is imported, because the shards open at import time.
"""
import os

os.environ.setdefault("DEVICE_ID", "unit-tests")
