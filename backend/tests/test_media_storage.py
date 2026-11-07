"""Media storage helpers: reporting only. Nothing here may create, copy, substitute or delete a file."""
import os

from app.services import media_storage as ms


def test_asset_file_present_is_true_only_for_a_real_file(tmp_path):
    f = tmp_path / "a.mp4"
    f.write_bytes(b"x")
    assert ms.asset_file_present(str(f)) is True
    assert ms.asset_file_present(str(tmp_path / "missing.mp4")) is False
    assert ms.asset_file_present(str(tmp_path)) is False          # a directory is not a media file
    assert ms.asset_file_present("") is False and ms.asset_file_present(None) is False


def test_missing_file_message_names_the_file_and_promises_no_replacement():
    m = ms.missing_file_message("Barakah ad.mp4")
    assert "'Barakah ad.mp4'" in m and "no longer on the server" in m and "Nothing was replaced or recreated" in m and "Upload the file again" in m
    assert "this file" in ms.missing_file_message(None)


def test_storage_status_reports_booleans_and_never_writes(tmp_path, monkeypatch):
    monkeypatch.setattr(ms.settings, "UPLOAD_DIR", str(tmp_path / "uploads"))
    st = ms.storage_status()
    assert st["exists"] is False and st["writable"] is False and st["persistent_mount"] is False
    assert not (tmp_path / "uploads").exists()                    # reporting must not create the folder
    (tmp_path / "uploads").mkdir()
    st = ms.storage_status()
    assert st["exists"] is True and st["writable"] is True and st["persistent_mount"] is False   # a plain folder is not a volume
    assert set(st) == {"exists", "writable", "persistent_mount", "free_mb"}
