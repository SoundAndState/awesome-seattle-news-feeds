from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from check_agent_guidance import check_guidance, GuidanceError


class AgentGuidanceTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        self.canonical = '.agents/skills/example/SKILL.md'
        self.adapter = '.claude/skills/example/SKILL.md'
        header = '---\nname: example\ndescription: "A fixture workflow."\n---\n'
        self.write('package.json', '{"scripts":{"check:agents":"python checker.py"}}')
        self.write('AGENTS.md', f'# Instructions\n[Example]({self.canonical})\n')
        self.write('CLAUDE.md', '@AGENTS.md\n')
        self.write('.github/CONTRIBUTING.md', '[Rules](../AGENTS.md#instructions)\n`npm run check:agents`\n')
        self.write(self.canonical, header + '# Example\n')
        self.write(self.adapter, header + f'[Workflow](../../../{self.canonical})\n')

    def write(self, name, content):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')

    def test_valid_checkout_and_fenced_examples(self):
        self.write('docs/agent-guidance.md', '# Review\n# Review\n[Second](#review-1)\n```md\n[Example](missing.md)\n```\n')
        self.assertEqual(check_guidance(self.root), {'files': 6, 'local_links_and_anchors': 4, 'skill_pairs': 1})

    def test_missing_file_and_heading_fail(self):
        for link in ['../missing.md', '../AGENTS.md#missing']:
            with self.subTest(link=link):
                self.write('.github/CONTRIBUTING.md', f'[Broken]({link})\n')
                with self.assertRaisesRegex(GuidanceError, 'missing (link target|heading)'):
                    check_guidance(self.root)

    def test_metadata_requires_matching_nonempty_fields(self):
        for header in ['---\nname: example\n---\n', '---\nname: other\ndescription: Test\n---\n', '---\nname: example\ndescription: Different\n---\n', '---\nname: [\n---\n']:
            with self.subTest(header=header):
                self.write(self.adapter, header + f'[Workflow](../../../{self.canonical})\n')
                with self.assertRaises(GuidanceError):
                    check_guidance(self.root)

    def test_missing_adapter_fails(self):
        (self.root / self.adapter).unlink()
        with self.assertRaisesRegex(GuidanceError, 'directories must match'):
            check_guidance(self.root)

    def test_routes_require_real_links_and_import(self):
        changes = [('AGENTS.md', f'# Instructions\n```md\n[Example]({self.canonical})\n```\n', 'missing root skill route'),
                   ('CLAUDE.md', '```\n@AGENTS.md\n```\n', 'must import'),
                   (self.adapter, '---\nname: example\ndescription: "A fixture workflow."\n---\n[Wrong](../../../AGENTS.md)\n', 'does not link')]
        for name, content, error in changes:
            with self.subTest(name=name):
                old = (self.root / name).read_text(encoding='utf-8')
                self.write(name, content)
                try:
                    with self.assertRaisesRegex(GuidanceError, error):
                        check_guidance(self.root)
                finally:
                    self.write(name, old)

    def test_unknown_command_and_outside_link_fail(self):
        for content, error in [('`npm run missing`', 'unknown npm script'), ('[Outside](../../outside.md)', 'leaves the repository')]:
            with self.subTest(content=content):
                self.write('.github/CONTRIBUTING.md', content)
                with self.assertRaisesRegex(GuidanceError, error):
                    check_guidance(self.root)


if __name__ == '__main__':
    unittest.main()
