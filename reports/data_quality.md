# Data Quality

Last sync: 2026-08-24T07:16:09.673728+00:00

- No sync issue was recorded (or sync has not run).

- Raw running records: 487
- Running records used in analysis after exact-import deduplication: 481
- Exact duplicate imports excluded from metrics: 6
- Strava rows matched to Intervals and excluded: 470
- Activities absent from Intervals and supplied by the local Strava archive: 122
- Missing-source FIT/TCX/GPX stream files parsed locally: 118
  - 2026-05-13: excluded i160348686; retained i160348687 (Exact start/type/distance/duration/average-HR duplicate import).
  - 2026-05-17: excluded i160348670; retained i160348671 (Exact start/type/distance/duration/average-HR duplicate import).
  - 2026-05-26: excluded i160348645; retained i160348646 (Exact start/type/distance/duration/average-HR duplicate import).
  - 2026-05-30: excluded i160348615; retained i160348617 (Exact start/type/distance/duration/average-HR duplicate import).
  - 2026-06-03: excluded i160348593; retained i160348594 (Exact start/type/distance/duration/average-HR duplicate import).
  - 2026-06-10: excluded i160348509; retained i160348510 (Exact start/type/distance/duration/average-HR duplicate import).

Missing data are not imputed. Stream restrictions and blank wellness fields reduce confidence rather than being invented.
