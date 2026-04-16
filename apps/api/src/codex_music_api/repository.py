from __future__ import annotations

import json
import sqlite3
from typing import TYPE_CHECKING, Any

from codex_music_api.schemas import (
    AnalysisSummary,
    JobView,
    ProjectDetail,
    ProjectSummary,
    RightsSummary,
    StemView,
)

if TYPE_CHECKING:
    from pathlib import Path


class StudioRepository:
    """Persist projects, stems, and jobs for the Codex Music MVP."""

    def __init__(self, database_path: Path) -> None:
        """Create a repository bound to one SQLite database file."""

        self._database_path = database_path

    def initialize(self) -> None:
        """Create tables needed by the MVP if they do not yet exist."""

        self._database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    primary_provider TEXT NOT NULL,
                    audio_filename TEXT,
                    audio_path TEXT,
                    source_notes TEXT,
                    audio_content_type TEXT,
                    audio_size_bytes INTEGER,
                    polished_audio_filename TEXT,
                    polished_audio_path TEXT,
                    polished_audio_content_type TEXT,
                    polished_audio_provider TEXT,
                    analysis_json TEXT NOT NULL,
                    rights_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS stems (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    color TEXT NOT NULL,
                    level_db REAL NOT NULL,
                    audio_path TEXT,
                    audio_content_type TEXT,
                    provider TEXT NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                );

                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    message TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                );
                """
            )
            self._ensure_column(connection, "projects", "source_notes", "TEXT")
            self._ensure_column(connection, "projects", "polished_audio_filename", "TEXT")
            self._ensure_column(connection, "projects", "polished_audio_path", "TEXT")
            self._ensure_column(connection, "projects", "polished_audio_content_type", "TEXT")
            self._ensure_column(connection, "projects", "polished_audio_provider", "TEXT")
            self._ensure_column(connection, "stems", "audio_path", "TEXT")
            self._ensure_column(connection, "stems", "audio_content_type", "TEXT")

    def list_projects(self) -> list[ProjectSummary]:
        """Return all projects ordered by most recently updated."""

        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    p.*,
                    COUNT(s.id) AS stem_count
                FROM projects p
                LEFT JOIN stems s ON s.project_id = p.id
                GROUP BY p.id
                ORDER BY p.updated_at DESC
                """
            ).fetchall()

        return [self._to_project_summary(row) for row in rows]

    def get_project(self, project_id: str) -> ProjectDetail | None:
        """Return one project with its stems and jobs."""

        with self._connect() as connection:
            project_row = connection.execute(
                "SELECT * FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if project_row is None:
                return None

            stem_rows = connection.execute(
                "SELECT * FROM stems WHERE project_id = ? ORDER BY name ASC",
                (project_id,),
            ).fetchall()
            job_rows = connection.execute(
                "SELECT * FROM jobs WHERE project_id = ? ORDER BY updated_at DESC",
                (project_id,),
            ).fetchall()

        stems = [StemView.model_validate(dict(row)) for row in stem_rows]
        jobs = [JobView.model_validate(dict(row)) for row in job_rows]
        return self._to_project_detail(project_row, stems=stems, jobs=jobs)

    def create_project(
        self,
        *,
        project_id: str,
        name: str,
        source_type: str,
        status: str,
        created_at: str,
        updated_at: str,
        primary_provider: str,
        audio_filename: str | None,
        audio_path: str | None,
        source_notes: str | None,
        audio_content_type: str | None,
        audio_size_bytes: int | None,
        analysis: AnalysisSummary,
        rights: RightsSummary,
        polished_audio_filename: str | None = None,
        polished_audio_path: str | None = None,
        polished_audio_content_type: str | None = None,
        polished_audio_provider: str | None = None,
    ) -> ProjectDetail:
        """Create a project and return the stored detail view."""

        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO projects (
                    id,
                    name,
                    source_type,
                    status,
                    created_at,
                    updated_at,
                    primary_provider,
                    audio_filename,
                    audio_path,
                    source_notes,
                    audio_content_type,
                    audio_size_bytes,
                    polished_audio_filename,
                    polished_audio_path,
                    polished_audio_content_type,
                    polished_audio_provider,
                    analysis_json,
                    rights_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    name,
                    source_type,
                    status,
                    created_at,
                    updated_at,
                    primary_provider,
                    audio_filename,
                    audio_path,
                    source_notes,
                    audio_content_type,
                    audio_size_bytes,
                    polished_audio_filename,
                    polished_audio_path,
                    polished_audio_content_type,
                    polished_audio_provider,
                    analysis.model_dump_json(),
                    rights.model_dump_json(),
                ),
            )

        project = self.get_project(project_id)
        if project is None:
            raise RuntimeError("Project was created but could not be reloaded.")
        return project

    def replace_stems(self, project_id: str, stems: list[StemView], updated_at: str) -> None:
        """Replace all stems associated with a project."""

        with self._connect() as connection:
            connection.execute("DELETE FROM stems WHERE project_id = ?", (project_id,))
            connection.executemany(
                """
                INSERT INTO stems (
                    id,
                    project_id,
                    name,
                    kind,
                    color,
                    level_db,
                    audio_path,
                    audio_content_type,
                    provider
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        stem.id,
                        project_id,
                        stem.name,
                        stem.kind,
                        stem.color,
                        stem.level_db,
                        stem.audio_path,
                        stem.audio_content_type,
                        stem.provider,
                    )
                    for stem in stems
                ],
            )
            connection.execute(
                "UPDATE projects SET updated_at = ? WHERE id = ?",
                (updated_at, project_id),
            )

    def set_analysis(
        self,
        project_id: str,
        analysis: AnalysisSummary,
        updated_at: str,
    ) -> None:
        """Update the analysis summary for a project."""

        self._update_project_json(
            project_id=project_id,
            column="analysis_json",
            payload=analysis.model_dump(mode="json"),
            updated_at=updated_at,
        )

    def set_rights(
        self,
        project_id: str,
        rights: RightsSummary,
        updated_at: str,
    ) -> None:
        """Update the rights summary for a project."""

        self._update_project_json(
            project_id=project_id,
            column="rights_json",
            payload=rights.model_dump(mode="json"),
            updated_at=updated_at,
        )

    def set_project_status(self, project_id: str, status: str, updated_at: str) -> None:
        """Update the overall project status."""

        with self._connect() as connection:
            connection.execute(
                "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
                (status, updated_at, project_id),
            )

    def set_project_audio_source(
        self,
        project_id: str,
        *,
        audio_filename: str | None,
        audio_path: str | None,
        audio_content_type: str | None,
        audio_size_bytes: int | None,
        updated_at: str,
    ) -> None:
        """Update the audio source fields for a project."""

        with self._connect() as connection:
            connection.execute(
                """
                UPDATE projects
                SET
                    audio_filename = ?,
                    audio_path = ?,
                    audio_content_type = ?,
                    audio_size_bytes = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    audio_filename,
                    audio_path,
                    audio_content_type,
                    audio_size_bytes,
                    updated_at,
                    project_id,
                ),
            )

    def set_project_polished_audio(
        self,
        project_id: str,
        *,
        polished_audio_filename: str | None,
        polished_audio_path: str | None,
        polished_audio_content_type: str | None,
        polished_audio_provider: str | None,
        updated_at: str,
    ) -> None:
        """Update the polished output fields for a project."""

        with self._connect() as connection:
            connection.execute(
                """
                UPDATE projects
                SET
                    polished_audio_filename = ?,
                    polished_audio_path = ?,
                    polished_audio_content_type = ?,
                    polished_audio_provider = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    polished_audio_filename,
                    polished_audio_path,
                    polished_audio_content_type,
                    polished_audio_provider,
                    updated_at,
                    project_id,
                ),
            )

    def replace_jobs(self, project_id: str, jobs: list[JobView]) -> None:
        """Replace all current jobs for a project."""

        with self._connect() as connection:
            connection.execute("DELETE FROM jobs WHERE project_id = ?", (project_id,))
            connection.executemany(
                """
                INSERT INTO jobs (id, project_id, kind, status, provider, message, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        job.id,
                        project_id,
                        job.kind,
                        job.status,
                        job.provider,
                        job.message,
                        job.updated_at,
                    )
                    for job in jobs
                ],
            )

    def upsert_job(self, project_id: str, job: JobView) -> None:
        """Insert or update a single job for a project."""

        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO jobs (id, project_id, kind, status, provider, message, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    kind = excluded.kind,
                    status = excluded.status,
                    provider = excluded.provider,
                    message = excluded.message,
                    updated_at = excluded.updated_at
                """,
                (
                    job.id,
                    project_id,
                    job.kind,
                    job.status,
                    job.provider,
                    job.message,
                    job.updated_at,
                ),
            )

    def _update_project_json(
        self,
        *,
        project_id: str,
        column: str,
        payload: dict[str, Any],
        updated_at: str,
    ) -> None:
        """Persist one JSON field on the project table."""

        serialized = json.dumps(payload)
        with self._connect() as connection:
            connection.execute(
                f"UPDATE projects SET {column} = ?, updated_at = ? WHERE id = ?",
                (serialized, updated_at, project_id),
            )

    def _ensure_column(
        self,
        connection: sqlite3.Connection,
        table_name: str,
        column_name: str,
        column_type: str,
    ) -> None:
        """Add a new column to an existing table if it is missing."""

        rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
        existing = {row["name"] for row in rows}
        if column_name in existing:
            return
        connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}")

    def _connect(self) -> sqlite3.Connection:
        """Create a SQLite connection with row access by column name."""

        connection = sqlite3.connect(self._database_path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection

    def _to_project_summary(self, row: sqlite3.Row) -> ProjectSummary:
        """Convert one project row into a dashboard summary."""

        row_keys = set(row.keys())
        stem_count = int(row["stem_count"]) if "stem_count" in row_keys else 0
        return ProjectSummary(
            id=row["id"],
            name=row["name"],
            source_type=row["source_type"],
            status=row["status"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            primary_provider=row["primary_provider"],
            audio_filename=row["audio_filename"],
            audio_path=row["audio_path"],
            source_notes=row["source_notes"],
            stem_count=stem_count,
            next_action=self._next_action_for_status(
                row["status"],
                row["source_type"],
                stem_count,
            ),
        )

    def _to_project_detail(
        self,
        row: sqlite3.Row,
        *,
        stems: list[StemView],
        jobs: list[JobView],
    ) -> ProjectDetail:
        """Convert one row and its related records into the full studio view."""

        summary = self._to_project_summary(row)
        if summary.stem_count != len(stems):
            summary = summary.model_copy(
                update={
                    "stem_count": len(stems),
                    "next_action": self._next_action_for_status(
                        summary.status,
                        summary.source_type,
                        len(stems),
                    ),
                }
            )
        analysis = AnalysisSummary.model_validate(json.loads(row["analysis_json"]))
        rights = RightsSummary.model_validate(json.loads(row["rights_json"]))
        next_actions = self._build_next_actions(
            summary.status,
            source_type=summary.source_type,
            stems=stems,
            polished_audio_path=row["polished_audio_path"],
        )

        return ProjectDetail(
            **summary.model_dump(),
            audio_content_type=row["audio_content_type"],
            audio_size_bytes=row["audio_size_bytes"],
            polished_audio_filename=row["polished_audio_filename"],
            polished_audio_path=row["polished_audio_path"],
            polished_audio_content_type=row["polished_audio_content_type"],
            polished_audio_provider=row["polished_audio_provider"],
            analysis=analysis,
            rights=rights,
            stems=stems,
            jobs=jobs,
            next_actions=next_actions,
        )

    def _next_action_for_status(self, status: str, source_type: str, stem_count: int) -> str:
        """Return the main CTA label for a project summary card."""

        if status == "processing":
            return "Open live workspace"
        if stem_count > 0:
            return "Review stems and analysis"
        if source_type in {"prompt", "reference"}:
            return "Run generation and prep"
        return "Run studio prep"

    def _build_next_actions(
        self,
        status: str,
        *,
        source_type: str,
        stems: list[StemView],
        polished_audio_path: str | None = None,
    ) -> list[str]:
        """Return helpful next-step suggestions for the workspace."""

        actions = ["Review rights before commercial export", "Prepare compare mix snapshot"]
        if polished_audio_path:
            actions.insert(0, "Audition the polished preview before export")
        if status in {"draft", "attention"}:
            if source_type in {"prompt", "reference"}:
                actions.insert(0, "Run ACE generation, separation, and analysis")
            else:
                actions.insert(0, "Run studio prep to generate stems and analysis")
        elif not stems:
            actions.insert(0, "Upload audio and generate the first stem layout")
        else:
            actions.insert(0, "Trim regions and rebalance stem levels")
        return actions
