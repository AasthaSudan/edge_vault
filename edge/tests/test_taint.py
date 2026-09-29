import pytest
from edge.memory.taint import inherited_floor, RESTRICTIVENESS


def test_taint_empty():
    assert inherited_floor([]) == "shareable"


def test_taint_all_shareable():
    assert inherited_floor(["shareable", "shareable"]) == "shareable"


def test_taint_single_private_forces_private():
    assert inherited_floor(["shareable", "private"]) == "private"
    assert inherited_floor(["private"]) == "private"


def test_taint_routine_forces_private():
    # Routine status or time-keeping cannot be promoted to shareable fleet knowledge
    assert inherited_floor(["shareable", "routine"]) == "private"
    assert inherited_floor(["routine"]) == "private"


def test_taint_mixed_sources():
    assert inherited_floor(["shareable", "routine", "private"]) == "private"
