"""Pregame defender availability. The projection multiplier stays off."""
from build_defense import availability_status, build_week_availability, status_of


def test_status_labels():
    assert status_of('Out') == 'out'
    assert status_of('Doubtful') == 'doubt'
    assert status_of('Questionable') == 'q'
    assert status_of('IR') == 'out'
    assert status_of(None) is None


def test_out_carries_forward_until_he_plays():
    reports = {(2026, 2, 'bosa'): 'out', (2026, 5, 'bosa'): 'q'}
    played = {(2026, 4, 'bosa')}
    assert availability_status(reports, played, 2026, 2, 'bosa') == 'out'
    assert availability_status(reports, played, 2026, 3, 'bosa') == 'out'
    # Week 4 is still pregame: the snap that week is not known yet.
    assert availability_status(reports, played, 2026, 4, 'bosa') == 'out'
    assert availability_status(reports, played, 2026, 5, 'bosa') == 'q'
    assert availability_status(reports, played, 2026, 6, 'bosa') is None


def test_missing_files_leave_availability_empty(tmp_path):
    assert build_week_availability(str(tmp_path), 2026, 6) == {}
