"""Authenticated API for the dashboard. Every write is validated before persistence."""
import json
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import wraps

from django.core.exceptions import RequestDataTooBig, ValidationError
from django.db import transaction, OperationalError
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache

from .models import Record
from .metrics import build_state

REQUIRED = object()
STAGES = ('conversacion', 'call_agendada', 'propuesta', 'cerrado', 'perdido')
# kind, default, allowed values (for choices).
SCHEMAS = {
    'leads': {
        'nombre': ('name', REQUIRED), 'origen': ('choice', REQUIRED, ('outreach', 'inbound', 'referido')),
        'etapa': ('choice', 'conversacion', STAGES), 'cuentas_propuestas': ('count?', None),
        'monto_total': ('money', 0), 'plazos': ('count', 1), 'responsable': ('name', 'equipo'), 'notas': ('text', ''),
    },
    'clientes': {
        'nombre': ('name', REQUIRED), 'cuentas': ('count', 1), 'precio_mensual': ('money', REQUIRED),
        'fecha_inicio': ('date', 'today'), 'proxima_renovacion': ('date', REQUIRED),
        'estado': ('choice', 'activo', ('activo', 'pausado', 'baja')), 'notas': ('text', ''),
    },
    'cobros': {
        'cliente_id': ('name', REQUIRED), 'monto': ('positive', REQUIRED), 'fecha': ('date', 'today'),
        'metodo': ('name', 'transferencia'), 'concepto': ('text', ''), 'caja_id': ('ref?', None),
    },
    'gastos': {
        'concepto': ('name', REQUIRED), 'monto': ('positive', REQUIRED), 'fecha': ('date', 'today'),
        'tipo': ('choice', 'unico', ('unico', 'mensual')), 'caja_id': ('ref?', None),
    },
    'cajas': {
        'nombre': ('name', REQUIRED), 'saldo_inicial': ('money', 0),
        'fecha_saldo_inicial': ('date', 'today'), 'notas': ('text', ''),
    },
    'movimientos': {
        'fecha': ('date', 'today'), 'tipo': ('choice', REQUIRED, ('transferencia', 'ajuste')),
        'origen_id': ('ref?', None), 'destino_id': ('name', REQUIRED), 'monto': ('signed', REQUIRED), 'nota': ('text', ''),
    },
    'tickets': {
        'titulo': ('name', REQUIRED), 'detalle': ('text', ''),
        'tipo': ('choice', 'pedido', ('pedido', 'bug', 'idea')),
        'prioridad': ('choice', 'normal', ('normal', 'alta', 'urgente')),
        'estado': ('choice', 'pendiente', ('pendiente', 'en_progreso', 'resuelto')),
        'respuesta': ('text', ''), 'archivado': ('bool', False),
    },
    'tareas': {'titulo': ('name', REQUIRED), 'completada': ('bool', False)},
}
PATCH_FIELDS = {
    'leads': set(SCHEMAS['leads']), 'clientes': set(SCHEMAS['clientes']), 'cajas': set(SCHEMAS['cajas']),
    'tickets': {'estado', 'prioridad', 'respuesta', 'archivado'}, 'tareas': {'completada'},
}
DELETABLE = {'leads', 'cobros', 'gastos', 'cajas', 'movimientos'}


class Invalid(ValueError):
    pass


def api_view(fn):
    @wraps(fn)
    @never_cache
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'errores': ['Iniciá sesión para continuar.']}, status=401)
        try:
            return fn(request, *args, **kwargs)
        except Record.DoesNotExist:
            return JsonResponse({'errores': ['El registro no existe.']}, status=404)
        except (Invalid, RequestDataTooBig) as error:
            message = str(error) if isinstance(error, Invalid) else 'El pedido supera el tamaño permitido.'
            return JsonResponse({'errores': [message]}, status=400)
        except OperationalError:
            return JsonResponse({'errores': ['La base está ocupada. Intentá de nuevo.']}, status=503)
    return wrapped


def read_body(request):
    if request.content_type != 'application/json':
        raise Invalid('Enviá un objeto JSON.')
    try:
        data = json.loads(request.body, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeDecodeError):
        raise Invalid('JSON inválido.')
    if not isinstance(data, dict):
        raise Invalid('El cuerpo debe ser un objeto.')
    return data


def validate(collection, incoming, today, current=None):
    schema = SCHEMAS[collection]
    if set(incoming) - set(schema):
        raise Invalid('El pedido contiene campos no admitidos.')
    result = dict(current or {})
    for key, spec in schema.items():
        kind, default, *choices = spec
        value = incoming.get(key, result.get(key, today if default == 'today' else default))
        if value is REQUIRED:
            raise Invalid(f'{key}: campo requerido.')
        if kind.endswith('?') and value is None:
            result[key] = None
            continue
        if kind in ('name', 'text', 'ref?', 'choice'):
            if not isinstance(value, str) or len(value) > (20000 if kind == 'text' else 200):
                raise Invalid(f'{key}: texto inválido o demasiado largo.')
            value = value.strip()
            if kind != 'text' and not value:
                raise Invalid(f'{key}: no puede estar vacío.')
            if kind == 'choice' and value not in choices[0]:
                raise Invalid(f'{key}: opción inválida.')
        elif kind == 'date':
            try:
                parsed = date.fromisoformat(value)
                if parsed.isoformat() != value or not 2000 <= parsed.year <= 2100:
                    raise ValueError()
            except (ValueError, TypeError):
                raise Invalid(f'{key}: usá una fecha válida (YYYY-MM-DD).')
        elif kind in ('count', 'count?'):
            if type(value) is not int or not 1 <= value <= 1000000:
                raise Invalid(f'{key}: debe ser un entero entre 1 y 1000000.')
        elif kind == 'bool':
            if type(value) is not bool:
                raise Invalid(f'{key}: debe ser true o false.')
        else:
            if type(value) not in (int, float):
                raise Invalid(f'{key}: debe ser un número.')
            try:
                amount = Decimal(str(value))
                if not amount.is_finite() or abs(amount) > Decimal('9999999999.99') or amount.quantize(Decimal('.01')) != amount:
                    raise InvalidOperation()
                if (kind == 'money' and amount < 0) or (kind == 'positive' and amount <= 0) or (kind == 'signed' and amount == 0):
                    raise InvalidOperation()
            except InvalidOperation:
                raise Invalid(f'{key}: monto inválido; usá hasta dos decimales.')
            value = float(amount)
        result[key] = value
    return result


def require_reference(collection, record_id):
    try:
        exists = Record.objects.filter(collection=collection, pk=record_id).exists()
    except (ValueError, TypeError, ValidationError):
        exists = False
    if not exists:
        raise Invalid('El cliente o la caja seleccionada no existe.')


def validate_relations(collection, data):
    if data.get('caja_id'):
        require_reference('cajas', data['caja_id'])
    if collection == 'cobros':
        if data['cliente_id'] == 'otros':
            if not data['concepto']:
                raise Invalid('El concepto es obligatorio para otros cobros.')
        else:
            require_reference('clientes', data['cliente_id'])
            data['concepto'] = ''
    if collection == 'movimientos':
        require_reference('cajas', data['destino_id'])
        if data['tipo'] == 'transferencia':
            require_reference('cajas', data['origen_id'])
            if data['origen_id'] == data['destino_id'] or data['monto'] <= 0:
                raise Invalid('La transferencia necesita cajas distintas y un monto positivo.')
        elif data.get('origen_id'):
            raise Invalid('Un ajuste no lleva caja de origen.')


def serialized(record):
    return {**record.payload, 'id': str(record.id)}


@api_view
def records(request, collection, record_id=None):
    if collection not in SCHEMAS:
        return JsonResponse({'errores': ['Recurso no encontrado.']}, status=404)
    if request.method == 'POST' and record_id is None:
        pass
    elif request.method == 'PATCH' and record_id and collection in PATCH_FIELDS:
        pass
    elif request.method == 'DELETE' and record_id and collection in DELETABLE:
        pass
    else:
        return JsonResponse({'errores': ['Método no permitido.']}, status=405)
    today = timezone.localdate().isoformat()
    with transaction.atomic():
        row = Record.objects.select_for_update().get(pk=record_id, collection=collection) if record_id else None
        if request.method == 'DELETE':
            if collection == 'cajas' and Record.objects.filter(
                Q(payload__caja_id=str(record_id)) | Q(payload__origen_id=str(record_id)) | Q(payload__destino_id=str(record_id))
            ).exists():
                raise Invalid('La caja tiene movimientos asociados y no se puede eliminar.')
            result = serialized(row)
            row.delete()
            return JsonResponse(result)
        body = read_body(request)
        if collection in ('tickets', 'tareas'):
            body.pop('creado_por', None)
        if row and set(body) - PATCH_FIELDS[collection]:
            raise Invalid('Esos campos no se pueden modificar.')
        data = validate(collection, body, today, row.payload if row else None)
        validate_relations(collection, data)
        if collection == 'leads':
            data['valor_mensual'] = float((Decimal(str(data['monto_total'])) / data['plazos']).quantize(Decimal('.01'), rounding=ROUND_HALF_UP))
        if collection in ('leads', 'tickets', 'tareas'):
            data['creado'] = data.get('creado', today)
            data['actualizado'] = today
        if collection in ('tickets', 'tareas') and not row:
            data['creado_por'] = request.user.get_username()
        if row:
            row.payload = data
            row.save(update_fields=['payload'])
        else:
            row = Record.objects.create(collection=collection, payload=data)
        if collection == 'leads':
            from .integrations.inbound import record_closed
            record_closed(row)
        return JsonResponse(serialized(row), status=200 if record_id else 201)


@api_view
def state(request):
    if request.method != 'GET':
        return JsonResponse({'errores': ['Método no permitido.']}, status=405)
    collections = {name: [] for name in SCHEMAS}
    for row in Record.objects.all():
        if row.collection in collections:
            collections[row.collection].append(serialized(row))
    from .integrations.config import public_status
    from .integrations.inbound_metrics import dashboard
    result = build_state(collections, timezone.localdate().isoformat(), request.GET)
    result['metricas']['inbound'] = dashboard(request.GET)
    result['integraciones'] = public_status()
    return JsonResponse(result)
