"""Uploaded-media storage: where the files live, whether that place survives a redeploy, and what to tell a person when a file their records point at is gone.

Every Asset row stores a RELATIVE path under UPLOAD_DIR (`uploads/<user_id>/<uuid>.<ext>`; keyframes, thumbnails and footage all live there), so the persistence of ALL media (reference videos, their
keyframes, Video Studio footage) is decided by one thing: whether UPLOAD_DIR is a persistent volume. On a container without a volume it is wiped by every redeploy while the database rows survive.
Nothing here ever creates, copies, substitutes or deletes a media file: a missing file is reported as missing.
"""
from __future__ import annotations

import os
from pathlib import Path

from app.config import settings


def upload_root() -> Path:
    return Path(settings.UPLOAD_DIR).resolve()


def storage_status() -> dict:
    """Booleans and numbers only (safe to expose): is the upload folder there, writable, and a mount point (= a volume that outlives the container)?"""
    root = upload_root()
    exists = root.is_dir()
    writable = exists and os.access(root, os.W_OK)
    free_mb = None
    if exists:
        try:
            st = os.statvfs(root) if hasattr(os, "statvfs") else None
            free_mb = int(st.f_bavail * st.f_frsize // (1024 * 1024)) if st else None
        except OSError:
            free_mb = None
    return {"exists": exists, "writable": writable, "persistent_mount": bool(exists and os.path.ismount(root)), "free_mb": free_mb}


def asset_file_present(file_path: str | None) -> bool:
    return bool(file_path) and Path(file_path).is_file()


def missing_file_message(original_filename: str | None) -> str:
    name = f"'{original_filename}'" if original_filename else "this file"
    return (f"The uploaded file {name} is no longer on the server (it was stored before persistent storage was set up, or it was removed). "
            "Nothing was replaced or recreated. Upload the file again, then use the new copy.")
