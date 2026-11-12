from django.urls import path

from . import views

urlpatterns = [
    path("orders", views.OrdersView.as_view()),
    path("orders/<str:id>", views.OrderView.as_view()),
    path("orders/<str:id>/cancel", views.OrderCancelView.as_view()),
    path("my/restaurant/orders", views.MyOrdersView.as_view()),
    path("my/restaurant/stats", views.MyStatsView.as_view()),
    path("my/restaurant/orders/<str:id>", views.MyOrderView.as_view()),
    path("my/restaurant/orders/<str:id>/status", views.MyOrderStatusView.as_view()),
    path("admin/orders", views.AdminOrdersView.as_view()),
    path("admin/orders/<str:id>", views.AdminOrderView.as_view()),
    path("admin/orders/<str:id>/cancel", views.AdminOrderCancelView.as_view()),
    path("admin/orders/<str:id>/unassign", views.AdminOrderUnassignView.as_view()),
]
