from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import path

from brain.views import home

admin.site.site_header = "Segundo cerebro"
admin.site.site_title = "Segundo cerebro"
admin.site.index_title = "Datos"

urlpatterns = [
    path("", home, name="home"),
    path("login/", auth_views.LoginView.as_view(template_name="brain/login.html"), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("admin/", admin.site.urls),
]
