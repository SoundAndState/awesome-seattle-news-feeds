import datetime as dt
from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from check_feeds import inspect_xml, article_url

FIXTURES = Path(__file__).parent / 'fixtures'
RSS = (FIXTURES / 'rss.xml').read_bytes()
ATOM = (FIXTURES / 'atom.xml').read_bytes()


class FeedHealthTests(unittest.TestCase):
    now = dt.datetime(2026, 9, 16, 12, tzinfo=dt.timezone.utc)

    def rss(self, date=None):
        return RSS if date is None else re.sub(rb'<pubDate>.*?</pubDate>', f'<pubDate>{date}</pubDate>'.encode(), RSS)

    def test_dates_and_staleness(self):
        self.assertNotIn('error', inspect_xml(self.rss(), self.now, 365))
        self.assertIn('error', inspect_xml(self.rss('Tue, 15 Sep 2020 00:00:00 GMT'), self.now, 365))
        self.assertIn('error', inspect_xml(self.rss('garbage'), self.now, 365))

    def test_atom_and_html(self):
        result = inspect_xml(ATOM, self.now, 365)
        self.assertEqual(result['format'], 'Atom')
        self.assertEqual(result['articleUrls'], ['https://publisher.example/story'])
        with self.assertRaises(ValueError):
            inspect_xml(b'<html><body>Challenge</body></html>', self.now, 365)

    def test_empty_feed(self):
        with self.assertRaises(ValueError):
            inspect_xml(re.sub(rb'<item>.*?</item>', b'', RSS, flags=re.DOTALL), self.now, 365)

    def test_empty_channel_title_is_reported_without_losing_valid_items(self):
        result = inspect_xml(self.rss().replace(b'<title>News</title>', b'<title/>'), self.now, 365)
        self.assertNotIn('error', result)
        self.assertEqual(len(result['warnings']), 1)

    def test_deduplication_preserves_meaningful_query(self):
        self.assertEqual(article_url('http://www.example.com/story/?utm_medium=rss&id=42#top'), 'https://example.com/story?id=42')


if __name__ == '__main__':
    unittest.main()
