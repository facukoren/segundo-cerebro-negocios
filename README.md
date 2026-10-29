# Segundo cerebro para negocios chicos

Una app local para guardar notas de trabajo y seguir leads, clientes, cobros, gastos y tareas. El inicio muestra los importes registrados del mes y accesos para editar cada sección.

Está pensada para una persona o un equipo de confianza que comparte una instalación. No incluye IA, integraciones externas, facturación electrónica ni contabilidad. Los movimientos se registran en una sola moneda: elegí una y usala siempre.

## Empezar

Necesitás Python 3.12 o superior y soporte para `venv` (en Debian/Ubuntu, el paquete `python3-venv`). En Linux o macOS:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python scripts/bootstrap.py
python manage.py createsuperuser
waitress-serve --listen=127.0.0.1:8000 core.wsgi:application
```

En Windows PowerShell, activá el entorno con `.venv\Scripts\Activate.ps1` y ejecutá los mismos comandos con `python`. Abrí <http://127.0.0.1:8000>. Usá el usuario que acabás de crear. La edición se hace desde los enlaces del inicio, que abren el administrador de Django.

`bootstrap.py` crea una clave aleatoria y una base SQLite vacía en `~/.local/share/segundo-cerebro-negocios/`. No imprime la clave. Podés cambiar esa ubicación con `SECOND_BRAIN_DATA_DIR`, siempre fuera del repositorio. El script se puede volver a ejecutar: conserva la clave y los datos existentes.

Las fechas del inicio se calculan en UTC. Si trabajás en otra zona, definí `SECOND_BRAIN_TIME_ZONE` con un nombre IANA, por ejemplo `America/Argentina/Buenos_Aires`, antes de arrancar el servidor.

## Datos y copias

El archivo `db.sqlite3` contiene tus notas, contactos y números. Cerrá el servidor antes de copiarlo; guardá la copia en un lugar privado. Para restaurar, reemplazá ese archivo con el servidor detenido. Conservá también `secret_key` si querés mantener las sesiones existentes. No subas ninguno de los dos a GitHub.

El monto de “abonos activos” suma los abonos de clientes marcados como activos. “Cobros” y “gastos” suman movimientos fechados en el mes actual. “Resultado” es cobros menos gastos; no es una medida contable ni una proyección.

## Seguridad

- El servidor escucha solo en `127.0.0.1`. El acceso a las páginas y al administrador requiere contraseña; los formularios usan protección CSRF de Django.
- La base y la clave se crean fuera del repositorio. En Linux y macOS, la carpeta tiene permisos `0700` y la clave `0600`.
- No hay claves de API, datos de ejemplo reales, cargas de archivos, webhooks ni servicios externos.
- No publiques el puerto `8000` en internet. Para acceder desde otra máquina, usá un túnel SSH: `ssh -L 8000:127.0.0.1:8000 usuario@servidor` y abrí `127.0.0.1:8000` en tu equipo.
- Actualizá las dependencias cuando salgan parches de seguridad y hacé copias privadas de la base. El archivo `requirements.txt` fija versiones para que cada instalación arranque con las mismas dependencias.

Para informar una vulnerabilidad, usá un aviso privado de seguridad de GitHub. No pongas datos sensibles en un issue público.

## Alcance

Esta versión tiene un solo espacio de datos. Un superusuario puede ver y editar todo. Si necesitás usuarios aislados entre empresas, permisos por rol, acceso público por HTTPS o automatizaciones, hay que diseñarlos antes de usarla para eso.

Código bajo licencia MIT. La app se entrega sin datos de negocio preinstalados.
