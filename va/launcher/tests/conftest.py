import os
import tempfile

from cryptography.fernet import Fernet

# Settings are read at import time, so set the environment before importing the app.
_tmp = tempfile.mkdtemp(prefix="va-test-")
os.environ.update(
    VA_SECRET_KEY=Fernet.generate_key().decode(),
    VA_ALLOWED_DOMAINS="example.test, apps.example.org",
    VA_DATABASE_URL=f"sqlite:///{_tmp}/va.db",
    VA_DATA_DIR=_tmp,
    VA_MANUAL_DIR=_tmp,
    VA_DOJO_PUBLIC_URL="https://va-dojo.devops.example.test",
)

ALLOWED = ["example.test", "apps.example.org"]
