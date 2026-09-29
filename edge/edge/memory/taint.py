RESTRICTIVENESS = {"shareable": 0, "routine": 1, "private": 2}


def inherited_floor(source_categories: list[str]) -> str:
    """The least-restrictive category a derived memory may have."""
    if not source_categories:
        return "shareable"
    worst = max(source_categories, key=lambda c: RESTRICTIVENESS.get(c, 2))
    return "private" if worst in ("private", "routine") else "shareable"
