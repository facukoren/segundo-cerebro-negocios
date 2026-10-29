from datetime import date
from django.db import migrations


def import_records(apps, schema_editor):
    alias = schema_editor.connection.alias
    Record = apps.get_model('brain', 'Record')
    Client = apps.get_model('brain', 'Client')
    Lead = apps.get_model('brain', 'Lead')
    Entry = apps.get_model('brain', 'Entry')
    Task = apps.get_model('brain', 'Task')
    today = date.today().isoformat()
    clients = {}
    for client in Client.objects.using(alias).all():
        notes = client.notes
        if not client.start_date or not client.next_renewal:
            notes += '\nImportado: confirmar fechas de inicio y renovación.'
        row = Record.objects.using(alias).create(collection='clientes', payload={
            'nombre': client.name, 'estado': client.status, 'cuentas': 1,
            'precio_mensual': float(client.monthly_fee), 'notas': notes.strip(),
            'fecha_inicio': client.start_date.isoformat() if client.start_date else today,
            'proxima_renovacion': client.next_renewal.isoformat() if client.next_renewal else today,
        })
        clients[client.pk] = str(row.id)
    stages = {'nuevo': 'conversacion', 'contactado': 'conversacion', 'propuesta': 'propuesta', 'ganado': 'cerrado', 'perdido': 'perdido'}
    for lead in Lead.objects.using(alias).all():
        Record.objects.using(alias).create(collection='leads', payload={
            'nombre': lead.name, 'etapa': stages[lead.stage], 'origen': 'referido',
            'cuentas_propuestas': None, 'monto_total': float(lead.estimated_monthly_value), 'plazos': 1,
            'valor_mensual': float(lead.estimated_monthly_value), 'responsable': 'equipo',
            'creado': lead.updated_at.date().isoformat(), 'actualizado': lead.updated_at.date().isoformat(),
            'notas': (lead.notes + '\nOrigen anterior: ' + lead.source).strip(),
        })
    for entry in Entry.objects.using(alias).all():
        payload = {'fecha': entry.date.isoformat(), 'monto': float(entry.amount), 'caja_id': None, 'concepto': entry.description}
        if entry.kind == 'cobro':
            payload.update(cliente_id=clients.get(entry.client_id, 'otros'), metodo='otro')
            collection = 'cobros'
        else:
            payload['tipo'] = 'unico'
            collection = 'gastos'
        Record.objects.using(alias).create(collection=collection, payload=payload)
    for task in Task.objects.using(alias).all():
        Record.objects.using(alias).create(collection='tareas', payload={
            'titulo': task.title, 'completada': task.done, 'creado_por': 'equipo', 'creado': today, 'actualizado': today,
        })


class Migration(migrations.Migration):
    dependencies = [('brain', '0002_record')]
    operations = [migrations.RunPython(import_records, reverse_code=migrations.RunPython.noop)]
