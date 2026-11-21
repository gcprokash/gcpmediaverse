#!/usr/bin/env python3
"""Read-only structural audit for exported MediaVerse XLSX workbooks.

Usage:
  python tools/audit_mediaverse_workbooks.py "MediaVerse Database.xlsx" "Media Assets.xlsx"

This script never writes to either workbook or to Google Sheets.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


MAIN_EXPECTED = {
    "Media": ["Media_ID", "Title", "File_Name", "Artist", "Album", "Composer", "Genre", "Language", "Resolution", "Video_Codec", "Video_Quality", "Audio_Count", "Hi_Res_Audio", "Subtitle_Count", "Cover", "Cover_Source", "Drive_URL", "Download_URL"],
    "Files": ["File_ID", "Media_ID", "File_Name", "File_Type", "File_Size", "Modified_Time", "Drive_URL", "Download_URL"],
    "Video": ["Video_ID", "Media_ID", "File_Name", "Codec", "Profile", "Width", "Height", "Resolution", "Aspect_Ratio", "FPS", "Bitrate", "Bit_Depth", "Pixel_Format", "HDR", "Scan_Type", "Default"],
    "Audio": ["Audio_ID", "Media_ID", "Track_No", "Title", "Artist", "Codec", "Sample_Rate", "Bit_Depth", "Channels", "Channel_Layout", "Language", "Hi_Res", "Default"],
    "Subtitle": ["Subtitle_ID", "Media_ID", "Track_No", "Codec", "Language", "Title", "Default", "Forced"],
    "Covers": ["Cover_ID", "Media_ID", "File_Name", "Cover_Source", "Cover_URL", "Drive_URL"],
}
ASSET_EXPECTED = {
    "Covers": ["Title", "File_Name", "Drive_URL", "Download_URL"],
    "HiResAudio": ["Title", "File_Name", "Format", "Drive_URL", "Download_URL"],
}
RELATIONS = {
    "Files": ("File_ID", "Media_ID"),
    "Video": ("Video_ID", "Media_ID"),
    "Audio": ("Audio_ID", "Media_ID"),
    "Subtitle": ("Subtitle_ID", "Media_ID"),
    "Covers": ("Cover_ID", "Media_ID"),
}


def clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def read_tab(ws) -> tuple[list[str], list[dict[str, Any]], list[int]]:
    raw = list(ws.iter_rows(values_only=True))
    if not raw:
        return [], [], []
    header_row = list(raw[0])
    last = max((i for i, value in enumerate(header_row) if clean(value)), default=-1)
    headers = [clean(v) for v in header_row[: last + 1]]
    records = []
    for row in raw[1:]:
        vals = list(row[: len(headers)])
        vals += [None] * (len(headers) - len(vals))
        if not any(clean(v) for v in vals):
            continue
        records.append(dict(zip(headers, vals)))
    blank_positions = [i + 1 for i, value in enumerate(header_row) if not clean(value)]
    return headers, records, blank_positions


def audit_book(path: Path, expected: dict[str, list[str]]) -> dict[str, Any]:
    wb = load_workbook(path, read_only=True, data_only=True)
    report: dict[str, Any] = {"file": path.name, "sheets": {}, "errors": []}
    for name, required in expected.items():
        if name not in wb.sheetnames:
            report["errors"].append(f"Missing required tab: {name}")
            continue
        headers, rows, blank_positions = read_tab(wb[name])
        missing = [h for h in required if h not in headers]
        duplicate = [h for h, n in Counter(headers).items() if h and n > 1]
        report["sheets"][name] = {
            "rows": len(rows),
            "headers": headers,
            "missing_required_headers": missing,
            "duplicate_headers": duplicate,
            "blank_header_positions": blank_positions,
        }
        if missing:
            report["errors"].append(f"{name}: missing required headers {missing}")
        if duplicate:
            report["errors"].append(f"{name}: duplicate headers {duplicate}")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("main_workbook", type=Path)
    parser.add_argument("assets_workbook", type=Path)
    args = parser.parse_args()

    main_wb = load_workbook(args.main_workbook, read_only=True, data_only=True)
    tabs: dict[str, tuple[list[str], list[dict[str, Any]]]] = {}
    for name in main_wb.sheetnames:
        headers, rows, _ = read_tab(main_wb[name])
        tabs[name] = (headers, rows)

    result = {
        "main": audit_book(args.main_workbook, MAIN_EXPECTED),
        "assets": audit_book(args.assets_workbook, ASSET_EXPECTED),
        "integrity": {},
    }

    media_rows = tabs.get("Media", ([], []))[1]
    media_ids = [clean(row.get("Media_ID")) for row in media_rows if clean(row.get("Media_ID"))]
    media_id_set = set(media_ids)
    result["integrity"]["media_rows"] = len(media_rows)
    result["integrity"]["duplicate_media_ids"] = sorted(k for k, n in Counter(media_ids).items() if n > 1)

    for tab, (id_col, fk_col) in RELATIONS.items():
        rows = tabs.get(tab, ([], []))[1]
        ids = [clean(row.get(id_col)) for row in rows if clean(row.get(id_col))]
        refs = [clean(row.get(fk_col)) for row in rows if clean(row.get(fk_col))]
        result["integrity"][tab] = {
            "rows": len(rows),
            "duplicate_ids": sorted(k for k, n in Counter(ids).items() if n > 1),
            "orphan_media_ids": sorted(set(refs) - media_id_set),
        }

    audio_by_media = Counter(clean(row.get("Media_ID")) for row in tabs.get("Audio", ([], []))[1])
    subtitle_by_media = Counter(clean(row.get("Media_ID")) for row in tabs.get("Subtitle", ([], []))[1])
    mismatches = []
    for row in media_rows:
        mid = clean(row.get("Media_ID"))
        try:
            expected_audio = int(float(row.get("Audio_Count") or 0))
            expected_subs = int(float(row.get("Subtitle_Count") or 0))
        except (TypeError, ValueError):
            mismatches.append({"Media_ID": mid, "error": "non-numeric declared track count"})
            continue
        actual_audio, actual_subs = audio_by_media[mid], subtitle_by_media[mid]
        if expected_audio != actual_audio or expected_subs != actual_subs:
            mismatches.append({
                "Media_ID": mid,
                "audio_expected": expected_audio,
                "audio_actual": actual_audio,
                "subtitle_expected": expected_subs,
                "subtitle_actual": actual_subs,
            })
    result["integrity"]["track_count_mismatches"] = mismatches

    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    has_errors = bool(result["main"]["errors"] or result["assets"]["errors"])
    for table in result["integrity"].values():
        if isinstance(table, dict):
            has_errors |= bool(table.get("duplicate_ids") or table.get("orphan_media_ids"))
    has_errors |= bool(result["integrity"]["duplicate_media_ids"] or mismatches)
    return 1 if has_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
