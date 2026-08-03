from redteam_langgraph.guard import decide


def test_guard_denies_mutating_azure_command():
    result = decide("az vm delete --resource-group rg --name vm --yes")
    assert result["decision"] == "deny"


def test_guard_allows_read_only_azure_command():
    result = decide("az vm list --resource-group rg")
    assert result["decision"] == "allow"


def test_guard_fails_closed_for_empty_command():
    result = decide("")
    assert result["decision"] == "deny"
