"""Metrics shared by all dashboard views. Amounts are summed as decimals."""
from calendar import monthrange
from datetime import date, datetime, timezone
from decimal import Decimal

STAGES = ('conversacion', 'call_agendada', 'propuesta', 'cerrado', 'perdido')
OPEN_STAGES = STAGES[:3]


def money(value):
    return Decimal(str(value))


def total(rows, key):
    return sum((money(row[key]) for row in rows), Decimal(0))


def next_month(month, offset=1):
    year, number = map(int, month.split('-'))
    year, number = divmod(year * 12 + number - 1 + offset, 12)
    return f'{year:04d}-{number + 1:02d}'


def day_in_month(month, day):
    year, number = map(int, month.split('-'))
    return f'{month}-{min(day, monthrange(year, number)[1]):02d}'


def months(start, end):
    while start <= end:
        yield start
        start = next_month(start)


def expense_occurrences(expense, today):
    if expense['tipo'] != 'mensual':
        return [expense['fecha']] if expense['fecha'] <= today else []
    return [day for month in months(expense['fecha'][:7], today[:7])
            if expense['fecha'] <= (day := day_in_month(month, int(expense['fecha'][8:]))) <= today]


def balance(box, receipts, expenses, transfers, today):
    start = box['fecha_saldo_inicial']
    value = money(box['saldo_inicial'])
    for item in receipts:
        if item.get('caja_id') == box['id'] and start <= item['fecha'] <= today:
            value += money(item['monto'])
    for item in expenses:
        if item.get('caja_id') == box['id']:
            value -= money(item['monto']) * sum(day >= start for day in expense_occurrences(item, today))
    for item in transfers:
        if start <= item['fecha'] <= today:
            if item['tipo'] == 'transferencia' and item.get('origen_id') == box['id']:
                value -= money(item['monto'])
            if item['destino_id'] == box['id']:
                value += money(item['monto'])
    return value


def monthly_expenses(expenses, month):
    return total([item for item in expenses if (item['fecha'][:7] <= month if item['tipo'] == 'mensual' else item['fecha'][:7] == month)], 'monto')


def financial_series(receipts, expenses, today):
    dates = [row['fecha'][:7] for row in receipts + expenses]
    if not dates:
        return []
    current = today[:7]
    limit = next_month(current, 12)
    first = min(dates)
    start = first if first > limit else min(first, current)
    end = max(start, min(max(dates + [current]), limit))
    accumulated = Decimal(0)
    series = []
    for month in months(start, end):
        received = total([row for row in receipts if row['fecha'][:7] == month], 'monto')
        spent = monthly_expenses(expenses, month)
        profit = received - spent
        accumulated += profit
        series.append({'mes': month, 'cobros': float(received), 'costos': float(spent), 'ganancia': float(profit), 'acumulado': float(accumulated)})
    return series


def cash_series(boxes, receipts, expenses, transfers, today):
    active = [box for box in boxes if box['fecha_saldo_inicial'] <= today]
    if not active:
        return []
    start = min(box['fecha_saldo_inicial'][:7] for box in active)
    series = []
    for month in months(start, today[:7]):
        cutoff = min(today, day_in_month(month, 31))
        amount = sum((balance(box, receipts, expenses, transfers, cutoff) for box in active if box['fecha_saldo_inicial'] <= cutoff), Decimal(0))
        series.append({'mes': month, 'corte': cutoff, 'caja': float(amount)})
    return series


def client_health(client, receipts, today):
    if client['estado'] != 'activo':
        return 'inactivo', None, None
    renewal = (date.fromisoformat(client['proxima_renovacion']) - date.fromisoformat(today)).days
    if client['fecha_inicio'] > today:
        return 'futuro', None, renewal
    paid = any(row['cliente_id'] == client['id'] and row['fecha'][:7] == today[:7] for row in receipts)
    due = day_in_month(today[:7], int(client['fecha_inicio'][8:]))
    delay = (date.fromisoformat(today) - date.fromisoformat(due)).days if not paid else 0
    overdue = delay if delay > 0 else None
    status = 'rojo' if renewal < 0 or delay > 3 else 'amarillo' if renewal < 15 or overdue else 'verde'
    return status, overdue, renewal


def empty_inbound(query):
    days = query.get('inbound_dias', '30')
    days = int(days) if days in ('7', '30', '90') else 30
    return {
        'cuentas': [], 'filtro': {'cuenta_id': 'todas', 'dias': days},
        'funnel': {'videos': 0, 'dms': 0, 'leads': 0, 'llamadas': 0, 'clientes': 0, 'reproducciones': 0},
        'metas': {'videos': 0, 'dms': 0, 'leads': 0, 'llamadas': 0, 'clientes': 0},
        'conversiones': {'dm_a_lead': None, 'lead_a_llamada': None, 'llamada_a_cliente': None},
        'recomendacion': {'texto': 'No hay una integración de Instagram conectada en esta instalación.'},
        'ranking': [], 'sync': {'cuentas': {}},
        'cadencia': {'publicados_semana': 0, 'objetivo_semana': 0},
        'sinAtribucion': {'publicaciones': 0, 'eventos': {'total': 0}},
    }


def build_state(data, today, query):
    clients, leads, boxes = data['clientes'], data['leads'], data['cajas']
    receipts, expenses, transfers = data['cobros'], data['gastos'], data['movimientos']
    active = [client for client in clients if client['estado'] == 'activo' and client['fecha_inicio'] <= today]
    received = total([row for row in receipts if row['fecha'][:7] == today[:7]], 'monto')
    spent = monthly_expenses(expenses, today[:7])
    balances = {box['id']: float(balance(box, receipts, expenses, transfers, today)) for box in boxes}
    pipeline = {stage: {'cantidad': len(rows := [lead for lead in leads if lead['etapa'] == stage]), 'valor': float(total(rows, 'valor_mensual'))} for stage in STAGES}
    resolved = pipeline['cerrado']['cantidad'] + pipeline['perdido']['cantidad']
    health, alerts = {}, []
    for box in boxes:
        if balances[box['id']] < 0:
            alerts.append({'tipo': 'caja_negativa', 'severidad': 'critical', 'mensaje': f"La caja {box['nombre']} tiene saldo negativo: revisá sus movimientos"})
    for client in clients:
        status, delay, renewal = client_health(client, receipts, today)
        health[client['id']] = status
        if status == 'inactivo':
            continue
        if renewal < 0 and status != 'futuro':
            alerts.append({'tipo': 'renovacion_vencida', 'severidad': 'critical', 'mensaje': f"La renovación de {client['nombre']} venció hace {-renewal} días"})
        elif 0 <= renewal < 15:
            alerts.append({'tipo': 'renovacion_proxima', 'severidad': 'warning', 'mensaje': f"{client['nombre']} renueva en {renewal} días"})
        if delay:
            alerts.append({'tipo': 'cobro_pendiente', 'severidad': 'critical' if delay > 3 else 'warning', 'mensaje': f"Sin cobro de {client['nombre']}: venció hace {delay} días"})
    for lead in leads:
        delay = (date.fromisoformat(today) - date.fromisoformat(lead['actualizado'])).days
        if lead['etapa'] in OPEN_STAGES and delay > 7:
            alerts.append({'tipo': 'lead_frio', 'severidad': 'warning', 'mensaje': f"Lead {lead['nombre']} sin movimiento hace {delay} días"})
    return {
        'generado': datetime.now(timezone.utc).isoformat(), 'hoy': today,
        'datos': {'clientes': clients, 'leads': leads, 'finanzas': {'cobros': receipts, 'gastos': expenses},
                  'cajas': boxes, 'movimientos': transfers, 'tickets': data['tickets'], 'tareas': data['tareas']},
        'errores': [], 'alertas': alerts, 'sync': {'pendientes': False, 'ultimoError': None},
        'metricas': {
            'mrr': float(total(active, 'precio_mensual')), 'cuentas': sum(row['cuentas'] for row in active),
            'clientesActivos': len(active), 'cobrosMes': float(received), 'costosMes': float(spent),
            'resultadoMes': float(received - spent), 'serie': financial_series(receipts, expenses, today),
            'serieCaja': cash_series(boxes, receipts, expenses, transfers, today), 'pipeline': pipeline,
            'tasaCierre': pipeline['cerrado']['cantidad'] / resolved if resolved else None,
            'salud': health, 'saldos': balances, 'inbound': empty_inbound(query),
        },
    }
