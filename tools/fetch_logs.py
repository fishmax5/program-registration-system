#!/usr/bin/env python3
"""Fetch this Apps Script project's Cloud Logging entries for a time window.

`clasp logs` only shows the most recent entries; this reads any window, using
clasp's own stored login to mint a short-lived access token. The token is never
printed. Read-only: it calls entries:list and nothing else.

    python3 tools/fetch_logs.py 2026-09-24T20:00:00Z 2026-09-25T14:00:00Z [min_severity]

One line per entry: time, severity, function, invocation type, the last six
characters of the process id (two ids interleaving = two overlapping runs), message.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

PROJECT = 'nhsc-apps-script'


def access_token():
    rc = json.load(open(os.path.expanduser('~/.clasprc.json')))
    t = rc.get('tokens', {}).get('default') or rc.get('token') or rc
    data = urllib.parse.urlencode({
        'client_id': t['client_id'], 'client_secret': t['client_secret'],
        'refresh_token': t['refresh_token'], 'grant_type': 'refresh_token',
    }).encode()
    return json.load(urllib.request.urlopen('https://oauth2.googleapis.com/token', data))['access_token']


def main():
    since, until = sys.argv[1], sys.argv[2]
    severity = sys.argv[3] if len(sys.argv) > 3 else 'DEFAULT'
    tok = access_token()
    flt = f'timestamp>="{since}" AND timestamp<="{until}" AND severity>={severity}'
    page = None
    while True:
        body = {'resourceNames': [f'projects/{PROJECT}'], 'filter': flt,
                'orderBy': 'timestamp asc', 'pageSize': 1000}
        if page:
            body['pageToken'] = page
        req = urllib.request.Request('https://logging.googleapis.com/v2/entries:list',
                                     json.dumps(body).encode(),
                                     {'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
        j = json.load(urllib.request.urlopen(req))
        for e in j.get('entries', []):
            lb = e.get('resource', {}).get('labels', {})
            pid = e.get('labels', {}).get('script.googleapis.com/process_id', '')[-6:]
            msg = (e.get('jsonPayload', {}).get('message') or e.get('textPayload')
                   or json.dumps(e.get('protoPayload', {}).get('status', '')))
            print(f"{e['timestamp'][:19]} {e.get('severity', '')[:4]} {lb.get('function_name')} "
                  f"{lb.get('invocation_type')} {pid} {str(msg)[:400]}")
        page = j.get('nextPageToken')
        if not page:
            break


if __name__ == '__main__':
    main()
