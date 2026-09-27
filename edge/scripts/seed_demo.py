"""Seed rehearsed industrial maintenance notes for Device A and Device B."""
import sys
from pathlib import Path

# Add edge package root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from edge.config import settings
from edge.memory import service

def seed():
    print(f"Seeding rehearsed demo memories for {settings.device_id}...")

    # Shared pre-seeded memory M1 (for concurrent offline conflict demo)
    service.create(
        text="M-1: Inspect synthetic lubricant level and replace secondary filter on pump P-200 every 500 hours.",
        title="P-200 Standard Lubrication Procedure",
        asset_tag="P-200",
        category="shareable"
    )

    # Initial baseline knowledge
    service.create(
        text="C-14 screw compressor oil pressure should maintain 4.5 bar during full load operation.",
        title="C-14 Operating Pressure Baseline",
        asset_tag="C-14",
        category="shareable"
    )

    print(f"Rehearsed demo data successfully seeded for {settings.device_id}!")

if __name__ == "__main__":
    seed()
