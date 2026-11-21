// Scriptable 위젯(widget/today.js, widget/cards.js)을 가짜 Scriptable 환경에서 크기별로 그려 보고, 문구·포인트 색 확인
const fs = require('fs'), path = require('path'), assert = require('assert');
const run = async (file, family, summary) => {
  let out = null; const texts = [];
  class Node { constructor() { this.kids = []; } addText(s) { const t = { text: s, centerAlignText() {} }; texts.push(t); this.kids.push(t); return t; }
    addStack() { const s = new Node(); this.kids.push(s); return s; } addSpacer() {} addImage(img) { const i = { img }; this.kids.push(i); return i; }
    layoutVertically() {} layoutHorizontally() {} centerAlignContent() {} setPadding() {} }
  class ListWidget extends Node {}
  class Color { constructor(hex, a = 1) { this.hex = hex; this.a = a; } }
  class DrawContext { addPath() {} setFillColor() {} fillPath() {} getImage() { return { drawn: true }; } }
  class Path { addRoundedRect() {} }
  const g = { ListWidget, Color, DrawContext, Path, Rect: class {}, Size: class {}, LinearGradient: class {},
    Font: { boldRoundedSystemFont: s => ({ s }), mediumRoundedSystemFont: s => ({ s }), systemFont: s => ({ s }) },
    Request: class { constructor(u) { this.u = u; } async loadJSON() { if (!summary) throw new Error('offline'); assert.match(this.u, /what=summary/); return summary; } },
    config: { widgetFamily: family, runsInWidget: true }, Script: { setWidget: w => { out = w; }, complete() {} } };
  const src = fs.readFileSync(path.join(__dirname, '..', 'widget', file), 'utf8');
  await new Function(...Object.keys(g), `return (async () => {${src}\n})();`)(...Object.values(g));
  assert.ok(out, `${file} ${family}: widget set`);
  return { w: out, all: texts.map(t => t.text).join(' | '), colorOf: s => texts.find(t => t.text.includes(s))?.textColor?.hex };
};
(async () => {
  const base = { ok: true, date: '2026-11-21', month: 820000, budget: 1500000, left: 680000, cards: [{ name: '롯데카드', goal: 300000, spent: 120000 }, { name: '현대카드', goal: 0, spent: 190000 }, { name: '국민카드', goal: 300000, spent: 350000 }] };
  const FAMS = ['small', 'medium', 'large', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular'];
  // 오늘 쓴 돈: 여유(초록) / 거의(주황) / 넘음(빨강)
  for (const f of FAMS) for (const today of [10000, 40000, 70000]) await run('today.js', f, { ...base, today, daily: 50000 });
  let r = await run('today.js', 'small', { ...base, today: 10000, daily: 50000 });
  assert.match(r.all, /오늘 쓴 돈 \| 10,000원 \| 아직 여유 있어요 \| 오늘 쓸 수 있는 돈 50,000원/); assert.equal(r.colorOf('10,000원'), '#2fd39a');
  r = await run('today.js', 'small', { ...base, today: 40000, daily: 50000 }); assert.equal(r.colorOf('40,000원'), '#ffb340'); assert.match(r.all, /거의 다 썼어요/);
  r = await run('today.js', 'medium', { ...base, today: 70000, daily: 50000 }); assert.equal(r.colorOf('70,000원'), '#ff5a6a'); assert.match(r.all, /오늘 20,000원 넘었어요[\s\S]*이번 달 820,000원/);
  assert.ok(r.w.backgroundGradient, 'home widget has a colored background');
  r = await run('today.js', 'accessoryCircular', { ...base, today: 40000, daily: 50000 }); assert.match(r.all, /80%/);
  r = await run('today.js', 'small', null); assert.match(r.all, /연결 안 됨/);
  // 카드 실적
  for (const f of FAMS) await run('cards.js', f, { ...base, today: 0, daily: 0 });
  r = await run('cards.js', 'medium', base);
  assert.match(r.all, /카드 실적 \| 롯데 \| 180,000원 남음 \| 120,000원 \/ 300,000원 \| 현대 \| 실적 금액 미설정 \| 190,000원 \| 국민 \| 달성/);
  assert.equal(r.colorOf('180,000원 남음'), '#ffb340'); assert.equal(r.colorOf('달성'), '#2fd39a');
  r = await run('cards.js', 'small', base); assert.match(r.all, /18만 남음/);
  r = await run('cards.js', 'accessoryRectangular', base); assert.match(r.all, /롯데 12만 · 18만 남음 \| 현대 19만 · - \| 국민 35만 · 달성/);
  r = await run('cards.js', 'accessoryInline', base); assert.match(r.all, /롯데 18만 · 현대 - · 국민 ✓/);
  r = await run('cards.js', 'accessoryCircular', base); assert.match(r.all, /1\/2/);
  r = await run('cards.js', 'medium', { ok: true, today: 0 }); assert.match(r.all, /새 버전/);
  console.log('WIDGETS OK');
})().catch(e => { console.error(e); process.exit(1); });
