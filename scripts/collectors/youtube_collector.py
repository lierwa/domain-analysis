#!/usr/bin/env python3
"""YouTube low-frequency collector using yt-dlp and youtube-transcript-api.

JSON stdin:
  {"platform":"youtube","query":{...},"config":{...}}

JSON stdout:
  {"items":[...]} or {"error":{"code":"...","message":"..."}}
"""

from __future__ import annotations

import json
import sys
from typing import Any


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        query = payload.get("query") or {}
        items = collect_youtube(query)
        print(json.dumps({"items": items}, ensure_ascii=False))
    except ImportError as exc:
        write_error("parse_failed", f"missing python dependency: {exc.name}")
    except Exception as exc:  # noqa: BLE001 - collector boundary must never print tracebacks as contract output.
        write_error(classify_error(exc), str(exc))


def collect_youtube(query: dict[str, Any]) -> list[dict[str, Any]]:
    import yt_dlp
    from youtube_transcript_api import NoTranscriptFound, TranscriptsDisabled, YouTubeTranscriptApi

    limit = int(query.get("limitPerRun") or 10)
    language = str(query.get("language") or "en")[:2]
    target_urls = query.get("targetUrls") or []
    channel_urls = query.get("channelUrls") or []
    include_keywords = query.get("includeKeywords") or []

    urls = list(target_urls) + list(channel_urls)
    search_terms = " ".join(include_keywords).strip()
    if search_terms:
        urls.append(f"ytsearch{limit}:{search_terms}")

    if not urls:
        return []

    ydl_opts = {
        "extract_flat": "in_playlist",
        "quiet": True,
        "skip_download": True,
        "noplaylist": False,
    }

    items: list[dict[str, Any]] = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for url in urls:
            info = ydl.extract_info(url, download=False)
            for entry in iter_entries(info):
                if len(items) >= limit:
                    break
                video_id = entry.get("id")
                if not video_id:
                    continue
                transcript = ""
                try:
                    transcript_rows = YouTubeTranscriptApi.get_transcript(video_id, languages=[language, "en"])
                    transcript = " ".join(row.get("text", "") for row in transcript_rows).strip()
                except (NoTranscriptFound, TranscriptsDisabled):
                    transcript = ""

                # WHY: yt-dlp 负责公开视频/搜索元数据，transcript-api 只补字幕；字幕缺失不应让整个任务失败。
                # TRADE-OFF: 没有字幕时保留 title/description，分析深度下降但低频采集更稳。
                items.append(
                    {
                        "videoId": video_id,
                        "url": entry.get("webpage_url") or f"https://www.youtube.com/watch?v={video_id}",
                        "title": entry.get("title"),
                        "channel": entry.get("channel") or entry.get("uploader"),
                        "channelHandle": entry.get("channel_id") or entry.get("uploader_id"),
                        "transcript": transcript,
                        "description": entry.get("description"),
                        "metrics": {
                            "view_count": entry.get("view_count"),
                            "like_count": entry.get("like_count"),
                            "comment_count": entry.get("comment_count"),
                            "duration": entry.get("duration"),
                        },
                        "publishedAt": normalize_upload_date(entry.get("upload_date")),
                        "raw": entry,
                    }
                )
            if len(items) >= limit:
                break

    return items


def iter_entries(info: dict[str, Any]) -> list[dict[str, Any]]:
    entries = info.get("entries")
    if isinstance(entries, list):
        return [entry for entry in entries if isinstance(entry, dict)]
    return [info]


def normalize_upload_date(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) != 8:
        return None
    return f"{value[:4]}-{value[4:6]}-{value[6:]}T00:00:00.000Z"


def classify_error(exc: Exception) -> str:
    text = str(exc).lower()
    if "sign in" in text or "login" in text:
        return "login_required"
    if "rate" in text or "too many requests" in text or "429" in text:
        return "rate_limited"
    if "json" in text or "parse" in text:
        return "parse_failed"
    return "failed"


def write_error(code: str, message: str) -> None:
    print(json.dumps({"error": {"code": code, "message": message}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
