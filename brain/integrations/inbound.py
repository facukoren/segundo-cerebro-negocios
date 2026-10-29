"""Instagram synchronization and authenticated inbound events."""
import hashlib
import hmac
import json
import re
import time
from datetime import timedelta, timezone as utc_timezone

from django.core.exceptions import RequestDataTooBig
from django.db import transaction, OperationalError
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt

from brain.api import Invalid, api_view, read_body, validate
from brain.models import InboundContact, InboundEvent, InboundPublication, InboundSync, Record
from .config import IntegrationError, load_config, text
from .locks import acquire, release
from .transport import ProviderError, open_request, read_json

EVENT_TYPES = ('dm_keyword', 'lead_calificado', 'llamada_agendada')


def timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise IntegrationError('Fecha inválida: usá ISO 8601 con zona horaria.')
    try:
        result = parse_datetime(value)
    except ValueError:
        result = None
    if not result or timezone.is_naive(result) or result.year < 2000 or result > timezone.now() + timedelta(minutes=5):
        raise IntegrationError('Fecha inválida: usá ISO 8601 con zona horaria y sin fechas futuras.')
    return result.astimezone(utc_timezone.utc)


def keyword_from(caption, keywords):
    matches = [key for key in keywords if re.search(r'(?<![\w-])' + re.escape(key) + r'(?![\w-])', caption.upper())]
    return matches[0] if len(matches) == 1 else ''


def graph(config, account, suffix, query):
    path = '/' + config['version'] + '/' + suffix
    return read_json(open_request('Instagram', path, account['token'], query=query), 'Instagram')


def sync_all():
    config = load_config().get('instagram')
    if not config:
        raise IntegrationError('Configurá Instagram con: python manage.py configure_integrations instagram')
    holder = acquire('inbound-sync', seconds=600)
    if not holder:
        raise IntegrationError('Ya hay una sincronización en curso. Intentá más tarde.')
    results, deadline = [], time.monotonic() + 180
    try:
        for account in config['accounts']:
            now = timezone.now()
            sync, _ = InboundSync.objects.get_or_create(account_id=account['id'])
            if sync.attempted_at and now - sync.attempted_at < timedelta(seconds=60):
                results.append({'cuenta': account['id'], 'estado': 'espera', 'mensaje': 'Esperá un minuto entre sincronizaciones.'})
                continue
            sync.attempted_at = now
            sync.save(update_fields=['attempted_at'])
            try:
                publications, cursor, truncated = [], None, False
                seen = set()
                for page in range(2):
                    if time.monotonic() >= deadline:
                        raise IntegrationError('Se alcanzó el tiempo máximo de sincronización. Volvé a sincronizar.')
                    query = {'fields': 'id,caption,media_type,media_product_type,timestamp,permalink', 'limit': 25}
                    if cursor:
                        query['after'] = cursor
                    body = graph(config, account, account['user_id'] + '/media', query)
                    rows = body.get('data')
                    if not isinstance(rows, list) or len(rows) > 100:
                        raise ProviderError('Instagram')
                    for item in rows:
                        if item.get('media_type') != 'VIDEO' and item.get('media_product_type') != 'REELS':
                            continue
                        identity = text(item.get('id'), 'media ID', r'\d{1,40}')
                        published = timestamp(item.get('timestamp'))
                        if published < now - timedelta(days=90):
                            continue
                        if time.monotonic() >= deadline:
                            raise IntegrationError('Se alcanzó el tiempo máximo de sincronización. Volvé a sincronizar.')
                        views = None
                        insights = graph(config, account, identity + '/insights', {'metric': 'views'})
                        for metric in insights.get('data', []):
                            if metric.get('name') == 'views':
                                values = metric.get('values') or []
                                value = values[0].get('value') if values else metric.get('total_value', {}).get('value')
                                if type(value) is int and 0 <= value <= 9223372036854775807:
                                    views = value
                        caption = str(item.get('caption') or '')[:10000]
                        link = str(item.get('permalink') or '')
                        if not re.fullmatch(r'https://(?:www\.)?instagram\.com/[A-Za-z0-9_/?=.-]{1,450}', link):
                            link = ''
                        publications.append((identity, {'published_at': published, 'caption': caption, 'permalink': link,
                            'keyword': keyword_from(caption, account.get('keywords', [])), 'views': views}))
                    paging = body.get('paging') or {}
                    # Never follow paging.next: it may contain a credential or a different host.
                    cursor = (paging.get('cursors') or {}).get('after') if paging.get('next') else None
                    if not cursor:
                        break
                    if not isinstance(cursor, str) or len(cursor) > 2048 or cursor in seen:
                        raise ProviderError('Instagram')
                    seen.add(cursor)
                    truncated = page == 1
                with transaction.atomic():
                    for identity, defaults in publications:
                        InboundPublication.objects.update_or_create(account_id=account['id'], media_id=identity, defaults=defaults)
                    sync.succeeded_at, sync.error, sync.truncated = now, '', truncated
                    sync.save(update_fields=['succeeded_at', 'error', 'truncated'])
                results.append({'cuenta': account['id'], 'estado': 'ok', 'videos': len(publications), 'parcial': truncated})
            except (IntegrationError, TypeError, AttributeError, KeyError):
                # Provider payloads and exceptions can contain credentials: persist fixed text only.
                sync.error = 'No se pudo sincronizar. Revisá token, permisos, versión y disponibilidad de Instagram.'
                sync.save(update_fields=['error'])
                results.append({'cuenta': account['id'], 'estado': 'error', 'mensaje': sync.error})
    finally:
        release('inbound-sync', holder)
    return results


@api_view
def sync(request):
    if request.method != 'POST':
        return JsonResponse({'errores': ['Método no permitido.']}, status=405)
    try:
        result = sync_all()
    except IntegrationError as error:
        return JsonResponse({'errores': [str(error)]}, status=503)
    return JsonResponse({'cuentas': result}, status=502 if any(row['estado'] == 'error' for row in result) else 200)


def ingest(body):
    allowed = {'event_type', 'account_id', 'contact_id', 'keyword', 'occurred_at', 'contact_name', 'event_id'}
    if set(body) - allowed:
        raise IntegrationError('El evento contiene campos no admitidos.')
    config = load_config()
    kind = body.get('event_type')
    if kind not in EVENT_TYPES:
        raise IntegrationError('Tipo de evento inválido.')
    account_id = text(body.get('account_id'), 'account_id', r'[a-z0-9_-]{1,40}')
    account = next((row for row in config.get('instagram', {}).get('accounts', []) if row['id'] == account_id), None)
    if not account:
        raise IntegrationError('La cuenta no está configurada.')
    contact = text(body.get('contact_id'), 'contact_id', r'[A-Za-z0-9_.:-]{1,128}')
    keyword = text(body.get('keyword'), 'keyword', r'[A-Z0-9_-]{1,40}')
    if keyword not in account.get('keywords', []):
        raise IntegrationError('La keyword no está configurada para esa cuenta.')
    occurred = timestamp(body.get('occurred_at'))
    name = text(body.get('contact_name'), 'contact_name') if kind == 'lead_calificado' else ''
    identity = body.get('event_id')
    if identity is not None:
        text(identity, 'event_id', r'[A-Za-z0-9_.:-]{1,128}')
    key_data = [account_id, identity] if identity else [account_id, contact, kind, keyword, occurred.isoformat()]
    key = hashlib.sha256(json.dumps(key_data).encode()).hexdigest()
    with transaction.atomic():
        event, created = InboundEvent.objects.get_or_create(key=key, defaults={
            'account_id': account_id, 'contact_id': contact, 'kind': kind, 'keyword': keyword, 'occurred_at': occurred})
        if not created:
            if (event.account_id, event.contact_id, event.kind, event.keyword, event.occurred_at) != (account_id, contact, kind, keyword, occurred):
                raise IntegrationError('El event_id ya se usó para otro evento.')
            return {'duplicado': True}
        link, _ = InboundContact.objects.get_or_create(account_id=account_id, contact_id=contact)
        link = InboundContact.objects.select_for_update().get(pk=link.pk)
        if kind == 'lead_calificado' and link.lead_id is None:
            today = timezone.localdate().isoformat()
            first = InboundEvent.objects.filter(account_id=account_id, contact_id=contact, kind='dm_keyword').order_by('occurred_at', 'id').first()
            data = validate('leads', {'nombre': name, 'origen': 'inbound'}, today)
            data.update(creado=today, actualizado=today, valor_mensual=0,
                inbound={'cuenta_id': account_id, 'contact_id': contact, 'first_keyword': first.keyword if first else keyword})
            link.lead = Record.objects.create(collection='leads', payload=data)
            link.save(update_fields=['lead'])
        qualification = InboundEvent.objects.filter(account_id=account_id, contact_id=contact, kind='lead_calificado').order_by('occurred_at', 'id').first()
        has_call = qualification and InboundEvent.objects.filter(account_id=account_id, contact_id=contact, kind='llamada_agendada', occurred_at__gte=qualification.occurred_at).exists()
        if has_call and link.lead_id:
            lead = Record.objects.select_for_update().get(pk=link.lead_id)
            if lead.payload.get('etapa') == 'conversacion':
                lead.payload = {**lead.payload, 'etapa': 'call_agendada', 'actualizado': timezone.localdate().isoformat()}
                lead.save(update_fields=['payload'])
    return {'duplicado': False}


def record_closed(record):
    if record.collection != 'leads' or record.payload.get('etapa') != 'cerrado':
        return
    link = InboundContact.objects.filter(lead=record).first()
    if not link:
        return
    first = InboundEvent.objects.filter(account_id=link.account_id, contact_id=link.contact_id, kind='dm_keyword').order_by('occurred_at', 'id').first()
    keyword = first.keyword if first else record.payload.get('inbound', {}).get('first_keyword', '')
    key = hashlib.sha256(('closed:' + str(record.id)).encode()).hexdigest()
    InboundEvent.objects.get_or_create(key=key, defaults={'account_id': link.account_id, 'contact_id': link.contact_id,
        'kind': 'lead_cerrado', 'keyword': keyword, 'occurred_at': timezone.now()})


@csrf_exempt
@never_cache
def webhook(request):
    if request.method != 'POST':
        return JsonResponse({'errores': ['Método no permitido.']}, status=405)
    try:
        expected = load_config().get('webhook', {}).get('secret', '')
        supplied = request.headers.get('Authorization', '')
        if not expected or len(supplied) > 256 or not hmac.compare_digest(supplied.encode(), ('Bearer ' + expected).encode()):
            return JsonResponse({'errores': ['No autorizado.']}, status=401)
        result = ingest(read_body(request))
        return JsonResponse(result, status=200 if result['duplicado'] else 201)
    except (Invalid, IntegrationError, RequestDataTooBig):
        return JsonResponse({'errores': ['Evento o configuración inválidos. Revisá los campos y la cuenta.']}, status=400)
    except OperationalError:
        return JsonResponse({'errores': ['Base ocupada; reintentá con el mismo evento.']}, status=503)
