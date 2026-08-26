#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
归档 WorkBuddy 自动化运行记录（inbox 待复核项）。

== 机制说明（重要）==
WorkBuddy 的收件箱（automation_runs）状态是「内存态」。应用内的归档动作走 RPC
`automation:archiveInboxItem`，把 status 从 PENDING_REVIEW 改为 ARCHIVED。
应用每次持久化收件箱时都会用内存态整体覆盖数据库（persistInbox：先删掉所有
active 自动化的运行记录，再按内存里的 inbox 重写）。

因此：
- 应用运行时直接改 DB，会被下一次持久化覆盖回去（基本每小时被冲一次）。
- 本脚本只有在「WorkBuddy 完全关闭」时运行，改完再启动应用，应用才会从 DB
  载入已归档状态并保留（后续的 persistInbox 会用内存里已是 ARCHIVED 的行重写，不会回退）。

== 用法 ==
  python archive_automation_runs.py           # 试运行：只统计，不修改
  python archive_automation_runs.py --apply   # 真正把 PENDING_REVIEW -> ARCHIVED
"""
import os
import sqlite3
import sys
import time

DB = os.path.expanduser(r"~/.workbuddy/workbuddy.db")


def main():
    apply = "--apply" in sys.argv
    if not os.path.exists(DB):
        print("找不到数据库：", DB)
        return 1

    con = sqlite3.connect(DB, timeout=30)
    con.execute("PRAGMA busy_timeout=30000")
    cur = con.cursor()

    cur.execute("SELECT COUNT(*) FROM automation_runs WHERE status='PENDING_REVIEW'")
    pending = cur.fetchone()[0]
    print("当前 PENDING_REVIEW（待复核）记录数：", pending)

    if pending == 0:
        print("没有待归档记录，无需处理。")
        con.close()
        return 0

    if not apply:
        print("（试运行模式，未修改任何数据。加 --apply 才真正执行归档）")
        con.close()
        return 0

    now = int(time.time() * 1000)
    cur.execute(
        "UPDATE automation_runs SET status='ARCHIVED', read_at=?, updated_at=? "
        "WHERE status='PENDING_REVIEW'",
        (now, now),
    )
    n = cur.rowcount
    con.commit()
    con.close()
    print(f"已归档 {n} 条。请重启 WorkBuddy 使改动持久生效"
          f"（启动时会从数据库载入已归档状态并保留）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
