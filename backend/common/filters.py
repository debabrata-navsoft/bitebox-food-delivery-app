"""
Multi-value list filters and facet counts for the admin lists (the admin app's "Filters" panel).

A list adopts them in three steps:

1. Its query serializer inherits `FacetQuery` (adds `?facets=1`) and declares each filter as a
   `MultiValueField` (`status=active,suspended` → `["active", "suspended"]`; one value works as
   before; an invalid item is a 422 "Invalid value" on that field; empty items are ignored).
2. Its service declares its `Facet`s and builds the filtered queryset with a pure `build(query)`
   function that calls `apply_facets(qs, query, FACETS)`: each facet is also the filter of the
   same name, its values combined with OR; filters combine with AND.
3. It returns `with_facets(result, query, build, FACETS)`: without `facets=1` the result is
   unchanged (no extra queries); with it, `data.facets` gets `{name: [{value, count}, ...]}`,
   each counted in the database (one query per facet) over `build(query without that facet's
   own selection)` — standard faceted search.

Fixed-value facets (`values=`) list every value in that order, 0 when none match. Open-value
facets (no `values`) list the values that occur, by count (desc) then name, at most `limit`.
A facet counts by grouping on `field` (a model path), or, for values that overlap or need custom
rules, by one conditional count per value (`cases={value: Q}`, one query).
Id facets (`label=` a path to the name, e.g. "restaurant__name") give `{value: id, label, count}`
ordered by count then label; `elements=True` counts each string of a JSON array field once per
row (a restaurant under each of its cuisines).
"""

import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection
from django.db.models import Count, F, Min, Q, QuerySet
from django.db.models.functions import Collate, Lower, Trim
from drf_spectacular.utils import OpenApiParameter, inline_serializer
from rest_framework import serializers

from common.schema import envelope, pagination

INVALID = "Invalid value"
MAX_VALUES = 50
OPEN_FACET_LIMIT = 50


class MultiValueField(serializers.Field):
    """
    A comma-separated list filter → a list of distinct values (in the order given; [] when every
    item is empty). With `choices`, each item must be one of them; without, each is free text,
    trimmed, at most `max_length` characters. More than `max_values` items is "Invalid value".
    """

    default_error_messages = {"invalid": INVALID}

    def __init__(
        self,
        *,
        choices: Iterable[str] | None = None,
        max_length: int = 60,
        max_values: int = MAX_VALUES,
        **kwargs: Any,
    ) -> None:
        kwargs.setdefault("required", False)
        super().__init__(**kwargs)
        self.choices = None if choices is None else [str(c) for c in choices]
        self.max_length = max_length
        self.max_values = max_values

    def to_internal_value(self, data: Any) -> list[str]:
        if not isinstance(data, str):
            self.fail("invalid")
        values: list[str] = []
        for item in (part.strip() for part in data.split(",")):
            if not item:
                continue
            if len(item) > self.max_length or (
                self.choices is not None and item not in self.choices
            ):
                self.fail("invalid")
            if item not in values:
                values.append(item)
        if len(values) > self.max_values:
            self.fail("invalid")
        return values

    def to_representation(self, value: Any) -> Any:
        return value


class MultiIdField(MultiValueField):
    """A comma-separated list of ids (restaurant=<id>,<id>) → distinct UUIDs; any bad one is
    "Invalid value". `keywords` (e.g. "me", "unassigned") are also accepted, kept as text."""

    def __init__(self, *, keywords: Sequence[str] = (), **kwargs: Any) -> None:
        super().__init__(max_length=36, **kwargs)
        self.keywords = keywords

    def to_internal_value(self, data: Any) -> list[Any]:
        ids: list[Any] = []
        for item in super().to_internal_value(data):
            value: Any = item
            if item not in self.keywords:
                try:
                    value = uuid.UUID(item)
                except ValueError:
                    self.fail("invalid")
            if value not in ids:
                ids.append(value)
        return ids


def multi_choice(choices: Iterable[str]) -> MultiValueField:
    """An optional enum filter taking one or several comma-separated values."""
    return MultiValueField(choices=choices)


class FacetQuery(serializers.Serializer):
    """`?facets=1`: also return the facet counts (`data.facets`)."""

    facets = serializers.BooleanField(
        required=False, default=False, error_messages={"invalid": INVALID}
    )


def any_of(values: Iterable[str], to_q: Callable[[str], Q]) -> Q:
    """OR of `to_q(value)` over the values (a filter with several values)."""
    match = Q(pk__in=[])
    for value in values:
        match |= to_q(value)
    return match


def text_search(search: str | None, *fields: str) -> Q:
    """Rows with `search` (trimmed, any letter case) in one of `fields`; everything without."""
    if not (search := (search or "").strip()):
        return Q()
    return any_of(fields, lambda field: Q(**{f"{field}__icontains": search}))


def day_start(day: date) -> datetime:
    """Midnight of a calendar day in the report time zone."""
    return datetime.combine(day, time.min, tzinfo=ZoneInfo(settings.REPORT_TIMEZONE))


def days_between(query: Mapping[str, Any], name: str, field: str = "created_at") -> Q:
    """`<name>_from` / `<name>_to`: whole calendar days (inclusive) in the report time zone."""
    match = Q()
    if start := query.get(f"{name}_from"):
        match &= Q(**{f"{field}__gte": day_start(start)})
    if end := query.get(f"{name}_to"):
        match &= Q(**{f"{field}__lt": day_start(end + timedelta(days=1))})
    return match


def _binary(expr: Any) -> Collate:
    """Compared by code point, so of a value's spellings the label is the one GET /cities shows
    (accounts.admin_services.distinct_names: "Mysuru" before "mysuru")."""
    return Collate(expr, "C" if connection.vendor == "postgresql" else "BINARY")


@dataclass(frozen=True)
class Facet:
    """
    One facet of a list, and the list filter of the same name. `name` is the query key
    (snake_case; rendered camelCase). Count by grouping on `field` (default: `name`), or with
    `cases` (value → Q, one conditional count each). `values`: the fixed values, in order (None:
    open values, by count). `ignore_case` groups open values by their trimmed, lower-cased text
    (shown as one of the stored spellings). The filter keeps rows whose `field` is one of the
    values (`ignore_case`: equal after trimming, any letter case), or that match one of the
    values' `cases`; `match` (values → Q) replaces that rule. `per`: what a count counts (e.g.
    "order_id": the distinct orders of the rows; default the rows).
    """

    name: str
    values: Sequence[str] | None = None
    field: str | None = None
    cases: Mapping[str, Q] | None = None
    ignore_case: bool = False
    limit: int = OPEN_FACET_LIMIT
    exclude: Sequence[str] = ("",)
    label: str | None = None
    elements: bool = False
    match: Callable[[list[Any]], Q] | None = None
    per: str = "pk"

    @property
    def path(self) -> str:
        return self.field or self.name

    def _tally(self, **kwargs: Any) -> Count:
        return Count(self.per, distinct=self.per != "pk", **kwargs)

    def filter(self, qs: QuerySet[Any], values: list[Any]) -> QuerySet[Any]:
        """The rows matching any of `values` (this facet's list filter)."""
        if self.match is not None:
            return qs.filter(self.match(values))
        if self.cases is not None:
            return qs.filter(any_of(values, self.cases.__getitem__))
        if self.ignore_case:
            alias = f"{self.path.replace('__', '_')}_trimmed"
            return qs.alias(**{alias: Trim(self.path)}).filter(
                any_of(values, lambda v: Q(**{f"{alias}__iexact": v}))
            )
        return qs.filter(**{f"{self.path}__in": values})

    def count(self, qs: QuerySet[Any]) -> list[dict[str, Any]]:
        qs = qs.order_by()
        if self.elements:
            return self._count_elements(qs)
        if self.label is not None:
            return self._count_ids(qs)
        if self.cases is not None:
            keys = {f"facet_{i}": v for i, v in enumerate(self.cases)}
            totals = qs.aggregate(**{k: self._tally(filter=self.cases[v]) for k, v in keys.items()})
            counts = {v: totals[k] or 0 for k, v in keys.items()}
            return self._fixed(counts) if self.values is not None else self._open(counts)
        expr = F(self.path)
        if self.ignore_case:
            rows = (
                qs.annotate(facet_key=Lower(Trim(expr)))
                .exclude(facet_key__isnull=True)
                .exclude(facet_key__in=list(self.exclude))
                .values("facet_key")
                .annotate(facet_label=Min(_binary(Trim(expr))), facet_count=self._tally())
                .order_by("-facet_count", "facet_key")[: self.limit]
            )
            return [{"value": r["facet_label"], "count": r["facet_count"]} for r in rows]
        grouped = (
            qs.annotate(facet_key=expr)
            .exclude(facet_key__isnull=True)
            .values("facet_key")
            .annotate(facet_count=self._tally())
        )
        if self.values is not None:
            grouped = grouped.filter(facet_key__in=list(self.values))
            return self._fixed({r["facet_key"]: r["facet_count"] for r in grouped})
        rows = grouped.exclude(facet_key__in=list(self.exclude)).order_by(
            "-facet_count", "facet_key"
        )[: self.limit]
        return [{"value": r["facet_key"], "count": r["facet_count"]} for r in rows]

    def _count_ids(self, qs: QuerySet[Any]) -> list[dict[str, Any]]:
        """Open id values with their name (`label`), by count then name."""
        rows = (
            qs.annotate(facet_key=F(self.path))
            .exclude(facet_key__isnull=True)
            .values("facet_key")
            .annotate(facet_count=self._tally(), facet_label=Min(self.label))
            .order_by("-facet_count", "facet_label", "facet_key")[: self.limit]
        )
        return [
            {"value": str(r["facet_key"]), "label": r["facet_label"], "count": r["facet_count"]}
            for r in rows
        ]

    def _count_elements(self, qs: QuerySet[Any]) -> list[dict[str, Any]]:
        """Each trimmed, non-empty string of a JSON array column counted once per row
        (PostgreSQL), by count then name; `ignore_case` merges letter cases as above."""
        meta = qs.model._meta
        quote = connection.ops.quote_name
        table, pk = quote(meta.db_table), quote(meta.pk.column)
        column = quote(meta.get_field(self.path).column)
        inner, params = qs.values("pk").query.sql_with_params()
        item = "btrim(e.value)"
        key = f"lower({item})" if self.ignore_case else item
        sql = (
            f'SELECT min({item} COLLATE "C"), count(DISTINCT t.{pk}) AS n '  # noqa: S608 (names)
            f"FROM {table} t CROSS JOIN LATERAL jsonb_array_elements_text(t.{column}) e(value) "
            f"WHERE t.{pk} IN ({inner}) AND {item} <> '' "
            f"GROUP BY {key} ORDER BY n DESC, {key} LIMIT %s"
        )
        with connection.cursor() as cursor:
            cursor.execute(sql, [*params, self.limit])
            rows = cursor.fetchall()
        return [{"value": value, "count": n} for value, n in rows]

    def _fixed(self, counts: Mapping[str, int]) -> list[dict[str, Any]]:
        return [{"value": v, "count": counts.get(v, 0)} for v in self.values or ()]

    def _open(self, counts: Mapping[str, int]) -> list[dict[str, Any]]:
        ordered = sorted(((v, n) for v, n in counts.items() if n), key=lambda p: (-p[1], p[0]))
        return [{"value": v, "count": n} for v, n in ordered[: self.limit]]


def apply_facets(
    qs: QuerySet[Any], query: Mapping[str, Any], specs: Sequence[Facet]
) -> QuerySet[Any]:
    """`qs` narrowed by the filter of each facet that the query sets (filters combine with AND)."""
    for spec in specs:
        if query.get(spec.name):
            qs = spec.filter(qs, query[spec.name])
    return qs


def facets(
    build: Callable[[dict[str, Any]], QuerySet[Any]],
    query: Mapping[str, Any],
    specs: Sequence[Facet],
) -> dict[str, list[dict[str, Any]]]:
    """Each facet counted over `build(query)` minus that facet's own selection."""
    return {spec.name: spec.count(build({**query, spec.name: None})) for spec in specs}


def with_facets(
    result: dict[str, Any],
    query: Mapping[str, Any],
    build: Callable[[dict[str, Any]], QuerySet[Any]],
    specs: Sequence[Facet],
) -> dict[str, Any]:
    """`result` plus `facets` when the request asked for them (`?facets=1`)."""
    if query.get("facets"):
        result["facets"] = facets(build, query, specs)
    return result


# --- OpenAPI ---------------------------------------------------------------------------------
FACETS_PARAM = OpenApiParameter(
    "facets", bool, description="1: also return `facets`, the count each filter option would give"
)


def page_params(search: str = "") -> list[Any]:
    """`page`, `limit` and `search` (described by `search`)."""
    return [
        OpenApiParameter("page", int),
        OpenApiParameter("limit", int),
        OpenApiParameter("search", str, description=search),
    ]


def day_params(name: str) -> list[Any]:
    """`<name>From` / `<name>To`: whole days in the report time zone (JoinedListQuery)."""
    return [
        OpenApiParameter(f"{name}From", str, description="YYYY-MM-DD (report time zone)"),
        OpenApiParameter(f"{name}To", str, description="YYYY-MM-DD, inclusive"),
    ]


def list_params(search: str, *filters: Any, days: str | None = None) -> list[Any]:
    """A faceted list's parameters: page_params(search), `filters`, day_params(days), `facets`."""
    return [*page_params(search), *filters, *(day_params(days) if days else ()), FACETS_PARAM]


MULTI_NOTE = "Several values in one filter: any of them; filters combine with AND."


def multi_param(name: str, values: Sequence[str] | None = None, description: str = "") -> Any:
    """A filter taking one or several comma-separated values (`status=active,suspended`)."""
    text = "One or more, comma-separated (OR)"
    return OpenApiParameter(
        name,
        str,
        enum=list(values) if values is not None else None,
        many=True,
        style="form",
        explode=False,
        description=f"{text}. {description}" if description else text,
    )


class FacetCount(serializers.Serializer):
    """One option of a facet: its value and how many rows it would give."""

    value = serializers.CharField()
    count = serializers.IntegerField()


# One option of an id facet: the id, its name and how many rows it would give. (Declared inline:
# a serializer attribute named `label` would clash with Field.label.)
LabelledFacetCount = inline_serializer(
    name="LabelledFacetCount",
    fields={
        "value": serializers.CharField(),
        "label": serializers.CharField(),
        "count": serializers.IntegerField(),
    },
).__class__


def facets_schema(name: str, specs: Sequence[Facet]) -> Any:
    """The OpenAPI shape of `data.facets` for a list (present only with `?facets=1`)."""
    return inline_serializer(
        name=name,
        fields={
            spec.name: (LabelledFacetCount if spec.label else FacetCount)(many=True)
            for spec in specs
        },
        required=False,
        help_text="Only with ?facets=1: per filter, the count each option would give",
    )


def facets_page(
    name: str, specs: Sequence[Facet], items: Any = None, paging: Any = None, **fields: Any
) -> Any:
    """
    The OpenAPI envelope `<name>` ("CustomerPage") of a paged admin list with facets
    (`<name without Page>Facets`). `items` defaults to free-form objects, `paging` to a
    `<name>Pagination` component; `fields` are extra `data` fields.
    """
    return envelope(
        name,
        inline_serializer(
            name=f"{name}Data",
            fields={
                "items": serializers.ListField(child=serializers.JSONField())
                if items is None
                else items,
                "pagination": pagination(f"{name}Pagination") if paging is None else paging,
                **fields,
                "facets": facets_schema(f"{name.removesuffix('Page')}Facets", specs),
            },
        ),
    )
