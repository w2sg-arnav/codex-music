from __future__ import annotations

import shutil
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlparse
from uuid import uuid4

import httpx

if TYPE_CHECKING:
    from fastapi import UploadFile


class LocalMediaStorage:
    """Persist uploaded media files on local disk for MVP usage."""

    def __init__(self, media_root: Path) -> None:
        """Initialize the storage manager."""

        self._media_root = media_root

    def prepare(self) -> None:
        """Create the storage directory if it does not exist."""

        self._media_root.mkdir(parents=True, exist_ok=True)

    def save_project_audio(self, project_id: str, upload: UploadFile) -> tuple[str, int]:
        """Save an uploaded project audio file and return its public path and size."""

        suffix = Path(upload.filename or "upload.wav").suffix or ".wav"
        safe_name = f"{uuid4().hex}{suffix}"
        project_dir = self._media_root / "projects" / project_id
        project_dir.mkdir(parents=True, exist_ok=True)
        target_path = project_dir / safe_name

        with target_path.open("wb") as file_handle:
            shutil.copyfileobj(upload.file, file_handle)

        relative_path = f"/media/projects/{project_id}/{safe_name}"
        return relative_path, target_path.stat().st_size

    def save_remote_audio(
        self,
        project_id: str,
        *,
        source_url: str,
        filename: str,
    ) -> tuple[str, int]:
        """Download remote audio into the public media store."""

        parsed_url = urlparse(source_url)
        suffix = Path(filename).suffix or Path(parsed_url.path).suffix or ".wav"
        safe_name = f"{uuid4().hex}{suffix}"
        project_dir = self._media_root / "projects" / project_id
        project_dir.mkdir(parents=True, exist_ok=True)
        target_path = project_dir / safe_name

        with httpx.stream("GET", source_url, follow_redirects=True, timeout=180) as response:
            response.raise_for_status()
            with target_path.open("wb") as file_handle:
                for chunk in response.iter_bytes():
                    file_handle.write(chunk)

        relative_path = f"/media/projects/{project_id}/{safe_name}"
        return relative_path, target_path.stat().st_size
