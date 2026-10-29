from collections import defaultdict
from datetime import timedelta
from math import ceil

from django.utils import timezone

from brain.models import InboundEvent, InboundPublication, InboundSync
from brain.metrics import empty_inbound
from .config import IntegrationError, load_config


def dashboard(query):
    result = empty_inbound(query)
    try:
        config = load_config().get('instagram', {})
    except IntegrationError:
        result['recomendacion']['texto'] = 'Revisá la configuración local de integraciones.'
        return result
    accounts = config.get('accounts', [])
    if not accounts:
        return result
    result['cuentas'] = [{'id': row['id'], 'handle': row['handle'], 'estado': 'activa'} for row in accounts]
    chosen = query.get('inbound_cuenta', 'todas')
    if chosen not in {row['id'] for row in accounts}:
        chosen = 'todas'
    result['filtro']['cuenta_id'] = chosen
    selected = [row for row in accounts if chosen == 'todas' or row['id'] == chosen]
    ids = [row['id'] for row in selected]
    now = timezone.now()
    days = result['filtro']['dias']
    since = now - timedelta(days=days)
    # Keep older publications available for attribution of conversions within the selected period.
    publications = list(InboundPublication.objects.filter(account_id__in=ids, published_at__lte=now).order_by('published_at', 'id'))
    by_keyword = defaultdict(list)
    for publication in publications:
        if publication.keyword:
            by_keyword[(publication.account_id, publication.keyword)].append(publication)
    rows = {p.pk: {'publicacion_id': str(p.pk), 'cuenta_id': p.account_id, 'permalink': p.permalink,
            'keyword': p.keyword, 'reproducciones': p.views, 'dms': 0, 'leads': 0, 'llamadas': 0, 'clientes': 0}
            for p in publications if p.published_at >= since}
    events = list(InboundEvent.objects.filter(account_id__in=ids, occurred_at__lte=now).order_by('occurred_at', 'id'))
    contacts = defaultdict(list)
    for event in events:
        contacts[(event.account_id, event.contact_id)].append(event)
    unresolved = set()
    totals = {'dms': 0, 'leads': 0, 'llamadas': 0, 'clientes': 0}
    for contact_events in contacts.values():
        first_dm = next((event for event in contact_events if event.kind == 'dm_keyword'), None)
        if not first_dm:
            unresolved.update(event.pk for event in contact_events if event.occurred_at >= since)
            continue
        candidates = [p for p in by_keyword[(first_dm.account_id, first_dm.keyword)] if p.published_at <= first_dm.occurred_at]
        # Reusing a keyword across videos is ambiguous: never credit one arbitrarily.
        publication = candidates[0] if len(candidates) == 1 else None
        if not publication:
            unresolved.update(event.pk for event in contact_events if event.occurred_at >= since)
            continue
        if publication.pk not in rows and any(event.occurred_at >= since for event in contact_events):
            rows[publication.pk] = {'publicacion_id': str(publication.pk), 'cuenta_id': publication.account_id,
                'permalink': publication.permalink, 'keyword': publication.keyword, 'reproducciones': publication.views,
                'dms': 0, 'leads': 0, 'llamadas': 0, 'clientes': 0}
        row = rows.get(publication.pk)
        previous = None
        stages = [('dm_keyword', 'dms'), ('lead_calificado', 'leads'), ('llamada_agendada', 'llamadas'), ('lead_cerrado', 'clientes')]
        for position, (kind, field) in enumerate(stages):
            event = next((e for e in contact_events if e.kind == kind and (previous is None or e.occurred_at >= previous.occurred_at)), None)
            if event is None:
                remaining_kinds = {stage for stage, _ in stages[position:]}
                unresolved.update(e.pk for e in contact_events if e.kind in remaining_kinds and e.occurred_at >= since)
                break
            if previous:
                unresolved.update(e.pk for e in contact_events if e.kind == kind and since <= e.occurred_at < previous.occurred_at)
            if event.occurred_at >= since:
                totals[field] += 1
                if row:
                    row[field] += 1
            previous = event
    in_period = [p for p in publications if p.published_at >= since]
    result['funnel'] = {'videos': len(in_period), 'reproducciones': sum(p.views or 0 for p in in_period), **totals}
    result['metas'] = {key: ceil(sum(a.get('targets', {}).get(key, 0) for a in selected) * days / 30) for key in result['metas']}
    # Cohorts may cross a period boundary. Ratios are shown only for first-DM cohorts in this period.
    cohort = {'dms': 0, 'leads': 0, 'llamadas': 0, 'clientes': 0}
    for contact_events in contacts.values():
        dm = next((e for e in contact_events if e.kind == 'dm_keyword'), None)
        if not dm or dm.occurred_at < since:
            continue
        candidates = [p for p in by_keyword[(dm.account_id, dm.keyword)] if p.published_at <= dm.occurred_at]
        if len(candidates) != 1:
            continue
        previous = dm
        cohort['dms'] += 1
        for kind, field in [('lead_calificado', 'leads'), ('llamada_agendada', 'llamadas'), ('lead_cerrado', 'clientes')]:
            event = next((e for e in contact_events if e.kind == kind and e.occurred_at >= previous.occurred_at), None)
            if event is None:
                break
            cohort[field] += 1
            previous = event
    result['conversiones'] = {name: cohort[b] / cohort[a] if cohort[a] else None for name, a, b in
        [('dm_a_lead', 'dms', 'leads'), ('lead_a_llamada', 'leads', 'llamadas'), ('llamada_a_cliente', 'llamadas', 'clientes')]}
    result['ranking'] = sorted(rows.values(), key=lambda row: (-row['clientes'], -row['leads'], -row['dms']))
    result['cadencia'] = {'publicados_semana': sum(p.published_at >= now - timedelta(days=7) for p in publications),
        'objetivo_semana': ceil(sum(a.get('targets', {}).get('videos', 0) for a in selected) * 7 / 30)}
    result['sinAtribucion'] = {'publicaciones': sum(not p.keyword for p in in_period), 'eventos': {'total': len(unresolved)}}
    result['sync'] = {'cuentas': {row.account_id: {'ultimo_exito': row.succeeded_at.isoformat() if row.succeeded_at else None,
        'ultimo_error': row.error, 'parcial': row.truncated} for row in InboundSync.objects.filter(account_id__in=ids)}}
    missing = sum(p.views is None for p in in_period)
    result['recomendacion']['texto'] = 'Conversiones por primer DM; contactos únicos. Las reproducciones son acumuladas por video.'
    if missing:
        result['recomendacion']['texto'] += f' Instagram no devolvió reproducciones para {missing} video(s); el total es parcial.'
    if any(state['parcial'] for state in result['sync']['cuentas'].values()):
        result['recomendacion']['texto'] += ' Se alcanzó el límite de 50 publicaciones por cuenta; puede faltar historial.'
    if unresolved:
        result['recomendacion']['texto'] += ' Hay eventos sin atribución: revisá keywords repetidas y el orden de los eventos.'
    return result
