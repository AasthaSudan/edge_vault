import re

RULES = {
    "phone": re.compile(r"(?:\+91[\s-]?)?[6-9]\d{9}\b|\+\d{1,3}[\s-]?\d{6,12}"),
    "email": re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),
    "access_code": re.compile(r"\b(gate|door|lock|alarm|wifi|site)\s*(code|pin|password|pwd)\b\D{0,12}\w{3,}", re.I),
    "password": re.compile(r"\b(password|passcode|pin|otp)\b\s*[:=is]*\s*\S+", re.I),
    "id_number": re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b"),  # 12-digit number (Aadhaar / employee ID format)
    "money": re.compile(r"(rs\.?|inr|₹|\$)\s?\d[\d,]*", re.I),
    "address": re.compile(r"\b(flat|house|plot)\s*(no\.?|number)\s*\w+", re.I),
    # Combinations and keypad codes: "combination lock is set to 8821", "keypad 4471#"
    "lock_combination": re.compile(
        r"\b(combination|keypad|padlock|locker)\b[^.\n]{0,30}?\b\d{3,8}\b"
        r"|\block\s+(is\s+)?(set\s+to|code|combo)\b[^.\n]{0,12}\d{3,8}", re.I),
    # A role followed by a name: "Guard Ramesh", "Manager Amit", "Mr. Shah" (case-sensitive name)
    "named_person": re.compile(
        r"\b(?i:guard|supervisor|manager|foreman|operator|technician|engineer|customer|client"
        r"|vendor|contractor|driver|inspector|plant head|site head|mr|mrs|ms|dr)\.?\s+"
        r"(?!(?:Panel|Service|Station|Interface|Terminal|Console|Room|Portal|Screen|Module|Area|Unit"
        r"|Side|Cabin|Desk|Seat|Controls?|Mode|Manual|Guide|Training|Access|Support|Level)\b)[A-Z][a-z]{2,}\b"),
    # Requests to hide something: a note carrying one must never reach the fleet as-is
    "sensitive_request": re.compile(
        r"\b(confidential|off the record|between us"
        r"|keep\s+(it|this|that|the\s+\w+)\s+(quiet|secret|confidential|hush)"
        r"|(do not|don't|dont)\s+(disclose|tell|mention|report))\b", re.I),
}

def scan(text: str) -> list[str]:
    return [name for name, rx in RULES.items() if rx.search(text)]
