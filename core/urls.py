from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import path

from brain.views import home
from brain import api
from brain.integrations import consultor, inbound

admin.site.site_header = "Segundo cerebro"
admin.site.site_title = "Segundo cerebro"
admin.site.index_title = "Datos"

urlpatterns = [
    path("", home, name="home"),
    path("api/estado", api.state),
    path("api/consultor/mensajes", consultor.messages),
    path("api/consultor/archivos", consultor.upload),
    path("api/inbound/sync", inbound.sync),
    path("api/inbound/eventos", inbound.webhook),
    path("api/<str:collection>", api.records),
    path("api/<str:collection>/<uuid:record_id>", api.records),
    path("login/", auth_views.LoginView.as_view(template_name="brain/login.html"), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("admin/", admin.site.urls),
]
