// BAB:ZIP 잠금화면·홈화면 위젯 (아이폰 무료 앱 「Scriptable」용)
// 오늘 지출 · 이번 달 지출 · 남은 예산을 보여 주고, 누르면 지출 입력 화면을 열어요.
// TOKEN 에 앱 비밀번호를 넣으세요 (이 파일을 다른 사람과 공유하지 마세요)
const TOKEN = '여기에-앱-비밀번호';
const API = 'https://script.google.com/macros/s/AKfycbzZWDgLW1AFlZbCGTgzWH0uZAs660hNJOh4YHzyqXFu4kZtyzUP_VWOBzj0T5PDBtxM/exec';
const APP = 'https://bab-works.github.io/bab-zip/?add=1';

const won = n => Math.round(n).toLocaleString('ko-KR');
const short = n => Math.abs(n) >= 1e4 ? `${Math.round(n / 1e3) / 10}만` : won(n); // 좁은 칸용: 52.4만
let d;
try { d = await new Request(`${API}?token=${encodeURIComponent(TOKEN)}&what=summary`).loadJSON(); }
catch (e) { d = { ok: false, error: '연결 안 됨' }; }

const fam = config.widgetFamily || 'accessoryRectangular';
const w = new ListWidget();
w.url = APP;
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
const line = (s, size, bold) => { const t = w.addText(s); t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size); t.lineLimit = 1; t.minimumScaleFactor = 0.7; return t; };

if (!d.ok) line(d.error || '오류', 12);
else if (fam === 'accessoryInline') line(`오늘 ${won(d.today)}원 · 남은 ${short(d.left)}`, 12);
else if (fam === 'accessoryCircular') {
  // 원형: 남은 예산 비율
  w.addAccessoryWidgetBackground = true;
  const pct = d.budget ? Math.max(0, Math.round(d.left / d.budget * 100)) : 0;
  line('남은', 9).centerAlignText();
  line(`${pct}%`, 15, true).centerAlignText();
} else if (fam === 'accessoryRectangular') {
  line('💸 BAB:ZIP', 11, true);
  line(`오늘 ${won(d.today)}원`, 14, true);
  line(`이번 달 ${short(d.month)} · 남은 ${short(d.left)}`, 11);
} else {
  // 홈 화면 위젯
  line('BAB:ZIP', 13, true);
  w.addSpacer(6);
  line('오늘', 11); line(`${won(d.today)}원`, 20, true);
  w.addSpacer(4);
  line(`이번 달 ${won(d.month)}원`, 11);
  line(`남은 예산 ${won(d.left)}원`, 11);
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentAccessoryRectangular(); // 앱에서 실행하면 미리보기
Script.complete();
