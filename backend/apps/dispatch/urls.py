from django.urls import path

from . import views

urlpatterns = [
    path("admin/dispatch/settings", views.DispatchSettingsView.as_view()),
    path("delivery-range", views.DeliveryRangeView.as_view()),
]
