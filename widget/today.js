// 하트 「오늘 쓴 돈」 위젯 (아이폰 무료 앱 「Scriptable」용)
// 오늘 쓴 돈을 크게, 오늘 써도 되는 돈(남은 예산 ÷ 남은 날)과 비교해 색으로 알려 줘요:
//   초록 = 여유 (70% 미만) · 주황 = 거의 다 씀 (70~100%) · 빨강 = 넘음
// TOKEN 에 앱 비밀번호를 넣으세요 (이 파일을 다른 사람과 공유하지 마세요)
const TOKEN = '여기에-앱-비밀번호';
const API = 'https://script.google.com/macros/s/AKfycbzZWDgLW1AFlZbCGTgzWH0uZAs660hNJOh4YHzyqXFu4kZtyzUP_VWOBzj0T5PDBtxM/exec';
const APP = 'https://bab-works.github.io/bab-zip/?add=1';

const won = n => Math.round(n).toLocaleString('ko-KR');
let d;
try { d = await new Request(`${API}?token=${encodeURIComponent(TOKEN)}&what=summary`).loadJSON(); }
catch (e) { d = { ok: false, error: '연결 안 됨' }; }

const fam = config.widgetFamily || 'small';
const w = new ListWidget();
w.url = APP;
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
const ratio = d.ok && d.daily ? d.today / d.daily : 0;
const level = !d.ok || !d.daily ? 'none' : ratio > 1 ? 'over' : ratio >= 0.7 ? 'warn' : 'ok';
const POINT = { ok: '#2fd39a', warn: '#ffb340', over: '#ff5a6a', none: '#8b95a1' }[level];
const MSG = { ok: '아직 여유 있어요', warn: '거의 다 썼어요', over: `오늘 ${won(d.today - d.daily)}원 넘었어요`, none: '' }[level];
const text = (stack, s, size, color, weight = 'bold') => {
  const t = stack.addText(s); t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  t.font = weight === 'bold' ? Font.boldRoundedSystemFont(size) : Font.mediumRoundedSystemFont(size);
  if (color) t.textColor = new Color(color); return t;
};
// 둥근 막대 그림 (오늘 쓴 돈 / 오늘 써도 되는 돈)
const bar = (width, height, p, color) => {
  const c = new DrawContext(); c.size = new Size(width, height); c.opaque = false; c.respectScreenScale = true;
  const r = height / 2, back = new Path(); back.addRoundedRect(new Rect(0, 0, width, height), r, r);
  c.addPath(back); c.setFillColor(new Color('#ffffff', 0.15)); c.fillPath();
  const fw = Math.max(height, Math.min(1, p) * width), front = new Path(); front.addRoundedRect(new Rect(0, 0, fw, height), r, r);
  c.addPath(front); c.setFillColor(new Color(color)); c.fillPath();
  return c.getImage();
};

if (!d.ok) text(w, d.error || '오류', 13, null, 'medium');
else if (fam === 'accessoryInline') text(w, `오늘 ${won(d.today)}원${d.daily ? ` / ${won(d.daily)}` : ''}`, 12);
else if (fam === 'accessoryCircular') {
  // 잠금화면 원형: 오늘 써도 되는 돈 중 몇 %를 썼는지
  w.addAccessoryWidgetBackground = true;
  const s = w.addStack(); s.layoutVertically(); s.centerAlignContent();
  text(s, '오늘', 10, null, 'medium').centerAlignText();
  text(s, d.daily ? `${Math.round(ratio * 100)}%` : won(d.today), 15).centerAlignText();
} else if (fam === 'accessoryRectangular') {
  text(w, level === 'over' ? '오늘 쓴 돈 · 넘음' : '오늘 쓴 돈', 11, null, 'medium');
  text(w, `${won(d.today)}원`, 18);
  if (d.daily) text(w, `오늘 쓸 수 있는 돈 ${won(d.daily)}원`, 11, null, 'medium');
} else {
  // 홈 화면: 어두운 바탕 + 포인트 색
  const bg = new LinearGradient(); bg.locations = [0, 1];
  bg.colors = [new Color('#191f28'), new Color(POINT, level === 'none' ? 0.25 : 0.55)];
  w.backgroundGradient = bg; w.setPadding(14, 16, 14, 16);
  const head = w.addStack(); head.centerAlignContent();
  const dot = head.addText('●'); dot.font = Font.systemFont(9); dot.textColor = new Color(POINT);
  head.addSpacer(5); text(head, '오늘 쓴 돈', 12, '#ffffff', 'medium').textOpacity = 0.75;
  w.addSpacer(fam === 'small' ? 6 : 4);
  text(w, `${won(d.today)}원`, fam === 'small' ? 26 : 32, POINT);
  w.addSpacer(6);
  if (d.daily) {
    w.addImage(bar(fam === 'small' ? 130 : 290, 8, ratio, POINT)).imageSize = new Size(fam === 'small' ? 130 : 290, 8);
    w.addSpacer(6);
    text(w, MSG, 12, '#ffffff', 'medium');
    text(w, `오늘 쓸 수 있는 돈 ${won(d.daily)}원`, 11, '#ffffff', 'medium').textOpacity = 0.6;
  } else text(w, '예산을 정하면 써도 되는 돈과 비교해요', 11, '#ffffff', 'medium').textOpacity = 0.6;
  if (fam !== 'small') { w.addSpacer(); text(w, `이번 달 ${won(d.month)}원 · 남은 예산 ${won(d.left)}원`, 11, '#ffffff', 'medium').textOpacity = 0.6; }
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentSmall(); // 앱에서 실행하면 미리보기
Script.complete();
