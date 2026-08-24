"""Small, defensive, GET-only client for the documented Intervals.icu API."""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Iterable

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import Settings


LOG = logging.getLogger(__name__)


class IntervalsAPIError(RuntimeError):
    pass


SENSITIVE_FRAGMENTS = ("api_key", "apikey", "access_token", "refresh_token", "secret", "password")


def redact_sensitive(value: Any) -> Any:
    """Recursively remove fields that could contain credentials before persistence."""
    if isinstance(value, dict):
        return {
            key: redact_sensitive(item)
            for key, item in value.items()
            if not any(fragment in key.lower() for fragment in SENSITIVE_FRAGMENTS)
        }
    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]
    return value


class IntervalsClient:
    """Only exposes GET operations. No write method exists by design."""

    def __init__(self, settings: Settings) -> None:
        settings.require_credentials()
        self.settings = settings
        self.session = requests.Session()
        self.session.auth = ("API_KEY", settings.api_key)
        self.session.headers.update(
            {"Accept": "application/json", "User-Agent": "bad-ischl-running-coach/0.1"}
        )
        retry = Retry(
            total=4,
            connect=4,
            read=4,
            status=4,
            backoff_factor=0.8,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET"}),
            respect_retry_after_header=True,
        )
        self.session.mount("https://", HTTPAdapter(max_retries=retry))

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = f"{self.settings.base_url}{path}"
        safe_params = {k: v for k, v in (params or {}).items() if v is not None}
        LOG.debug("GET %s params=%s", path, safe_params)
        try:
            response = self.session.get(url, params=safe_params, timeout=self.settings.timeout_seconds)
            response.raise_for_status()
        except requests.RequestException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            hint = " Check athlete ID and read permissions." if status in (401, 403, 404) else ""
            raise IntervalsAPIError(f"Intervals.icu GET {path} failed ({status or 'network error'}).{hint}") from exc
        try:
            return redact_sensitive(response.json())
        except ValueError as exc:
            raise IntervalsAPIError(f"Intervals.icu returned non-JSON data for GET {path}") from exc

    def list_activities(self, oldest: date, newest: date, limit: int = 10000) -> list[dict[str, Any]]:
        data = self._get(
            f"/athlete/{self.settings.athlete_id}/activities",
            {"oldest": oldest.isoformat(), "newest": newest.isoformat(), "limit": limit},
        )
        if not isinstance(data, list):
            raise IntervalsAPIError("Activities response was not a JSON list")
        if len(data) >= limit:
            raise IntervalsAPIError(
                f"Activities response reached the safety limit ({limit}); refusing a potentially truncated sync"
            )
        return data

    def get_activity(self, activity_id: str, include_intervals: bool = True) -> dict[str, Any]:
        data = self._get(f"/activity/{activity_id}", {"intervals": str(include_intervals).lower()})
        if not isinstance(data, dict):
            raise IntervalsAPIError(f"Activity {activity_id} response was not a JSON object")
        return data

    def get_activity_streams(
        self, activity_id: str, types: Iterable[str] | None = None
    ) -> list[dict[str, Any]]:
        # The documented GET endpoint is /activity/{id}/streams{ext}; .json selects JSON.
        params = {"types": ",".join(types)} if types else None
        data = self._get(f"/activity/{activity_id}/streams.json", params)
        if not isinstance(data, list):
            raise IntervalsAPIError(f"Streams for {activity_id} were not a JSON list")
        return data

    def list_activity_pace_curves(
        self,
        oldest: date,
        newest: date,
        distances: Iterable[float],
        activity_type: str = "Run",
        gap: bool = False,
    ) -> Any:
        """Return documented athlete best paces for selected distances.

        This deliberately requests real pace (``gap=False``) so GPS best efforts
        are not confused with gradient-adjusted performances.
        """
        return self._get(
            f"/athlete/{self.settings.athlete_id}/activity-pace-curves.json",
            {
                "oldest": oldest.isoformat(),
                "newest": newest.isoformat(),
                "type": activity_type,
                "distances": ",".join(str(value) for value in distances),
                "gap": str(gap).lower(),
            },
        )

    def list_activity_messages(self, activity_id: str, limit: int = 100) -> list[dict[str, Any]]:
        data = self._get(f"/activity/{activity_id}/messages", {"limit": limit})
        if isinstance(data, dict) and isinstance(data.get("messages"), list):
            return data["messages"]
        return data if isinstance(data, list) else []

    def list_wellness(self, oldest: date, newest: date) -> list[dict[str, Any]]:
        data = self._get(
            f"/athlete/{self.settings.athlete_id}/wellness.json",
            {"oldest": oldest.isoformat(), "newest": newest.isoformat()},
        )
        if not isinstance(data, list):
            raise IntervalsAPIError("Wellness response was not a JSON list")
        return data

    def get_athlete(self) -> dict[str, Any]:
        data = self._get(f"/athlete/{self.settings.athlete_id}")
        if not isinstance(data, dict):
            raise IntervalsAPIError("Athlete response was not a JSON object")
        return redact_sensitive(data)
