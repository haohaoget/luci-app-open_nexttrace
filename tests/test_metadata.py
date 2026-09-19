import hashlib
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "luci-app-open_nexttrace"


class MetadataTests(unittest.TestCase):
    def test_acl_has_no_generic_shell_or_file_access(self):
        acl = json.loads((APP / "root/usr/share/rpcd/acl.d/luci-app-open_nexttrace.json").read_text())["luci-app-open_nexttrace"]
        self.assertEqual(acl["read"], {"ubus": {"open_nexttrace": ["info", "status"]}})
        self.assertEqual(acl["write"], {"ubus": {"open_nexttrace": ["start", "stop"]}})

    def test_menu_points_to_real_view(self):
        menu = json.loads((APP / "root/usr/share/luci/menu.d/luci-app-open_nexttrace.json").read_text())
        for item in menu.values():
            self.assertTrue((APP / ("htdocs/luci-static/resources/view/" + item["action"]["path"] + ".js")).is_file())

    def test_hash_pins_and_lf_shebang(self):
        content = (ROOT / "open-nexttrace-core/version.mk").read_text()
        self.assertEqual(len(re.findall(r"^NEXTTRACE_HASH_[\w]+:=[0-9a-f]{64}$", content, re.M)), 10)
        backend = (APP / "root/usr/libexec/rpcd/open_nexttrace").read_bytes()
        self.assertTrue(backend.startswith(b"#!/usr/bin/lua\n"))
        self.assertNotIn(b"\r\n", backend)

    def test_bundled_leaflet_integrity(self):
        vendor = APP / "htdocs/luci-static/resources/open_nexttrace/vendor"
        for name, expected in {
            "leaflet.js": "db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a",
            "leaflet.css": "a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6",
        }.items():
            self.assertEqual(hashlib.sha256((vendor / name).read_bytes()).hexdigest(), expected)
        self.assertIn("BSD 2-Clause License", (vendor / "LEAFLET-LICENSE").read_text())


if __name__ == "__main__":
    unittest.main()
