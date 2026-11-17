"""Platform single sign-on for DefectDojo.

Traefik runs every request for va-dojo.devops.<DOMAIN> through, in order:
  1. a headers middleware that deletes any client-supplied X-Auth-Request-Email,
  2. oidc-auth@file (oauth2-proxy, Keycloak group `admins`), which sets
     X-Auth-Request-Email to the signed-in user's address,
  3. a headers middleware that adds X-VA-Proxy-Secret.

The identity header is trusted only together with the secret, so a container
that reaches va-dojo-nginx directly on devops-network cannot impersonate anyone.
Requests without the secret (the VA launcher's API calls) fall through to
DefectDojo's normal token / password authentication.

Only `admins` get past oauth2-proxy, so new users are created as superusers.
A user who already exists keeps whatever rights were set in DefectDojo.
"""
from __future__ import annotations

import hmac

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.http import HttpResponseRedirect
from django.utils.http import url_has_allowed_host_and_scheme

IDENTITY = "HTTP_X_AUTH_REQUEST_EMAIL"
SECRET = "HTTP_X_VA_PROXY_SECRET"
BACKEND = "django.contrib.auth.backends.ModelBackend"


def platform_identity(request) -> str:
    """The signed-in platform user's email, or "" when the request did not come through Traefik."""
    expected = getattr(settings, "VA_PROXY_SECRET", "")
    given = request.META.get(SECRET, "")
    if not expected or not hmac.compare_digest(given.encode(), expected.encode()):
        return ""
    email = request.META.get(IDENTITY, "").strip().lower()
    return email if "@" in email and len(email) <= 150 else ""


def user_for(email: str):
    User = get_user_model()
    user, created = User.objects.get_or_create(
        username=email,
        defaults={"email": email, "is_superuser": True, "is_staff": True, "is_active": True},
    )
    if created:
        user.set_unusable_password()  # this account can only sign in through the platform
        user.save(update_fields=["password"])
    return user


class PlatformSSOMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        email = platform_identity(request)
        if not email:
            return self.get_response(request)

        path = request.path_info.rstrip("/")
        if path.endswith("/logout") or path == "logout":
            # A DefectDojo-only logout would be undone by the next request, so sign
            # out of the platform instead when a sign-out URL is configured.
            logout(request)
            return HttpResponseRedirect(getattr(settings, "VA_SIGNOUT_URL", "") or "/")

        user = request.user
        if not (user.is_authenticated and user.get_username().lower() == email):
            user = user_for(email)
            if not user.is_active:
                return self.get_response(request)  # disabled in DefectDojo: no automatic sign-in
            login(request, user, backend=BACKEND)

        if path.endswith("/login") or path == "login":
            target = request.GET.get("next") or "/"
            if not url_has_allowed_host_and_scheme(target, allowed_hosts={request.get_host()}):
                target = "/"  # never redirect off-site
            return HttpResponseRedirect(target)
        return self.get_response(request)
