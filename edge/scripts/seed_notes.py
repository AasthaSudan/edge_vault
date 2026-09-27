"""Seed 200 synthetic maintenance notes to test hybrid search accuracy & p95 latency."""
import sys
import random
import time
from pathlib import Path

# Add edge package root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from edge.memory import service

ASSET_TYPES = [
    ("P-101", "centrifugal pump"),
    ("P-200", "slurry pump"),
    ("P-305", "cooling water pump"),
    ("C-12", "reciprocating compressor"),
    ("C-14", "screw compressor"),
    ("T-501", "distillation tower"),
    ("M-7", "drive motor 75kW"),
    ("V-102", "pressure relief valve"),
    ("B-400", "industrial boiler"),
    ("E-210", "shell and tube heat exchanger"),
]

ISSUES = [
    "cavitation noise under heavy suction load",
    "excessive vibration after bearing replacement",
    "bearing temperature exceeding 85 degrees Celsius",
    "intermittent oil leak from mechanical seal gland",
    "tripped on high discharge pressure during morning shift",
    "loose electrical terminal causing voltage imbalance",
    "impeller wear detected during scheduled vibration analysis",
    "clogged intake suction strainer restricting flow",
    "abnormal humming sound coming from stator housing",
    "shaft misalignment detected with laser alignment tool",
]

RESOLUTIONS = [
    "replaced worn impeller with stainless steel upgrade; vibration back within normal tolerances.",
    "performed precision laser alignment and torqued mounting bolts to 120 Nm.",
    "re-packed gland seal with Teflon packing rings and replaced degraded gasket.",
    "cleaned clogged suction filter mesh; differential pressure returned to 0.2 bar.",
    "flushed contaminated synthetic lubricant and replaced secondary oil filter element.",
    "replaced drive-end spherical roller bearing and greased with high-temp lithium grease.",
    "tightened terminal lugs to 25 Nm; phase current balance restored.",
    "calibrated pressure relief valve setting to 12.5 bar release threshold.",
    "inspected internal vanes and cleared debris lodged in the diffuser.",
    "adjusted V-belt tension to 45 Hz using acoustic belt tension meter.",
]

def generate_notes(count: int = 200):
    print(f"Generating and seeding {count} maintenance records...")
    t0 = time.perf_counter()

    # Anchor key notes for verification tests
    service.create(
        text="P-200 cavitation noise fixed by replacing the worn impeller; inspect inlet pipe clearance on next shift.",
        title="P-200 Impeller Replacement",
        asset_tag="P-200",
        category="shareable"
    )
    service.create(
        text="Significant pump vibration after bearing change observed on P-200; realignment of coupling resolved vibration issue.",
        title="P-200 Vibration After Bearing Change",
        asset_tag="P-200",
        category="shareable"
    )
    service.create(
        text="Gate code for the Noida plant is 4431; do not share outside the authorized maintenance roster.",
        title="Noida Facility Access",
        asset_tag="",
        category="private"
    )
    service.create(
        text="C-14 trips on high temp when the intake filter is clogged; thorough cleaning fixed compressor trip.",
        title="C-14 Intake Filter Fix",
        asset_tag="C-14",
        category="shareable"
    )

    created_count = 4
    for i in range(count - 4):
        tag, asset_name = random.choice(ASSET_TYPES)
        issue = random.choice(ISSUES)
        fix = random.choice(RESOLUTIONS)
        category = "shareable" if random.random() > 0.35 else "private"

        text = f"{tag} ({asset_name}) experienced {issue}. Technician action: {fix} Note logged for shift record #{i+1}."
        title = f"{tag} Maintenance #{i+1}"
        service.create(text=text, title=title, asset_tag=tag, category=category)
        created_count += 1
        if created_count % 50 == 0:
            print(f"  -> Seeded {created_count}/{count} notes...")

    t_total = time.perf_counter() - t0
    print(f"Successfully seeded {created_count} notes in {t_total:.2f} seconds!")

if __name__ == "__main__":
    count = 200
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        count = int(sys.argv[1])
    generate_notes(count)
