from redteam_langgraph.state import append_values, merge_findings


def test_merge_findings_dedupes_and_unions_resources():
    first = [
        {
            "dedupe_key": "AZ-1",
            "severity": "medium",
            "title": "old",
            "affected_resources": [{"resource_id": "/r/1"}],
        }
    ]
    second = [
        {
            "dedupe_key": "AZ-1",
            "severity": "high",
            "title": "new",
            "affected_resources": [{"resource_id": "/r/1"}, {"resource_id": "/r/2"}],
        },
        {"dedupe_key": "AZ-2", "affected_resources": []},
    ]

    merged = merge_findings(first, second)

    assert len(merged) == 2
    assert merged[0]["severity"] == "high"
    assert merged[0]["title"] == "new"
    assert merged[0]["affected_count"] == 2
    assert [r["resource_id"] for r in merged[0]["affected_resources"]] == ["/r/1", "/r/2"]


def test_append_values_concatenates_lists_and_scalars():
    assert append_values(["a"], ["b", "c"]) == ["a", "b", "c"]
    assert append_values(["a"], "b") == ["a", "b"]
