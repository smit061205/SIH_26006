#!/usr/bin/env bash
# Assembles the backend as a Hugging Face Space (Docker SDK) and pushes it.
#
#   scripts/build_hf_space.sh OUT_DIR                 # just assemble into OUT_DIR
#   HF_TOKEN=hf_... scripts/build_hf_space.sh OUT_DIR user/space-name   # assemble and push
#
# A Space needs its Dockerfile and a README with the Space settings at its
# root, so this copies the backend, the planning code and the data next to
# backend/Dockerfile (renamed Dockerfile) and deploy/hf-space/README.md.
# .github/workflows/deploy-hf-space.yml runs it on every push to main.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?usage: build_hf_space.sh OUT_DIR [user/space]}"
SPACE="${2:-}"

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$ROOT/requirements.txt" "$OUT/"
cp "$ROOT/backend/Dockerfile" "$OUT/Dockerfile"
cp "$ROOT/deploy/hf-space/README.md" "$OUT/README.md"
for dir in src backend data scripts db; do
  rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'var/' "$ROOT/$dir/" "$OUT/$dir/"
done
printf '__pycache__/\n*.pyc\nbackend/var/\n' > "$OUT/.gitignore"
echo "Assembled the Space in $OUT"

if [ -n "$SPACE" ]; then
  : "${HF_TOKEN:?set HF_TOKEN to a Hugging Face access token with write access}"
  cd "$OUT"
  git init -q -b main
  git add -A
  git -c user.name="freightwise-deploy" -c user.email="deploy@users.noreply.huggingface.co" \
    commit -q -m "Deploy ${GITHUB_SHA:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)}"
  # The Space is a build target: its history is replaced on every deploy.
  git push -q --force "https://user:${HF_TOKEN}@huggingface.co/spaces/${SPACE}" main
  echo "Pushed to https://huggingface.co/spaces/${SPACE}"
fi
