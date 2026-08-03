"""State schema and reducers generated from the canonical graph channels."""

from __future__ import annotations

import json
import operator
from typing import Annotated, Any, TypedDict

from .graph_spec import GraphSpec, load_graph_spec


def append_values(left: list[Any] | None, right: list[Any] | Any | None) -> list[Any]:
    """Reducer-compatible list concatenation used by append channels."""

    left_items = list(left or [])
    if right is None:
        return left_items
    if isinstance(right, list):
        return left_items + right
    return left_items + [right]


def _finding_key(finding: dict[str, Any]) -> str:
    for field in ("dedupe_key", "finding_id", "id"):
        value = finding.get(field)
        if value:
            return str(value)
    return json.dumps(finding, sort_keys=True, default=str)


def _resource_key(resource: Any) -> str:
    if isinstance(resource, dict):
        return str(resource.get("resource_id") or resource.get("id") or json.dumps(resource, sort_keys=True, default=str))
    return str(resource)


def _merge_one(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = {**base, **incoming}
    by_id: dict[str, Any] = {}
    for resource in base.get("affected_resources") or []:
        by_id[_resource_key(resource)] = resource
    for resource in incoming.get("affected_resources") or []:
        by_id.setdefault(_resource_key(resource), resource)
    resources = list(by_id.values())
    if resources:
        merged["affected_resources"] = resources
        merged["affected_count"] = len(resources)
    return merged


def merge_findings(left: list[dict[str, Any]] | None, right: list[dict[str, Any]] | dict[str, Any] | None) -> list[dict[str, Any]]:
    """Deduplicate and merge findings by key, unioning affected resources."""

    merged: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    def add(finding: dict[str, Any]) -> None:
        key = _finding_key(finding)
        if key not in merged:
            order.append(key)
            merged[key] = {**finding, "affected_resources": list(finding.get("affected_resources") or [])}
            if merged[key].get("affected_resources"):
                merged[key]["affected_count"] = len(merged[key]["affected_resources"])
            return
        merged[key] = _merge_one(merged[key], finding)

    for item in left or []:
        if isinstance(item, dict):
            add(item)
    if isinstance(right, dict):
        add(right)
    else:
        for item in right or []:
            if isinstance(item, dict):
                add(item)
    return [merged[key] for key in order]


def annotation_for(channel_meta: dict[str, Any]) -> Any:
    reducer = channel_meta.get("reducer", "last")
    if reducer == "append":
        return Annotated[list[Any], operator.add]
    if reducer == "merge_findings":
        return Annotated[list[dict[str, Any]], merge_findings]
    json_type = channel_meta.get("type")
    if json_type == "array":
        return list[Any]
    if json_type == "number":
        return float | int
    if json_type == "boolean":
        return bool
    if isinstance(json_type, list) and "boolean" in json_type and "null" in json_type:
        return bool | None
    if json_type == "string":
        return str
    return dict[str, Any]


def build_state_schema(spec: GraphSpec | None = None) -> type[TypedDict]:
    """Build a TypedDict state class with reducer annotations from the graph spec."""

    graph_spec = spec or load_graph_spec()
    annotations = {name: annotation_for(dict(meta)) for name, meta in graph_spec.channels.items()}
    annotations["_roster_item"] = dict[str, Any]
    return TypedDict("RedTeamState", annotations, total=False)  # type: ignore[misc]
