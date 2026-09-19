import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("updater", ROOT / "scripts/update-core.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def release(tag="v1.7.3"):
    return {"tag_name": tag, "draft": False, "prerelease": False, "assets": [
        {"name": f"nexttrace_linux_{arch}", "digest": "sha256:" + "a" * 64,
         "browser_download_url": f"https://github.com/nxtrace/NTrace-core/releases/download/{tag}/nexttrace_linux_{arch}"}
        for arch in updater.ARCHES
    ]}


class UpdaterTests(unittest.TestCase):
    def test_all_arches_and_idempotency(self):
        content = updater.render(release())
        self.assertEqual(content.count("NEXTTRACE_HASH_"), len(updater.ARCHES))
        with tempfile.TemporaryDirectory() as directory:
            dest = Path(directory) / "version.mk"
            self.assertTrue(updater.update(dest, content))
            self.assertFalse(updater.update(dest, content))

    def test_rejects_incomplete_release_and_untrusted_url(self):
        r = release()
        r["assets"].pop()
        with self.assertRaisesRegex(ValueError, "Missing"):
            updater.render(r)
        r = release()
        r["assets"][0]["browser_download_url"] = "https://evil.example/core"
        with self.assertRaisesRegex(ValueError, "URL"):
            updater.render(r)

    def test_rejects_prerelease_draft_bad_tag_bad_digest_duplicates(self):
        for field, value in [("prerelease", True), ("draft", True), ("tag_name", "v1.8.0-rc1"), ("tag_name", "$(id)")]:
            r = release()
            r[field] = value
            with self.assertRaises(ValueError):
                updater.render(r)
        r = release()
        r["assets"][0]["digest"] = "sha256:skip"
        with self.assertRaises(ValueError):
            updater.render(r)
        r = release()
        r["assets"].append(r["assets"][0])
        with self.assertRaises(ValueError):
            updater.render(r)

    def test_fallback_download_hash_and_verification_mismatch(self):
        r = release()
        r["assets"][0]["digest"] = None
        with patch.object(updater, "download_hash", return_value="b" * 64) as fetch:
            self.assertIn("NEXTTRACE_HASH_386:=" + "b" * 64, updater.render(r))
            fetch.assert_called_once()
        with patch.object(updater, "download_hash", return_value="b" * 64):
            with self.assertRaisesRegex(ValueError, "mismatch"):
                updater.render(release(), verify=True)

    def test_no_downgrade(self):
        with tempfile.TemporaryDirectory() as directory:
            dest = Path(directory) / "version.mk"
            updater.update(dest, updater.render(release("v1.10.0")))
            with self.assertRaisesRegex(ValueError, "downgrade"):
                updater.update(dest, updater.render(release("v1.9.0")))
            self.assertIn("NEXTTRACE_VERSION:=1.10.0", dest.read_text())


if __name__ == "__main__":
    unittest.main()
