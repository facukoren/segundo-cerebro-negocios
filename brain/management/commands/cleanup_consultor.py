from django.core.management.base import BaseCommand
from brain.integrations.consultor import cleanup


class Command(BaseCommand):
    help = 'Borra adjuntos de más de 24 horas y conversaciones inactivas durante 30 días.'

    def handle(self, *args, **options):
        cleanup()
        self.stdout.write('Limpieza terminada.')
