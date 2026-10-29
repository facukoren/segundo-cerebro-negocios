from django.contrib import admin

from .models import Client, Entry, Lead, Note, Task


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ("title", "topic", "updated_at")
    search_fields = ("title", "body", "topic")


@admin.register(Lead)
class LeadAdmin(admin.ModelAdmin):
    list_display = ("name", "stage", "source", "estimated_monthly_value", "updated_at")
    list_filter = ("stage",)
    search_fields = ("name", "source", "notes")


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ("name", "status", "monthly_fee", "next_renewal")
    list_filter = ("status",)
    search_fields = ("name", "notes")


@admin.register(Entry)
class EntryAdmin(admin.ModelAdmin):
    list_display = ("date", "kind", "amount", "description", "client")
    list_filter = ("kind", "date")
    search_fields = ("description", "client__name")
    autocomplete_fields = ("client",)


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("title", "done", "due_date")
    list_filter = ("done",)
    search_fields = ("title", "notes")
