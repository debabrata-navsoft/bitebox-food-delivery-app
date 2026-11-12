from django.urls import path

from . import views

urlpatterns = [path("my/restaurant/earnings", views.RestaurantEarningsView.as_view())]
