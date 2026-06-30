// Locks the reader XP email TEMPLATES — they render, carry the personal signature
// from Christopher Amell + the team, stay branded, and cover every perk.
import test from 'node:test';
import assert from 'node:assert';
import { wrap, feedbackEmail, championEmail, unlockEmail, UNLOCK_KEYS } from '../src/lib/xpEmailTemplates.js';

test('the branded shell is dark, signed, and self-contained', () => {
  const html = wrap({ eyebrow: 'X', heading: 'Hello', bodyHtml: '<p>Body</p>', cta: { text: 'Go', url: 'https://x' } });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /background:#000/); // dark
  assert.ok(html.includes('Christopher Gilbert Amell'));
  assert.ok(html.includes('Founder'));
  assert.ok(html.includes('I N T E R D E P E N D E N T'));
  assert.ok(html.includes('>Go<')); // CTA rendered
  assert.ok(html.includes('Hello') && html.includes('Body'));
});

test('feedback email is personal and names the script', () => {
  const e = feedbackEmail('Jane', 'The Carrier');
  assert.ok(e.subject.length > 0);
  assert.ok(e.html.includes('Hi Jane,'));
  assert.ok(e.html.includes('The Carrier'));
  assert.ok(e.html.includes('Christopher Gilbert Amell'));
});

test('champion email is personal and names the script', () => {
  const e = championEmail('Sam', 'The Midnight Line');
  assert.ok(e.html.includes('Hi Sam,'));
  assert.ok(e.html.includes('The Midnight Line'));
});

test('every perk has an unlock email; unknown perk → null', () => {
  for (const key of UNLOCK_KEYS) {
    const e = unlockEmail('Ana', key);
    assert.ok(e && e.subject && e.html.includes('Hi Ana,'), `missing unlock email for ${key}`);
    assert.ok(e.html.includes('Christopher Gilbert Amell'));
  }
  // the 5 perks we expect
  ['event', 'podcast', 'chat', 'voting', 'credit'].forEach((k) => assert.ok(UNLOCK_KEYS.includes(k), `expected perk ${k}`));
  assert.strictEqual(unlockEmail('Ana', 'nope'), null);
});

test('the event email is about The Carrier + the July 31 Plots event', () => {
  const e = unlockEmail('Ana', 'event');
  assert.ok(e.html.includes('The Carrier'));
  assert.ok(/Plots/.test(e.html) && /July 31/.test(e.html));
});

test('the screen-credit email frames it as eligibility, not a guarantee', () => {
  const e = unlockEmail('Ana', 'credit');
  assert.ok(/eligible/i.test(e.html));
  assert.ok(/Story Scout/.test(e.html));
});

test('html escaping is applied to dynamic names', () => {
  const e = feedbackEmail('<b>x</b>', 'A & B "C"');
  assert.ok(e.html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(e.html.includes('A &amp; B'));
});
