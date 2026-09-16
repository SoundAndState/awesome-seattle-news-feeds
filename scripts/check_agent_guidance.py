"""Check repository guidance links, skill metadata, and cross-agent routing offline."""
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

try:
    import yaml
except ModuleNotFoundError as error:
    if error.name != 'yaml':
        raise
    raise SystemExit('Install the guidance checker dependency: python -m pip install -r scripts/requirements-agent-guidance.txt') from error

ROOT = Path(__file__).resolve().parent.parent
INLINE_LINK = re.compile(r'\[[^\]\n]+\]\(([^\s)]+)\)')


class GuidanceError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise GuidanceError(message)


def prose(content):
    """Exclude fenced examples from link, heading, and route checks."""
    lines, fence = [], None
    for line in content.splitlines():
        marker = re.match(r'^\s{0,3}(`{3,}|~{3,})(.*)$', line)
        if marker:
            run, rest = marker.groups()
            if fence is None:
                fence = run
            elif run[0] == fence[0] and len(run) >= len(fence) and not rest.strip():
                fence = None
        elif fence is None:
            lines.append(line)
    return '\n'.join(lines)


def heading_ids(content):
    ids = set()
    for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', prose(content), re.M):
        slug = re.sub(r'[^\w -]', '', heading.lower()).replace(' ', '-')
        candidate, suffix = slug, 0
        while candidate in ids:
            suffix += 1
            candidate = f'{slug}-{suffix}'
        ids.add(candidate)
    return ids


def skill_metadata(path):
    content = path.read_text(encoding='utf-8')
    match = re.match(r'\A---\n(.*?)\n---(?:\n|$)', content, re.S)
    require(match, f'{path}: missing YAML frontmatter')
    try:
        metadata = yaml.safe_load(match[1])
    except yaml.YAMLError as error:
        raise GuidanceError(f'{path}: invalid YAML frontmatter: {error}') from error
    require(isinstance(metadata, dict), f'{path}: frontmatter must be a mapping')
    name, description = metadata.get('name'), metadata.get('description')
    require(isinstance(name, str) and 1 <= len(name) <= 64 and re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name), f'{path}: invalid skill name')
    require(name == path.parent.name, f'{path}: skill name must match its directory')
    require(isinstance(description, str) and description.strip() and len(description) <= 1024, f'{path}: description must be a nonempty string of at most 1024 characters')
    return name, description


def check_guidance(root=ROOT):
    root = Path(root).resolve()
    canonical = {path.parent.name: path for path in (root / '.agents/skills').glob('*/SKILL.md')}
    adapters = {path.parent.name: path for path in (root / '.claude/skills').glob('*/SKILL.md')}
    require(canonical, 'No canonical repository skills found')
    require(canonical.keys() == adapters.keys(), 'Canonical and Claude skill directories must match')
    files = [root / name for name in ['AGENTS.md', 'CLAUDE.md', '.github/CONTRIBUTING.md']]
    files += sorted((root / 'docs').glob('agent-guidance*.md'))
    for directory in ['.agents/skills', '.claude/skills']:
        files += sorted((root / directory).rglob('*.md'))
    scripts = json.loads((root / 'package.json').read_text(encoding='utf-8'))['scripts']
    targets, link_count = {}, 0
    for path in files:
        require(path.is_file(), f'Missing guidance file: {path}')
        content = path.read_text(encoding='utf-8')
        targets[path] = set()
        for target in INLINE_LINK.findall(prose(content)):
            parts = urlsplit(target)
            if parts.scheme or parts.netloc:
                continue
            destination = (path.parent / unquote(parts.path)).resolve() if parts.path else path
            require(destination.is_relative_to(root), f'{path}: link leaves the repository: {target}')
            require(destination.exists(), f'{path}: missing link target: {target}')
            if parts.fragment:
                require(destination.is_file() and destination.suffix == '.md', f'{path}: expected a Markdown heading target: {target}')
                require(unquote(parts.fragment) in heading_ids(destination.read_text(encoding='utf-8')), f'{path}: missing heading: {target}')
            targets[path].add(destination)
            link_count += 1
        for command in re.findall(r'`npm run ([\w:-]+)', content):
            require(command in scripts, f'{path}: unknown npm script: {command}')
    require(re.search(r'^@AGENTS\.md\s*$', prose((root / 'CLAUDE.md').read_text(encoding='utf-8')), re.M), 'CLAUDE.md must import AGENTS.md')
    for name, canonical_path in canonical.items():
        require(skill_metadata(canonical_path) == skill_metadata(adapters[name]), f'{name}: canonical and Claude name/description differ')
        require(canonical_path in targets[root / 'AGENTS.md'], f'{name}: missing root skill route')
        require(canonical_path in targets[adapters[name]], f'{name}: Claude adapter does not link to its canonical skill')
    return {'files': len(files), 'local_links_and_anchors': link_count, 'skill_pairs': len(canonical)}


if __name__ == '__main__':
    try:
        print(json.dumps(check_guidance(), indent=2))
    except (GuidanceError, OSError, ValueError) as error:
        print(f'Guidance check failed: {error}', file=sys.stderr)
        raise SystemExit(1)
