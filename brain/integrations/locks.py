import uuid
from datetime import timedelta

from django.utils import timezone
from brain.models import IntegrationLease


def acquire(name, seconds=240):
    now = timezone.now()
    holder = uuid.uuid4()
    row, created = IntegrationLease.objects.get_or_create(name=name, defaults={'holder': holder, 'expires_at': now + timedelta(seconds=seconds)})
    if created:
        return holder
    changed = IntegrationLease.objects.filter(pk=name, expires_at__lte=now).update(holder=holder, expires_at=now + timedelta(seconds=seconds))
    return holder if changed else None


def release(name, holder):
    IntegrationLease.objects.filter(pk=name, holder=holder).delete()
