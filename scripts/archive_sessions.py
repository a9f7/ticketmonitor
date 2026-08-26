#!/usr/bin/env python3
"""Archive completed background-automation sessions (left-panel tasks).

Default is dry-run. Use --apply to actually UPDATE sessions.status='archived'.
"""
import argparse
import sqlite3
import sys
from datetime import datetime, timezone

DB = r"C:\Users\d\.workbuddy\workbuddy.db"


def parse_args():
    p = argparse.ArgumentParser(description="Archive completed background-automation sessions")
    p.add_argument("--apply", action="store_true", help="actually update the database")
    p.add_argument("--exclude-recent-hours", type=float, default=0,
                   help="skip sessions whose last_activity_at is within N hours (default: 0 = archive all)")
    p.add_argument("--exclude-ids", type=str, default="",
                   help="comma-separated session ids to never archive")
    return p.parse_args()


def main():
    args = parse_args()
    exclude_ids = set(x.strip() for x in args.exclude_ids.split(",") if x.strip())

    con = sqlite3.connect(DB)
    con.execute("PRAGMA busy_timeout = 10000")
    cur = con.cursor()

    # identify currently active session(s) to avoid archiving the one user is in
    cur.execute("SELECT id, status FROM sessions WHERE status IN ('working','planning','pending') AND is_background_automation=1")
    active = cur.fetchall()
    for sid, st in active:
        exclude_ids.add(sid)

    cutoff_ts = None
    if args.exclude_recent_hours > 0:
        cutoff_ts = int((datetime.now(timezone.utc).timestamp() - args.exclude_recent_hours * 3600) * 1000)

    sql = """
        SELECT id, status, title, cwd, last_activity_at
        FROM sessions
        WHERE is_background_automation = 1
          AND status = 'completed'
    """
    params = []
    if exclude_ids:
        sql += f" AND id NOT IN ({','.join('?' * len(exclude_ids))})"
        params.extend(exclude_ids)
    if cutoff_ts is not None:
        sql += " AND last_activity_at < ?"
        params.append(cutoff_ts)
    sql += " ORDER BY last_activity_at DESC"

    cur.execute(sql, params)
    rows = cur.fetchall()

    print(f"[archive_sessions] found {len(rows)} completed background-automation session(s) to archive")
    for sid, status, title, cwd, ts in rows:
        ts_s = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC") if ts else "None"
        print(f"  {sid} | title={title!r} | cwd={cwd!r} | last_activity={ts_s}")

    if not args.apply:
        print("[archive_sessions] dry-run: no changes made. Add --apply to archive.")
        con.close()
        sys.exit(0)

    if not rows:
        print("[archive_sessions] nothing to archive.")
        con.close()
        sys.exit(0)

    ids = [r[0] for r in rows]
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    cur.execute(f"""
        UPDATE sessions
        SET status = 'archived',
            updated_at = ?
        WHERE id IN ({','.join('?' * len(ids))})
    """, [now_ms] + ids)
    con.commit()
    print(f"[archive_sessions] archived {cur.rowcount} session(s).")
    con.close()


if __name__ == "__main__":
    main()
