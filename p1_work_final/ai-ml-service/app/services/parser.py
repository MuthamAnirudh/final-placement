"""
Resume / Job-Description parsing.

Pipeline:
 1. Text extraction (PyPDF2 for .pdf, python-docx for .docx, raw for .txt)
 2. Structural extraction (name/email/phone/links via regex — deterministic,
    no LLM call needed, so it never fails even with zero API keys configured)
 3. Skill & section extraction via spaCy if the model is installed, else a
    curated keyword-matcher fallback (SKILL_VOCAB) so the service degrades
    gracefully instead of crashing when `en_core_web_sm` isn't downloaded.
 4. Optional LLM enrichment (role inference, seniority, project summaries)
    via llm_providers.call_llm — skipped automatically if no key is set.
"""
import io
import logging
import re
from typing import Optional

from app.services.llm_providers import call_llm, parse_json_loose, LLMError

logger = logging.getLogger("ai_ml_service.parser")

try:
    import spacy
    try:
        _NLP = spacy.load("en_core_web_sm")
    except OSError:
        _NLP = None
except ImportError:
    spacy = None
    _NLP = None

try:
    from pypdf import PdfReader
except ImportError:
    try:
        from PyPDF2 import PdfReader  # type: ignore
    except ImportError:
        PdfReader = None

try:
    import docx as python_docx
except ImportError:
    python_docx = None


EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"(?:\+?\d{1,3}[-.\s]?)?(?:\d{10}|\d{5}[-.\s]\d{5}|\(\d{3}\)\s?\d{3}[-.\s]?\d{4})")
LINKEDIN_RE = re.compile(r"(?:https?://)?(?:www\.)?linkedin\.com/in/[A-Za-z0-9\-_/]+", re.I)
GITHUB_RE = re.compile(r"(?:https?://)?(?:www\.)?github\.com/[A-Za-z0-9\-_/]+", re.I)

SECTION_HEADERS = ["education", "experience", "projects", "skills", "certifications",
                    "achievements", "publications", "internships", "summary", "objective"]

# Curated fallback vocabulary — used only when spaCy/en_core_web_sm isn't installed.
SKILL_VOCAB = [
    "python", "java", "javascript", "typescript", "c++", "c", "go", "rust", "kotlin", "swift",
    "react", "react.js", "next.js", "vue", "angular", "node.js", "express", "django", "flask",
    "fastapi", "spring boot", "html", "css", "tailwind", "bootstrap",
    "sql", "mysql", "postgresql", "mongodb", "redis", "firebase", "sqlite",
    "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "ci/cd", "jenkins", "git", "github",
    "machine learning", "deep learning", "nlp", "computer vision", "pytorch", "tensorflow",
    "scikit-learn", "pandas", "numpy", "opencv", "langchain", "llm", "huggingface",
    "data structures", "algorithms", "dsa", "oop", "rest api", "graphql", "microservices",
    "linux", "bash", "webrtc", "websockets", "figma", "power bi", "tableau", "excel",
    "spacy", "whisper", "pinecone", "qdrant", "vector database", "system design",
]


def extract_text(filename: str, content: bytes) -> str:
    lower = (filename or "").lower()
    if lower.endswith(".pdf"):
        if PdfReader is None:
            raise RuntimeError("pypdf/PyPDF2 not installed — add it to requirements.txt")
        # FIX: a corrupt, truncated or password-protected PDF raised pypdf's own exception types, which the
        # router does not catch -> generic HTTP 500 "Internal server error". They are now reported as a clear
        # 422 (ValueError) the student can act on.
        try:
            reader = PdfReader(io.BytesIO(content))
            if getattr(reader, "is_encrypted", False):
                try:
                    if not reader.decrypt(""):
                        raise ValueError("This PDF is password-protected. Remove the password and upload it again.")
                except ValueError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    raise ValueError("This PDF is password-protected. Remove the password and upload it again.") from exc
            return "\n".join((page.extract_text() or "") for page in reader.pages)
        except ValueError:
            raise
        except Exception as exc:  # noqa: BLE001 - pypdf raises many distinct error types
            raise ValueError("This PDF could not be read — it may be corrupt or not a real PDF file.") from exc
    if lower.endswith(".docx"):
        if python_docx is None:
            raise RuntimeError("python-docx not installed — add it to requirements.txt")
        try:
            doc = python_docx.Document(io.BytesIO(content))
        except Exception as exc:  # noqa: BLE001 - BadZipFile, KeyError, PackageNotFoundError...
            raise ValueError("This DOCX could not be read — it may be corrupt or not a real Word file.") from exc
        parts = [p.text for p in doc.paragraphs]
        # Resumes are often laid out in tables (skills grids, two-column headers); include their text too.
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    if cell.text.strip():
                        parts.append(cell.text)
        return "\n".join(parts)
    # .txt or unknown — best-effort decode. NUL bytes mean this is a binary file (e.g. legacy .doc, an image),
    # which would otherwise be "parsed" as garbage.
    if b"\x00" in content[:4096]:
        raise ValueError("Unsupported file type. Please upload a PDF, DOCX or plain-text (.txt) resume.")
    return content.decode("utf-8", errors="ignore")


def extract_contact_info(text: str) -> dict:
    email = EMAIL_RE.search(text)
    phone = PHONE_RE.search(text)
    linkedin = LINKEDIN_RE.search(text)
    github = GITHUB_RE.search(text)
    name = None
    for line in text.strip().splitlines()[:5]:
        candidate = line.strip()
        # Heuristic: a short, mostly-alphabetic line near the top with no digits/@ is likely the name
        if 2 <= len(candidate.split()) <= 5 and not any(ch.isdigit() for ch in candidate) and "@" not in candidate:
            name = candidate
            break
    return {
        "name": name,
        "email": email.group(0) if email else None,
        "phone": phone.group(0) if phone else None,
        "linkedin": linkedin.group(0) if linkedin else None,
        "github": github.group(0) if github else None,
    }


# FIX: skills were matched with a plain substring test (`skill in text`). That made "c" match every resume that
# contains the letter c, "go" match "good"/"Google", "java" match "JavaScript", "express" match "expression",
# "git" match "GitHub", "r"-style tokens match anywhere, etc. — so the extracted skill list (and every match /
# radar / roadmap that consumes it) was full of skills the student never listed. Skills are now matched as
# whole tokens; the two ambiguous one-word skills ("c", "go") must additionally appear capitalised as a language
# name ("C", "Go").
_CASE_SENSITIVE_SKILLS = {"c": "C", "go": "Go"}
_SKILL_PATTERNS: dict = {}


def _skill_pattern(skill: str):
    pat = _SKILL_PATTERNS.get(skill)
    if pat is None:
        literal = _CASE_SENSITIVE_SKILLS.get(skill, skill)
        body = re.escape(literal).replace(r"\ ", r"[\s\-]+")  # "machine learning" also matches "machine-learning"
        pat = re.compile(r"(?<![A-Za-z0-9+#])" + body + r"(?![A-Za-z0-9+#])",
                         0 if skill in _CASE_SENSITIVE_SKILLS else re.I)
        _SKILL_PATTERNS[skill] = pat
    return pat


def extract_skills(text: str) -> list[str]:
    text = text or ""
    found = set()
    lemmas = None
    if _NLP is not None:
        doc = _NLP(text[:100000])
        # spaCy has no out-of-the-box "skill" entity type, so combine NER (ORG/PRODUCT-ish
        # noise filtered out) with the curated vocabulary matched against lemmatized tokens —
        # this is the standard pragmatic pattern for skill extraction without a fine-tuned model.
        lemmas = {tok.lemma_.lower() for tok in doc if not tok.is_stop and not tok.is_punct}
    for skill in SKILL_VOCAB:
        if _skill_pattern(skill).search(text):
            found.add(skill)
        elif lemmas is not None and " " in skill and all(w in lemmas for w in skill.split()):
            # lemma fallback only for multi-word skills ("machine learning" vs "machine-learned models");
            # for single words it matched ordinary verbs (e.g. the lemma "go").
            found.add(skill)
    return sorted(found)


def extract_sections(text: str) -> dict:
    lines = text.splitlines()
    sections: dict[str, list[str]] = {}
    current = "header"
    sections[current] = []
    for line in lines:
        stripped = line.strip()
        norm = re.sub(r"[^a-z ]", "", stripped.lower())
        matched_header = next((h for h in SECTION_HEADERS if norm == h or norm.startswith(h + " ")), None)
        if matched_header and len(stripped) < 40:
            current = matched_header
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(stripped)
    return {k: "\n".join(v).strip() for k, v in sections.items() if "\n".join(v).strip()}


async def parse_resume(filename: str, content: bytes, use_llm_enrichment: bool = True) -> dict:
    text = extract_text(filename or "", content)
    if not text.strip():
        raise ValueError("Could not extract any text from this file — it may be a scanned image PDF.")

    contact = extract_contact_info(text)
    skills = extract_skills(text)
    sections = extract_sections(text)

    result = {
        "contact": contact,
        "skills": skills,
        "sections": sections,
        "word_count": len(text.split()),
        "nlp_engine": "spacy(en_core_web_sm)" if _NLP is not None else "keyword-fallback",
        "enrichment": None,
        "enrichment_error": None,
    }

    if use_llm_enrichment:
        system = (
            "You are a resume analysis engine for campus placements. Given raw resume text, "
            "output ONLY strict JSON (no markdown fences) with keys: "
            '{"inferred_experience_level": "fresher|junior|mid", '
            '"top_projects": [ {"name": string, "one_line_impact": string} ] (max 3), '
            '"strengths": [string] (max 5), '
            '"resume_red_flags": [string] (max 4, e.g. no quantified impact, generic objective) }'
        )
        try:
            res = await call_llm(system, text[:6000], {"jsonMode": True, "maxTokens": 700})
            result["enrichment"] = parse_json_loose(res["text"])
        except Exception as exc:  # noqa: BLE001 - LLMError, ValueError (bad JSON), network errors...
            # Keep the raw provider/exception text in the server log, not in the API response.
            logger.warning("Resume LLM enrichment failed: %s: %s", type(exc).__name__, exc)
            result["enrichment_error"] = str(exc) if isinstance(exc, LLMError) else "AI enrichment was unavailable for this resume."

    return result


def parse_job_description(text: str) -> dict:
    skills = extract_skills(text)
    return {"skills": skills, "word_count": len(text.split())}
