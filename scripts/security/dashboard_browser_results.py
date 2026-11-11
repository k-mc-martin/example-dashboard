"""Render the individual dashboard scenarios from Node's TAP output."""
from pathlib import Path
import re
import sys


def browser_results(tap):
    pattern = r"^(ok|not ok) \d+ - (Exercise \d+ — .+?) — (.+?)(?: #(SKIP|TODO).*)?$"
    rows = []
    for status, label, detail, directive in re.findall(pattern, tap, re.MULTILINE):
        rows.append({"name": label, "status": directive.lower() if directive else
                     ("passed" if status == "ok" else "failed"), "detail": detail})
    return rows


if __name__ == "__main__":
    file = Path(sys.argv[1])
    rows = browser_results(file.read_text() if file.exists() else "")
    print("## Dashboard exercise results\n")
    if rows:
        print("| Exercise | Outcome | What the browser checked |")
        print("|---|---|---|")
        for row in rows:
            print("| {name} | {status} | {detail} |".format(**row))
    if len(rows) != 19:
        print(f"\n{len(rows)} of 19 scenarios reported a result.")
