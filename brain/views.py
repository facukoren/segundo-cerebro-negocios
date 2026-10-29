from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie


@login_required
@never_cache
@ensure_csrf_cookie
def home(request):
    return render(request, "brain/home.html", {"business_name": settings.BUSINESS_NAME})


def csrf_failure(request, reason=""):
    if request.path.startswith("/api/"):
        from django.http import JsonResponse
        return JsonResponse({"errores": ["La sesión venció. Recargá la página."]}, status=403)
    from django.views.csrf import csrf_failure as default_failure
    return default_failure(request, reason=reason)
