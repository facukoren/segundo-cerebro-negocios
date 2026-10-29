from getpass import getpass

from django.core.management.base import BaseCommand, CommandError

from brain.integrations.config import IntegrationError, load_config, save_config


class Command(BaseCommand):
    help = 'Configura integraciones en el directorio privado de datos. No realiza llamadas externas.'

    def add_arguments(self, parser):
        parser.add_argument('service', choices=['openai', 'instagram', 'webhook'])
        parser.add_argument('--disable', action='store_true')

    def handle(self, *args, **options):
        try:
            config = load_config()
            service = options['service']
            if options['disable']:
                config.pop(service, None)
            elif service == 'openai':
                config['openai'] = {
                    'api_key': getpass('API key de OpenAI (entrada oculta): ').strip(),
                    'model': input('ID del modelo principal con Responses API: ').strip(),
                    'fast_model': input('ID del modelo rápido con Responses API: ').strip(),
                }
            elif service == 'instagram':
                version = input('Versión habilitada de Graph API (por ejemplo v25.0): ').strip()
                account = {'id': input('Identificador local de cuenta: ').strip(),
                    'handle': input('Usuario de Instagram: ').strip(),
                    'user_id': input('Instagram user ID: ').strip(),
                    'token': getpass('Token de Instagram Login (entrada oculta): ').strip(),
                    'keywords': [x.strip().upper() for x in input('Keywords separadas por coma: ').split(',') if x.strip()],
                    'targets': {}}
                self.stdout.write('Objetivos por 30 días. Dejá vacío para usar 0.')
                for key in ('videos', 'dms', 'leads', 'llamadas', 'clientes'):
                    account['targets'][key] = int(input(f'{key}: ').strip() or '0')
                accounts = [row for row in config.get('instagram', {}).get('accounts', []) if row['id'] != account['id']]
                config['instagram'] = {'version': version, 'accounts': [*accounts, account]}
            else:
                secret = getpass('Secreto del webhook (32–128 letras, números, guion o _): ').strip()
                config['webhook'] = {'secret': secret}
            save_config(config)
        except (IntegrationError, ValueError, EOFError):
            raise CommandError('No se guardó la configuración. Revisá formato, permisos y campos requeridos.') from None
        self.stdout.write('Configuración guardada fuera del repositorio. No hace falta reiniciar el servidor.')
