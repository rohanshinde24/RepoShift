from reposhift.benchmark import summarize


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
    assert result["latencyMs"]["median"] == 100
    assert result["tokens"] == 50
