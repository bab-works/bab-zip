// 하트 「카드 실적」 위젯 (아이폰 무료 앱 「Scriptable」용)
// 롯데·현대·국민카드의 이번 달 사용액과, 실적까지 얼마 남았는지 보여 줘요.
// 실적 금액은 앱 가계부 홈의 「카드 실적」에서 카드를 눌러 정해요.
// TOKEN 에 앱 비밀번호를 넣으세요 (이 파일을 다른 사람과 공유하지 마세요)
const TOKEN = '여기에-앱-비밀번호';
const API = 'https://script.google.com/macros/s/AKfycbzZWDgLW1AFlZbCGTgzWH0uZAs660hNJOh4YHzyqXFu4kZtyzUP_VWOBzj0T5PDBtxM/exec';
const APP = 'https://bab-works.github.io/bab-zip/';

const won = n => Math.round(n).toLocaleString('ko-KR');
const man = n => Math.abs(n) >= 1e4 ? `${Math.round(n / 1e3) / 10}만` : won(n); // 좁은 칸용: 18.2만
const brand = name => name.replace(/카드$/, ''); // 롯데카드 → 롯데
let d;
try { d = await new Request(`${API}?token=${encodeURIComponent(TOKEN)}&what=summary`).loadJSON(); }
catch (e) { d = { ok: false, error: '연결 안 됨' }; }

const fam = config.widgetFamily || 'medium';
const w = new ListWidget();
w.url = APP;
w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
const OK = '#2fd39a', SHORT = '#ffb340', MUTED = '#8b95a1';
const cards = (d.ok && d.cards) || [];
const left = c => c.goal - c.spent;
const text = (stack, s, size, color, weight = 'bold') => {
  const t = stack.addText(s); t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  t.font = weight === 'bold' ? Font.boldRoundedSystemFont(size) : Font.mediumRoundedSystemFont(size);
  if (color) t.textColor = new Color(color); return t;
};
const bar = (width, height, p, color) => {
  const c = new DrawContext(); c.size = new Size(width, height); c.opaque = false; c.respectScreenScale = true;
  const r = height / 2, back = new Path(); back.addRoundedRect(new Rect(0, 0, width, height), r, r);
  c.addPath(back); c.setFillColor(new Color('#ffffff', 0.15)); c.fillPath();
  const fw = Math.max(height, Math.min(1, p) * width), front = new Path(); front.addRoundedRect(new Rect(0, 0, fw, height), r, r);
  c.addPath(front); c.setFillColor(new Color(color)); c.fillPath();
  return c.getImage();
};
const status = c => !c.goal ? ['실적 금액 미설정', MUTED] : left(c) > 0 ? [`${fam === 'small' ? man(left(c)) : won(left(c)) + '원'} 남음`, SHORT] : ['달성', OK];

if (!d.ok) text(w, d.error || '오류', 13, null, 'medium');
else if (!cards.length) text(w, '시트의 Code.gs를 새 버전으로', 12, null, 'medium');
else if (fam === 'accessoryInline') text(w, cards.map(c => `${brand(c.name)} ${c.goal ? (left(c) > 0 ? man(left(c)) : '✓') : '-'}`).join(' · '), 12);
else if (fam === 'accessoryCircular') {
  // 잠금화면 원형: 실적 채운 카드 수
  w.addAccessoryWidgetBackground = true;
  const s = w.addStack(); s.layoutVertically();
  text(s, '실적', 10, null, 'medium').centerAlignText();
  text(s, `${cards.filter(c => c.goal && left(c) <= 0).length}/${cards.filter(c => c.goal).length}`, 15).centerAlignText();
} else if (fam === 'accessoryRectangular') {
  // 잠금화면 직사각형: 카드마다 한 줄 「롯데 12만 · 18만 남음」
  cards.slice(0, 3).forEach(c => text(w, `${brand(c.name)} ${man(c.spent)} · ${c.goal ? (left(c) > 0 ? man(left(c)) + ' 남음' : '달성') : '-'}`, 12, null, 'medium'));
} else {
  // 홈 화면: 카드마다 이름·사용액, 막대, 남은 금액(주황) 또는 달성(초록)
  const bg = new LinearGradient(); bg.locations = [0, 1]; bg.colors = [new Color('#191f28'), new Color('#2a2f3a')];
  w.backgroundGradient = bg; w.setPadding(12, 14, 12, 14);
  const BW = fam === 'small' ? 128 : 292;
  text(w, '카드 실적', 11, '#ffffff', 'medium').textOpacity = 0.7;
  w.addSpacer(4);
  cards.slice(0, 3).forEach((c, k) => {
    const [st, color] = status(c);
    const row = w.addStack(); row.centerAlignContent();
    text(row, brand(c.name), fam === 'small' ? 12 : 13, '#ffffff');
    row.addSpacer();
    text(row, st, fam === 'small' ? 11 : 12, color);
    w.addSpacer(3);
    w.addImage(bar(BW, 6, c.goal ? c.spent / c.goal : 0, color)).imageSize = new Size(BW, 6);
    if (fam !== 'small') { w.addSpacer(2); text(w, `${won(c.spent)}원${c.goal ? ` / ${won(c.goal)}원` : ''}`, 10, '#ffffff', 'medium').textOpacity = 0.55; }
    if (k < Math.min(3, cards.length) - 1) w.addSpacer(fam === 'small' ? 5 : 6);
  });
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium(); // 앱에서 실행하면 미리보기
Script.complete();
