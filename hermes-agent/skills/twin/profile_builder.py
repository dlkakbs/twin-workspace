from __future__ import annotations

from pathlib import Path
from typing import Iterable

try:
    from pypdf import PdfReader
except ModuleNotFoundError:  # pragma: no cover - optional dependency
    PdfReader = None

from .models import SourceDocument


TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".rst", ".json", ".yaml", ".yml", ".csv"}


def read_writing_sample(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        if PdfReader is None:
            raise RuntimeError("PDF support requires `pypdf`. Install it with `python -m pip install pypdf`.")
        reader = PdfReader(str(path))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(pages).strip()
    if suffix in TEXT_EXTENSIONS:
        return path.read_text(encoding="utf-8").strip()
    raise ValueError(f"Unsupported writing sample type: {path}")


def load_writing_corpus(paths: Iterable[Path]) -> tuple[list[SourceDocument], str]:
    documents: list[SourceDocument] = []
    chunks: list[str] = []
    for path in paths:
        text = read_writing_sample(path)
        if not text:
            continue
        documents.append(
            SourceDocument(
                path=str(path),
                kind=path.suffix.lower().lstrip(".") or "text",
                characters=len(text),
            )
        )
        chunks.append(f"## SOURCE: {path.name}\n{text}")
    corpus = "\n\n".join(chunks).strip()
    if not corpus:
        raise ValueError("No usable writing sample text could be extracted.")
    return documents, corpus
