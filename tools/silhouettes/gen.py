"""Generate raw silhouette images via the OpenAI Images API.  (local developer tool; CI never runs it)

Usage:
  gen.py [options] <model> <name> [<name> ...]

  --work DIR        working dir holding raw/, ref/ and the request-count file.
                    default: $SILHOUETTES_WORK, else <repo>/.cache/silhouettes-raw  (git-ignored)
  --raw DIR         where raw PNG + .prompt.txt are written (default: <work>/raw)
  --prompts FILE    prompt table (default: prompts.json next to this script)
  --count-file F    request ledger, relative paths resolve under --work (default: request-count-3.json)
  --cap N           total request cap across all assets recorded in the ledger (default: 20)
  --tag TAG         raw file version tag, e.g. "v" -> <name>-v1.png, "b3v" -> <name>-b3v1.png (default: v)
  --dry-run         print model/size/ref/prompt sha256 per name; no key read, no request, no ledger write

Every asset is also capped at 3 requests (failed requests count). Only the assets listed in CAP_EXCEPTIONS (fig-guard:
the user approved 5 on 2026-11-20 after two failed Codex reviews) may raise it with "request_cap" (<= 5) in the
prompt table, and only together with a non-empty "request_cap_reason"; anything else stops before any request.
Tests: tools/silhouettes/test_gen.py.
The OpenAI key is read ONLY at run time from %APPDATA%/agent-sprite-forge/config.json and is never printed:
every message that could echo server text goes through scrub()
(it masks the exact key and any key-shaped token). A missing --work/ref file is detected before a request is reserved.
"""
import argparse, base64, hashlib, json, os, re, sys, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
PER_ASSET_CAP = 3
DEFAULT_CAP = 20
# The only assets allowed to raise their own cap (prompts.json "request_cap" + "request_cap_reason"), and to how much at most.
# Written here, not in the prompt table, so a prompt edit can never unlock more paid requests:
# fig-guard (sanshou): the user approved 5 on 2026-11-20 after two failed Codex reviews.
# fig-jab had the same exception until the owner asked on 2026-11-20 to drop the adult jab from the home page (asset removed).
CAP_EXCEPTIONS = {"fig-guard": 5}
MAX_EXCEPTION_CAP = 5
LOCK = threading.Lock()


def load_key():
    with open(os.path.join(os.environ["APPDATA"], "agent-sprite-forge", "config.json"), encoding="utf-8-sig") as f:
        return json.load(f)["OPENAI_API_KEY"].strip()


KEY_SHAPE = re.compile(r"sk-[\w*.-]+")  # any key-shaped token a server message might echo, even if it is not our key


def scrub(s, key):
    if key:
        s = s.replace(key, "***")
    return KEY_SHAPE.sub("***", s)


def prompt_sha256(prompt):
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def load_counts(count_file):
    if os.path.exists(count_file):
        with open(count_file, encoding="utf-8") as f:
            return json.load(f)
    return {"total": 0, "per_asset": {}, "log": []}


def save_counts(count_file, c):
    os.makedirs(os.path.dirname(os.path.abspath(count_file)), exist_ok=True)
    with open(count_file, "w", encoding="utf-8") as f:
        json.dump(c, f, indent=1)


def reserve(count_file, cap, name, per_asset_cap=PER_ASSET_CAP):
    with LOCK:
        c = load_counts(count_file)
        n = c["per_asset"].get(name, 0)
        if c["total"] >= cap:
            raise SystemExit("total cap reached")
        if n >= per_asset_cap:
            raise RuntimeError(f"{name}: per-asset cap ({per_asset_cap}) reached")
        c["total"] += 1
        c["per_asset"][name] = n + 1
        save_counts(count_file, c)
        return n + 1


def note(count_file, entry):
    with LOCK:
        c = load_counts(count_file)
        c["log"].append(entry)
        save_counts(count_file, c)


def asset_cap(prompts_file, name):
    """Per-asset request cap: 3. Only the assets in CAP_EXCEPTIONS may ask for more, up to their listed cap (never above
    MAX_EXCEPTION_CAP), and only with a written request_cap_reason. Anything else stops the run before the key is read."""
    with open(prompts_file, encoding="utf-8") as f:
        a = json.load(f)["assets"][name]
    if "request_cap" not in a:
        return PER_ASSET_CAP
    if name not in CAP_EXCEPTIONS:
        raise SystemExit(f"{name}: request_cap is only allowed for {sorted(CAP_EXCEPTIONS)}")
    cap = a["request_cap"]
    if not isinstance(cap, int) or isinstance(cap, bool) or cap > min(CAP_EXCEPTIONS[name], MAX_EXCEPTION_CAP):
        raise SystemExit(f"{name}: request_cap must be an integer <= {min(CAP_EXCEPTIONS[name], MAX_EXCEPTION_CAP)}, got {cap!r}")
    if not str(a.get("request_cap_reason", "")).strip():
        raise SystemExit(f"{name}: request_cap needs a request_cap_reason (who approved it and why)")
    return cap


def build_prompt(prompts_file, name):
    with open(prompts_file, encoding="utf-8") as f:
        P = json.load(f)
    a = P["assets"][name]
    p = a["prompt"]
    # a placeholder in the prompt needs its common block: a missing or empty block is an error, never silently an empty string
    for token, key in (("{FIG}", "_common_fig"), ("{KID}", "_common_kid"), ("{SCENE}", "_common_scene")):
        if token in p:
            if not str(P.get(key, "")).strip():
                raise SystemExit(f"{name}: prompt uses {token} but {key} is missing or empty in {prompts_file}")
            p = p.replace(token, P[key])
    if a.get("retry_note"):
        p += " IMPORTANT CORRECTION: " + a["retry_note"]
    return p, a["size"], a.get("ref")


def gen(args, key, model, name):
    prompt, size, ref = build_prompt(args.prompts, name)
    img = None
    if ref:  # read the reference image BEFORE reserving, so a missing file never burns a request
        ref_path = os.path.join(args.work, ref)
        try:
            with open(ref_path, "rb") as f:
                img = f.read()
        except OSError as e:
            return f"{name}: cannot read ref {ref_path}: {type(e).__name__}"
    try:
        v = reserve(args.count_file, args.cap, name, asset_cap(args.prompts, name))
    except RuntimeError as e:
        return str(e)
    fields = {"model": model, "prompt": prompt, "size": size, "n": "1", "quality": "medium", "background": "opaque"}
    if ref:  # reference image -> /images/edits (multipart); ref path is relative to --work
        bnd = "----silhouetteform7d3"
        parts = [f"--{bnd}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{val}\r\n".encode() for k, val in fields.items()]
        parts.append(f"--{bnd}\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"ref.png\"\r\nContent-Type: image/png\r\n\r\n".encode() + img + b"\r\n")
        parts.append(f"--{bnd}--\r\n".encode())
        req = urllib.request.Request(
            "https://api.openai.com/v1/images/edits", data=b"".join(parts),
            headers={"Authorization": "Bearer " + key, "Content-Type": "multipart/form-data; boundary=" + bnd},
        )
    else:
        req = urllib.request.Request(
            "https://api.openai.com/v1/images/generations",
            data=json.dumps(dict(fields, n=1)).encode(),
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        msg = scrub(e.read().decode("utf-8", "replace"), key)[:600]
        note(args.count_file, {"name": name, "v": v, "model": model, "ok": False, "http": e.code})
        return f"{name} v{v}: HTTP {e.code} {msg}"
    except Exception as e:
        note(args.count_file, {"name": name, "v": v, "model": model, "ok": False, "err": type(e).__name__})
        return f"{name} v{v}: {type(e).__name__} {scrub(str(e), key)[:300]}"
    os.makedirs(args.raw, exist_ok=True)
    out = os.path.join(args.raw, f"{name}-{args.tag}{v}.png")
    with open(out, "wb") as f:
        f.write(base64.b64decode(d["data"][0]["b64_json"]))
    with open(os.path.join(args.raw, f"{name}-{args.tag}{v}.prompt.txt"), "w", encoding="utf-8") as f:
        f.write(f"model={model} size={size} quality=medium ref={ref}\n\n{prompt}\n")
    note(args.count_file, {"name": name, "v": v, "model": model, "ok": True, "usage": d.get("usage")})
    return f"{name} v{v}: OK -> {out}"


def parse_args(argv):
    ap = argparse.ArgumentParser(description="Generate raw silhouettes via the OpenAI Images API.")
    ap.add_argument("--work", default=os.environ.get("SILHOUETTES_WORK") or os.path.join(REPO, ".cache", "silhouettes-raw"))
    ap.add_argument("--raw", default=None)
    ap.add_argument("--prompts", default=os.path.join(HERE, "prompts.json"))
    ap.add_argument("--count-file", default="request-count-3.json")
    ap.add_argument("--cap", type=int, default=DEFAULT_CAP)
    ap.add_argument("--tag", default="v")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("model")
    ap.add_argument("names", nargs="+")
    args = ap.parse_args(argv)
    args.work = os.path.abspath(args.work)
    args.raw = os.path.abspath(args.raw) if args.raw else os.path.join(args.work, "raw")
    args.prompts = os.path.abspath(args.prompts)
    args.count_file = os.path.join(args.work, args.count_file)  # absolute --count-file wins (os.path.join drops the prefix)
    return args


def main(argv):
    args = parse_args(argv)
    if args.dry_run:
        for name in args.names:
            prompt, size, ref = build_prompt(args.prompts, name)
            print(f"{name}: model={args.model} size={size} ref={ref} chars={len(prompt)} sha256={prompt_sha256(prompt)}")
        return
    for name in args.names:  # build every prompt first: a bad prompt table fails here, before the key is read and before any paid request
        build_prompt(args.prompts, name)
        asset_cap(args.prompts, name)
    key = load_key()
    with ThreadPoolExecutor(max_workers=4) as ex:
        for res in ex.map(lambda n: gen(args, key, args.model, n), args.names):
            print(res, flush=True)
    print("total requests so far:", load_counts(args.count_file)["total"])


if __name__ == "__main__":
    main(sys.argv[1:])
