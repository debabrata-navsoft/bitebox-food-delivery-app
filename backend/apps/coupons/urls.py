from django.urls import path

from . import views

urlpatterns = [
    # Customers
    path("coupons/available", views.AvailableView.as_view()),
    path("coupons/offers", views.CustomerOffersView.as_view()),
    path("restaurants/<str:slug_or_id>/offers", views.RestaurantOffersView.as_view()),
    # Admins (fixed paths before <id>)
    path("admin/coupons", views.AdminCouponsView.as_view()),
    path("admin/coupons/analytics", views.AdminAnalyticsView.as_view()),
    path("admin/coupons/<str:id>", views.AdminCouponView.as_view()),
    path("admin/coupons/<str:id>/status", views.AdminCouponStatusView.as_view()),
    path("admin/coupons/<str:id>/duplicate", views.AdminCouponDuplicateView.as_view()),
    path("admin/restaurant-offers/pending", views.AdminPendingOffersView.as_view()),
    path("admin/restaurant-offers/<str:id>/approve", views.AdminApproveOfferView.as_view()),
    path("admin/restaurant-offers/<str:id>/reject", views.AdminRejectOfferView.as_view()),
    # Restaurant partners: their own offers
    path("my/restaurant/offers", views.OwnOffersView.as_view()),
    path("my/restaurant/offers/analytics", views.OwnOfferAnalyticsView.as_view()),
    path("my/restaurant/offers/<str:id>", views.OwnOfferView.as_view()),
    path("my/restaurant/offers/<str:id>/status", views.OwnOfferStatusView.as_view()),
]
