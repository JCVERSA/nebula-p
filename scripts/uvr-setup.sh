#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Vocal separation installer (audit 8.49) — best-effort, never blocks setup.
# Creates a dedicated venv (.uvr-venv) with onnxruntime/numpy/soundfile and
# downloads the light MDX vocal model (Kim_Vocal_2, 66.8 MB, sha256-pinned).
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/.uvr-venv"
MODEL_DIR="$ROOT/models/uvr"
MODEL="$MODEL_DIR/Kim_Vocal_2.onnx"
MODEL_URL="https://huggingface.co/seanghay/uvr_models/resolve/main/Kim_Vocal_2.onnx"
MODEL_SHA256="ce74ef3b6a6024ce44211a07be9cf8bc6d87728cc852a68ab34eb8e58cde9c8b"

echo "── Séparation vocale (UVR MDX) ──"

if ! command -v python3 >/dev/null 2>&1; then
  echo "  ⚠ python3 absent — séparation vocale désactivée (apt install python3-venv)"
  exit 0
fi

if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV" || { echo "  ⚠ venv impossible — séparation vocale désactivée"; exit 0; }
fi

if ! "$VENV/bin/python" -c "import onnxruntime, numpy, soundfile" >/dev/null 2>&1; then
  echo "  Installation des dépendances Python (onnxruntime, numpy, soundfile)..."
  "$VENV/bin/pip" install -q --disable-pip-version-check onnxruntime numpy soundfile \
    || { echo "  ⚠ pip install échoué — séparation vocale désactivée"; exit 0; }
fi

mkdir -p "$MODEL_DIR"
if [ ! -f "$MODEL" ]; then
  echo "  Téléchargement du modèle vocal (66.8 MB, vérifié par sha256)..."
  if ! curl -fL --retry 3 --retry-delay 2 -o "$MODEL.tmp" "$MODEL_URL"; then
    rm -f "$MODEL.tmp"
    echo "  ⚠ téléchargement échoué — séparation vocale désactivée (relance plus tard)"
    exit 0
  fi
  if ! echo "$MODEL_SHA256  $MODEL.tmp" | sha256sum -c - >/dev/null 2>&1; then
    rm -f "$MODEL.tmp"
    echo "  ⚠ sha256 du modèle invalide — téléchargement abandonné (sécurité)"
    exit 0
  fi
  mv "$MODEL.tmp" "$MODEL"
fi

if "$VENV/bin/python" "$ROOT/python/uvr_runner.py" --selftest --model "$MODEL"; then
  echo "  ✓ Séparation vocale prête (.m karaoké / .m voix)"
else
  echo "  ⚠ selftest échoué — envoie le retour à l'agent (voir ci-dessus)"
fi
exit 0
