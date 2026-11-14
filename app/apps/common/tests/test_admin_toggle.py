import importlib

from django.test import SimpleTestCase, override_settings
from django.urls import Resolver404, clear_url_caches, resolve

import WYGIWYH.urls


class AdminToggleTests(SimpleTestCase):
    def _reload_urls(self):
        clear_url_caches()
        importlib.reload(WYGIWYH.urls)

    def tearDown(self):
        self._reload_urls()

    @override_settings(ADMIN_ENABLED=False)
    def test_admin_not_routed_when_disabled(self):
        self._reload_urls()
        for url in ("/admin/", "/admin/login/"):
            with self.assertRaises(Resolver404):
                resolve(url)

    @override_settings(ADMIN_ENABLED=True)
    def test_admin_routed_when_enabled(self):
        self._reload_urls()
        self.assertEqual(resolve("/admin/login/").url_name, "login")
