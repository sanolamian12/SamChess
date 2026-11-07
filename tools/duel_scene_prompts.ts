/**
 * 일기토 · 설전 결과 연출 그림 — Gemini 프롬프트 페이지를 굽는다 (2026-11-06).
 *
 *   node --experimental-strip-types tools/duel_scene_prompts.ts
 *
 * → `Design/일기토_설전_연출그림_프롬프트.html`. **스크립트 없이도 장수 · 종류를 누르면 프롬프트가 바뀐다** —
 * 프롬프트를 다 적어 두고 라디오 + CSS로 하나만 보인다. 미리보기 창이 스크립트를 안 돌려도 된다(복사 단추만 스크립트).
 * 장수의 특징 · 장면 글은 아래 `PEOPLE` · `KINDS`가 정본이다 — 고치면 이것을 다시 돌린다.
 */
import { writeFileSync } from 'node:fs';

export const STYLE = `STYLE: Traditional Chinese ink-wash illustration with a gritty manga line style. Monochrome only: black and charcoal-grey ink on warm cream rice paper, dry-brush texture, ink splatter and speed strokes. The ONLY color allowed is a few small touches of dark red for blood. No purple, no blue, no colored tint, no glossy HDR lighting, no 3D render look.
PROPORTIONS: realistic adult human anatomy for BOTH people — the head is about one seventh of the body height, both shown full-body at the same scale. NOT chibi, NOT super-deformed, NOT big-headed, NOT a close-up bust.
FORMAT: ONE single square illustration (1:1), one moment only. NOT a comic page: no panels, no grid, no border, no frame. No text, no letters, no calligraphy characters, no seal stamps, no signature, no watermark. Keep the action inside the middle 70% of the square; let the outer edges fade into plain empty rice paper (the game will fade the edges out).`;

const AVOID = `AVOID: big heads or chibi proportions; swapping the two people's sides or weapons; a third person in the foreground; extra hands or extra weapons; the RIGHT-side person looking like any famous character; any text.`;

const KINDS = {
  duel: {
    label: '일기토',
    place: 'A mounted duel on an open battlefield; dusty ground, faint army banners far in the background.',
    opponent: 'RIGHT side, facing left: an ANONYMOUS enemy general on a PALE GREY horse. Closed iron helmet with a face guard and cheek flaps so his face cannot be seen, plain dark lamellar armor, a plain straight spear. He must not resemble any famous character: no beard showing, no feathers, no plume, no special weapon.',
    scenes: [
      ['첫 격돌 / 비김', 'SCENE: The first clash. Both riders charge at full gallop toward each other and their weapons collide exactly in the center of the image with a burst of ink sparks. Both horses rear. Perfectly even footing, neither is winning.'],
      ['주인공이 공격권', 'SCENE: The LEFT rider is on the attack. He rises in the saddle and swings his weapon down hard at the right rider. The right rider is ONLY defending, NOT attacking: both his hands hold his spear horizontally above his head to block the blow, he leans back in the saddle, his horse stumbles backward. The whole image reads "LEFT pushes RIGHT back".'],
      ['상대가 공격권', 'SCENE: The RIGHT rider is on the attack. He swings his spear down hard at the left rider. The LEFT rider is on the defensive: blocking with his weapon raised across his body, gritting his teeth, leaning back, his horse sliding backward. The whole image reads "RIGHT pushes LEFT back".'],
      ['주인공 패배 · 도망', 'SCENE: The LEFT rider has lost. He is wounded (a small dark-red blood stain on his shoulder) and RETREATING: seen in three-quarter back view, his horse galloping AWAY from the enemy toward the LEFT edge of the image (the horse\x27s hindquarters toward the viewer), while he looks back over his shoulder with a bitter expression. In the right background the anonymous general raises his spear in pursuit.'],
      ['주인공 승리', 'SCENE: The LEFT rider has won. In the left foreground he sits tall and proud on his horse, raising his weapon high in triumph. On the right the defeated anonymous general slumps in the saddle and his horse turns away, fleeing toward the RIGHT edge; a small dark-red blood stain on the loser.'],
      ['무승부', 'SCENE: A stalemate after a long, even fight. The two riders have separated and stand apart facing each other across the dusty field at dusk, horses panting, weapons lowered but still alert. Calm, exhausted, mutual respect. Faint banners of both armies far behind.'],
    ],
  },
  debate: {
    label: '설전',
    place: 'Inside a grand palace council hall: tall wooden pillars, lattice windows, low lacquered desks, rows of seated court officials in the background (small, blurred).',
    opponent: 'RIGHT side, facing left: an ANONYMOUS rival strategist in a plain dark scholar\'s robe and a simple black cloth cap, his face turned three-quarters away or half hidden behind a raised sleeve, holding a bamboo scroll. He must not resemble any famous character: no feather fan, no distinctive hat, no long beard.',
    scenes: [
      ['첫 논쟁 / 비김', 'SCENE: The opening exchange. Both men stand facing each other across a low table, both gesturing sharply. Their words are drawn as swirling ink-brush streams (abstract strokes, NO readable characters) that collide in the center of the image in a burst of ink. Perfectly even, neither is winning.'],
      ['주인공이 공격권', 'SCENE: The LEFT man is on the offensive. He steps forward and points straight at the rival; a powerful wave of swirling ink strokes flows from LEFT to RIGHT and crashes over the rival. The rival leans back, sweating, raising his sleeve to shield his face. The officials in the background turn to look at the left man in admiration.'],
      ['상대가 공격권', 'SCENE: The RIGHT man is on the offensive. He points at the left man and a wave of swirling ink strokes flows from RIGHT to LEFT. The LEFT man is pressed: leaning back, frowning, one hand raised as if to hold off the words. The officials murmur.'],
      ['주인공 패배 · 퇴장', 'SCENE: The LEFT man has lost the debate. Head lowered, shoulders slumped, he turns away and walks out of the hall toward the LEFT edge. The rival stands composed on the right; officials in the background hide their laughter behind their sleeves.'],
      ['주인공 승리', 'SCENE: The LEFT man has won. He stands calm and upright with a faint smile. On the right the rival bows deeply in defeat, his bamboo scroll dropped on the floor. The officials in the background bow toward the left man.'],
      ['무승부', 'SCENE: A stalemate. Both men are seated on either side of the low table with cups of tea between them, silent, regarding each other with wary respect. Evening light falls through the lattice windows.'],
    ],
  },
};

// 전용 장수 — 초상(assets/CharsInBattle)에서 뽑은 특징. duel = 무기 · 말, debate = 설전 차림
type Person = { id: string; name: string; ko: string; look: string; duel: string; debate: string; shared?: boolean; only?: string[] };
const PEOPLE: Person[] = [
  { id: 'default', name: '디폴트', ko: '아무개 장수(전용이 없는 모두)',
    look: 'an ANONYMOUS allied general: open-face iron helmet with a short dark plume, his face mostly in shadow under the helmet brim so it reads as "anyone", plain lamellar armor',
    duel: 'a plain long spear, riding a DARK horse',
    debate: 'wearing a light layered court robe and a tall black official\'s cap, face in shadow, holding a folded fan' },
  { id: 'yeo-po', name: '여포', ko: '여포',
    look: 'LÜ BU: a young, handsome, arrogant warrior; two VERY long pheasant-tail feathers rising from a small ornate crown on his topknot and sweeping back; richly scaled ornate armor with a flowing cape',
    duel: 'the Sky Piercer halberd (fangtian ji: a long polearm with a spear point and a crescent blade on BOTH sides), riding a powerful DARK warhorse with a wild flame-like mane',
    debate: 'in armor with a cape, both pheasant feathers still on his crown, arms crossed, sneering' },
  { id: 'gwan-u', name: '관우', ko: '관우',
    look: 'GUAN YU: tall and imposing, a VERY long flowing black beard reaching his chest, narrow stern eyes, dark cloth head wrap, a long war robe over his armor',
    duel: 'the Green Dragon Crescent Blade (a long glaive with a broad curved blade and a dragon engraved at its base), riding a DARK warhorse',
    debate: 'in his long war robe, stroking his long beard with one hand, calm and dignified' },
  { id: 'jang-bi', name: '장비', ko: '장비',
    look: 'ZHANG FEI: a burly, wild-looking warrior with a thick bushy black beard, fierce round bulging eyes, a cloth head wrap with a square metal plate at the front, heavy scaled armor',
    duel: 'the Serpent Spear (a long spear whose blade WAVES like a snake), riding a DARK warhorse',
    debate: 'in armor, slamming the table with his fist, shouting (still no text)' },
  { id: 'jo-un', name: '조운', ko: '조운',
    look: 'ZHAO YUN: a youthful, calm, handsome general; a bright silver ornate helmet with a long WHITE plume flowing behind; finely scaled silver armor with a white cape',
    duel: 'a long straight spear with a slim leaf-shaped head, riding a WHITE horse',
    debate: 'in his silver armor and white cape, standing straight, speaking calmly' },
  { id: 'ma-cho', name: '마초', ko: '마초',
    look: 'MA CHAO: a young, fierce, handsome general wearing a LION-HEAD helmet (the lion\'s open jaws frame his face) with a long dark plume, lion-face pauldrons on both shoulders, ornate scaled armor',
    duel: 'a long spear with a horsehair tassel below the blade, riding a WHITE horse',
    debate: 'in the lion-head helmet and armor, glaring, chin raised' },
  { id: 'hwang-chung', name: '황충', ko: '황충',
    look: 'HUANG ZHONG: an OLD but powerful veteran with long WHITE hair tied in a topknot and a long WHITE beard, deep wrinkles, sharp eyes, heavy scaled armor, a quiver of arrows on his back',
    duel: 'a heavy curved saber in one hand and a great longbow slung on his back, riding a DARK warhorse',
    debate: 'in armor, a hand on the longbow at his side, an old man\'s stubborn glare' },
  { id: 'ha-hu-don', name: '하후돈', ko: '하후돈',
    look: 'XIAHOU DUN: a hardened general with a black EYEPATCH over his LEFT eye, a dark cloth head scarf, a short beard and mustache, chain-mail armor with plate shoulders',
    duel: 'a long spear, riding a DARK warhorse',
    debate: 'in chain armor and eyepatch, leaning forward with one fist on the table' },
  { id: 'chuk-yung', name: '축융', ko: '축융 (여장군)',
    look: 'LADY ZHURONG: a young, bold, confident WOMAN warrior of the southern tribes; hair in a high bun with a flower ornament and dangling hair pins, a bright fearless smile, light scaled armor over a fitted tunic, earrings',
    duel: 'a spear decorated with feathers below the blade and a row of small throwing knives at her belt (she can be throwing one), riding a DARK horse',
    debate: 'in light armor with her flower ornament, hands on hips, laughing confidently' },
  { id: 'jo-jo', name: '조조', ko: '조조',
    look: 'CAO CAO: a shrewd, commanding ruler in his forties with a neat short beard and mustache, piercing eyes, a small ornate crown-cap on his topknot, ornate engraved armor with a cape',
    duel: 'a straight double-edged sword (jian) with an ornate hilt, riding a DARK warhorse',
    debate: 'in a rich court robe with his crown-cap, half-smiling, eyes narrowed, one hand raised in a dismissive gesture' },
  { id: 'je-gal-ryang', name: '제갈량', ko: '제갈량',
    look: 'ZHUGE LIANG: a calm, wise strategist with a thin goatee and mustache, a tall ribbed scholar\'s hat (lunjin), a layered white scholar\'s robe with wide sleeves',
    duel: 'NO real weapon: he holds his WHITE FEATHER FAN, and with a sweep of the fan a gust of ink-wind and leaves strikes the enemy; he rides a small four-wheeled wooden carriage instead of a horse',
    debate: 'holding his WHITE FEATHER FAN, serene, gesturing gently with the fan' },
  { id: 'ju-yu', name: '주유', ko: '주유',
    look: 'ZHOU YU: an elegant, very handsome young commander with LONG flowing hair loose over his shoulders, a confident slight smile, ornate scaled armor',
    duel: 'a straight sword in one hand (a longbow and arrows on his back), riding a WHITE horse',
    debate: 'in a fine long robe over light armor, long hair flowing, a slight confident smile' },
  // ↓ 2026-11-06 추가 — 일기토만(설전 인원은 설전 화면을 고칠 때 다시 정한다). shared = 여러 장수가 함께 쓰는 공용 한 벌(얼굴이 특정되면 안 된다)
  { id: 'sage', name: '책사 공용', ko: '책사 공용 (말을 탄 책사 — 전용이 없는 책사 모두)', shared: true, only: ['duel'],
    look: 'an ANONYMOUS mounted STRATEGIST, clearly a scholar rather than a soldier: a tall black scholar\'s cap, a long layered scholar\'s robe with wide sleeves worn over a light leather chest guard, a thin mustache and small goatee, his face partly shaded so it reads as "any strategist"; slimmer build than a warrior, a composed, calculating expression',
    duel: 'a slim straight double-edged sword (jian) held with a scholar\'s grip, NO feather fan, riding a DARK horse',
    debate: '' },
  { id: 'veteran', name: '노장 공용', ko: '노장 공용 (흰 수염 노장 — 전용이 없는 노장 모두)', shared: true,
    look: 'an ANONYMOUS OLD veteran general: a long flowing WHITE beard and white eyebrows clearly visible, deep wrinkles, an open-face iron helmet with a short plume so his eyes are in shadow and the face reads as "any old general", heavy scaled armor, still broad-shouldered and strong',
    duel: 'a long spear with a black horsehair tassel below the blade (NO bow, NO quiver, NO saber), riding a DARK warhorse',
    debate: 'still in his armor and helmet, NO weapon in hand, one gnarled fist planted on the low table, white beard jutting forward, an old soldier\'s stubborn, unbending glare' },
  { id: 'heo-jeo', name: '허저', ko: '허저', only: ['duel'],
    look: 'XU CHU: a HUGE, massively built, barrel-chested warrior, much bulkier than an ordinary man; a topknot bound with a dark cloth HEADBAND tied at the back, a very thick full black beard, fierce scowling eyes under heavy brows, heavy scaled armor with large rounded pauldrons',
    duel: 'a huge heavy broad-bladed great saber held in one massive fist, riding a big DARK warhorse that looks strained under his weight',
    debate: '' },
  { id: 'seo-hwang', name: '서황', ko: '서황', only: ['duel'],
    look: 'XU HUANG: a tall, solidly built, disciplined veteran general in a cape over ornately engraved scaled armor; a round iron helmet with a tall plume and small WING-shaped cheek guards; a downturned mustache and pointed goatee, a stern frown',
    duel: 'a great double-bladed battle AXE on a long haft (broad crescent blades on both sides), riding a DARK warhorse',
    debate: '' },
  { id: 'i-myeong', name: '이명', ko: '이명 (여장군)',
    look: 'LADY LI MING: a calm, graceful young WOMAN warrior, a hermit of Mount Tai; her hair in an elegant high bun with an ornate openwork hair crown and dangling hair ornaments, earrings, a scarf knotted at her throat, light scaled armor',
    duel: 'a slim spear, riding a DARK horse; she rides with quiet, wild-animal-like poise',
    debate: 'a light flowing robe worn over her armor, NO weapon, hands folded calmly in her sleeves, a cool, unreadable gaze — a hermit\'s quiet composure' },
  { id: 'mun-chu', name: '문추', ko: '문추', only: ['duel'],
    look: 'WEN CHOU: a savage warrior with WILD, SHAGGY, DREADLOCK-LIKE black hair spiking out in all directions around a metal-plated headband, a short rough beard, a fierce stare, plain steel plate armor over chain mail',
    duel: 'a heavy single-bladed battle AXE on a long haft, riding a DARK warhorse',
    debate: '' },
  { id: 'jang-hap', name: '장합', ko: '장합', only: ['duel'],
    look: 'ZHANG HE: a sharp-eyed, elegant general with a neat mustache; a helmet whose front is shaped like a snarling LION-DOG (beast) face, with a long flowing plume; finely scaled armor with a cape',
    duel: 'a long slender spear with a small red tassel, riding a DARK warhorse',
    debate: '' },
  { id: 'bang-deok', name: '방덕', ko: '방덕', only: ['duel'],
    look: 'PANG DE: a stern, battle-hardened general with a full thick beard, wearing a large wrapped TURBAN with a jewel and a feather at the front, heavy scaled armor',
    duel: 'a huge broad curved GLAIVE (a long-handled blade with a wide curved head), riding a DARK warhorse',
    debate: '' },
  { id: 'yu-bi', name: '유비', ko: '유비',
    look: 'LIU BEI: a benevolent, dignified lord with a kind but determined face, a neat mustache and a small goatee; a small ornate crown-cap on his topknot; a layered noble robe with a patterned collar worn over light armor; TWO swords crossed on his back',
    duel: 'TWIN straight swords (one in each hand, a matched pair of double-edged jian), riding a DARK horse',
    debate: 'in his noble robe, the two swords left sheathed on his back, one open hand extended toward the listener in a sincere, persuading gesture, earnest and warm' },
  { id: 'son-gwon', name: '손권', ko: '손권',
    look: 'SUN QUAN: a young, handsome, self-assured ruler with a calm faint smile and NO beard; a topknot held by a gold hairpin; a rich dark robe embroidered with dragons worn over light armor',
    duel: 'a straight double-edged sword (jian) with an ornate hilt, riding a DARK horse',
    debate: 'in his dragon-embroidered robe, the sheathed sword at his hip, one hand resting on its hilt, chin raised, a young ruler\'s calm, commanding authority' },
  { id: 'gam-nyeong', name: '감녕', ko: '감녕', only: ['duel'],
    look: 'GAN NING: a bold, roguish river-pirate general with a short beard and fierce eyes; a round helmet with WING-shaped side plates and a long plume; scaled armor with a dark scarf at his neck',
    duel: 'a METEOR HAMMER: a heavy spiked iron ball on a long chain, swung around over his head (NO spear, NO sword), riding a DARK warhorse',
    debate: '' },
  { id: 'jang-ryo', name: '장료', ko: '장료',
    look: 'ZHANG LIAO: a fearsome, composed elite general with intense eyes, a neat mustache and a short goatee; an ornate iron helmet with a JEWEL set in the brow plate, pointed upswept cheek guards and a long flowing plume; richly patterned scaled armor with a cape',
    duel: 'a long polearm with a large CRESCENT-MOON shaped curved blade (different from a straight spear), riding a DARK warhorse',
    debate: 'in his armor and jeweled helmet, NO polearm, arms folded, standing like a wall, cold piercing eyes — a soldier who wins arguments by sheer presence' },
  // ↓ 2026-11-06 설전만 — 책사 일곱(일기토는 책사 공용 · 디폴트). 깃털 부채를 든 초상이 많아 제갈량(흰 깃털 부채)과 섞이지 않게 저마다 다른 물건을 쥐여 준다
  { id: 'no-suk', name: '노숙', ko: '노숙', only: ['debate'],
    look: 'LU SU: a sincere, honest-faced, broad-faced statesman of middle age with a thin mustache and a long pointed goatee; a TALL official\'s crown-cap with a round jewel at the front; a plain layered court robe with patterned collar bands',
    duel: '',
    debate: 'holding a ROLLED SCROLL (a map) in one hand and unrolling it toward the rival, an earnest, open, persuading expression; NO fan' },
  { id: 'yuk-son', name: '육손', ko: '육손', only: ['debate'],
    look: 'LU XUN: a very YOUNG, beardless, sharp-browed scholar-general with an intense, serious stare; his hair pulled back in a high knot with several thin BRAIDS falling beside his face; a plain scholar\'s robe with an ornate belt',
    duel: '',
    debate: 'gripping a tall plain wooden STAFF hung with a decorative KNOTTED TASSEL, standing very straight, quiet cold resolve in his eyes; NO fan' },
  { id: 'sa-ma-ui', name: '사마의', ko: '사마의', only: ['debate'],
    look: 'SIMA YI: a calm, cunning, hooded-eyed statesman with a thin mustache and a long narrow goatee; a TALL ridged official\'s cap pierced by a long horizontal HAIRPIN from which two long WHITE RIBBONS hang down on both sides; a richly patterned dark court robe',
    duel: '',
    debate: 'one hand resting on the hilt of a sword at his waist, the other hidden in his sleeve, a faint, patient, unreadable smile — a man who waits; NO fan' },
  { id: 'sun-uk', name: '순욱', ko: '순욱', only: ['debate'],
    look: 'XUN YU: a dignified, upright, handsome court minister with a neat mustache and a full pointed beard; a TALL, ornately patterned official\'s crown-cap with a jewel at the front; a heavily PATTERNED court robe with swirling cloud motifs',
    duel: '',
    debate: 'holding a DARK, large-feathered fan (NOT white) against his chest, standing formally, a principled, measured, unshakable calm' },
  { id: 'gwak-ga', name: '곽가', ko: '곽가', only: ['debate'],
    look: 'GUO JIA: a slender, YOUTHFUL, beardless, mischievous strategist with long WAVY hair falling to his shoulders; a curved, patterned scholar\'s cap with a scroll-shaped curl on one side; a patterned robe with a wide decorated sash',
    duel: '',
    debate: 'an ABACUS tucked under one arm and a small feather fan held loosely in the other hand, head tilted, a sly, playful smirk' },
  { id: 'ga-hu', name: '가후', ko: '가후', only: ['debate'],
    look: 'JIA XU: a cold, sharp-featured, menacing strategist with heavy frowning brows, narrow eyes, a downturned mustache and a small goatee; his hair in a tight topknot held by a small crown with a long HAIRPIN through it; a dark robe with a tall STIFF STAND-UP COLLAR',
    duel: '',
    debate: 'holding a DARK feather fan close to his face, glaring sideways with a cold, contemptuous, scheming stare' },
  { id: 'bang-tong', name: '방통', ko: '방통', only: ['debate'],
    look: 'PANG TONG: a stout, round-faced, plain-looking strategist with heavy cheeks, a thin mustache and a scruffy goatee; a small simple scholar\'s cap tied with a long loose cloth RIBBON fluttering behind; a plain patterned robe',
    duel: '',
    debate: 'a thick ROLLED SCROLL tucked under his arm, eyes squeezed into a broad, cheerful, knowing grin, relaxed and unbothered; NO fan' },
];


const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function promptsOf(kind: string, p: Person): { title: string; file: string; text: string }[] {
  const k = (KINDS as Record<string, (typeof KINDS)['duel']>)[kind]!;
  const subject = `LEFT side, facing right (the MAIN character of this image): ${p.look}; ${kind === 'duel' ? p.duel : p.debate}.`;
  const refs = p.id === 'default' || p.shared
    ? 'Reference: the attached image shows the drawing style only.'
    : (() => { const [his, him] = /여장군/.test(p.ko) ? ['her', 'her'] : ['his', 'him'];
      return `Reference: the first attached image is ${his} portrait — use it ONLY for ${his} face, hair, headwear and gear; it is a close-up bust, so do NOT copy its framing or head size — draw ${him} full-body at normal adult proportions, the same scale as the person on the right. The other attached image shows the drawing style.`; })();
  const she = /여장군/.test(p.ko) && kind === 'debate';
  const left = (t: string): string => !she ? t
    : t.replace('The LEFT man', 'The LEFT woman').replace('Both men', 'Both of them').replace('He steps', 'She steps')
      .replace('he turns away', 'she turns away').replace('He stands calm', 'She stands calm');
  const hold = kind === 'duel' ? 'each holds only his own weapon' : 'each holds only their own item';
  return k.scenes.map(([title, scene], i) => ({
    title: `${i + 1}. ${title}`,
    file: `${kind}_${p.id}_${i + 1}.png`,
    text: [STYLE, `PLACE: ${k.place}`, subject, k.opponent, left(scene),
      `Keep the LEFT person on the left and the RIGHT person on the right; ${hold}.`, refs, AVOID].join('\n\n'),
  }));
}

const kinds = Object.keys(KINDS);
const radios = [
  ...kinds.map((k, i) => `<input type="radio" name="kind" id="k-${k}"${i === 0 ? ' checked' : ''} hidden>`),
  ...PEOPLE.map((p, i) => `<input type="radio" name="who" id="p-${p.id}"${i === 0 ? ' checked' : ''} hidden>`),
].join('\n');

const has = (p: Person, k: string): boolean => !p.only || p.only.includes(k);
const faceless = (p: Person): boolean => p.id === 'default' || Boolean(p.shared);
const panes = kinds.flatMap((k) => PEOPLE.map((p) => {
  if (!has(p, k)) return `<div class="pane" data-k="${k}" data-p="${p.id}"><div class="box">${p.ko} — ${KINDS[k as keyof typeof KINDS].label} 그림은 안 만든다(${k === 'debate' ? '설전에서는 디폴트를 쓴다' : '일기토에서는 책사 공용 · 디폴트를 쓴다'}).</div></div>`;
  const portrait = faceless(p) ? '<div class="noface">?</div>' : `<img src="../assets/CharsInBattle/${p.name}.jpg" alt="${p.name}">`;
  const attach = p.id === 'default'
    ? '첨부: 화풍 기준 그림 한 장만. 디폴트는 전용 그림이 없는 모든 장수에게 쓰인다 — 얼굴이 안 읽혀야 한다.'
    : p.shared
    ? '첨부: 화풍 기준 그림 + (장면 2부터) 마음에 든 장면 1. 공용 한 벌이라 초상은 안 붙인다 — 여러 장수가 함께 쓰므로 특정 얼굴이 읽히면 안 된다.'
    : `첨부: <code>assets/CharsInBattle/${p.name}.jpg</code> + 화풍 기준 그림 + (장면 2부터) 마음에 든 장면 1`;
  const cards = promptsOf(k, p).map((x) => `<section class="card"><header><div><b>${x.title}</b> <span class="file">${x.file}</span></div><button class="copy" type="button">복사</button></header><pre>${esc(x.text)}</pre></section>`).join('\n');
  return `<div class="pane" data-k="${k}" data-p="${p.id}"><div class="who">${portrait}<div><b>${p.ko}</b> — ${KINDS[k as keyof typeof KINDS].label}<br>${attach}<br><span class="file">저장 이름: ${k}_${p.id}_1.png ~ _6.png</span></div></div><div class="cards">${cards}</div></div>`;
})).join('\n');

const show = kinds.flatMap((k) => PEOPLE.map((p) => `#k-${k}:checked ~ #p-${p.id}:checked ~ main .pane[data-k="${k}"][data-p="${p.id}"]`)).join(',\n') + ' { display: block; }';
const pressed = [...kinds.map((k) => `#k-${k}:checked ~ main label[for="k-${k}"]`), ...PEOPLE.map((p) => `#p-${p.id}:checked ~ main label[for="p-${p.id}"]`)].join(',\n')
  + ' { background: var(--ink); color: var(--paper); border-color: var(--ink); }';

const kindChips = kinds.map((k) => `<label class="chip" for="k-${k}">${KINDS[k as keyof typeof KINDS].label}</label>`).join('');
const peopleChips = PEOPLE.map((p) => `<label class="chip" for="p-${p.id}">${faceless(p) ? '' : `<img src="../assets/CharsInBattle/${p.name}.jpg" alt="">`}${p.name}</label>`).join('');
const table = PEOPLE.slice(1).map((p) => `<tr><td><label class="link" for="p-${p.id}">${p.ko}</label></td><td>${esc(p.look)}</td><td>${esc(p.duel) || '—'}</td><td>${esc(p.debate) || '—'}</td></tr>`).join('\n');

/**
 * 설전의 패 셋 — 세 논점 명분 · 실리 · 대세 (2026-11-07 기획자, 옛 산가지 1 · 2 · 3). 엔진 값은 그대로 1 · 2 · 3이고 그림만 바뀐다.
 * 일기토의 손 셋(`ic_rps_*`)과 같은 결 — 검은 바탕 · 가운데 물건 하나 · 얇은 짙은 테 + 따뜻한 금빛 번짐. 바탕을 `npm run duel`이 빼낸다.
 */
const PICK_STYLE = `A single game UI icon in a hand-painted, semi-realistic fantasy RPG icon style: rich warm colors, soft painterly shading, a clean readable silhouette with a thin dark outline and a soft warm golden glow hugging the edge.
ONE object only, centered, filling about 60% of the frame height, slightly tilted for life.
BACKGROUND: pure flat black (#000000) — no gradient, no floor, no cast shadow, no smoke.
Wide 16:9 canvas. Ancient China, Three Kingdoms era.`;
const PICK_AVOID = `AVOID: any text, letters, Chinese characters or numbers anywhere (the object must be readable by shape and color alone); hands or people; a frame or border; more than one main object; a background scene.`;
const DEBATE_PICKS: { n: 1 | 2 | 3; ko: string; en: string; object: string }[] = [
  { n: 1, ko: '명분(名分)', en: 'CAUSE — legitimacy, the righteous claim',
    object: 'an ancient imperial JADE SEAL: a square block of glowing green jade topped by a coiled dragon knob, a red silk cord with a golden tassel tied around the knob, the flat seal face turned slightly toward the viewer and stained with red cinnabar ink (plain red square, no characters)' },
  { n: 2, ko: '실리(實利)', en: 'PROFIT — gain, practical advantage',
    object: 'a heavy string of ancient bronze cash coins with square holes, threaded on a red cord and coiled into a loose loop, with two small gleaming GOLD INGOTS (boat-shaped yuanbao) resting in front of it' },
  { n: 3, ko: '대세(大勢)', en: 'MOMENTUM — the tide of the realm',
    object: 'a half-unrolled old MAP SCROLL of the land on aged paper with dark wooden rollers, ink-drawn mountains and a winding blue river, three tiny triangular war flags (red, blue, green) pinned on it, and one bold sweeping red brush-arrow curving across the map' },
];
const pickCards = DEBATE_PICKS.map((x) => {
  const text = [PICK_STYLE, `MEANING: ${x.en}.`, `OBJECT: ${x.object}.`, PICK_AVOID].join('\n\n');
  return `<section class="card"><header><div><b>${x.n}. ${x.ko}</b> <span class="file">assets/icons/ui/control/_src/ic_debate_${x.n}.png.jpg</span></div><button class="copy" type="button">복사</button></header><pre>${esc(text)}</pre></section>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>일기토 · 설전 연출 그림 프롬프트</title>
<!-- 굽는 곳: tools/duel_scene_prompts.ts — 이 파일을 직접 고치지 말고 그것을 고쳐 다시 돌린다 -->
<style>
  :root { --ink: #2a1e14; --paper: #f6efe1; --line: #d8c8a8; --accent: #8a2b1a; --jade: #1f6a5a; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Noto Serif KR", "Malgun Gothic", serif; background: #e9dfca; color: var(--ink); line-height: 1.6; }
  main { max-width: 1080px; margin: 0 auto; padding: 2rem 1.4rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .3rem; }
  h2 { font-size: 1.2rem; margin: 2.2rem 0 .6rem; padding-bottom: .3rem; border-bottom: 2px solid var(--line); }
  h3 { font-size: 1.02rem; margin: 1.2rem 0 .4rem; }
  .lead { color: #5b4a36; margin: 0 0 1rem; }
  .box { background: var(--paper); border: 1px solid var(--line); border-radius: .5rem; padding: 1rem 1.2rem; }
  .warn { border-left: 4px solid var(--accent); }
  .tip { border-left: 4px solid var(--jade); }
  ol, ul { margin: .3rem 0; padding-left: 1.4rem; }
  li { margin: .2rem 0; }
  code { background: #efe4cc; padding: 0 .3rem; border-radius: .2rem; font-size: .9em; }
  table { border-collapse: collapse; width: 100%; font-size: .92rem; }
  th, td { border: 1px solid var(--line); padding: .35rem .5rem; text-align: left; vertical-align: top; }
  th { background: #efe4cc; }
  .controls { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin: .6rem 0 1rem; }
  .controls button { font: inherit; padding: .35rem .8rem; border: 1px solid var(--line); background: var(--paper); border-radius: 2rem; cursor: pointer; }
  .controls button[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .who { display: grid; grid-template-columns: 120px 1fr; gap: 1rem; align-items: start; margin-bottom: 1rem; }
  .who img { width: 120px; height: 120px; object-fit: cover; border-radius: .4rem; border: 1px solid var(--line); background: #fff; }
  .cards { display: grid; grid-template-columns: 1fr; gap: .9rem; }
  .card { background: var(--paper); border: 1px solid var(--line); border-radius: .5rem; overflow: hidden; }
  .card header { display: flex; justify-content: space-between; align-items: center; gap: .6rem; padding: .5rem .8rem; background: #efe4cc; }
  .card header b { font-size: 1rem; }
  .card header span { color: #6d5a45; font-size: .85rem; }
  .card pre { margin: 0; padding: .8rem; white-space: pre-wrap; word-break: break-word; font-family: Consolas, "D2Coding", monospace; font-size: .82rem; line-height: 1.5; max-height: 360px; overflow: auto; }
  .copy { font: inherit; font-size: .85rem; padding: .25rem .7rem; border: 0; border-radius: .3rem; background: var(--jade); color: #fff; cursor: pointer; white-space: nowrap; }
  .copy.done { background: #4a7a3a; }
  .file { font-family: Consolas, monospace; font-size: .82rem; color: #6d5a45; }
  .ex { display: flex; gap: .8rem; flex-wrap: wrap; }
  .ex figure { margin: 0; flex: 1 1 300px; }
  .ex img { width: 100%; border: 1px solid var(--line); border-radius: .3rem; }
  .ex figcaption { font-size: .85rem; color: #5b4a36; }

  .chip { display: inline-flex; align-items: center; gap: .35rem; font: inherit; padding: .3rem .8rem; border: 1px solid var(--line); background: var(--paper); border-radius: 2rem; cursor: pointer; user-select: none; }
  .chip img { width: 1.6rem; height: 1.6rem; border-radius: 50%; object-fit: cover; object-position: top; }
  .chip:hover { border-color: var(--ink); }
  .link { cursor: pointer; text-decoration: underline dotted; }
  .pane { display: none; }
  .noface { width: 120px; height: 120px; border-radius: .4rem; border: 1px dashed var(--line); display: flex; align-items: center; justify-content: center; font-size: 3rem; color: #b9a684; }
  ${show}
  ${pressed}
</style>
</head>
<body>
${radios}
<main>
<h1>일기토 · 설전 연출 그림 프롬프트</h1>
<p class="lead">대결 화면 가운데(두 손 아래 층)에 띄울 결과 연출 그림 — 장면 6 × 일기토 · 설전, 디폴트 · 공용 둘(책사 · 노장) + 전용 21명 (화웅 · 사마의는 뽑아 보고 접었다). Gemini용 (2026-11-06)<br>
<b>설전 둘째 묶음(2026-11-06)</b> — 노장 공용 · 노숙 · 육손 · 손권 · 사마의 · 순욱 · 곽가 · 가후 · 장료 · 방통 · 유비 · 이명. 노숙 · 육손 · 사마의 · 순욱 · 곽가 · 가후 · 방통은 설전만. 갑옷 차림 무인은 디폴트가 맡는다 — 설전 그림이 없는 장수는 디폴트를 쓴다.</p>

<h2>1. 지난 세 장이 엉망이었던 까닭</h2>
<div class="box warn">
  <ol>
    <li><b>여섯 칸을 한 장에 그리게 했다.</b> 칸이 늘수록 모델이 「누가 왼쪽인가」를 잊는다 —
      <i>여포_조운</i>은 왼쪽이 여포로 바뀌었고, <i>여포_장비</i>의 3번째 칸은 오른쪽 사람이 장비의 사모(뱀창)를 들었다. 5번째 칸은 셋 다 구도가 제멋대로였다.</li>
    <li><b>두 사람을 다 특정 인물로 적었다.</b> 두 얼굴 · 두 무기를 동시에 지키는 것이 가장 어렵다. 게다가 우리 게임에서는
      <b>전용 장수가 아무 상대와 붙어도 같은 그림</b>을 쓴다 → 상대는 <b>얼굴 없는 「아무개 장수」</b>여야 맞다.</li>
    <li><b>장면의 뜻이 그림으로 안 읽혔다.</b> 「공격권을 가짐」은 말이지 모습이 아니다. 「왼쪽이 내려치고, 오른쪽이 창을 가로로 들어 막으며 말이 뒤로 밀린다」처럼 <b>몸짓으로</b> 적어야 한다.</li>
    <li><b>화풍이 흔들렸다.</b> <i>여포_조운</i>은 보라 · 청색 번짐과 HDR 광택이 끼었다. 「먹 한 가지 색 + 피만 붉게」를 매번 적어야 한다.</li>
  </ol>
</div>

<h2>2. 이렇게 만든다 (작업 순서)</h2>
<div class="box tip">
  <ol>
    <li><b>한 장수 = 새 채팅 하나.</b> 앞 장수의 그림이 섞이지 않는다.</li>
    <li><b>한 번에 한 장면, 정사각형(1:1) 한 장.</b> 「6칸짜리 한 장」을 시키지 않는다. 자르는 일도 없어진다.</li>
    <li><b>첫 메시지에 그림 둘을 붙인다</b> — ① 그 장수의 수묵 초상(<code>assets/CharsInBattle/{이름}.jpg</code>, 아래에 보인다),
      ② 화풍 기준 그림 한 장(지난 결과 중 마음에 든 칸 하나 — 예: <i>여포_관우</i>의 1번 칸을 잘라서). 그리고 장면 1 프롬프트.</li>
    <li>장면 1이 마음에 들 때까지 다시 뽑는다. <b>마음에 든 장면 1을 장면 2 ~ 6을 시킬 때마다 함께 붙인다</b>(「같은 사람 · 같은 화풍으로」의 기준이 된다).</li>
    <li>여섯 장을 아래 파일 이름으로 저장해 <code>assets/duel/scene/</code>에 넣어 주면 굽는 도구(가장자리 흐리기 · 크기)와 화면은 내가 붙인다.</li>
  </ol>
  <p style="margin:.6rem 0 0">왼쪽 = 이 그림의 주인공(그 전용 장수)이다. 그 장수가 화면 오른쪽에 서는 판에서는 게임이 그림을 좌우로 뒤집고 장면 뜻을 맞바꿔 쓴다(2↔3, 4↔5) — 그러니 <b>언제나 왼쪽이 주인공인 그림만</b> 만들면 된다.</p>
</div>

<h2>3. 장면 여섯</h2>
<table>
  <tr><th>#</th><th>일기토</th><th>설전</th><th>게임에서 뜨는 때</th></tr>
  <tr><td>1</td><td>첫 격돌 — 무기가 한가운데서 부딪힌다</td><td>첫 논쟁 — 말이 먹 소용돌이로 맞부딪힌다</td><td>첫 합 · 비긴 합</td></tr>
  <tr><td>2</td><td>주인공이 몰아붙인다</td><td>주인공이 몰아붙인다</td><td>주인공이 공격권을 쥔 합</td></tr>
  <tr><td>3</td><td>상대가 몰아붙인다</td><td>상대가 몰아붙인다</td><td>상대가 공격권을 쥔 합</td></tr>
  <tr><td>4</td><td>주인공이 지고 물러난다</td><td>주인공이 말문이 막혀 자리를 뜬다</td><td>주인공의 패배 · 도망</td></tr>
  <tr><td>5</td><td>주인공이 이긴다</td><td>주인공이 이긴다</td><td>주인공의 승리</td></tr>
  <tr><td>6</td><td>지쳐 떨어져 마주 선다</td><td>찻잔을 사이에 두고 말이 없다</td><td>10합 결판 없음</td></tr>
</table>

<h2>4. 프롬프트</h2>
<p class="lead">종류와 장수를 누르면 여섯 장면의 프롬프트가 바뀐다(아래 5번 표의 이름을 눌러도 된다). 영어로 적었다 — 그림 모델은 영어 지시를 더 잘 지킨다. [복사]로 그대로 붙여 넣는다.</p>
<div class="controls">${kindChips}</div>
<div class="controls">${peopleChips}</div>
${panes}

<h2>5. 전용 장수 — 무엇이 그 사람인가</h2>
<p class="lead">초상(수묵)에서 뽑은 특징이다. 프롬프트 안에 그대로 들어간다. 고칠 것이 있으면 <code>tools/duel_scene_prompts.ts</code>의 <code>PEOPLE</code>에서 한 줄을 고치고 다시 굽는다.</p>
<table><tr><th>장수</th><th>특징</th><th>일기토 무기</th><th>설전 차림</th></tr>
${table}
</table>

<h2>6. 설전의 패 셋 — 명분 · 실리 · 대세 (2026-11-07)</h2>
<p class="lead">설전은 「상대가 기댄 논점을 찌르는」 놀이다 — 규칙은 그대로(셋 중 하나 맞히기), 옛 산가지 1 · 2 · 3 그림만 바꾼다. 일기토의 손 셋(<code>ic_rps_*</code>)과 같은 결로: 검은 바탕 · 물건 하나 · 금빛 번짐, <b>글자는 넣지 않는다</b>(모양과 색으로 읽혀야 한다 — 그림 모델의 한자는 틀리기 쉽다). 받은 그림은 적힌 이름 그대로 <code>assets/icons/ui/control/_src/</code>에 덮어 두고 <code>npm run duel</code>.</p>
<div class="cards">
${pickCards}
</div>
</main>
<script>
// 복사만 스크립트다 — 스크립트가 안 돌면 프롬프트 글을 직접 골라 복사한다
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.copy');
  if (!b) return;
  const text = b.closest('.card').querySelector('pre').textContent;
  try { await navigator.clipboard.writeText(text); } catch {}
  b.textContent = '복사됨'; b.classList.add('done');
  setTimeout(() => { b.textContent = '복사'; b.classList.remove('done'); }, 1400);
});
</script>
</body>
</html>
`;

writeFileSync(new URL('../Design/일기토_설전_연출그림_프롬프트.html', import.meta.url), html);
const sets = kinds.reduce((n, k) => n + PEOPLE.filter((p) => has(p, k)).length, 0);
console.log(`굽기 끝 — ${sets}벌 · 프롬프트 ${sets * 6}개`);
