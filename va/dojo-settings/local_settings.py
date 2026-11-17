# DefectDojo local settings for the va stack.
#
# Mounted at /app/docker/extra_settings; DefectDojo's entrypoints copy these files
# into dojo/settings/ and settings.py includes local_settings.py after
# settings.dist.py, in the same namespace (so MIDDLEWARE is already defined here).
#
# Adds platform single sign-on: open-source DefectDojo 3.x ships only
# username/password login, so va_sso.py signs users in from the identity that
# oauth2-proxy (Keycloak) passes through Traefik.
import os

VA_PROXY_SECRET = os.environ.get("VA_PROXY_SECRET", "")
VA_SIGNOUT_URL = os.environ.get("VA_SIGNOUT_URL", "")

_middleware = list(MIDDLEWARE)  # noqa: F821 - defined by settings.dist.py
_middleware.insert(
    _middleware.index("django.contrib.auth.middleware.AuthenticationMiddleware") + 1,
    "dojo.settings.va_sso.PlatformSSOMiddleware",
)
MIDDLEWARE = _middleware
