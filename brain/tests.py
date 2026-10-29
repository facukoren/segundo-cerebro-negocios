from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import Client as Browser, TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Client, Entry, Lead, Note, Task


class PrivateAppTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_superuser("owner", "", "a strong test password 123")

    def test_anonymous_cannot_read_business_data(self):
        for path in ("/", "/admin/", "/admin/brain/note/"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 302)

    def test_login_rejects_post_without_csrf_token(self):
        browser = Browser(enforce_csrf_checks=True)
        response = browser.post(reverse("login"), {"username": "owner", "password": "a strong test password 123"})
        self.assertEqual(response.status_code, 403)

    def test_dashboard_counts_and_escapes_notes(self):
        Note.objects.create(title="<script>alert(1)</script>", body="Private")
        Task.objects.create(title="Call", done=False)
        Lead.objects.create(name="New prospect")
        Client.objects.create(name="Example", monthly_fee=Decimal("100.00"))
        Entry.objects.create(kind=Entry.Kind.INCOME, date=timezone.localdate(), amount=Decimal("70.00"), description="Payment")
        Entry.objects.create(kind=Entry.Kind.EXPENSE, date=timezone.localdate(), amount=Decimal("20.00"), description="Hosting")
        self.client.force_login(self.user)
        response = self.client.get(reverse("home"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["result"], Decimal("50.00"))
        self.assertContains(response, "&lt;script&gt;alert(1)&lt;/script&gt;")
        self.assertNotContains(response, "<script>alert(1)</script>")

    def test_login_uses_argon2(self):
        self.assertTrue(self.user.password.startswith("argon2$"))
