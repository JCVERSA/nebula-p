#!/usr/bin/env python3
"""9.18k — annotations GitHub des tests vitest échoués.

La CI ne peut pas télécharger ses logs depuis certains réseaux : les noms
des tests en échec sont émis en annotations ::error:: (le seul canal lisible
via l'API check-runs). Appelé par .github/workflows/ci.yml après un run
vitest --reporter=json --outputFile.

Usage : python3 scripts/ci-vitest-annotations.py /tmp/vitest.json [max]
Sortie : rien si le rapport est vert ou illisible (l'erreur du run parle
d'elle-même).
"""
import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        return 0
    path = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    try:
        with open(path, encoding="utf-8") as fh:
            report = json.load(fh)
    except Exception:
        # Rapport absent/illisible : ne pas masquer l'échec vitest lui-même.
        return 0

    emitted = 0
    for test_file in report.get("testResults", []):
        for assertion in test_file.get("assertionResults", []):
            if assertion.get("status") != "failed":
                continue
            name = (assertion.get("fullName") or "?")[:220].replace("\n", " ")
            origin = (test_file.get("name") or "?")[-60:]
            # Le message d'annotation : nom complet + fichier d'origine.
            print("::error::FAIL %s (%s)" % (name, origin))
            emitted += 1
            if emitted >= limit:
                return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
