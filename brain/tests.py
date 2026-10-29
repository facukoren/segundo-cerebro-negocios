from django.contrib.auth import get_user_model
from django.test import Client as Browser, TestCase

from .metrics import build_state
from .models import Record


class DashboardTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_superuser('owner', '', 'a strong test password 123')

    def setUp(self):
        self.client.force_login(self.user)

    def post(self, collection, data):
        response = self.client.post('/api/' + collection, data, content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_anonymous_cannot_access_pages_or_api(self):
        browser = Browser()
        self.assertEqual(browser.get('/').status_code, 302)
        for path in ('/api/estado', '/api/leads', '/api/clientes', '/api/consultor/mensajes'):
            self.assertEqual(browser.get(path).status_code, 401)

    def test_csrf_required_for_login_and_api(self):
        browser = Browser(enforce_csrf_checks=True)
        self.assertEqual(browser.post('/login/', {'username': 'owner', 'password': 'a strong test password 123'}).status_code, 403)
        browser.force_login(self.user)
        self.assertEqual(browser.post('/api/tareas', {'titulo': 'Example'}, content_type='application/json').status_code, 403)
        browser.get('/')
        token = browser.cookies['csrftoken'].value
        response = browser.post('/api/tareas', {'titulo': 'Example'}, content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 201)

    def test_dashboard_and_auth_settings(self):
        response = self.client.get('/')
        self.assertContains(response, 'id="dialogo-cliente"')
        self.assertContains(response, 'id="pagina-pipeline"')
        self.assertContains(response, 'id="pagina-finanzas"')
        self.assertContains(response, 'csrf-token')
        self.assertIn('no-store', response.headers['Cache-Control'])
        self.assertTrue(self.user.password.startswith('argon2$'))

    def test_lead_create_move_and_remove(self):
        lead = self.post('leads', {'nombre': '<img src=x onerror=alert(1)>', 'origen': 'inbound', 'monto_total': 100, 'plazos': 3})
        self.assertEqual(lead['valor_mensual'], 33.33)
        response = self.client.patch('/api/leads/' + lead['id'], {'etapa': 'propuesta'}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        state = self.client.get('/api/estado').json()
        self.assertEqual(state['metricas']['pipeline']['propuesta']['cantidad'], 1)
        self.assertEqual(self.client.delete('/api/leads/' + lead['id']).status_code, 200)

    def test_real_cash_flow_and_protected_box_deletion(self):
        box = self.post('cajas', {'nombre': 'Banco demo', 'fecha_saldo_inicial': '2026-01-01'})
        other = self.post('cajas', {'nombre': 'Otra caja', 'fecha_saldo_inicial': '2026-01-01'})
        client = self.post('clientes', {'nombre': 'Cliente demo', 'precio_mensual': 200, 'proxima_renovacion': '2027-01-01', 'fecha_inicio': '2026-01-01'})
        self.post('cobros', {'cliente_id': client['id'], 'monto': 200, 'caja_id': box['id'], 'fecha': '2026-01-01'})
        self.post('gastos', {'concepto': 'Herramienta', 'monto': 20, 'caja_id': box['id'], 'fecha': '2026-01-01'})
        self.post('movimientos', {'tipo': 'transferencia', 'origen_id': box['id'], 'destino_id': other['id'], 'monto': 40, 'fecha': '2026-01-01'})
        state = self.client.get('/api/estado').json()
        self.assertEqual(state['metricas']['saldos'][box['id']], 140)
        self.assertEqual(state['metricas']['saldos'][other['id']], 40)
        self.assertEqual(self.client.delete('/api/cajas/' + box['id']).status_code, 400)

    def test_validation_rejects_invalid_dates_numbers_fields_and_relations(self):
        for data in (
            {'nombre': 'X', 'precio_mensual': -1, 'proxima_renovacion': '2027-01-01'},
            {'nombre': 'X', 'precio_mensual': 1, 'proxima_renovacion': '2026-02-30'},
            {'nombre': 'X', 'precio_mensual': True, 'proxima_renovacion': '2027-01-01'},
            {'nombre': 'X', 'precio_mensual': 0.001, 'proxima_renovacion': '2027-01-01'},
            {'nombre': 'X', 'precio_mensual': 1, 'proxima_renovacion': '2027-01-01', 'id': 'override'},
        ):
            self.assertEqual(self.client.post('/api/clientes', data, content_type='application/json').status_code, 400)
        self.assertEqual(self.client.post('/api/cobros', {'cliente_id': 'invalid', 'monto': 5}, content_type='application/json').status_code, 400)
        self.assertEqual(Record.objects.count(), 0)

    def test_tasks_tickets_and_unconfigured_services(self):
        task = self.post('tareas', {'titulo': 'Example', 'creado_por': 'spoof'})
        self.assertEqual(task['creado_por'], 'owner')
        self.assertEqual(self.client.patch('/api/tareas/' + task['id'], {'completada': True}, content_type='application/json').status_code, 200)
        ticket = self.post('tickets', {'titulo': 'Example'})
        self.assertEqual(self.client.patch('/api/tickets/' + ticket['id'], {'estado': 'resuelto', 'archivado': True}, content_type='application/json').status_code, 200)
        response = self.client.post('/api/consultor/mensajes', {'texto': 'Example'}, content_type='application/json')
        self.assertEqual(response.status_code, 503)
        self.assertIn('no está conectado', response.json()['errores'][0])

    def test_recurring_expenses_and_future_client(self):
        data = {key: [] for key in ('clientes', 'leads', 'cajas', 'cobros', 'gastos', 'movimientos', 'tickets', 'tareas')}
        data['cajas'] = [{'id': 'box', 'nombre': 'Demo', 'saldo_inicial': 100, 'fecha_saldo_inicial': '2026-01-01'}]
        data['gastos'] = [{'monto': 10, 'fecha': '2026-01-31', 'tipo': 'mensual', 'caja_id': 'box'}]
        data['clientes'] = [{'id': 'client', 'nombre': 'Demo', 'cuentas': 1, 'precio_mensual': 50, 'estado': 'activo', 'fecha_inicio': '2026-03-10', 'proxima_renovacion': '2026-04-10'}]
        state = build_state(data, '2026-02-28', {})
        self.assertEqual(state['metricas']['saldos']['box'], 80)
        self.assertEqual(state['metricas']['costosMes'], 10)
        self.assertEqual(state['metricas']['mrr'], 0)
        self.assertEqual(state['metricas']['salud']['client'], 'futuro')
