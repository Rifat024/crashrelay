import assert from 'node:assert';
import { test } from 'node:test';
import { textToAdf } from './adf';

test('textToAdf turns blank-line-separated text into paragraphs', () => {
  const doc = textToAdf('first paragraph\n\nsecond paragraph');
  assert.equal(doc.type, 'doc');
  assert.equal(doc.content.length, 2);
});

test('textToAdf turns single newlines into hardBreak nodes within a paragraph', () => {
  const doc = textToAdf('line one\nline two');
  assert.equal(doc.content.length, 1);
  const nodes = doc.content[0].content;
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].type, 'text');
  assert.equal(nodes[1].type, 'hardBreak');
  assert.equal(nodes[2].type, 'text');
});

test('textToAdf handles empty input without throwing', () => {
  const doc = textToAdf('');
  assert.equal(doc.content.length, 1);
});
