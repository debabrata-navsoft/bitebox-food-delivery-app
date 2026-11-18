"""/support/tickets: customers, restaurants and riders raise and follow their own tickets (Node:
support.routes.js supportRouter)."""

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import current_user
from apps.rbac.roles import Role
from common.api import ok
from common.filters import facets_page, list_params, multi_param
from common.pagination import Page
from common.permissions import role_required
from common.schema import envelope, errors
from common.validation import parse_id, validated

from . import services
from .models import TicketType
from .serializers import CreateTicketInput, MyTicketQuery, ReplyInput

REQUESTERS = [role_required(Role.CUSTOMER, Role.RESTAURANT, Role.DELIVERY)]
TAGS = ["Support"]
TICKET = envelope("MyTicketResult")
MY_TICKET_PAGE = facets_page("MyTicketPage", services.MINE_FACETS)


class MyTicketsView(APIView):
    permission_classes = REQUESTERS

    @extend_schema(
        tags=TAGS,
        operation_id="support_tickets_list",
        parameters=list_params(
            "Ticket number, subject or order number",
            multi_param(
                "status",
                services.MINE_STATUSES,
                "open: not resolved or closed yet (waiting_for_response included); "
                "closed: resolved or closed",
            ),
            multi_param("type", TicketType.values),
            days="created",
        ),
        responses={200: MY_TICKET_PAGE, **errors(401, 403, 422)},
    )
    def get(self, request: Request) -> Response:
        query = validated(MyTicketQuery, request.query_params)
        return ok(services.list_mine(current_user(request), query, Page.from_query(query)))

    @extend_schema(
        tags=TAGS,
        operation_id="support_tickets_create",
        request=CreateTicketInput,
        responses={201: TICKET, **errors(401, 403, 422)},
    )
    def post(self, request: Request) -> Response:
        data = validated(CreateTicketInput, request.data)
        ticket = services.create(current_user(request), data)
        return ok(
            {"ticket": ticket},
            message="Ticket created. Our support team will reply soon.",
            status=201,
        )


class MyTicketView(APIView):
    permission_classes = REQUESTERS

    @extend_schema(
        tags=TAGS,
        operation_id="support_tickets_get",
        responses={200: TICKET, **errors(401, 403, 404, 422)},
    )
    def get(self, request: Request, id: str) -> Response:
        return ok({"ticket": services.get_mine(current_user(request), parse_id(id))})


class MyTicketMessagesView(APIView):
    permission_classes = REQUESTERS

    @extend_schema(
        tags=TAGS,
        operation_id="support_tickets_reply",
        request=ReplyInput,
        responses={200: TICKET, **errors(400, 401, 403, 404, 422)},
    )
    def post(self, request: Request, id: str) -> Response:
        ticket_id = parse_id(id)
        data = validated(ReplyInput, request.data)
        ticket = services.reply_mine(current_user(request), ticket_id, data["body"])
        return ok({"ticket": ticket}, message="Reply sent")
