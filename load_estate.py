"""Load the Bayer builder data pack (xlsx) into SQLite.

Usage: python3 -I load_estate.py <xlsx> <db>
"""
import re
import sqlite3
import sys
from datetime import datetime

from openpyxl import load_workbook

SKIP = {"START_HERE", "Package_Overview"}  # free-form sheets, not tables


def clean(v):
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, bool):
        return int(v)
    return v


def main(xlsx, db):
    wb = load_workbook(xlsx, read_only=True, data_only=True)
    con = sqlite3.connect(db)
    for ws in wb.worksheets:
        if ws.title in SKIP:
            continue
        rows = ws.iter_rows(values_only=True)
        header = [h for h in next(rows) if h is not None]
        cols = [re.sub(r"\W+", "_", str(h)).strip("_") for h in header]
        con.execute(f'DROP TABLE IF EXISTS "{ws.title}"')
        con.execute(f'CREATE TABLE "{ws.title}" ({", ".join(chr(34) + c + chr(34) for c in cols)})')
        data = [tuple(clean(v) for v in r[: len(cols)]) for r in rows if any(v is not None for v in r)]
        con.executemany(f'INSERT INTO "{ws.title}" VALUES ({",".join("?" * len(cols))})', data)
        print(f"{ws.title}: {len(data)} rows")
    con.commit()
    con.close()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
