"""Build the Google Sheet requests for the approved/sent log ("Sent" tab) and the matching Applications updates.

Run with a JSON file of {job_id: {"row": <Applications row>, "version": ..., "drive_id": ..., "portal": ...,
"status": ..., "next": ...}} and it prints the batchUpdate request list as JSON.  The Sent tab is an append-only
log: one row per approved application, with live Status / Next action / Follow-up looked up from Applications
by job id, so nothing has to be copied by hand when a status changes.
"""
import json
import sys

SENT_SHEET_ID = 6
HEADERS = ["Sent on", "Company", "Role", "Region", "Fit", "Resume", "Resume file", "Portal", "Confirmation",
           "Status (live)", "Next action (live)", "Follow-up (live)", "Notes", "Job ID"]


def cell(v):
    if isinstance(v, str) and v.startswith("="):
        return {"userEnteredValue": {"formulaValue": v}}
    if isinstance(v, (int, float)):
        return {"userEnteredValue": {"numberValue": v}}
    return {"userEnteredValue": {"stringValue": "" if v is None else str(v)}}


def lookup(col, r):
    return f'=IFERROR(INDEX(Applications!${col}:${col},MATCH($N{r},Applications!$A:$A,0)),"")'


def main() -> None:
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    reqs = []
    # Applications tab: status, next action, resume version/file/link for the approved rows
    for job_id, s in spec["apps"].items():
        r0 = s["row"] - 1
        def put(col, vals):
            reqs.append({"updateCells": {"start": {"sheetId": 0, "rowIndex": r0, "columnIndex": col},
                                         "rows": [{"values": [cell(v) for v in vals]}], "fields": "userEnteredValue"}})
        put(11, [s["status"]])                      # L Status
        put(16, [s["next"]])                        # Q Next action
        if s.get("version"):
            put(20, [s["version"], s["file"]])      # U, V
            put(26, [f'=HYPERLINK("https://drive.google.com/file/d/{s["drive_id"]}/view","Open {s["version"]}")'])  # AA
    # Sent tab rows
    rows = [{"values": [cell(h) for h in HEADERS]}]
    for i, row in enumerate(spec["sent"], start=6):
        link = (f'=HYPERLINK("https://drive.google.com/file/d/{row["drive_id"]}/view","{row["version"]}")'
                if row.get("drive_id") else "")
        rows.append({"values": [cell(x) for x in [
            row.get("sent_on", ""), row["company"], row["role"], row["region"], row["fit"], row.get("version", ""),
            link, row["portal"], row.get("confirmation", ""), lookup("L", i), lookup("Q", i), lookup("R", i),
            row.get("notes", ""), row["job_id"]]]})
    reqs.append({"updateCells": {"start": {"sheetId": SENT_SHEET_ID, "rowIndex": 4, "columnIndex": 0},
                                 "rows": rows, "fields": "userEnteredValue"}})
    print(json.dumps(reqs, ensure_ascii=False))


if __name__ == "__main__":
    main()
