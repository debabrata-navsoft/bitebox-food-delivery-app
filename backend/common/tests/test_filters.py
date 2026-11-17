"""common.filters: the comma-separated multi-value list filter."""

import uuid

import pytest
from rest_framework import serializers

from common.filters import MultiIdField, MultiValueField


def parse(field: MultiValueField, raw: str) -> list[str]:
    return field.to_internal_value(raw)


def test_values_are_trimmed_deduplicated_and_empties_dropped() -> None:
    field = MultiValueField(choices=["a", "b", "c"])
    assert parse(field, "b, a,,b ,") == ["b", "a"]
    assert parse(field, " , ") == []
    assert parse(MultiValueField(), " Lake side ,Hilltop") == ["Lake side", "Hilltop"]


@pytest.mark.parametrize("raw", ["a,z", "A"])
def test_an_item_outside_the_choices_is_invalid(raw: str) -> None:
    with pytest.raises(serializers.ValidationError) as error:
        parse(MultiValueField(choices=["a", "b"]), raw)
    assert error.value.detail == ["Invalid value"]


def test_too_long_items_and_too_many_values_are_invalid() -> None:
    with pytest.raises(serializers.ValidationError):
        parse(MultiValueField(max_length=5), "short,toolong")
    with pytest.raises(serializers.ValidationError):
        parse(MultiValueField(max_values=2), "a,b,c")
    assert parse(MultiValueField(max_values=2), "a,b,a") == ["a", "b"]


def test_id_lists_are_parsed_and_deduplicated() -> None:
    field = MultiIdField()
    one = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
    assert field.to_internal_value(f"{one}, {one.upper()},") == [uuid.UUID(one)]
    with pytest.raises(serializers.ValidationError) as error:
        field.to_internal_value(f"{one},not-an-id")
    assert error.value.detail == ["Invalid value"]
