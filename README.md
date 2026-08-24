# Intervals.icu Running Coach — Bad Ischl HM

A local, read-only Python workflow for synchronizing Tobias Pointner's Intervals.icu data, analysing actual running, and maintaining a daily plan through the Bad Ischl Half Marathon on 27 September 2026.

The project never uploads or edits activities, wellness, or workouts in Intervals.icu. The API client exposes GET operations only.

## Multi-athlete web platform

The original local Bad Ischl workflow remains intact. A new private platform in
`web/` adds coach and athlete dashboards, athlete switching, goals, full
lactate-stage records, feedback, versioned draft/published plans, audit history,
encrypted per-athlete Intervals.icu OAuth, private report uploads, calendar
exports, background jobs, and a delivery outbox.

The reusable multi-athlete Python boundary is in `src/athlete_context.py` and
`src/planning_engine.py`. `service/engine_api.py` exposes it as a small deployable
service; the web platform uses its deterministic in-platform fallback until
`COACH_ENGINE_URL` is configured.

See `web/README.md` for setup, security boundaries, and hosted configuration.

## What it produces

- 12–24 months of local activity/wellness history (24 months by default)
- detailed activity intervals and useful streams for the latest 16 weeks plus historical races
- weekly mileage, duration, elevation, consistency, long-run and pace-band metrics
- workout classification based on laps/streams where possible
- cautious 5K, 10K and HM fitness ranges with confidence and contrary evidence
- HR anomaly warnings and contextual HR interpretation
- a fully daily, adaptive HM plan with a future-only regeneration workflow
- concise `latest_review.md` and longer `weekly_review.md`
- a private static dashboard, offline calendar export, and Suunto key-workout entry sheet

Raw API payloads and processed personal data are gitignored. Missing metrics remain missing; the code does not invent them.

## Installation

From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

On macOS/Linux, activate with `source .venv/bin/activate`.

## Configuration

1. In Intervals.icu, open **Settings** and find **Developer Settings** near the bottom.
2. Create/copy your personal API key.
3. Copy `.env.example` to `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Edit `.env` locally:

   ```text
   INTERVALS_API_KEY=your_personal_key_here
   INTERVALS_ATHLETE_ID=0
   ```

`0` means the athlete belonging to the personal key and is the simplest option. An explicit Intervals athlete ID is also supported. `.env` is ignored by Git. Never paste the key into source files, reports, terminal commands, or chat.

Leave `COACH_AS_OF_DATE` blank for normal use. It defaults to the computer's current date. A fixed `YYYY-MM-DD` value is useful only for reproducible back-testing.

## Initial sync

```powershell
python -m src.sync --full
```

If Intervals.icu is missing activities, a downloaded Strava archive can be
reconciled locally without uploading anything:

```powershell
python -m src.strava_archive --zip "C:\path\to\export.zip"
```

Set `STRAVA_ARCHIVE_PATH` in `.env` to repeat this reconciliation automatically
after each `python -m src.update_plan` sync. Strava timestamps are converted from
UTC to Europe/Vienna, activities already present in Intervals are excluded, and
available FIT/TCX/GPX streams are parsed locally.

This fetches activity summaries and wellness for the configured history window. It fetches detailed intervals and streams for recent runs and historical races. Later syncs overlap the prior 21 days so edits settle correctly, merge by activity ID, and reuse unchanged cached detail/stream files.

## Generate analysis

```powershell
python -m src.analyse
```

## Generate the initial plan

After the first successful sync:

```powershell
python -m src.analyse --plan
```

Open:

- `reports/current_fitness.md`
- `reports/training_history.md`
- `reports/bad_ischl_plan.md`
- `reports/data_quality.md`
- `reports/multisport_load.md`
- `reports/hr_analysis.md`
- `reports/personal_records.md`
- `reports/multi_race_roadmap.md`
- `plan/multi_race_roadmap.json`

## Daily tracking: dashboard, calendar, and Suunto

The local dashboard is the control centre. It is regenerated automatically with
the plan, or can be rebuilt without a sync:

```powershell
python -m src.dashboard
```

Open `reports/training_dashboard.html` in a browser. It combines current HM and
recovery status, the next 14 days, recent completed runs, and weekly planned
versus completed volume. It is a local file: it does not send data anywhere.

`plan/bad_ischl_calendar.ics` is a standard all-day calendar export of only the
remaining planned sessions. Import it into your personal Outlook, Apple, or
Google calendar for visibility. After a plan update, replace the previous
imported "Bad Ischl HM plan (local)" calendar before importing the new file, so
that changed sessions do not create duplicates.

`plan/suunto_key_workouts.md` is the short entry sheet for the upcoming major
sessions. In the Suunto app, manually create only those structured workouts,
give them their planned date, and sync the Suunto Vertical. Keep easy and long
runs flexible; their terrain, duration, and fatigue modification matter more
than a watch prompt. The project does not upload workouts to Suunto,
Intervals.icu, or Strava.

Recommended roles:

- **Local dashboard:** decision-making and the current plan.
- **Intervals.icu:** read-only activity/wellness source and post-run review.
- **Suunto:** execution prompts for the next one or two key sessions.
- **Strava:** activity history/social log, not the planning source of truth.

If you later want automatic publishing to an Intervals.icu calendar, request it
explicitly. It will be implemented as a separate opt-in command using only the
minimum calendar-write permission; it is deliberately not enabled now.

If run before data are synchronized, the plan is marked **provisional** and deliberately uses a reduced template; it is not personalized coaching.

## Update every 1–3 days

Enter any useful subjective context in `data/manual_feedback.csv`; blanks are allowed. Then run:

```powershell
python -m src.update_plan
```

On Windows, you can instead double-click `Update Running Coach.cmd` in the
project folder. It switches to the correct project directory automatically,
runs the update using `.venv`, and opens the dashboard when successful.

Open:

- `reports/training_dashboard.html`
- `reports/latest_review.md`
- `reports/bad_ischl_plan.md`

The update command:

1. downloads new/edited data with a cache overlap;
2. compares actual activities with the current assessment;
3. reassesses recent performance and fatigue;
4. preserves all past plan dates (and today once today's activity exists);
5. regenerates only the remaining future plan;
6. records material future changes in `reports/plan_changelog.md` and the JSON `change_log`.

Use `python -m src.update_plan --full-sync` occasionally if an older activity was edited. `--skip-sync` is only for offline development/testing.

## Editable athlete context

Edit `data/athlete_profile.json` for availability, injuries, test data, or future context. The supplied PBs remain contextual evidence only; current synchronized training has priority.

Manual feedback columns:

```text
date,activity_id,rpe_1_10,legs_1_10,fatigue_1_10,sleep_1_10,pain,comments
```

An `activity_id` entry takes priority over a date-only entry.

Confirmed race results that are missing or incorrectly represented in the GPS/API data belong in `data/manual_race_results.csv`. Official results take priority over GPS distance/time for performance estimation, while the original activity remains unchanged.

## Data interpretation and limitations

- Intervals.icu activity `distance` is normalized from metres to kilometres.
- Pace-band distribution uses detailed speed/distance streams when available, then a non-overlapping interval partition when plausible, then whole-run pace as a lower-resolution fallback.
- Workout labels use explicit work intervals/laps before activity titles.
- HR is never used alone to declare lactate threshold. Trace anomalies reduce confidence.
- No lactate or physiological-test result is assumed. If such data are not present, reports state that explicitly.
- Intervals.icu wellness fields can be blank if no upstream device/service supplies them.
- Some Strava-sourced activity data may not be redistributable through another service's API. This is reported rather than silently filled.
- A local Strava export is a fallback only. Official race results override GPS distance/time, while recovered streams may still inform HR and split analysis.
- CTL/ATL/training load can be useful context, but the planner does not chase CTL or optimize load scores.
- Fitness ranges are decision support, not guarantees or medical advice.

## API contract used

The client was checked against the current [Intervals.icu API documentation](https://intervals.icu/api-docs.html) and the official [API Integration Cookbook](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090) on 13 August 2026.

Read operations used:

- `GET /api/v1/athlete/{id}/activities?oldest=...&newest=...`
- `GET /api/v1/activity/{id}?intervals=true`
- `GET /api/v1/activity/{id}/streams.json`
- `GET /api/v1/activity/{id}/messages`
- `GET /api/v1/athlete/{id}/wellness.json?oldest=...&newest=...`
- `GET /api/v1/athlete/{id}` (strictly filtered before storage)
- `GET /api/v1/athlete/{id}/activity-pace-curves.json` (real-pace best efforts; read-only)

Personal keys use HTTP Basic authentication with username `API_KEY` and the personal key as password. The athlete response schema can expose sensitive account fields, so only an explicit allow-list of analysis fields is persisted.

## Verification

```powershell
python -m pytest -q
```

To check syntax without network access:

```powershell
python -m compileall -q src tests
```
