"""Build the showcase page: the template with the experiment's numbers and replay shots put in.

    python showcase.py out.html      # after report.py, which leaves showcase.json in the cache
"""
import os
import sys
import run

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "showcase.html")) as f:
    page = f.read()
with open(os.path.join(run.CACHE, "showcase.json")) as f:
    data = f.read()
base = os.path.join(here, "results", "baseline.json")       # the end-to-end comparison, if baseline.py has been run
if os.path.exists(base):
    with open(base) as f:
        data = data[:-1] + ', "baseline": ' + f.read() + "}"
assert "</script" not in data
with open(sys.argv[1], "w") as f:
    f.write(page.replace("/*DATA*/", data))
print(f"{sys.argv[1]}: {len(page) + len(data)} bytes")
