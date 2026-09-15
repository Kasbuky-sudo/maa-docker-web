#!/usr/bin/env bash
# 手动下载并校验官方 MAA 运行包到本地目录（CI 调试 / 离线预热用）
# 用法: ./fetch-maa-runtime.sh <x86_64|aarch64> <目标目录>
set -euo pipefail

VER="v6.17.5"
SHA_X86="b2f472bb016621a0e0be080953ad4d88ac6735f605ddf6921e8ba4d2b68395bb"
SHA_ARM="dda6bf0a3941b876db597399e7d727575b40a8e0fd4a538ccc38d7e498d67809"

ARCH="${1:?usage: fetch-maa-runtime.sh <x86_64|aarch64> <target-dir>}"
DIR="${2:?usage: fetch-maa-runtime.sh <x86_64|aarch64> <target-dir>}"

case "$ARCH" in
  x86_64) FILE="MAA-${VER}-linux-x86_64.tar.gz"; SHA="$SHA_X86" ;;
  aarch64) FILE="MAA-${VER}-linux-aarch64.tar.gz"; SHA="$SHA_ARM" ;;
  *) echo "unknown arch: $ARCH" >&2; exit 1 ;;
esac

URL="https://github.com/MaaAssistantArknights/MaaAssistantArknights/releases/download/${VER}/${FILE}"

mkdir -p "$DIR"
echo ">> downloading $URL"
curl -fL --retry 3 -o "$DIR/$FILE" "$URL"
echo ">> verifying sha256"
echo "$SHA  $DIR/$FILE" | sha256sum -c -
echo ">> extracting"
tar -xzf "$DIR/$FILE" -C "$DIR" && rm -f "$DIR/$FILE"
echo ">> done: $DIR"
