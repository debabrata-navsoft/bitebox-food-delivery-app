"""
Request validation and the user JSON, matching the Node API (validators/auth.validators.js,
User.toJSON). Unknown fields are ignored, so a client can never set `role` or `status` itself.
"""

import re
from typing import Any

from rest_framework import serializers

from apps.rbac.roles import (
    ADMIN_ROLES,
    ALL_ROLES,
    PERMISSION_VALUES,
    STAFF_ADMIN_ROLES,
    SUPER_ADMIN_ONLY,
    Role,
)
from common.validation import PageQuery

from .models import Gender, User, UserStatus

SELF_REGISTER_ROLES = (Role.CUSTOMER, Role.RESTAURANT, Role.DELIVERY)
SELF_REGISTER_ROLE_VALUES = [r.value for r in SELF_REGISTER_ROLES]
PHONE = re.compile(r"^\+?[0-9]{10,15}$")
PHONE_MESSAGE = "Enter a valid phone number (10-15 digits)"


class EmailField(serializers.EmailField):
    """Trimmed and lower-cased (Node: normalizeEmail without the Gmail rewrites)."""

    def __init__(self, **kwargs: Any) -> None:
        kwargs.setdefault("max_length", 254)
        kwargs.setdefault(
            "error_messages",
            {
                "required": "Email is required",
                "null": "Email is required",
                "blank": "Email is required",
                "invalid": "Enter a valid email address",
            },
        )
        super().__init__(**kwargs)

    def to_internal_value(self, data: Any) -> str:
        if not isinstance(data, str):
            self.fail("required")
        return str(super().to_internal_value(data)).lower()


class NewPasswordField(serializers.CharField):
    """8+ characters with a letter and a number, at most 72 bytes (bcrypt's limit in Node)."""

    def __init__(self, **kwargs: Any) -> None:
        kwargs.setdefault("trim_whitespace", False)
        kwargs.setdefault(
            "error_messages",
            {
                "required": "Password is required",
                "null": "Password is required",
                "blank": "Password is required",
            },
        )
        super().__init__(**kwargs)

    def to_internal_value(self, data: Any) -> str:
        if not isinstance(data, str):
            self.fail("required")
        value = str(super().to_internal_value(data))
        if len(value) < 8:
            raise serializers.ValidationError("Password must be at least 8 characters")
        if len(value.encode()) > 72:
            raise serializers.ValidationError("Password is too long")
        if not re.search(r"[A-Za-z]", value):
            raise serializers.ValidationError("Password must contain a letter")
        if not re.search(r"[0-9]", value):
            raise serializers.ValidationError("Password must contain a number")
        return value


class NameField(serializers.CharField):
    def __init__(self, **kwargs: Any) -> None:
        kwargs.setdefault(
            "error_messages",
            {
                "required": "Name is required",
                "null": "Name is required",
                "blank": "Name must be 2-80 characters",
            },
        )
        super().__init__(**kwargs)

    def to_internal_value(self, data: Any) -> str:
        if not isinstance(data, str):
            self.fail("required")
        value = str(super().to_internal_value(data))
        if not 2 <= len(value) <= 80:
            raise serializers.ValidationError("Name must be 2-80 characters")
        return value


class PhoneField(serializers.CharField):
    """Optional; an empty value means "no phone"."""

    def __init__(self, **kwargs: Any) -> None:
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_blank", True)
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)

    def to_internal_value(self, data: Any) -> str:
        value = str(super().to_internal_value(data)).strip()
        if value and not PHONE.match(value):
            raise serializers.ValidationError(PHONE_MESSAGE)
        return value


def _choice(choices: tuple[Role, ...], message: str, **kwargs: Any) -> serializers.ChoiceField:
    return serializers.ChoiceField(
        choices=[r.value for r in choices], error_messages={"invalid_choice": message}, **kwargs
    )


OTP_CODE: dict[str, Any] = {
    "invalid": "Enter the 6-digit code",
    "required": "Enter the 6-digit code",
}


def _otp_code(**kwargs: Any) -> serializers.RegexField:
    return serializers.RegexField(r"^\d{6}$", error_messages=OTP_CODE, **kwargs)


def _current_password(message: str) -> serializers.CharField:
    """Any non-empty password (checked against the stored hash, not the password rules)."""
    return serializers.CharField(
        min_length=1,
        max_length=128,
        trim_whitespace=False,
        error_messages={"required": message, "blank": message},
    )


class RegisterInput(serializers.Serializer):
    name = NameField()
    email = EmailField()
    phone = PhoneField()
    password = NewPasswordField()
    role = _choice(SELF_REGISTER_ROLES, "Invalid role", required=False)
    # The emailed code from POST /auth/register/code (needed while signup_needs_code()).
    code = _otp_code(required=False)
    referral_code = serializers.RegexField(
        r"^[A-Za-z0-9-]{4,40}$",
        required=False,
        allow_blank=True,
        error_messages={"invalid": "Enter a valid referral code"},
    )


class LoginInput(serializers.Serializer):
    email = EmailField()
    password = _current_password("Password is required")
    portal = _choice(ALL_ROLES, "Invalid portal", required=False)


ENTER_PHONE = "Enter your mobile number"


def _required_phone() -> PhoneField:
    return PhoneField(
        required=True, allow_blank=False, allow_null=False,
        error_messages={"required": ENTER_PHONE, "blank": ENTER_PHONE},
    )  # fmt: skip


class SignupCodeInput(serializers.Serializer):
    email = EmailField()
    phone = _required_phone()


class OtpRequestInput(serializers.Serializer):
    phone = _required_phone()


class OtpLoginInput(serializers.Serializer):
    phone = _required_phone()
    code = _otp_code()
    portal = _choice(ALL_ROLES, "Invalid portal", required=False)


class OtpCodeInput(serializers.Serializer):
    code = _otp_code()


class EmailVerifyInput(serializers.Serializer):
    token = serializers.CharField(
        min_length=20, max_length=200, error_messages={"required": "Verification token is required"}
    )


class ForgotPasswordInput(serializers.Serializer):
    email = EmailField()


class ResetPasswordInput(serializers.Serializer):
    token = serializers.CharField(
        min_length=20, max_length=200, error_messages={"required": "Reset token is required"}
    )
    password = NewPasswordField()


class ChangePasswordInput(serializers.Serializer):
    current_password = _current_password("Current password is required")
    new_password = NewPasswordField()


GENDER_MESSAGE = f"Gender must be one of: {', '.join(Gender.values)}"


def _gender() -> serializers.ChoiceField:
    """Optional; null clears it."""
    return serializers.ChoiceField(
        choices=Gender.values,
        required=False,
        allow_null=True,
        error_messages=dict.fromkeys(("invalid_choice", "blank"), GENDER_MESSAGE),
    )


def _avatar_url() -> serializers.URLField:
    """An uploaded photo's URL (checked by the service); null or "" removes it."""
    return serializers.URLField(max_length=500, required=False, allow_null=True, allow_blank=True)


class UpdateProfileInput(serializers.Serializer):
    name = NameField(required=False)
    phone = PhoneField()
    avatar_url = _avatar_url()
    gender = _gender()


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------
STAFF_ROLE_MESSAGE = "Choose an operations, finance, support or operator role"


class PermissionsField(serializers.Field):
    """
    A person's own permission keys (null resets them to the role preset). Errors are reported on
    the field itself: an unknown key, or a super-admin-only one (admins:manage).
    """

    default_error_messages = {
        "not_a_list": "Permissions must be a list of permission keys",
        "unknown": "Unknown permission: {name}",
        "super_admin_only": "{name} can only belong to the super admin",
    }

    def __init__(self, **kwargs: Any) -> None:
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)

    def to_internal_value(self, data: Any) -> list[str]:
        if not isinstance(data, list) or not all(isinstance(k, str) for k in data):
            self.fail("not_a_list")
        for key in data:
            if key not in PERMISSION_VALUES:
                self.fail("unknown", name=key)
            if key in SUPER_ADMIN_ONLY:
                self.fail("super_admin_only", name=key)
        return sorted(set(data))

    def to_representation(self, value: Any) -> Any:
        return value


class StaffCreateInput(serializers.Serializer):
    name = NameField()
    email = EmailField()
    phone = PhoneField()
    password = NewPasswordField()
    role = _choice(STAFF_ADMIN_ROLES, STAFF_ROLE_MESSAGE)
    permissions = PermissionsField()


class StaffUpdateInput(serializers.Serializer):
    name = NameField(required=False)
    phone = PhoneField()
    role = _choice(STAFF_ADMIN_ROLES, STAFF_ROLE_MESSAGE, required=False)
    permissions = PermissionsField()


class MemberUpdateInput(serializers.Serializer):
    """
    PATCH /admin/users/:id: support corrects a member's name or date of birth. Email and phone are
    the person's sign-in details and only they can change them (any sent are ignored).
    """

    name = NameField(required=False)
    # Null clears it; the age rule is checked by coins.special.birth_date_from.
    birth_date = serializers.RegexField(
        r"^\d{4}-\d{2}-\d{2}$",
        required=False,
        allow_null=True,
        error_messages=dict.fromkeys(("invalid", "blank"), "Enter the date as YYYY-MM-DD"),
    )
    gender = _gender()
    avatar_url = _avatar_url()


STATUS_MESSAGE = f"Status must be one of: {', '.join(UserStatus.values)}"
REASON_MESSAGE = "Give a reason (3-500 characters)"


def reason_field() -> serializers.CharField:
    """Why an admin made a change; checked (and maybe required) by `clean_reason`."""
    return serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        trim_whitespace=True,
        error_messages=dict.fromkeys(("invalid",), REASON_MESSAGE),
    )


def clean_reason(attrs: dict[str, Any], required: bool) -> str | None:
    """3-500 characters, trimmed; required for some changes, optional (but checked) otherwise."""
    reason = (attrs.get("reason") or "").strip()
    if len(reason) > 500 or (reason and len(reason) < 3) or (required and not reason):
        raise serializers.ValidationError({"reason": REASON_MESSAGE})
    return reason or None


class ReasonInput(serializers.Serializer):
    reason = reason_field()


class StatusInput(serializers.Serializer):
    """
    An account status change. Any status but `active` needs a reason (3-500 characters, trimmed);
    reactivating may give one.
    """

    status = serializers.ChoiceField(
        choices=UserStatus.values,
        error_messages={"invalid_choice": STATUS_MESSAGE},
    )
    reason = reason_field()

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        attrs["reason"] = clean_reason(attrs, attrs["status"] != UserStatus.ACTIVE)
        return attrs


class UserListQuery(serializers.Serializer):
    page = serializers.IntegerField(required=False, min_value=1, max_value=10_000)
    limit = serializers.IntegerField(required=False, min_value=1, max_value=100)
    search = serializers.CharField(required=False, allow_blank=True, max_length=100)
    role = serializers.ChoiceField(choices=[], required=False)
    status = serializers.ChoiceField(choices=UserStatus.values, required=False)

    def __init__(self, *args: Any, roles: tuple[Role, ...] = (), **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        role_field = self.fields["role"]
        if isinstance(role_field, serializers.ChoiceField):
            role_field.choices = [r.value for r in roles]


INVALID: dict[str, Any] = dict.fromkeys(
    ("invalid", "invalid_choice", "null", "blank"), "Invalid value"
)
CUSTOMER_SORT_VALUES = ["newest", "oldest", "name", "orders", "spent"]
VERIFICATION_VALUES = ["email_verified", "email_unverified", "phone_verified", "phone_unverified"]


def optional_choice(choices: list[str]) -> serializers.ChoiceField:
    """An optional list filter; a value outside `choices` is "Invalid value"."""
    return serializers.ChoiceField(choices=choices, required=False, error_messages=INVALID)


def day_field() -> serializers.DateField:
    return serializers.DateField(required=False, input_formats=["%Y-%m-%d"], error_messages=INVALID)


class JoinedListQuery(PageQuery):
    """
    The admin account lists (customers, restaurants, riders): page, limit and search, plus
    `joined_from` / `joined_to` (calendar days in the report time zone) declared by each list.
    """

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        start, end = attrs.get("joined_from"), attrs.get("joined_to")
        if start and end and start > end:
            raise serializers.ValidationError({"joined_to": "Must be on or after joinedFrom"})
        return attrs


class CustomerListQuery(JoinedListQuery):
    """GET /admin/customers."""

    status = optional_choice(UserStatus.values)
    verification = optional_choice(VERIFICATION_VALUES)
    joined_from = day_field()
    joined_to = day_field()
    sort = optional_choice(CUSTOMER_SORT_VALUES)


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
def user_json(user: User) -> dict[str, Any]:
    """The user as the Angular app expects it (Node User.toJSON): no secrets, admin permissions."""
    data: dict[str, Any] = {
        "id": str(user.pk),
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
        "email_verified": user.email_verified_at is not None,
        "phone_verified": user.phone_verified_at is not None,
    }
    # Optional fields are left out when empty, as MongoDB documents omitted them.
    optional = {
        "phone": user.phone,
        "last_login_at": user.last_login,
        "referral_code": user.referral_code,
        "birth_date": user.birth_date,
        "avatar_url": user.avatar_url,
        "gender": user.gender,
        "status_reason": user.status_reason,
        "status_changed_at": user.status_changed_at,
    }
    data.update({k: v for k, v in optional.items() if v})
    if user.role in ADMIN_ROLES:
        data["permissions"] = user.permissions
        # The person's own list (None = the role's preset), for the super admin's permission editor.
        data["custom_permissions"] = user.custom_permissions
    return data


class UserOut(serializers.Serializer):
    """Schema only (responses are built by user_json)."""

    id = serializers.UUIDField()
    name = serializers.CharField()
    email = serializers.EmailField()
    phone = serializers.CharField(required=False)
    role = serializers.ChoiceField(choices=[r.value for r in Role])
    status = serializers.ChoiceField(choices=UserStatus.values)
    last_login_at = serializers.DateTimeField(required=False)
    referral_code = serializers.CharField(required=False)
    birth_date = serializers.DateField(required=False)
    avatar_url = serializers.URLField(required=False)
    gender = serializers.ChoiceField(choices=Gender.values, required=False)
    custom_permissions = serializers.ListField(
        child=serializers.CharField(), required=False, allow_null=True
    )  # admin roles: their own list, null for the role's preset
    status_reason = serializers.CharField(required=False)
    status_changed_at = serializers.DateTimeField(required=False)
    email_verified = serializers.BooleanField()
    phone_verified = serializers.BooleanField()
    # Admin-panel accounts: their effective permissions.
    permissions = serializers.ListField(child=serializers.CharField(), required=False)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
