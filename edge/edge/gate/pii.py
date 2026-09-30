import re

RULES = {
    "phone": re.compile(
        r"(?:\+91[\s-]?)?[6-9]\d{9}\b"
        r"|\+\d{1,3}[\s.-]?\d{6,12}"
        r"|\+\d{1,3}[\s.-]?\(?\d{1,5}\)?(?:[\s.-]\d{2,5}){1,4}"        # +91 98765 43210, +44 20 7946 0958
        r"|(?<![\w.-])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w-])"       # 555-123-4567, (555) 123-4567
        r"|(?<![\w.-])[6-9]\d{4}[\s-]\d{5}(?![\w-])"),                  # 98765 43210
    "email": re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),
    "access_code": re.compile(r"\b(gate|door|lock|alarm|wifi|site)\s*(code|pin|password|pwd)\b\D{0,12}\w{3,}", re.I),
    # "pin"/"otp" are also everyday words (clevis pin, locating pin): they only count when something
    # that looks like a secret follows within the clause (4+ digits, or letters with 3+ digits such as
    # "admin4491"), e.g. "PIN 8492", "pin: 9842", "pin for terminal login is admin4491". Small numbers
    # ("pin 3", "M12") are ordinary equipment language. "password"-style words are unambiguous.
    "password": re.compile(
        r"\b(?:password|passwd|passcode|pwd)\b\s*(?:[:=]|\bis\b)?\s*\S+"
        r"|\b(?:pin|otp)\b[^.\n;]{0,40}?(?<![\w-])(?:\d{4,}|[a-z]+\d{3,}\w*|\d{3,}[a-z]\w*)", re.I),
    # 12- or 16-digit numbers, optionally grouped: Aadhaar / employee ID / payment card
    "id_number": re.compile(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}(?:[\s-]?\d{4})?\b"),
    # "rs"/"inr" need a non-letter before them, or "sensors 4" reads as "Rs 4"
    "money": re.compile(
        r"(?<![a-z])(?:rs\.?|inr)\s?\d[\d,]*|[₹$]\s?\d[\d,]*|\b\d[\d,]*\s?(?:rupees?|usd|dollars?)\b", re.I),
    "address": re.compile(r"\b(flat|house|plot)\s*(no\.?|number)\s*\w+", re.I),
    # Combinations and keypad codes: "combination lock is set to 8821", "keypad 4471#"
    "lock_combination": re.compile(
        r"\b(combination|keypad|padlock|locker)\b[^.\n]{0,30}?\b\d{3,8}\b"
        r"|\block\s+(is\s+)?(set\s+to|code|combo)\b[^.\n]{0,12}\d{3,8}", re.I),
    # A role followed by a name: "Guard Ramesh", "Manager Amit", "Mr. Shah" (case-sensitive name)
    "named_person": re.compile(
        r"\b(?i:guard|supervisor|manager|foreman|operator|technician|engineer|customer|client"
        r"|vendor|contractor|driver|inspector|plant head|site head|mr|mrs|ms|dr)\.?(?:\s*[:–-]\s*|\s+)"
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
