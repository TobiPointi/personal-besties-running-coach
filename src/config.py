"""Configuration and project paths. Secrets are read only from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
CACHE_DIR = DATA_DIR / "cache"
REPORTS_DIR = ROOT / "reports"
PLAN_DIR = ROOT / "plan"
MANUAL_FEEDBACK_PATH = DATA_DIR / "manual_feedback.csv"
MANUAL_RACE_RESULTS_PATH = DATA_DIR / "manual_race_results.csv"
ATHLETE_PROFILE_PATH = DATA_DIR / "athlete_profile.json"
PLAN_PATH = PLAN_DIR / "bad_ischl_plan.json"
RACE_DATE = date(2026, 9, 27)
GOAL_HM_SECONDS = 75 * 60
GOAL_PACE_SECONDS_PER_KM = GOAL_HM_SECONDS / 21.0975


class ConfigurationError(RuntimeError):
    """Raised when required environment configuration is unavailable."""


def ensure_directories() -> None:
    for path in (RAW_DIR, PROCESSED_DIR, CACHE_DIR, REPORTS_DIR, PLAN_DIR):
        path.mkdir(parents=True, exist_ok=True)


def _as_date(value: str | None) -> date:
    if not value:
        return date.today()
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ConfigurationError("COACH_AS_OF_DATE must use YYYY-MM-DD") from exc


@dataclass(frozen=True)
class Settings:
    api_key: str
    athlete_id: str
    as_of_date: date
    history_months: int
    detail_weeks: int
    timeout_seconds: int
    strava_archive_path: Path | None
    base_url: str = "https://intervals.icu/api/v1"

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.athlete_id)

    def require_credentials(self) -> None:
        if not self.api_key:
            raise ConfigurationError(
                f"INTERVALS_API_KEY is missing. Copy {ROOT / '.env.example'} to "
                f"{ROOT / '.env'} and add the key there."
            )
        if not self.athlete_id:
            raise ConfigurationError("INTERVALS_ATHLETE_ID is missing (0 is valid).")


def get_settings(require_credentials: bool = False) -> Settings:
    load_dotenv(ROOT / ".env", override=False)
    strava_archive_raw = os.getenv("STRAVA_ARCHIVE_PATH", "").strip()
    settings = Settings(
        api_key=os.getenv("INTERVALS_API_KEY", "").strip(),
        athlete_id=os.getenv("INTERVALS_ATHLETE_ID", "0").strip(),
        as_of_date=_as_date(os.getenv("COACH_AS_OF_DATE")),
        history_months=max(12, min(36, int(os.getenv("COACH_HISTORY_MONTHS", "24")))),
        detail_weeks=max(8, min(26, int(os.getenv("COACH_DETAIL_WEEKS", "16")))),
        timeout_seconds=max(5, int(os.getenv("INTERVALS_TIMEOUT_SECONDS", "30"))),
        strava_archive_path=Path(strava_archive_raw).expanduser() if strava_archive_raw else None,
    )
    if require_credentials:
        settings.require_credentials()
    return settings


ensure_directories()
