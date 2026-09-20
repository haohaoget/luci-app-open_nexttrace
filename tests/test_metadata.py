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
        self.assertEqual(acl["read"], {"ubus": {"open_nexttrace": ["info", "status"]}, "uci": ["open_nexttrace"]})
        self.assertEqual(acl["write"], {"ubus": {"open_nexttrace": ["start", "stop"]}, "uci": ["open_nexttrace"]})

    def test_menu_points_to_real_view(self):
        menu = json.loads((APP / "root/usr/share/luci/menu.d/luci-app-open_nexttrace.json").read_text(encoding="utf-8"))
        for item in menu.values():
            if item["action"]["type"] == "view":
                self.assertTrue((APP / ("htdocs/luci-static/resources/view/" + item["action"]["path"] + ".js")).is_file())
        self.assertTrue((APP / "root/etc/config/open_nexttrace").is_file())

    def test_hash_pins_and_lf_shebang(self):
        content = (ROOT / "open-nexttrace-core/version.mk").read_text()
        self.assertEqual(len(re.findall(r"^NEXTTRACE_HASH_[\w]+:=[0-9a-f]{64}$", content, re.M)), 17)
        backend = (APP / "root/usr/libexec/rpcd/open_nexttrace").read_bytes()
        self.assertTrue(backend.startswith(b"#!/usr/bin/lua\n"))
        self.assertNotIn(b"\r\n", backend)

    def test_build_matrix_covers_apk_ipk_and_arm64_variants(self):
        workflow = (ROOT / ".github/workflows/build.yml").read_text()
        for value in (
            "25.12.5", "format: apk", "24.10.8", "format: ipk",
            "aarch64_cortex-a53", "aarch64_cortex-a72",
            "aarch64_cortex-a76", "aarch64_generic",
        ):
            self.assertIn(value, workflow)
        self.assertIn(
            "bin/packages/${{ matrix.arch }}/base/open-nexttrace-core*.${{ matrix.release.format }}",
            workflow,
        )
        self.assertIn(
            "bin/packages/${{ matrix.arch }}/base/luci-app-open_nexttrace*.${{ matrix.release.format }}",
            workflow,
        )
        self.assertNotIn("bin/packages/**/*.apk", workflow)
        self.assertNotIn("bin/packages/**/*.ipk", workflow)
        self.assertNotIn("logs/**", workflow)
        self.assertIn('package_dir="bin/packages/${{ matrix.arch }}/base"', workflow)
        self.assertIn('find "$package_dir" -maxdepth 1', workflow)
        self.assertIn("tags: ['v*', 'V*']", workflow)
        self.assertIn("types: [published]", workflow)
        self.assertIn("release_tag:", workflow)
        self.assertIn("gh release upload", workflow)
        self.assertIn("GH_REPO: ${{ github.repository }}", workflow)
        self.assertIn("test \"$(find release-assets -maxdepth 1 -type f | wc -l)\" -eq 24", workflow)
        self.assertIn("ghcr.io/openwrt/sdk:${{ matrix.arch }}-V${{ matrix.release.version }}", workflow)
        self.assertIn("bash /workspace/scripts/build-openwrt-packages.sh", workflow)
        self.assertNotIn("openwrt/gh-action-sdk", workflow)
        build_script = (ROOT / "scripts/build-openwrt-packages.sh").read_text()
        self.assertIn("feeds update -a", build_script)
        self.assertNotIn("feeds install -a", build_script)
        for dependency in (
            "ca-bundle", "lua", "libubus-lua", "luci-base",
            "luci-lib-nixio", "luci-lib-jsonc",
        ):
            self.assertRegex(build_script, rf"(?m)^\s*{re.escape(dependency)}(?:\s*\\)?$")
        self.assertLess(
            build_script.index("cp -a /workspace/open-nexttrace-core"),
            build_script.index("make defconfig"),
        )
        self.assertLess(
            build_script.index("cp -a /workspace/luci-app-open_nexttrace"),
            build_script.index("make defconfig"),
        )
        self.assertIn("make package/open-nexttrace-core/compile", build_script)
        self.assertIn("make package/luci-app-open-nexttrace/compile", build_script)
        self.assertIn("CONFIG_PACKAGE_open-nexttrace-core=m", build_script)
        self.assertIn("CONFIG_PACKAGE_luci-app-open_nexttrace=m", build_script)
        self.assertNotIn('compile -j"$(nproc)"', build_script)
        makefile = (APP / "Makefile").read_text()
        self.assertIn("PKG_NAME:=luci-app-open_nexttrace", makefile)
        self.assertIn("include $(INCLUDE_DIR)/package.mk", makefile)
        self.assertIn("DEPENDS:=+open-nexttrace-core", makefile)
        self.assertNotIn("feeds/luci/luci.mk", makefile)
        config = (APP / "root/etc/config/open_nexttrace").read_text(encoding="utf-8")
        self.assertIn("option tcp_port '80'", config)
        self.assertIn("option udp_port '33494'", config)

    def test_github_actions_use_node24_releases(self):
        workflows = {
            path.name: path.read_text(encoding="utf-8")
            for path in (ROOT / ".github/workflows").glob("*.yml")
        }
        combined = "\n".join(workflows.values())
        for action in (
            "actions/checkout@v7",
            "actions/setup-node@v7",
            "actions/setup-python@v7",
            "actions/upload-artifact@v7",
            "actions/download-artifact@v8",
        ):
            self.assertIn(action, combined)
        for action in (
            "actions/checkout@v4",
            "actions/setup-node@v4",
            "actions/setup-python@v5",
            "actions/upload-artifact@v4",
            "actions/download-artifact@v4",
        ):
            self.assertNotIn(action, combined)

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
