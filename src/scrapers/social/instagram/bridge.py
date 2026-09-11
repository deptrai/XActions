#!/usr/bin/env python3
# Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
"""
instagrapi bridge — JSON-over-stdio adapter for the Instagram private API.

Invoked by InstagramClient when `transport: 'instagrapi'` and INSTAGRAPI_BIN /
INSTAGRAPI_URL is configured. Reads `action` + a JSON args blob, calls the
`instagrapi` library, and prints a serialized JSON result on stdout.

Usage:
    python3 bridge.py <action> '<json-args>'

Requires: pip install instagrapi
Optional env: INSTAGRAM_SESSION_FILE (path to a saved instagrapi session).
"""

import json
import os
import sys


def _client():
    try:
        from instagrapi import Client  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on env
        raise RuntimeError(
            "instagrapi is not installed: pip install instagrapi"
        ) from exc

    cl = Client()
    session_file = os.environ.get("INSTAGRAM_SESSION_FILE")
    if session_file and os.path.exists(session_file):
        cl.load_settings(session_file)
        # Session token reuse — no interactive login needed.
        try:
            cl.get_timeline_feed()
        except Exception:
            pass
    return cl


def _media_to_dict(m):
    return {
        "pk": str(m.pk),
        "id": getattr(m, "id", str(m.pk)),
        "code": getattr(m, "code", None),
        "media_type": getattr(m, "media_type", None),
        "taken_at": int(m.taken_at.timestamp()) if getattr(m, "taken_at", None) else None,
        "caption": {"text": getattr(m, "caption_text", "")},
        "like_count": getattr(m, "like_count", None),
        "comment_count": getattr(m, "comment_count", None),
        "user": {
            "pk": str(m.user.pk),
            "username": m.user.username,
            "full_name": getattr(m.user, "full_name", ""),
        }
        if getattr(m, "user", None)
        else {},
    }


def _user_to_dict(u):
    return {
        "pk": str(u.pk),
        "username": u.username,
        "full_name": getattr(u, "full_name", ""),
        "biography": getattr(u, "biography", ""),
        "follower_count": getattr(u, "follower_count", None),
        "following_count": getattr(u, "following_count", None),
        "is_verified": getattr(u, "is_verified", False),
        "is_private": getattr(u, "is_private", False),
        "media_count": getattr(u, "media_count", None),
        "profile_pic_url": str(getattr(u, "profile_pic_url", "") or ""),
        "profile_pic_url_hd": str(getattr(u, "profile_pic_url_hd", "") or ""),
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: bridge.py <action> '<json-args>'"}))
        sys.exit(2)

    action = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    cl = _client()

    if action == "user":
        username = args["username"]
        user = cl.user_info_by_username(username)
        medias = cl.user_medias(user.pk, amount=int(args.get("limit", 25)))
        print(json.dumps({
            "user": _user_to_dict(user),
            "items": [_media_to_dict(m) for m in medias],
        }))
    elif action == "hashtag":
        medias = cl.hashtag_medias_top(args["tag"], amount=int(args.get("limit", 25)))
        print(json.dumps({"items": [_media_to_dict(m) for m in medias]}))
    elif action == "post":
        media = cl.media_info(cl.media_pk_from_code(args["shortcode"]))
        print(json.dumps({"media": _media_to_dict(media)}))
    else:
        print(json.dumps({"error": f"unknown action: {action}"}))
        sys.exit(2)


if __name__ == "__main__":
    main()
