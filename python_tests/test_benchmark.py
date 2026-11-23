from datetime import datetime, timedelta, timezone

import pytest

from reposhift.benchmark import (
    attempt_succeeded,
    check_timings,
    paired_summary,
    scheduled_attempts,
    stage_timings,
    summarize,
)


def test_attempt_success_requires_terminal_completion():
    run = {"state": "FAILED", "checkpoint": {"verification": {"passed": True}}}
    assert attempt_succeeded(run) is False
    run["state"] = "CANCELLED"
    assert attempt_succeeded(run) is False
    run["state"] = "COMPLETE"
    assert attempt_succeeded(run) is True


def test_timing_extractors_separate_states_and_runner_checks():
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    events = [
        {"state": "ANALYZE", "at": start + timedelta(milliseconds=5)},
        {"state": "MODEL_USAGE", "at": start + timedelta(milliseconds=20)},
        {"state": "PLAN", "at": start + timedelta(milliseconds=35)},
        {"state": "EXECUTE", "at": start + timedelta(milliseconds=40)},
        {"state": "BUILD", "at": start + timedelta(milliseconds=90)},
        {"state": "TEST", "at": start + timedelta(milliseconds=110)},
        {"state": "REPAIR", "at": start + timedelta(milliseconds=130)},
        {"state": "BUILD", "at": start + timedelta(milliseconds=160)},
        {"state": "COMPLETE", "at": start + timedelta(milliseconds=190)},
    ]
    assert stage_timings(events, start) == {
        "SETUP": 5,
        "ANALYZE": 30,
        "PLAN": 5,
        "EXECUTE": 50,
        "BUILD": 50,
        "TEST": 20,
        "REPAIR": 30,
    }
    artifacts = [
        {"name": "baseline-build", "value": {"code": 0, "durationMs": 12}},
        {"name": "build-0", "value": {"code": 1, "durationMs": 20}},
        {"name": "probe-1", "value": {"durationMs": 8}},
        {"name": "hidden", "value": {"code": 0, "durationMs": 11}},
        {"name": "regression-0", "value": {"durationMs": 99}},
    ]
    assert check_timings(artifacts) == {
        "baseline-build": 12,
        "build-0": 20,
        "probe-1": 8,
        "hidden": 11,
    }


def test_summary_keeps_failures_and_reports_repair_denominator():
    rows = [
        {
            "configuration": "C",
            "task": "one",
            "success": True,
            "delivery": False,
            "latencyMs": 100,
            "initialCheckFailed": True,
            "tokens": 20,
        },
        {
            "configuration": "C",
            "task": "two",
            "success": False,
            "delivery": False,
            "latencyMs": 200,
            "initialCheckFailed": True,
            "tokens": 30,
        },
    ]
    result = summarize(rows)[0]
    assert result["attempts"] == 2
    assert result["successRate"] == 0.5
    assert result["repairEligible"] == 2
    assert result["repairRecovered"] == 1
    assert result["latencyMs"]["median"] == 150
    assert result["tokens"] == 50


def test_paired_summary_keeps_failed_attempts_and_requires_matching_trials():
    rows = [
        {"configuration": "A", "task": "one", "trial": 0, "success": False, "latencyMs": 100},
        {"configuration": "C", "task": "one", "trial": 0, "success": True, "latencyMs": 50},
        {"configuration": "A", "task": "two", "trial": 0, "success": True, "latencyMs": 200},
        {"configuration": "C", "task": "two", "trial": 0, "success": False, "latencyMs": 100},
    ]
    result = paired_summary(rows)
    assert result["pairedAttempts"] == 2
    assert result["distinctTasks"] == 2
    assert result["distinctArchetypes"] == 2
    assert result["baselineSuccesses"] == result["candidateSuccesses"] == 1
    assert result["candidateOnlySuccesses"] == result["baselineOnlySuccesses"] == 1
    assert result["allAttemptMedianLatencyMs"] == {"A": 150, "C": 75}
    assert result["allAttemptMedianReduction"] == 0.5
    with pytest.raises(ValueError, match="requires one A and one C"):
        paired_summary(rows[:-1])


def test_paired_summary_counts_variants_within_their_archetype():
    rows = [
        {
            "configuration": config,
            "task": task,
            "archetype": "shared",
            "trial": 0,
            "success": config == "C",
            "latencyMs": 100,
        }
        for task in ("variant-01", "variant-02")
        for config in ("A", "C")
    ]
    result = paired_summary(rows)
    assert result["distinctTasks"] == 2
    assert result["distinctArchetypes"] == 1
    assert result["byArchetype"] == [
        {"archetype": "shared", "pairedAttempts": 2, "baselineSuccesses": 0, "candidateSuccesses": 2}
    ]


def test_schedule_counterbalances_model_warmup_by_task_and_trial():
    assert list(scheduled_attempts(["A", "C"], ["one", "two"], 2)) == [
        ("A", "one", 0),
        ("C", "one", 0),
        ("C", "one", 1),
        ("A", "one", 1),
        ("C", "two", 0),
        ("A", "two", 0),
        ("A", "two", 1),
        ("C", "two", 1),
    ]
