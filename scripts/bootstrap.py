"""Create a private local key and database; never print or commit the key."""

import os
import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("SECOND_BRAIN_DATA_DIR", Path.home() / ".local" / "share" / "segundo-cerebro-negocios")).expanduser().resolve()
if DATA_DIR == ROOT or DATA_DIR.is_relative_to(ROOT):
    sys.exit("SECOND_BRAIN_DATA_DIR debe estar fuera del repositorio")

DATA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
if os.name == "posix":
    DATA_DIR.chmod(0o700)
key_file = DATA_DIR / "secret_key"
try:
    fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    pass
else:
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        output.write(secrets.token_urlsafe(64) + "\n")
if os.name == "posix":
    key_file.chmod(0o600)

subprocess.run([sys.executable, str(ROOT / "manage.py"), "migrate", "--noinput"], check=True, cwd=ROOT)
subprocess.run([sys.executable, str(ROOT / "manage.py"), "collectstatic", "--noinput", "--verbosity", "0"], check=True, cwd=ROOT)
print("Base y archivos estáticos preparados. Creá tu usuario con: python manage.py createsuperuser")
