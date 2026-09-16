export function makeSource({id = 'local-news', category = 'regional', name = 'Local News', ...overrides} = {}) {
  const social = category === 'bluesky';
  return {
    id, name, category,
    website: social ? `https://bsky.app/profile/${id}.example` : `https://publisher.example/${id}`,
    feed: social ? `https://bsky.app/profile/did:plc:${id.replaceAll('-', '')}/rss` : `https://publisher.example/${id}/rss`,
    description: 'Fictional local reporting for automated tests.',
    format: 'RSS', checkedOn: '2026-09-15', aliases: [],
    ...structuredClone(overrides),
  };
}

// Category IDs are application concepts; publisher identities are fictional.
export function makeCatalog({regionalCount = 9, feeds} = {}) {
  const categories = [
    ['regional', 'Seattle and Regional Reporting'], ['transport', 'Transit and Urbanism'],
    ['official', 'Official Information'], ['commentary', 'Commentary and Advocacy'],
    ['satire', 'Satire'], ['bluesky', 'Bluesky'],
  ].map(([id, title]) => ({id, title, description: `Fixture sources for ${title}.`}));
  const sources = feeds ?? [
    ...Array.from({length: regionalCount}, (_, index) => makeSource({
      id: index === 0 ? 'local-news' : `regional-news-${index + 1}`,
      name: index === 0 ? 'Local News' : `Regional News ${index + 1}`,
      aliases: index === 1 ? ['https://publisher.example/retired/rss'] : [],
    })),
    makeSource({id: 'transit-news', name: 'Transit News', category: 'transport'}),
    makeSource({id: 'city-notices', name: 'City Notices', category: 'official'}),
    makeSource({id: 'local-opinion', name: 'Local Opinion', category: 'commentary'}),
    makeSource({id: 'local-satire', name: 'Local Satire', category: 'satire'}),
    makeSource({id: 'bluesky-reporter', name: 'Local Reporter', category: 'bluesky'}),
    makeSource({id: 'bluesky-neighbor', name: 'Local Neighbor', category: 'bluesky'}),
  ];
  return {
    schemaVersion: 1, title: 'Fixture News Feeds', description: 'Fictional feeds for reader tests.',
    repository: 'example/awesome-fixture-feeds',
    categories: categories.filter(category => sources.some(feed => feed.category === category.id)),
    feeds: structuredClone(sources),
    sections: [{title: 'Reader Resources', links: [{name: 'Fixture Guide', url: 'https://guide.example/'}]}],
  };
}
