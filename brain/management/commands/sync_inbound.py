from django.core.management.base import BaseCommand, CommandError
from brain.integrations.config import IntegrationError
from brain.integrations.inbound import sync_all


class Command(BaseCommand):
    help = 'Sincroniza Instagram usando únicamente las credenciales de esta instalación.'

    def handle(self, *args, **options):
        try:
            results = sync_all()
        except IntegrationError as error:
            raise CommandError(str(error)) from None
        for row in results:
            self.stdout.write(f"{row['cuenta']}: {row['estado']}")
        if any(row['estado'] == 'error' for row in results):
            raise CommandError('Una o más cuentas no sincronizaron. Los datos anteriores se conservaron.')
