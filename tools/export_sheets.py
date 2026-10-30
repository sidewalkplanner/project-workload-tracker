"""Converts the real source workbooks to JSON for local tests and the preview server.

  python3 tools/export_sheets.py "WLT - BA61 Pipeline.xlsx" "OFM Building Assignments.xlsx" /tmp/sources.json ["NEH BA61 Portal - Data.xlsx"]

Download each Google Sheet with File > Download > Microsoft Excel (.xlsx) first.
The output holds real data: keep it out of the repository (.gitignore blocks *.json).
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


def main(pipeline_path, directory_path, out_path, portal_path=None):
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
    with open(out_path, 'w') as f:
        json.dump(data, f)
    print('Wrote %s: %d pipeline rows, %d building rows' % (out_path, len(data['pipeline']) - 1, len(data['buildings'])))


if __name__ == '__main__':
    if len(sys.argv) not in (4, 5):
        sys.exit(__doc__)
    main(*sys.argv[1:])
