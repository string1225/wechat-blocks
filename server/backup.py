"""Online consistent SQLite backup; keep the latest 14 daily snapshots."""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

root = Path("/var/lib/wechat-blocks")
backups = root / "backups"
backups.mkdir(mode=0o700, exist_ok=True)
target = backups / ("progress-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + ".sqlite3")
with sqlite3.connect(root / "progress.sqlite3") as source, sqlite3.connect(target) as destination:
    source.backup(destination)
for old in sorted(backups.glob("progress-????????-??????.sqlite3"))[:-14]:
    old.unlink()
print("Progress backup complete")
