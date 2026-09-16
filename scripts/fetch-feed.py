"""Bounded, credential-free HTTP transport for the MyNorthwest collector."""
import base64
import json
import sys
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(url, headers):
    request = urllib.request.Request(url, headers=headers)
    opener = urllib.request.build_opener(NoRedirect)
    try:
        response = opener.open(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read(5 * 1024 * 1024 + 1)
        if len(body) > 5 * 1024 * 1024:
            raise ValueError('Feed is too large.')
        return {'status': response.status, 'headers': list(response.headers.items()), 'body': base64.b64encode(body).decode('ascii')}


if __name__ == '__main__':
    try:
        args = json.load(sys.stdin)
        print(json.dumps(fetch(args['url'], args['headers'])))
    except Exception:
        print(json.dumps({'error': 'Publisher could not be reached by the feed collector.'}))
        sys.exit(1)
