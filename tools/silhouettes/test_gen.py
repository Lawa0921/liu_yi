"""Tests for the per-asset request cap of gen.py.  (local developer tool; CI has no Python and never runs it)

Run: uv run --no-project --python 3.11 python -m unittest tools/silhouettes/test_gen.py
No key is read and no request is sent: asset_cap() only reads the prompt table.
"""
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen  # noqa: E402

REASON = "使用者 2026-11-20 核准：Codex 視覺評審兩輪未過"


def table(**assets):
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"assets": assets}, f, ensure_ascii=False)
    return path


class AssetCap(unittest.TestCase):
    def cap(self, name, entry):
        path = table(**{name: dict({"size": "1024x1536", "prompt": "x"}, **entry)})
        try:
            return gen.asset_cap(path, name)
        finally:
            os.remove(path)

    def test_default_is_three(self):
        self.assertEqual(self.cap("fig-kao", {}), 3)

    def test_listed_asset_with_cap_five_and_reason_passes(self):
        self.assertEqual(self.cap("fig-guard", {"request_cap": 5, "request_cap_reason": REASON}), 5)

    def test_asset_outside_the_exception_list_is_refused(self):
        with self.assertRaises(SystemExit):
            self.cap("fig-kao", {"request_cap": 5, "request_cap_reason": REASON})

    def test_removed_jab_can_no_longer_raise_its_cap(self):
        # the owner asked on 2026-11-20 to drop the adult jab from the home page; fig-jab is no longer an exception
        self.assertNotIn("fig-jab", gen.CAP_EXCEPTIONS)
        with self.assertRaises(SystemExit):
            self.cap("fig-jab", {"request_cap": 5, "request_cap_reason": REASON})

    def test_missing_or_blank_reason_is_refused(self):
        with self.assertRaises(SystemExit):
            self.cap("fig-guard", {"request_cap": 5})
        with self.assertRaises(SystemExit):
            self.cap("fig-guard", {"request_cap": 5, "request_cap_reason": "  "})

    def test_cap_above_five_is_refused(self):
        with self.assertRaises(SystemExit):
            self.cap("fig-guard", {"request_cap": 99, "request_cap_reason": REASON})

    def test_non_integer_cap_is_refused(self):
        with self.assertRaises(SystemExit):
            self.cap("fig-guard", {"request_cap": "5", "request_cap_reason": REASON})

    def test_real_prompt_table_only_the_sanshou_guard_carries_a_cap(self):
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts.json"), encoding="utf-8") as f:
            assets = json.load(f)["assets"]
        self.assertEqual(sorted(n for n, a in assets.items() if "request_cap" in a), ["fig-guard"])
        for name in assets:
            gen.asset_cap(os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts.json"), name)


if __name__ == "__main__":
    unittest.main()
