#!/usr/bin/env bash
# Encode a hero clip for scroll-scrubbing.
# Every frame becomes a keyframe, so seeking is instant and scrubbing never stutters.
# Usage: scripts/encode-hero.sh path/to/clip.mov [start_seconds] [duration_seconds]
set -euo pipefail
IN="$1"; START="${2:-0}"; DUR="${3:-10}"
OUT=public/media
mkdir -p "$OUT"
X264='keyint=1:min-keyint=1:scenecut=0'

# Desktop, landscape 1280x720
ffmpeg -y -ss "$START" -t "$DUR" -i "$IN" -an \
  -vf "fps=24,scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos,crop=1280:720,format=yuv420p" \
  -c:v libx264 -preset slow -crf 25 -x264-params "$X264" -movflags +faststart "$OUT/hero-1280.mp4"

# Phones, portrait 540x960 (centre crop)
ffmpeg -y -ss "$START" -t "$DUR" -i "$IN" -an \
  -vf "fps=24,scale=540:960:force_original_aspect_ratio=increase:flags=lanczos,crop=540:960,format=yuv420p" \
  -c:v libx264 -preset slow -crf 27 -x264-params "$X264" -movflags +faststart "$OUT/hero-540.mp4"

# First frames as posters (shown instantly, before the video loads)
ffmpeg -y -i "$OUT/hero-1280.mp4" -frames:v 1 -c:v libwebp -quality 78 "$OUT/hero-poster-1280.webp"
ffmpeg -y -i "$OUT/hero-540.mp4" -frames:v 1 -c:v libwebp -quality 78 "$OUT/hero-poster-540.webp"

# Verify: should print only I frames
for f in "$OUT"/hero-*.mp4; do
  echo "$f"; ffprobe -v error -select_streams v:0 -show_entries frame=pict_type -of csv=p=0 "$f" | sort | uniq -c
done
ls -lh "$OUT"
