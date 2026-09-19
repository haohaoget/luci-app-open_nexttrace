"""Evaluate the actual package Makefile with GNU make, using SDK include stubs.

This checks architecture selection, NOT an SDK package build.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MAKE = shutil.which("gmake") or shutil.which("make")
if not MAKE and Path("C:/Strawberry/c/bin/gmake.exe").exists():
    MAKE = "C:/Strawberry/c/bin/gmake.exe"


@unittest.skipUnless(MAKE, "GNU make unavailable")
class ArchitectureTests(unittest.TestCase):
    def test_actual_makefile_mapping(self):
        cases = [
            ("aarch64", "cortex-a53", "arm64"), ("arm", "cortex-a7", "armv7"),
            ("arm", "cortex-a9", "armv7"), ("arm", "arm1176jzf-s", "armv6"),
            ("arm", "arm926ej-s", "armv5"), ("x86_64", "", "amd64"), ("i386", "", "386"),
            ("mips", "24kc", "mips_softfloat"), ("mipsel", "24kc", "mipsle_softfloat"),
            ("riscv64", "", "riscv64"), ("loongarch64", "", "loong64"),
        ]
        with tempfile.TemporaryDirectory() as directory:
            top = Path(directory)
            (top / "rules.mk").write_text("INCLUDE_DIR:=$(TOPDIR)\n")
            (top / "package.mk").write_text("")
            (top / "inspect.mk").write_text(
                "include Makefile\n.PHONY: inspect\ninspect:\n"
                "\t@echo $(NEXTTRACE_ARCH) $(PKG_SOURCE_URL_FILE) $(PKG_HASH)\n"
            )
            for arch, cpu, expected in cases:
                with self.subTest(arch=arch, cpu=cpu):
                    result = subprocess.run(
                        [MAKE, "-s", "-f", str(top / "inspect.mk"), "inspect", f"TOPDIR={top.as_posix()}", f"ARCH={arch}", f"CPU_TYPE={cpu}"],
                        cwd=ROOT / "open-nexttrace-core", check=True, capture_output=True, text=True,
                    ).stdout.strip().split()
                    self.assertEqual(result[0], expected)
                    self.assertEqual(result[1], "nexttrace_linux_" + expected)
                    self.assertRegex(result[2], r"^[0-9a-f]{64}$")
