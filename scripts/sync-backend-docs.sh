#!/bin/bash
# 백엔드 API 명세를 GitHub Pages에서 다운로드하여 로컬 backend-context/ 에 동기화합니다.
# 사용법: ./scripts/sync-backend-docs.sh

set -e

BASE_URL="https://poi82999.github.io/snail_backend_specification"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$SCRIPT_DIR/../backend-context"

FILES=(
    "owner_web.ai.txt"
    "api_cookbook.ai.txt"
    "llms.txt"
    "openapi.json"
    "local_onboarding.md"
)

mkdir -p "$TARGET_DIR"

echo ""
echo "🐌 Snail 백엔드 API 문서 동기화"
echo "   소스: $BASE_URL"
echo "   대상: $TARGET_DIR"
echo ""

SUCCESS=0
FAILED=0

for file in "${FILES[@]}"; do
    printf "  ⬇️  %-30s " "$file"
    if curl -fsSL "$BASE_URL/$file" -o "$TARGET_DIR/$file" 2>/dev/null; then
        SIZE=$(wc -c < "$TARGET_DIR/$file" | tr -d ' ')
        echo "OK ($(( SIZE / 1024 )) KB)"
        SUCCESS=$((SUCCESS + 1))
    else
        echo "FAILED"
        FAILED=$((FAILED + 1))
    fi
done

cat > "$TARGET_DIR/.sync-info" <<EOF
# Backend Context Sync Info
synced_at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
source: $BASE_URL
files: $(IFS=', '; echo "${FILES[*]}")
EOF

echo ""
echo "✅ 완료: $SUCCESS 성공, $FAILED 실패"
echo "   AI 도구가 backend-context/ 폴더를 자동 참조합니다."
echo ""
