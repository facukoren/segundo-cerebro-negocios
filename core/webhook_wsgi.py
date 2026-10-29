"""Separate receiver: expose only inbound events, never the dashboard or admin."""
from .wsgi import application as django_application


def application(environ, start_response):
    if environ.get('PATH_INFO') != '/api/inbound/eventos':
        start_response('404 Not Found', [('Content-Type', 'text/plain'), ('Content-Length', '9')])
        return [b'Not found']
    # The reverse proxy validates the public hostname. Django sees only this receiver.
    environ = {**environ, 'HTTP_HOST': 'localhost'}
    return django_application(environ, start_response)
