"""Installation credentials never enter templates, database rows or API responses."""
import json
import os
import re
import stat
import tempfile
from pathlib import Path

from django.conf import settings


class IntegrationError(ValueError):
    pass


def text(value, name, pattern=None, limit=200):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise IntegrationError(f'Configuración inválida: {name}.')
    if any(ord(c) < 32 for c in value) or (pattern and not re.fullmatch(pattern, value)):
        raise IntegrationError(f'Configuración inválida: {name}.')
    return value.strip()


def validate(data):
    if not isinstance(data, dict) or set(data) - {'openai', 'instagram', 'webhook'}:
        raise IntegrationError('El archivo de integraciones tiene un formato inválido.')
    ai = data.get('openai', {})
    if not isinstance(ai, dict):
        raise IntegrationError('Configuración inválida: openai.')
    if ai:
        text(ai.get('api_key'), 'clave de OpenAI', limit=512)
        for name in ('model', 'fast_model'):
            text(ai.get(name), name, r'[A-Za-z0-9._:-]+')
    ig = data.get('instagram', {})
    if not isinstance(ig, dict):
        raise IntegrationError('Configuración inválida: instagram.')
    if ig:
        text(ig.get('version'), 'versión de Instagram', r'v\d{2}\.0')
        accounts = ig.get('accounts')
        if not isinstance(accounts, list) or not 1 <= len(accounts) <= 10:
            raise IntegrationError('Configurá entre 1 y 10 cuentas de Instagram.')
        ids = set()
        for account in accounts:
            if not isinstance(account, dict):
                raise IntegrationError('Cuenta de Instagram inválida.')
            identity = text(account.get('id'), 'identificador de cuenta', r'[a-z0-9_-]{1,40}')
            if identity in ids or identity == 'todas':
                raise IntegrationError('Identificador de cuenta duplicado o reservado.')
            ids.add(identity)
            text(account.get('user_id'), 'Instagram user ID', r'\d{1,40}')
            text(account.get('token'), 'token de Instagram', limit=4096)
            text(account.get('handle'), 'handle de Instagram', r'@?[A-Za-z0-9_.]{1,40}')
            keywords = account.get('keywords', [])
            if not isinstance(keywords, list) or len(keywords) > 100:
                raise IntegrationError('Lista de keywords inválida.')
            if len(keywords) != len(set(x for x in keywords if isinstance(x, str))):
                raise IntegrationError('Las keywords no pueden repetirse.')
            for keyword in keywords:
                text(keyword, 'keyword', r'[A-Z0-9_-]{1,40}')
            targets = account.get('targets', {})
            if not isinstance(targets, dict) or set(targets) - {'videos', 'dms', 'leads', 'llamadas', 'clientes'}:
                raise IntegrationError('Objetivos inválidos.')
            if any(type(n) is not int or not 0 <= n <= 1000000 for n in targets.values()):
                raise IntegrationError('Los objetivos deben ser enteros no negativos.')
    hook = data.get('webhook', {})
    if not isinstance(hook, dict):
        raise IntegrationError('Configuración inválida: webhook.')
    if hook:
        text(hook.get('secret'), 'secreto del webhook', r'[A-Za-z0-9_-]{32,128}')
    return data


def load_config():
    path = settings.DATA_DIR / 'integrations.json'
    if not path.exists():
        return {}
    try:
        if path.is_symlink() or path.stat().st_size > 65536:
            raise IntegrationError('Archivo de integraciones inválido.')
        if os.name == 'posix' and stat.S_IMODE(path.stat().st_mode) & 0o077:
            raise IntegrationError('integrations.json debe tener permisos 0600.')
        return validate(json.loads(path.read_text(encoding='utf-8')))
    except (OSError, ValueError) as error:
        if isinstance(error, IntegrationError):
            raise
        raise IntegrationError('No se pudo leer la configuración de integraciones.') from None


def save_config(data):
    validate(data)
    fd, filename = tempfile.mkstemp(prefix='.integrations-', dir=settings.DATA_DIR)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(data, output, ensure_ascii=False, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(filename, settings.DATA_DIR / 'integrations.json')
    finally:
        Path(filename).unlink(missing_ok=True)


def public_status():
    try:
        config = load_config()
        return {'consultor': bool(config.get('openai')), 'inbound': bool(config.get('instagram')),
                'webhook': bool(config.get('webhook')), 'error': None}
    except IntegrationError as error:
        return {'consultor': False, 'inbound': False, 'webhook': False, 'error': str(error)}
