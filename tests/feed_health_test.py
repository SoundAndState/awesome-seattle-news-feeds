import datetime as dt
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from check_feeds import inspect_xml, article_url


class FeedHealthTests(unittest.TestCase):
    now = dt.datetime(2026, 9, 15, tzinfo=dt.timezone.utc)

    def rss(self, date='Tue, 15 Sep 2026 00:00:00 GMT'):
        return f'<rss version="2.0"><channel><title>News</title><link>https://example.com</link><item><title>Local story</title><pubDate>{date}</pubDate></item></channel></rss>'.encode()

    def test_dates_and_staleness(self):
        self.assertNotIn('error', inspect_xml(self.rss(), self.now, 365))
        self.assertIn('error', inspect_xml(self.rss('Tue, 15 Sep 2020 00:00:00 GMT'), self.now, 365))
        self.assertIn('error', inspect_xml(self.rss('garbage'), self.now, 365))

    def test_atom_and_html(self):
        atom = b'<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title><entry><title>Story</title><updated>2026-09-14T00:00:00Z</updated><link href="https://example.com/story?utm_source=rss"/></entry></feed>'
        result = inspect_xml(atom, self.now, 365)
        self.assertEqual(result['format'], 'Atom')
        self.assertEqual(result['articleUrls'], ['https://example.com/story'])
        with self.assertRaises(ValueError):
            inspect_xml(b'<html><body>Challenge</body></html>', self.now, 365)

    def test_empty_feed(self):
        with self.assertRaises(ValueError):
            inspect_xml(b'<rss><channel><title>News</title><link>https://example.com</link></channel></rss>', self.now, 365)

    def test_empty_channel_title_is_reported_without_losing_valid_items(self):
        result = inspect_xml(self.rss().replace(b'<title>News</title>', b'<title/>'), self.now, 365)
        self.assertNotIn('error', result)
        self.assertEqual(len(result['warnings']), 1)

    def test_deduplication_preserves_meaningful_query(self):
        self.assertEqual(article_url('http://www.example.com/story/?utm_medium=rss&id=42#top'), 'https://example.com/story?id=42')


if __name__ == '__main__':
    unittest.main()
