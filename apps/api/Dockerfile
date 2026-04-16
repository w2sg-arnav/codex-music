FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

COPY pyproject.toml uv.lock README.md ./
COPY src ./src

RUN mkdir -p /app/data /app/media
RUN uv sync --frozen --no-dev

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "codex_music_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
