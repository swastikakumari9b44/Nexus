"""Replays the assessment's sample dialogue against a RUNNING backend and prints a transcript.
Usage: python -m scripts.demo_dialogue [--base http://127.0.0.1:8000] [--restart-hint]"""
import argparse
import uuid

import httpx


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    base = ap.parse_args().base
    t = str(uuid.uuid4())
    with httpx.Client(base_url=base, timeout=60) as c:
        h = c.get("/api/health").json()
        print(f"health: {h}\nthread_id: {t}\n")
        script = [
            "Hi, I need to book a 1-on-1 Performance Review session.",
            "Alex Chen (alex.chen@example.com). Wait, before that, how often are performance reviews "
            "conducted according to the handbook?",
            "Let's go with option 2",
            "yes",
        ]
        for msg in script:
            r = c.post("/api/chat", json={"thread_id": t, "message": msg}).json()
            print(f"USER : {msg}\nAGENT: {r['reply']}")
            print(f"       [intent={r['intent']} trace={'>'.join(r['trace'])} booking={r['booking']['status']}"
                  f"{' ref=' + r['booking']['reference'] if r['booking']['reference'] else ''}"
                  f"{' cites=' + str([x['page'] for x in r['citations']]) if r['citations'] else ''}]\n")


if __name__ == "__main__":
    main()
