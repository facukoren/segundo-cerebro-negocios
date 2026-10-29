from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models
import uuid


class Record(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    collection = models.CharField(max_length=24, db_index=True)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class Note(models.Model):
    title = models.CharField("Título", max_length=200)
    body = models.TextField("Contenido")
    topic = models.CharField("Tema", max_length=80, blank=True)
    updated_at = models.DateTimeField("Actualizada", auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "Nota"
        verbose_name_plural = "Notas"

    def __str__(self):
        return self.title


class Lead(models.Model):
    class Stage(models.TextChoices):
        NEW = "nuevo", "Nuevo"
        CONTACTED = "contactado", "Contactado"
        PROPOSAL = "propuesta", "Propuesta"
        WON = "ganado", "Ganado"
        LOST = "perdido", "Perdido"

    name = models.CharField("Nombre", max_length=160)
    stage = models.CharField("Etapa", max_length=20, choices=Stage.choices, default=Stage.NEW)
    source = models.CharField("Origen", max_length=100, blank=True)
    estimated_monthly_value = models.DecimalField("Valor mensual estimado", max_digits=12, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    notes = models.TextField("Notas", blank=True)
    updated_at = models.DateTimeField("Actualizado", auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "Lead"
        verbose_name_plural = "Leads"

    def __str__(self):
        return self.name


class Client(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "activo", "Activo"
        PAUSED = "pausado", "Pausado"
        ENDED = "baja", "Baja"

    name = models.CharField("Nombre", max_length=160)
    status = models.CharField("Estado", max_length=20, choices=Status.choices, default=Status.ACTIVE)
    monthly_fee = models.DecimalField("Abono mensual", max_digits=12, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    start_date = models.DateField("Fecha de inicio", null=True, blank=True)
    next_renewal = models.DateField("Próxima renovación", null=True, blank=True)
    notes = models.TextField("Notas", blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Cliente"
        verbose_name_plural = "Clientes"

    def __str__(self):
        return self.name


class Entry(models.Model):
    class Kind(models.TextChoices):
        INCOME = "cobro", "Cobro"
        EXPENSE = "gasto", "Gasto"

    kind = models.CharField("Tipo", max_length=10, choices=Kind.choices)
    date = models.DateField("Fecha")
    amount = models.DecimalField("Monto", max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    description = models.CharField("Concepto", max_length=200)
    client = models.ForeignKey(Client, on_delete=models.PROTECT, null=True, blank=True, verbose_name="Cliente")

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name = "Movimiento"
        verbose_name_plural = "Movimientos"

    def __str__(self):
        return f"{self.get_kind_display()}: {self.description}"


class Task(models.Model):
    title = models.CharField("Título", max_length=200)
    done = models.BooleanField("Completada", default=False)
    due_date = models.DateField("Vence", null=True, blank=True)
    notes = models.TextField("Notas", blank=True)

    class Meta:
        ordering = ["done", "due_date", "id"]
        verbose_name = "Tarea"
        verbose_name_plural = "Tareas"

    def __str__(self):
        return self.title


class Conversation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    messages = models.JSONField(default=list)
    updated_at = models.DateTimeField(auto_now=True)


class Attachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    name = models.CharField(max_length=160)
    mime = models.CharField(max_length=80)
    content = models.BinaryField()
    size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class IntegrationLease(models.Model):
    name = models.CharField(max_length=100, primary_key=True)
    holder = models.UUIDField(default=uuid.uuid4)
    expires_at = models.DateTimeField()


class InboundPublication(models.Model):
    account_id = models.CharField(max_length=40)
    media_id = models.CharField(max_length=40)
    published_at = models.DateTimeField()
    caption = models.TextField(blank=True)
    permalink = models.URLField(max_length=500, blank=True)
    keyword = models.CharField(max_length=40, blank=True)
    views = models.PositiveBigIntegerField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['account_id', 'media_id'], name='inbound_unique_media')]


class InboundContact(models.Model):
    account_id = models.CharField(max_length=40)
    contact_id = models.CharField(max_length=128)
    lead = models.OneToOneField(Record, on_delete=models.SET_NULL, null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['account_id', 'contact_id'], name='inbound_unique_contact')]


class InboundEvent(models.Model):
    key = models.CharField(max_length=64, unique=True)
    account_id = models.CharField(max_length=40)
    contact_id = models.CharField(max_length=128)
    kind = models.CharField(max_length=24)
    keyword = models.CharField(max_length=40)
    occurred_at = models.DateTimeField(db_index=True)


class InboundSync(models.Model):
    account_id = models.CharField(max_length=40, primary_key=True)
    attempted_at = models.DateTimeField(null=True)
    succeeded_at = models.DateTimeField(null=True)
    error = models.CharField(max_length=200, blank=True)
    truncated = models.BooleanField(default=False)
