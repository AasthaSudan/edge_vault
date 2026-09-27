import re

RULES = {
    "phone": re.compile(r"(?:\+91[\s-]?)?[6-9]\d{9}\b|\+\d{1,3}[\s-]?\d{6,12}"),
    "email": re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),
    "access_code": re.compile(r"\b(gate|door|lock|alarm|wifi|site)\s*(code|pin|password|pwd)\b\D{0,12}\w{3,}", re.I),
    "password": re.compile(r"\b(password|passcode|pin|otp)\b\s*[:=is]*\s*\S+", re.I),
    "id_number": re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b"),  # 12-digit number (Aadhaar / employee ID format)
    "money": re.compile(r"(rs\.?|inr|₹|\$)\s?\d[\d,]*", re.I),
    "address": re.compile(r"\b(flat|house|plot)\s*(no\.?|number)\s*\w+", re.I),
}

def scan(text: str) -> list[str]:
    return [name for name, rx in RULES.items() if rx.search(text)]
