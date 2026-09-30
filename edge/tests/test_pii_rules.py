"""The deterministic PII floor (edge/gate/pii.py).

The rules are the only barrier on paths that skip the LLM: a note created as "shareable",
an edit, a manual category override, an approved suggestion and the egress guard. So they
are tested in both directions: real identifiers must be flagged, and ordinary maintenance
language must stay clean (a false positive stops a technician from sharing a valid note).
"""
import pytest
from edge.gate import pii

MUST_FLAG = [
    # phone numbers in the formats people actually type
    "call Suresh +91 98765 43210", "reach me on 98765 43210", "phone 987-654-3210", "555-123-4567",
    "+1 555 123 4567", "+44 20 7946 0958", "(555) 123-4567", "call 9876543210", "+919876543210",
    # payment cards / 12-digit IDs, contiguous or grouped
    "card 4111111111111111", "card 4111-1111-1111-1111", "card 4111 1111 1111 1111", "id 1234-5678-9012", "id 123456789012",
    # credentials and codes
    "Control room access code is PIN 8492.", "password is TechSecret2026", "otp 123456", "pin: 9842", "passwd=abc",
    "Gate code for Noida plant is 4431",
    # a credential a few words after the keyword (this one was vetoed by the original rule; the gate eval relies on it)
    "Security pin for terminal login is admin4491.", "The pin code for the panel is 4471#", "otp was sent: 908712",
    # money
    "Rs 500 for parts", "Rs.500", "INR 5000", "$500", "cost was 500 rupees", "paid 500 USD",
    # people
    "Guard Ramesh cleared debris", "Manager: Amit approved", "Supervisor - Amit signed off",
    "email me at tech@example.com",
]

MUST_STAY_CLEAN = [
    # "pin" is a mechanical part, "rs" ends many words
    "Replaced the worn clevis pin on the coupling", "The locating pin was sheared; fitted a new one.",
    "Pin hole on the flange gasket sealed", "Replaced sensors 4 and 5 on the line", "Checked breakers 2 and 3",
    "Replaced clevis pin 3 and 4 on the M12 coupling", "Fitted a new locating pin, torque 25 Nm",
    # measurements, dates, versions, addresses of machines
    "Torque set to 25 Nm at 4.5 bar", "Motor ran at 1200 1500 rpm range", "2026-03-02 10:15 inspection",
    "Server 192.168.1.100 unreachable", "Part 12345-A replaced, serial 6123", "Flushed with ISO 46 lube every 500 hours",
    "Pressure test pass: 45 psi held", "Fault code 4032 on VFD cleared after resetting.",
    # equipment language that resembles a role + name
    "Tightened lock nut on pump shaft to 120 Nm.", "Operator Panel B display replaced.", "Customer Service module restarted.",
]


@pytest.mark.parametrize("text", MUST_FLAG)
def test_sensitive_text_is_flagged(text):
    assert pii.scan(text), f"PII slipped through: {text!r}"


@pytest.mark.parametrize("text", MUST_STAY_CLEAN)
def test_ordinary_maintenance_text_is_clean(text):
    assert pii.scan(text) == [], f"false positive on: {text!r} -> {pii.scan(text)}"
