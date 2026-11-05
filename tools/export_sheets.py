"""Converts the real source workbooks to JSON for local tests and the preview server.

  python3 tools/export_sheets.py "WLT - BA61 Pipeline.xlsx" "OFM Building Assignments.xlsx" /tmp/sources.json ["NEH BA61 Portal - Data.xlsx" ["BA54 National Tracker.xlsx" ["All Open RWAs and WRs Dashboard.xlsx" ["GSA-Wide Roster.xlsx"]]]]

Download each Google Sheet with File > Download > Microsoft Excel (.xlsx) first.
The output holds real data: keep it out of the repository (.gitignore blocks *.json).
From the GSA-Wide Roster only the reporting-line columns are kept (no names, pay or anything else).
"""
import datetime
import json
import sys

import openpyxl


def rows(ws):
    out = []
    for row in ws.iter_rows(values_only=True):
        out.append([v.isoformat() if isinstance(v, (datetime.datetime, datetime.date)) else v for v in row])
    while out and not any(v not in (None, '') for v in out[-1]):
        out.pop()
    return out


ROSTER_COLUMNS = ['Snapshot Date', 'Employee E-Mail Address', 'Supervisor E-Mail Address', 'Supervisor Level Description']


def roster_rows(ws):
    it = ws.iter_rows(values_only=True)
    header = list(next(it))
    keep = [header.index(c) for c in ROSTER_COLUMNS]
    out = [ROSTER_COLUMNS]
    for row in it:
        if row and row[keep[1]]:
            out.append([row[i].isoformat() if isinstance(row[i], (datetime.datetime, datetime.date)) else row[i] for i in keep])
    return out


def main(pipeline_path, directory_path, out_path, portal_path=None, ba54_path=None, rwa_path=None, roster_path=None):
    pipeline = openpyxl.load_workbook(pipeline_path, read_only=True, data_only=True)
    directory = openpyxl.load_workbook(directory_path, read_only=True, data_only=True)
    data = {
        'pipeline': rows(pipeline['Pipeline']),
        'reportInfo': rows(pipeline['Report Info']) if 'Report Info' in pipeline.sheetnames else [],
        'buildings': rows(directory['Buildings']),
        'org': rows(directory['Org Relationships']) if 'Org Relationships' in directory.sheetnames else [],
    }
    if portal_path:
        data['portal'] = rows(openpyxl.load_workbook(portal_path, read_only=True, data_only=True)['Projects'])
    if ba54_path:
        ba54 = openpyxl.load_workbook(ba54_path, read_only=True, data_only=True)
        data['ba54'] = rows(ba54['Current Program'])
        data['ba54Dashboard'] = rows(ba54['Dashboard'])[:12]
    if rwa_path:
        data['rwa'] = rows(openpyxl.load_workbook(rwa_path, read_only=True, data_only=True)['Detailed Data'])
    if roster_path:
        data['roster'] = roster_rows(openpyxl.load_workbook(roster_path, read_only=True, data_only=True)['GSA-Wide Roster'])
    with open(out_path, 'w') as f:
        json.dump(data, f)
    print('Wrote %s: %d pipeline rows, %d building rows' % (out_path, len(data['pipeline']) - 1, len(data['buildings'])))


if __name__ == '__main__':
    if len(sys.argv) not in (4, 5, 6, 7, 8):
        sys.exit(__doc__)
    main(*sys.argv[1:])
