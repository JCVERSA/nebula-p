# CI a appliquer (le jeton sandbox n a pas la permission workflows)

Remplacer le contenu de `.github/workflows/ci.yml` (branche arena/01a05555-p, repo JCVERSA/p) par :

```yaml
name: CI
on:
  push:
    branches: [arena/01a05555-p, main]
  pull_request:
jobs:
  test:
    name: Typecheck & tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Typecheck (tsc --noEmit)
        run: npx tsc --noEmit
      - name: Tests (vitest)
        run: npx vitest run --reporter=dot
      - name: Lint gate (eslint)
        run: npx eslint .
      - name: Format gate (prettier)
        run: npx prettier --check .
```
