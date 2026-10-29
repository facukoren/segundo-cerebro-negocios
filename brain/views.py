from decimal import Decimal

from django.contrib.auth.decorators import login_required
from django.db.models import Sum
from django.shortcuts import render
from django.utils import timezone

from .models import Client, Entry, Lead, Note, Task


@login_required
def home(request):
    today = timezone.localdate()
    month_entries = Entry.objects.filter(date__year=today.year, date__month=today.month)
    income = month_entries.filter(kind=Entry.Kind.INCOME).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    expenses = month_entries.filter(kind=Entry.Kind.EXPENSE).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    mrr = Client.objects.filter(status=Client.Status.ACTIVE).aggregate(total=Sum("monthly_fee"))["total"] or Decimal("0")
    return render(request, "brain/home.html", {
        "today": today,
        "mrr": mrr,
        "income": income,
        "expenses": expenses,
        "result": income - expenses,
        "open_leads": Lead.objects.exclude(stage__in=[Lead.Stage.WON, Lead.Stage.LOST]).count(),
        "open_tasks": Task.objects.filter(done=False).count(),
        "notes": Note.objects.all()[:5],
        "tasks": Task.objects.filter(done=False)[:5],
        "clients": Client.objects.filter(status=Client.Status.ACTIVE)[:5],
    })
