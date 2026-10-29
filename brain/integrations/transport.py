"""Bounded HTTPS requests to fixed providers. Never follow provider redirects."""
import json
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

from .config import IntegrationError


class ProviderError(IntegrationError):
    def __init__(self, provider, status=None):
        self.status = status
        reason = {400: 'revisá el modelo, los campos y los permisos', 401: 'credencial inválida o vencida',
                  403: 'faltan permisos', 429: 'límite de uso o saldo insuficiente'}.get(status, 'servicio no disponible')
        super().__init__(f'{provider}: {reason}.')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def open_request(provider, path, token, *, payload=None, query=None):
    hosts = {'OpenAI': 'https://api.openai.com', 'Instagram': 'https://graph.instagram.com'}
    if provider not in hosts or not path.startswith('/') or '?' in path or '#' in path:
        raise IntegrationError('Destino de integración inválido.')
    url = hosts[provider] + path
    if query:
        url += '?' + urllib.parse.urlencode(query)
    request = urllib.request.Request(url, data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Accept': 'text/event-stream' if payload else 'application/json'})
    # Explicitly ignore ambient proxy settings, which can forward credentials elsewhere.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        return opener.open(request, timeout=30)
    except urllib.error.HTTPError as error:
        error.close()
        raise ProviderError(provider, error.code) from None
    except (OSError, urllib.error.URLError, ValueError):
        raise ProviderError(provider) from None


def read_json(response, provider):
    try:
        with response:
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError()
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise ValueError()
        return body
    except (OSError, ValueError):
        raise ProviderError(provider) from None


def stream_events(response):
    start, total, event_lines = time.monotonic(), 0, []
    try:
        while True:
            line = response.readline(65537)
            if not line:
                return
            total += len(line)
            if len(line) > 65536 or total > 2 * 1024 * 1024 or time.monotonic() - start > 180:
                raise ProviderError('OpenAI')
            if line.strip():
                if line.startswith(b'data:'):
                    event_lines.append(line[5:].strip())
            elif event_lines:
                data = b'\n'.join(event_lines)
                event_lines = []
                if data == b'[DONE]':
                    return
                yield json.loads(data)
    except (OSError, ValueError, socket.timeout):
        raise ProviderError('OpenAI') from None
