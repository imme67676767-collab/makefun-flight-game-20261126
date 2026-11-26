// Player settings and the two UI languages.
//
// Settings live in localStorage so a pilot's sensitivity, volumes, language
// and quality survive a reload. The dictionary covers every word the menu,
// HUD and toasts show; elements carry data-i18n attributes and dynamic text
// goes through t(). Canvas-painted textures (runway numbers, ring badges)
// stay numeric in both languages.

import { SETTINGS_KEY } from './config.js';

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,   // mouse steering gain, 0.3..2.0
  musicVol: 0.75,     // 0..1
  sfxVol: 0.9,        // 0..1
  lang: 'en',         // 'en' | 'zh'
  events: true,       // random weather on/off
  quality: 'high',    // 'high' | 'medium' | 'low'
  fullscreen: false,  // mirrors the real fullscreen state (synced live)
};

const STRINGS = {
  en: {
    'menu.sub': 'Thread every glowing ring down the canyon, then land on the far runway.<br>Centre hits score more. Crashes cost 150.',
    'ctl.throttle': 'throttle up (S / Ctrl down)',
    'ctl.stick': 'pitch and bank (or just move the mouse to steer)',
    'ctl.camera': 'chase / first-person cockpit',
    'ctl.pause': 'pause',
    'ctl.restart': 'restart the run',
    'ctl.mute': 'mute',
    'diff.easy': 'Easy · 6 rings',
    'diff.normal': 'Normal · 10 rings',
    'diff.hard': 'Hard · 12 rings + wind',
    'btn.start': 'Take off',
    'btn.settings': 'Settings',
    'btn.again': 'Fly again',
    'btn.resume': 'Resume',
    'btn.restart': 'Restart run',
    'btn.back': 'Back',
    'btn.menu': 'Main menu',
    'music.on': 'Music: on',
    'music.off': 'Music: off',
    'best.none': 'No flights yet — the canyon is waiting.',
    'best.score': 'Best score: {n}',
    'hud.altitude': 'Altitude',
    'hud.speed': 'Speed',
    'hud.heading': 'Heading',
    'hud.time': 'Time',
    'hud.rings': 'Rings',
    'hud.score': 'Score',
    'hud.hull': 'Hull',
    'hud.thr': 'THR',
    'res.title': 'Course complete!',
    'res.over': 'Flight over',
    'res.time': 'Time',
    'res.rings': 'Rings',
    'res.crashes': 'Crashes',
    'res.score': 'Score',
    'res.grade': 'Grade',
    'pause.title': 'Paused',
    'set.title': 'Settings',
    'set.sensitivity': 'Mouse sensitivity',
    'set.musicVol': 'Music volume',
    'set.sfxVol': 'Sound effects volume',
    'set.language': 'Language',
    'set.events': 'Random weather events',
    'set.quality': 'Quality',
    'set.fullscreen': 'Fullscreen',
    'set.on': 'On',
    'set.off': 'Off',
    'quality.high': 'High',
    'quality.medium': 'Medium',
    'quality.low': 'Low',
    'toast.throttle': 'Throttle up with W / Shift when the light goes green!',
    'toast.go': 'GO!',
    'toast.airborne': 'Airborne — follow the gold ring!',
    'toast.ring': 'Ring {n} — +{g}',
    'toast.allRings': 'All rings! Land on the far runway.',
    'toast.downSafe': 'Down safe — throttle up and thread the rings!',
    'toast.rough': 'Rough landing! Hull damaged.',
    'toast.hard': 'Hard landing! That hurt.',
    'toast.crashed': 'Crashed! Back to the last ring.',
    'toast.soundOn': 'Sound on',
    'toast.soundOff': 'Sound off',
    'toast.boost': 'BOOST!',
    'toast.shield': 'Shield up!',
    'toast.repair': 'Hull repaired +{n}',
    'toast.shieldBlock': 'Shield blocked the hit!',
    'toast.birdStrike': 'Bird strike! Hull damaged.',
    'warn.stall': 'STALL — NOSE DOWN, ADD POWER',
    'warn.pullup': 'PULL UP',
    'warn.hull': 'HULL CRITICAL',
    'weather.storm': 'Thunderstorm rolling in!',
    'weather.gust': 'Gust front — crosswind!',
    'weather.rain': 'Heavy rain ahead!',
    'weather.tornado': 'Tornado on the course!',
    'weather.clear': 'Weather clearing',
    'buff.boost': 'BOOST',
    'buff.shield': 'SHIELD',
    'title.sub': 'Thread the canyon rings. Land it clean.',
    'btn.play': 'Start game',
    'btn.help': 'How to fly',
    'btn.best': 'Best flights',
    'btn.next': 'Next',
    'btn.title': 'Back to title',
    'map.title': 'Choose your map',
    'map.canyon.name': 'Canyon Peaks',
    'map.canyon.blurb': 'Snow-capped walls, a winding river and one mirror lake.',
    'map.lakeside.name': 'Lakeside Plains',
    'map.lakeside.blurb': 'Gentle hills, a big lake and farm country. Calm air, easy flying.',
    'map.snowpeak.name': 'Snowpeak Highlands',
    'map.snowpeak.blurb': 'High snowy ridges, strong winds and wild weather. Bring your nerve.',
    'map.difficulty': 'Difficulty',
    'plane.title': 'Choose your plane',
    'plane.aerobatic.name': 'Aerobatic',
    'plane.aerobatic.blurb': 'Balanced and nimble — rolls fast, turns tight.',
    'plane.racer.name': 'Racer',
    'plane.racer.blurb': 'Blistering speed and climb, but fragile with a wide turn.',
    'plane.trainer.name': 'Trainer',
    'plane.trainer.blurb': 'Slow, sturdy and forgiving. Hard to stall, easy to love.',
    'stat.speed': 'Speed',
    'stat.hull': 'Hull',
    'stat.agility': 'Agility',
    'stat.climb': 'Climb',
    'diff.title': 'Choose difficulty',
    'loading.title': 'Preparing the course…',
    'loading.terrain': 'Raising mountains',
    'loading.vegetation': 'Planting forests',
    'loading.buildings': 'Building villages',
    'loading.creatures': 'Waking the wildlife',
    'loading.course': 'Hanging the rings',
    'loading.done': 'Ready!',
    'loading.tip1': 'Tip: centre hits on a ring score double.',
    'loading.tip2': 'Tip: bank first, then pull — turns are coordinated.',
    'loading.tip3': 'Tip: dark storm clouds hide lightning. Fly around them.',
    'loading.tip4': 'Tip: slow down before tight turns to shrink your radius.',
    'help.title': 'How to fly',
    'help.pickups': 'Fly through pickups: orange = boost, cyan = shield, green = repair.',
    'help.weather': 'Weather rolls in: gusts push you sideways, storms shake the stick, tornadoes pull. Watch the banner.',
    'help.traffic': 'Other planes share the sky — keep clear, collisions hurt.',
    'help.storm': 'Dark storm cells: inside is turbulence and lightning. Detour or punch through.',
    'help.scoring': 'Score: ring points + finish bonus + time bonus + hull bonus − crash penalties.',
    'best.title': 'Best flights',
    'best.empty': 'No finished flights yet.',
    'best.map': 'Map',
    'best.plane': 'Plane',
    'res.ringScore': 'Ring points',
    'res.finish': 'Finish bonus',
    'res.timeBonus': 'Time bonus',
    'res.hpBonus': 'Hull bonus',
    'res.crashPenalty': 'Crash penalties',
    'res.total': 'Total',
    'warn.traffic': 'TRAFFIC — KEEP CLEAR',
    'warn.stormNear': 'STORM CELL AHEAD',
    'toast.trafficHit': 'Mid-air collision!',
    'toast.stormStrike': 'Lightning strike!',
    'hint.skip': 'Click or press any key to skip',
    'radio.1': 'Traffic in sight — keep clear of my altitude.',
    'radio.2': 'Heads up, you are drifting into my lane.',
    'radio.3': 'Mind your spacing, friend.',
    'radio.4': 'Nice day for it. Smooth air up here.',
    'radio.5': 'Canyon is looking fine today.',
    'radio.6': 'Watch the storm cell on your left.',
    'radio.7': 'Rings are hot — good hunting.',
    'radio.8': 'Tailwind is picking up. Stay sharp.',
  },
  zh: {
    'menu.sub': '穿过峡谷里的每一个发光圆环，再降落到远端的跑道上。<br>越接近环心分越高。坠毁扣 150 分。',
    'ctl.throttle': '加油门（S / Ctrl 减油门）',
    'ctl.stick': '俯仰与横滚（移动鼠标即可转向）',
    'ctl.camera': '追逐 / 第一人称座舱视角',
    'ctl.pause': '暂停',
    'ctl.restart': '重新开始',
    'ctl.mute': '静音',
    'diff.easy': '简单 · 6 环',
    'diff.normal': '普通 · 10 环',
    'diff.hard': '困难 · 12 环＋风',
    'btn.start': '起飞',
    'btn.settings': '设置',
    'btn.again': '再飞一次',
    'btn.resume': '继续',
    'btn.restart': '重新开始',
    'btn.back': '返回',
    'btn.menu': '主菜单',
    'music.on': '音乐：开',
    'music.off': '音乐：关',
    'best.none': '还没有飞行记录——峡谷在等你。',
    'best.score': '最佳成绩：{n}',
    'hud.altitude': '高度',
    'hud.speed': '速度',
    'hud.heading': '航向',
    'hud.time': '时间',
    'hud.rings': '圆环',
    'hud.score': '得分',
    'hud.hull': '机体',
    'hud.thr': '油门',
    'res.title': '航线完成！',
    'res.over': '飞行结束',
    'res.time': '用时',
    'res.rings': '圆环',
    'res.crashes': '坠毁',
    'res.score': '得分',
    'res.grade': '评级',
    'pause.title': '已暂停',
    'set.title': '设置',
    'set.sensitivity': '鼠标灵敏度',
    'set.musicVol': '背景音乐音量',
    'set.sfxVol': '音效音量',
    'set.language': '语言',
    'set.events': '随机天气事件',
    'set.quality': '画质',
    'set.fullscreen': '全屏',
    'set.on': '开',
    'set.off': '关',
    'quality.high': '高',
    'quality.medium': '中',
    'quality.low': '低',
    'toast.throttle': '绿灯亮起时按 W / Shift 加油门！',
    'toast.go': '出发！',
    'toast.airborne': '离地了——跟着金环飞！',
    'toast.ring': '第 {n} 环 — +{g}',
    'toast.allRings': '全部穿完！去远端跑道降落。',
    'toast.downSafe': '安全落地——加油门继续穿环！',
    'toast.rough': '粗糙落地！机体受损。',
    'toast.hard': '重着陆！撞得不轻。',
    'toast.crashed': '坠毁了！回到上一个环。',
    'toast.soundOn': '声音开',
    'toast.soundOff': '声音关',
    'toast.boost': '加速！',
    'toast.shield': '护盾开启！',
    'toast.repair': '机体修复 +{n}',
    'toast.shieldBlock': '护盾挡下了撞击！',
    'toast.birdStrike': '撞鸟了！机体受损。',
    'warn.stall': '失速——压低机头，加油门',
    'warn.pullup': '拉起！',
    'warn.hull': '机体危急',
    'weather.storm': '雷暴来袭！',
    'weather.gust': '阵风锋面——注意侧风！',
    'weather.rain': '前方暴雨！',
    'weather.tornado': '航线上有龙卷风！',
    'weather.clear': '天气转晴',
    'buff.boost': '加速',
    'buff.shield': '护盾',
    'title.sub': '穿过峡谷圆环，稳稳降落。',
    'btn.play': '开始游戏',
    'btn.help': '操作说明',
    'btn.best': '最佳成绩',
    'btn.next': '下一步',
    'btn.title': '回到主界面',
    'map.title': '选择地图',
    'map.canyon.name': '峡谷山地',
    'map.canyon.blurb': '雪峰峡谷、蜿蜒河流，还有一面镜子湖。',
    'map.lakeside.name': '湖畔平原',
    'map.lakeside.blurb': '缓坡、大湖和农田村庄。风小，适合新手。',
    'map.snowpeak.name': '雪山高原',
    'map.snowpeak.blurb': '高耸雪线、强风、天气多变。胆大者来。',
    'map.difficulty': '难度',
    'plane.title': '选择飞机',
    'plane.aerobatic.name': '特技机',
    'plane.aerobatic.blurb': '均衡灵活——滚转快，转弯半径小。',
    'plane.racer.name': '竞速机',
    'plane.racer.blurb': '速度与爬升拉满，但脆皮、转弯半径大。',
    'plane.trainer.name': '教练机',
    'plane.trainer.blurb': '慢、结实、宽容。抗失速，新手友好。',
    'stat.speed': '速度',
    'stat.hull': '血量',
    'stat.agility': '机动',
    'stat.climb': '爬升',
    'diff.title': '选择难度',
    'loading.title': '正在准备航线…',
    'loading.terrain': '隆起群山',
    'loading.vegetation': '种下森林',
    'loading.buildings': '建起村庄',
    'loading.creatures': '唤醒生灵',
    'loading.course': '挂上圆环',
    'loading.done': '就绪！',
    'loading.tip1': '小贴士：正中环心得分翻倍。',
    'loading.tip2': '小贴士：先压坡度再拉杆——转弯靠协调。',
    'loading.tip3': '小贴士：深色雷雨云里藏着闪电，绕开走。',
    'loading.tip4': '小贴士：急转弯前先减速，半径更小。',
    'help.title': '操作说明',
    'help.pickups': '飞过道具：橙色＝加速，青色＝护盾，绿色＝修复。',
    'help.weather': '天气会变化：阵风横推、雷暴抖杆、龙卷风吸附。留意横幅提示。',
    'help.traffic': '天上有其他飞机——保持距离，撞上很疼。',
    'help.storm': '深色雷雨云团：里面湍流＋闪电。绕开，或者穿过去。',
    'help.scoring': '计分：穿环分＋完赛分＋时间分＋血量分－坠毁扣分。',
    'best.title': '最佳成绩',
    'best.empty': '还没有完赛记录。',
    'best.map': '地图',
    'best.plane': '飞机',
    'res.ringScore': '穿环分',
    'res.finish': '完赛分',
    'res.timeBonus': '时间分',
    'res.hpBonus': '血量分',
    'res.crashPenalty': '坠毁扣分',
    'res.total': '总分',
    'warn.traffic': '有飞机接近——避让！',
    'warn.stormNear': '前方雷雨云团',
    'toast.trafficHit': '空中相撞！',
    'toast.stormStrike': '被雷劈中了！',
    'hint.skip': '点击或按任意键跳过',
    'radio.1': '看到你了——注意保持高度间隔。',
    'radio.2': '注意，你正飘进我的航线。',
    'radio.3': '朋友，保持距离。',
    'radio.4': '今天天气不错，上面气流很稳。',
    'radio.5': '今天的峡谷真好看。',
    'radio.6': '小心你左侧的雷雨云团。',
    'radio.7': '圆环就绪——祝你好运。',
    'radio.8': '顺风在变大，留神。',
  },
};

let current = { ...DEFAULT_SETTINGS };
let lang = 'en';

/** */
function sanitize(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const num = (v, min, max, fallback) => (
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
  );
  out.sensitivity = num(raw.sensitivity, 0.3, 2.0, DEFAULT_SETTINGS.sensitivity);
  out.musicVol = num(raw.musicVol, 0, 1, DEFAULT_SETTINGS.musicVol);
  out.sfxVol = num(raw.sfxVol, 0, 1, DEFAULT_SETTINGS.sfxVol);
  out.lang = raw.lang === 'zh' || raw.lang === 'en' ? raw.lang : DEFAULT_SETTINGS.lang;
  out.events = typeof raw.events === 'boolean' ? raw.events : DEFAULT_SETTINGS.events;
  out.quality = ['high', 'medium', 'low'].includes(raw.quality) ? raw.quality : DEFAULT_SETTINGS.quality;
  out.fullscreen = typeof raw.fullscreen === 'boolean' ? raw.fullscreen : DEFAULT_SETTINGS.fullscreen;
  return out;
}

/** Load saved settings, validated field by field over the defaults. */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    current = sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    current = { ...DEFAULT_SETTINGS };
  }
  lang = STRINGS[current.lang] ? current.lang : 'en';
  return current;
}

export function getSettings() {
  return current;
}

/** Change one setting (validated), persist, and return the whole set. */
export function setSetting(key, value) {
  current = sanitize({ ...current, [key]: value });
  if (key === 'lang') lang = STRINGS[value] ? value : 'en';
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // Private mode and friends: settings just will not persist.
  }
  return current;
}

/** Translate a key, filling {placeholders} from vars. */
export function t(key, vars = {}) {
  let text = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

/** Rewrite every data-i18n element in the document for the current language. */
export function applyLanguage() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.innerHTML = t(node.dataset.i18n);
  }
}

export function currentLang() {
  return lang;
}
