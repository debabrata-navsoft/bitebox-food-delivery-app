from django.urls import path

from . import views, views_accounts

urlpatterns = [
    path("delivery/me", views.DashboardView.as_view()),
    path("delivery/me/vehicle", views.VehicleView.as_view()),
    path("delivery/me/details", views.RiderDetailsView.as_view()),
    path("delivery/me/resubmit", views.RiderResubmitView.as_view()),
    path("delivery/me/availability", views.AvailabilityView.as_view()),
    path("delivery/me/location", views.LocationView.as_view()),
    path("delivery/offers/<str:id>/accept", views.OfferAcceptView.as_view()),
    path("delivery/offers/<str:id>/decline", views.OfferDeclineView.as_view()),
    path("delivery/orders/history", views.RiderHistoryView.as_view()),
    path("delivery/reviews", views.RiderReviewsView.as_view()),
    path("delivery/earnings", views.RiderEarningsView.as_view()),
    path("delivery/stats", views.RiderStatsView.as_view()),
    path("delivery/orders/<str:id>/status", views.RiderOrderStatusView.as_view()),
    path("admin/delivery-partners", views.AdminRidersView.as_view()),
    path("admin/delivery-partners/<str:id>", views.AdminRiderView.as_view()),
    path("admin/delivery-partners/<str:id>/status", views.AdminRiderStatusView.as_view()),
    path(
        "admin/delivery-partners/<str:id>/verification", views.AdminRiderVerificationView.as_view()
    ),
    path("admin/delivery-partner-accounts", views_accounts.RiderAccountsView.as_view()),
    path("admin/delivery-partner-accounts/zones", views_accounts.RiderAccountZonesView.as_view()),
    path("admin/delivery-partner-accounts/<str:id>", views_accounts.RiderAccountView.as_view()),
    path(
        "admin/delivery-partner-accounts/<str:id>/verification",
        views_accounts.RiderAccountVerificationView.as_view(),
    ),
    path(
        "admin/delivery-partner-accounts/<str:id>/availability",
        views_accounts.RiderAccountAvailabilityView.as_view(),
    ),
]
