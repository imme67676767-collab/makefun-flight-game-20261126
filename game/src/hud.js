// The instrument panel and screens, all DOM over the 3D view: flight
// instruments (altitude, speed, heading, compass, horizon, throttle),
// mission readouts (clock, rings, score, hull), buff chips, weather banner,
// target marker — plus the front-end screens: title, map select, plane
// select, difficulty, loading, help, best flights, results and pause.
// Card previews are small 2D canvas sketches (terrain silhouettes for maps,
// side views for planes) so the menus need no image assets.

import { t } from './settings.js';
import { HULL_PULSE, MAPS, PLANES } from './config.js';
import { createPlanePreviews } from './preview3d.js';

function el(id) {
  return document.getElementById(id);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Build the compass tape: three copies of 0..360 so it can wrap either way. */
function buildCompass(strip) {
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  let html = '';
  for (let copy = 0; copy < 3; copy++) {
    for (let deg = 0; deg < 360; deg += 15) {
      const label = names[deg] ?? (deg % 30 === 0 ? String(deg / 10).padStart(2, '0') : '·');
      const major = deg % 45 === 0;
      html += `<span class="tick${major ? ' major' : ''}">${label}</span>`;
    }
  }
  strip.innerHTML = html;
}

const SCREENS = ['title', 'mapselect', 'planeselect', 'difficulty', 'loading', 'help', 'best', 'results', 'pause', 'settings'];

/** Terrain silhouette sketch per map for the select cards. */
function drawMapPreview(canvas, key) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, key === 'snowpeak' ? '#9ec2e8' : '#7ec3f2');
  sky.addColorStop(1, '#e8f6ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  // sun
  ctx.fillStyle = 'rgba(255, 236, 160, 0.95)';
  ctx.beginPath(); ctx.arc(W * 0.82, H * 0.2, 13, 0, Math.PI * 2); ctx.fill();
  const ridge = (pts, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (const [x, y] of pts) ctx.lineTo(x * W, y * H);
    ctx.lineTo(W, H);
    ctx.closePath(); ctx.fill();
  };
  if (key === 'canyon') {
    ridge([[0, 0.45], [0.18, 0.18], [0.34, 0.5], [0.5, 0.62], [0.66, 0.5], [0.82, 0.16], [1, 0.42]], '#7d8b74');
    ridge([[0, 0.62], [0.2, 0.4], [0.38, 0.66], [0.55, 0.78], [0.72, 0.64], [0.88, 0.38], [1, 0.6]], '#5e8a4c');
    // snow caps
    ctx.fillStyle = '#f4faff';
    for (const cx of [0.18, 0.82]) {
      ctx.beginPath();
      ctx.moveTo(cx * W - 18, 0.3 * H); ctx.lineTo(cx * W, 0.16 * H); ctx.lineTo(cx * W + 18, 0.3 * H);
      ctx.lineTo(cx * W + 6, 0.26 * H); ctx.lineTo(cx * W - 4, 0.3 * H); ctx.lineTo(cx * W - 10, 0.25 * H);
      ctx.closePath(); ctx.fill();
    }
    // lake
    ctx.fillStyle = '#3f9fd0';
    ctx.beginPath(); ctx.ellipse(W * 0.55, H * 0.85, W * 0.2, H * 0.07, 0, 0, Math.PI * 2); ctx.fill();
  } else if (key === 'lakeside') {
    ridge([[0, 0.6], [0.25, 0.5], [0.5, 0.58], [0.75, 0.48], [1, 0.58]], '#8fbf6d');
    ridge([[0, 0.78], [0.3, 0.68], [0.6, 0.76], [0.85, 0.66], [1, 0.74]], '#6fae52');
    ctx.fillStyle = '#3f9fd0';
    ctx.beginPath(); ctx.ellipse(W * 0.5, H * 0.84, W * 0.34, H * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.ellipse(W * 0.42, H * 0.82, W * 0.12, H * 0.03, 0, 0, Math.PI * 2); ctx.fill();
    // farm fields
    ctx.fillStyle = '#d9b45e';
    ctx.fillRect(W * 0.06, H * 0.8, W * 0.16, H * 0.1);
    ctx.fillStyle = '#b7d977';
    ctx.fillRect(W * 0.78, H * 0.78, W * 0.16, H * 0.1);
  } else {
    ridge([[0, 0.5], [0.15, 0.12], [0.3, 0.42], [0.48, 0.08], [0.65, 0.4], [0.82, 0.14], [1, 0.46]], '#a8bdd4');
    ridge([[0, 0.68], [0.2, 0.34], [0.4, 0.6], [0.6, 0.32], [0.8, 0.58], [1, 0.66]], '#dfeaf6');
    ctx.fillStyle = '#ffffff';
    for (const cx of [0.15, 0.48, 0.82]) {
      ctx.beginPath();
      ctx.moveTo(cx * W - 22, 0.3 * H); ctx.lineTo(cx * W, 0.1 * H); ctx.lineTo(cx * W + 22, 0.3 * H);
      ctx.lineTo(cx * W + 8, 0.24 * H); ctx.lineTo(cx * W - 6, 0.3 * H); ctx.lineTo(cx * W - 12, 0.23 * H);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#7fb6d9';
    ctx.beginPath(); ctx.ellipse(W * 0.3, H * 0.86, W * 0.16, H * 0.06, 0, 0, Math.PI * 2); ctx.fill();
  }
}

/** Side-view sketch per plane for the select cards. */
function drawPlanePreview(canvas, def) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#7ec3f2');
  sky.addColorStop(1, '#e8f6ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#6fae52';
  ctx.fillRect(0, H * 0.84, W, H * 0.16);
  const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
  const cx = W * 0.5, cy = H * 0.52;
  const slim = def.wing === 'low' ? 0.82 : (def.wing === 'high' ? 1.12 : 1);
  const long = def.wing === 'low' ? 1.12 : (def.wing === 'high' ? 0.95 : 1);
  ctx.fillStyle = css(def.colors.body);
  // fuselage: tapered shape
  ctx.beginPath();
  ctx.moveTo(cx - 92 * long, cy + 2);
  ctx.quadraticCurveTo(cx - 40 * long, cy - 13 * slim, cx + 30 * long, cy - 12 * slim);
  ctx.quadraticCurveTo(cx + 78 * long, cy - 8 * slim, cx + 92 * long, cy + 2);
  ctx.quadraticCurveTo(cx + 70 * long, cy + 11 * slim, cx + 10 * long, cy + 12 * slim);
  ctx.quadraticCurveTo(cx - 60 * long, cy + 12 * slim, cx - 92 * long, cy + 2);
  ctx.fill();
  // stripe
  ctx.fillStyle = css(def.colors.trim);
  ctx.fillRect(cx - 78 * long, cy + 2, 150 * long, 4);
  // wing by position
  const wingY = def.wing === 'low' ? cy + 9 : (def.wing === 'high' ? cy - 15 : cy + 1);
  ctx.fillStyle = css(def.colors.body);
  ctx.beginPath();
  ctx.moveTo(cx - 6, wingY);
  ctx.lineTo(cx + 34, wingY + 4);
  ctx.lineTo(cx + 38, wingY + 9);
  ctx.lineTo(cx - 2, wingY + 8);
  ctx.closePath(); ctx.fill();
  if (def.wing === 'high') {
    ctx.strokeStyle = css(def.colors.accent);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + 4, wingY + 8); ctx.lineTo(cx + 10, cy + 8); ctx.stroke();
  }
  // tail fin
  ctx.fillStyle = css(def.colors.accent);
  ctx.beginPath();
  ctx.moveTo(cx - 88 * long, cy);
  ctx.lineTo(cx - 98 * long, cy - 26);
  ctx.lineTo(cx - 80 * long, cy - 24);
  ctx.lineTo(cx - 74 * long, cy);
  ctx.closePath(); ctx.fill();
  // canopy
  ctx.fillStyle = 'rgba(40, 90, 140, 0.9)';
  ctx.beginPath();
  ctx.ellipse(cx + 18 * long, cy - 11 * slim, 16, 7, 0, Math.PI, 0);
  ctx.fill();
  // prop disc
  ctx.fillStyle = 'rgba(40, 40, 40, 0.55)';
  ctx.beginPath(); ctx.ellipse(cx + 94 * long, cy + 1, 3, 30, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css(def.colors.accent);
  ctx.beginPath(); ctx.arc(cx + 93 * long, cy + 1, 4, 0, Math.PI * 2); ctx.fill();
  // wheel
  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath(); ctx.arc(cx + 22, cy + 20, 6, 0, Math.PI * 2); ctx.fill();
}

export function createHud() {
  const previews = createPlanePreviews(); // live 3D plane-card turntables
  const hud = el('hud');
  const altValue = el('alt-value');
  const speedValue = el('speed-value');
  const headingValue = el('heading-value');
  const compassStrip = el('compass-strip');
  const timeValue = el('time-value');
  const ringsValue = el('rings-value');
  const scoreValue = el('score-value');
  const hullFill = el('hull-fill');
  const hullValue = el('hull-value');
  const horizonBall = el('horizon-ball');
  const horizonWrap = el('horizon-wrap');
  const throttleWrap = el('throttle-wrap');
  const throttleFill = el('throttle-fill');
  const compassEl = el('compass');
  const compassTop = el('compass-top');
  const panelRight = el('panel-right');
  const tapeAlt = el('tape-alt');
  const tapeSpeed = el('tape-speed');
  const tapeAltStrip = el('tape-alt-strip');
  const tapeSpeedStrip = el('tape-speed-strip');
  const scorePopBox = el('score-pop');
  const ringFlashEl = el('ring-flash');
  const hullPulseEl = el('hull-pulse');
  const targetMarker = el('target-marker');
  const targetDist = el('target-dist');
  const warning = el('warning');
  const toast = el('toast');
  const countdown = el('countdown');
  const cockpitFrame = el('cockpit-frame');
  const coverVideo = el('cover-video');
  let coverMotion = true;
  if (coverVideo) {
    // Video failed to load/decode: hide it so the live 3D scene behind
    // the cover shows through instead of a black rectangle.
    coverVideo.addEventListener('error', () => { coverVideo.style.display = 'none'; }, true);
  }
  const fade = el('fade');
  const bestLine = el('best-line');
  const buffsBox = el('buffs');
  const weatherBanner = el('weather-banner');
  const windIndicator = el('wind-indicator');
  const windArrow = el('wind-arrow');
  const windValue = el('wind-value');
  const damageFlash = el('damage-flash');
  const lightningFlash = el('lightning-flash');
  const skipHint = el('skip-hint');
  const screenEls = {};
  for (const name of SCREENS) screenEls[name] = el(name);

  buildCompass(compassStrip);

  // --- vertical tape gauges -------------------------------------------------
  // Altitude: 0..650 m at 1.4 px/m; speed: 0..380 km/h at 1.15 px per km/h.
  // Tick for value v sits at strip top = (max - v) * pxPerUnit, so the strip
  // translates down as the value grows.
  const ALT_MAX = 650, ALT_PX = 1.4, SPD_MAX = 380, SPD_PX = 1.15;
  function buildTape(strip, max, pxPer, majorEvery) {
    let html = '';
    for (let v = 0; v <= max; v += 10) {
      const top = (max - v) * pxPer;
      const major = v % majorEvery === 0;
      html += `<div class="tape-tick${major ? ' major' : ''}" style="top:${top}px;width:${major ? 16 : 9}px"></div>`;
      if (major) html += `<div class="tape-tick-label" style="top:${top}px">${v}</div>`;
    }
    strip.innerHTML = html;
    strip.style.height = `${max * pxPer}px`;
  }
  buildTape(tapeAltStrip, ALT_MAX, ALT_PX, 50);
  buildTape(tapeSpeedStrip, SPD_MAX, SPD_PX, 50);

  // Throttle arc ticks: 11 marks across the 240-degree sweep.
  {
    const g = el('throttle-ticks');
    const NS = 'http://www.w3.org/2000/svg';
    for (let i = 0; i <= 10; i++) {
      const a = (210 - i * 24) * Math.PI / 180; // 210deg (idle) -> -30deg (full)
      const r1 = 33, r2 = i % 5 === 0 ? 26 : 29;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', 60 + r1 * Math.cos(a));
      line.setAttribute('y1', 60 - r1 * Math.sin(a));
      line.setAttribute('x2', 60 + r2 * Math.cos(a));
      line.setAttribute('y2', 60 - r2 * Math.sin(a));
      line.setAttribute('stroke', 'rgba(180,225,255,0.65)');
      line.setAttribute('stroke-width', i % 5 === 0 ? '2' : '1.2');
      g.appendChild(line);
    }
  }

  // Low-hull edge pulse shares its period with the audio heartbeat.
  hullPulseEl.style.animationDuration = `${HULL_PULSE.periodSec}s`;

  // Cached layout sizes (the HUD starts display:none, so measure lazily).
  let tapeAltH = 0, tapeSpeedH = 0, compassW = 360;
  function measure() {
    tapeAltH = tapeAlt.clientHeight || tapeAltH;
    tapeSpeedH = tapeSpeed.clientHeight || tapeSpeedH;
    compassW = compassEl.clientWidth || compassW;
  }
  window.addEventListener('resize', measure);

  // Smoothed display values: the tapes and score roll instead of snapping.
  let dispAlt = 0, dispSpeed = 0, dispScore = 0;

  let toastTimer = 0;
  let damageTimer = 0;
  let lightningTimer = 0;
  let countupRaf = 0;
  const buffChips = new Map();
  const cardRefs = { map: new Map(), plane: new Map() };
  let onCardSelect = null;
  let onHover = null; // optional UI hover tick (set via setHoverSound)

  function makeCard(kind, key) {
    const card = document.createElement('div');
    card.className = 'select-card';
    card.dataset.key = key;
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 236;
    const name = document.createElement('h3');
    const blurb = document.createElement('p');
    card.appendChild(canvas);
    card.appendChild(name);
    card.appendChild(blurb);
    const refs = { card, canvas, name, blurb };
    if (kind === 'map') {
      const stars = document.createElement('div');
      stars.className = 'stars';
      card.appendChild(stars);
      refs.stars = stars;
      drawMapPreview(canvas, key);
    } else {
      refs.stats = {};
      for (const stat of ['speed', 'hull', 'agility', 'climb']) {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.innerHTML = `<span class="sname"></span><span class="stat-track"><span class="stat-fill"></span></span>`;
        card.appendChild(row);
        refs.stats[stat] = { label: row.querySelector('.sname'), fill: row.querySelector('.stat-fill') };
      }
      // Live 3D turntable when WebGL is available; 2D sketch otherwise.
      if (!previews.attach(key, canvas, PLANES[key])) drawPlanePreview(canvas, PLANES[key]);
    }
    card.addEventListener('click', () => {
      if (onCardSelect) onCardSelect(kind, key);
    });
    card.addEventListener('mouseenter', () => { if (onHover) onHover(); });
    return refs;
  }

  function refreshCards() {
    for (const [key, refs] of cardRefs.map) {
      refs.name.textContent = t(`map.${key}.name`);
      refs.blurb.textContent = t(`map.${key}.blurb`);
      const stars = MAPS[key].stars;
      refs.stars.innerHTML = '★'.repeat(stars) + `<span class="dim">${'★'.repeat(3 - stars)}</span>`;
    }
    for (const [key, refs] of cardRefs.plane) {
      refs.name.textContent = t(`plane.${key}.name`);
      refs.blurb.textContent = t(`plane.${key}.blurb`);
      for (const [stat, sr] of Object.entries(refs.stats)) {
        sr.label.textContent = t(`stat.${stat}`);
        sr.fill.style.width = `${PLANES[key].stats[stat]}%`;
      }
    }
  }

  return {
    showHud(show) {
      hud.style.display = show ? 'block' : 'none';
    },

    /** Show one front-end screen (or none) and hide the rest. */
    showScreen(name) {
      for (const key of SCREENS) {
        if (screenEls[key]) screenEls[key].style.display = key === name ? 'flex' : 'none';
      }
      // The 3D card turntables only render while plane select is up.
      if (name === 'planeselect') previews.start();
      else previews.stop();
      // The cover video only plays while the title screen is up.
      if (coverVideo) {
        if (name === 'title' && coverMotion) coverVideo.play().catch(() => {});
        else coverVideo.pause();
      }
    },

    /** Low quality tier: drop the cover video, keep the 3D scene. */
    setCoverMotion(on) {
      coverMotion = on;
      if (!coverVideo) return;
      coverVideo.style.display = on ? '' : 'none';
      if (!on) coverVideo.pause();
    },

    /** Register the UI hover-tick callback (buttons + cards). */
    setHoverSound(fn) {
      onHover = fn;
    },

    /** Build the map and plane select cards; onSelect(kind, key) on click. */
    buildCards(onSelect) {
      onCardSelect = onSelect;
      const mapRow = el('map-cards');
      const planeRow = el('plane-cards');
      mapRow.innerHTML = '';
      planeRow.innerHTML = '';
      cardRefs.map.clear();
      cardRefs.plane.clear();
      for (const key of Object.keys(MAPS)) {
        const refs = makeCard('map', key);
        cardRefs.map.set(key, refs);
        mapRow.appendChild(refs.card);
      }
      for (const key of Object.keys(PLANES)) {
        const refs = makeCard('plane', key);
        cardRefs.plane.set(key, refs);
        planeRow.appendChild(refs.card);
      }
      refreshCards();
    },
    refreshCards,

    selectCard(kind, key) {
      for (const [k, refs] of cardRefs[kind]) refs.card.classList.toggle('selected', k === key);
    },

    setBestLine(best) {
      bestLine.textContent = best > 0 ? t('best.score', { n: best }) : t('best.none');
    },

    /** Render the best-flights table (array of {map, plane, score, grade, timeSec}). */
    renderBest(list) {
      const box = el('best-list');
      if (!list || list.length === 0) {
        box.textContent = t('best.empty');
        return;
      }
      let html = `<table><tr><th>${t('best.map')}</th><th>${t('best.plane')}</th><th>${t('res.time')}</th><th>${t('res.score')}</th><th>${t('res.grade')}</th></tr>`;
      for (const row of list) {
        html += `<tr><td>${t(`map.${row.map}.name`)}</td><td>${t(`plane.${row.plane}.name`)}</td><td>${formatTime(row.timeSec)}</td><td>${row.score}</td><td class="grade">${row.grade}</td></tr>`;
      }
      html += '</table>';
      box.innerHTML = html;
    },

    setLoading(frac, stageKey) {
      el('load-fill').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
      if (stageKey) el('load-stage').textContent = t(`loading.${stageKey}`);
    },
    setLoadingTip(text) {
      el('load-tip').textContent = text || '';
    },

    setSkipHint(show) {
      skipHint.style.display = show ? 'block' : 'none';
    },

    /** Left cluster + horizon + throttle, updated every frame. */
    setInstruments({ alt, speedKmh, headingDeg, pitch, roll, throttle }) {
      if (!tapeAltH) { measure(); dispAlt = alt; dispSpeed = speedKmh; }
      dispAlt += (alt - dispAlt) * 0.32;
      dispSpeed += (speedKmh - dispSpeed) * 0.32;
      // Readouts stay exact; only the tape motion is smoothed.
      altValue.textContent = `${Math.max(0, Math.round(alt))} m`;
      speedValue.textContent = `${Math.round(speedKmh)} km/h`;
      tapeAltStrip.style.transform = `translateY(${tapeAltH / 2 - ALT_MAX * ALT_PX + dispAlt * ALT_PX}px)`;
      tapeSpeedStrip.style.transform = `translateY(${tapeSpeedH / 2 - SPD_MAX * SPD_PX + dispSpeed * SPD_PX}px)`;
      headingValue.textContent = `${String(Math.round(headingDeg) % 360).padStart(3, '0')}°`;
      compassStrip.style.transform = `translateX(${-(1080 + headingDeg * 3 - compassW / 2)}px)`;
      const pitchPx = Math.max(-44, Math.min(44, pitch * 57.3 * 1.1));
      horizonBall.style.transform = `rotate(${-roll * 57.3}deg) translateY(${pitchPx}px)`;
      throttleFill.style.strokeDashoffset = String(184.3 * (1 - Math.max(0, Math.min(1, throttle))));
    },

    /** Right cluster: mission clock, rings threaded, score, hull health. */
    setMission({ timeSec, ringsDone, ringsTotal, score }) {
      timeValue.textContent = formatTime(timeSec);
      ringsValue.textContent = `${ringsDone} / ${ringsTotal}`;
      // Roll toward the score, but snap on resets / staged jumps so the
      // readout never lags a whole run behind.
      if (Math.abs(score - dispScore) > 300) dispScore = score;
      dispScore += (score - dispScore) * 0.25;
      if (Math.abs(score - dispScore) < 0.6) dispScore = score;
      scoreValue.textContent = String(Math.round(dispScore));
    },

    /** Hull bar: green to amber to red as the airframe takes a beating. */
    setHull(frac, value) {
      const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
      hullFill.style.width = `${pct}%`;
      hullFill.style.background = frac > 0.5 ? '#35d3f0' : (frac > HULL_PULSE.threshold ? '#ffb020' : '#ff4b3e');
      hullValue.textContent = String(Math.max(0, Math.round(value)));
      hullPulseEl.classList.toggle('on', frac < HULL_PULSE.threshold);
    },

    /** */
    setBuffs(buffs) {
      const seen = new Set();
      for (const buff of buffs) {
        seen.add(buff.key);
        let chip = buffChips.get(buff.key);
        if (!chip) {
          chip = document.createElement('div');
          chip.className = `buff-chip buff-${buff.key}`;
          chip.innerHTML = `<span class="buff-label"></span><span class="buff-bar"><span class="buff-fill"></span></span>`;
          buffsBox.appendChild(chip);
          buffChips.set(buff.key, chip);
        }
        chip.querySelector('.buff-label').textContent = buff.label;
        chip.querySelector('.buff-fill').style.width = `${Math.round(buff.frac * 100)}%`;
        chip.style.display = 'flex';
      }
      for (const [key, chip] of buffChips) {
        if (!seen.has(key)) chip.style.display = 'none';
      }
    },

    /** */
    setTarget({ show, x, y, dist, edge, angleDeg }) {
      if (!show) {
        targetMarker.style.display = 'none';
        targetDist.style.display = 'none';
        return;
      }
      // Never let the marker sit on top of a HUD cluster (SCORE/HULL panel,
      // compass, tapes): push it out along the shallowest escape axis.
      for (const zone of [panelRight, compassTop, tapeAlt, tapeSpeed]) {
        const r = zone.getBoundingClientRect();
        const pad = 22;
        if (x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad) {
          const dl = x - (r.left - pad), dr = (r.right + pad) - x;
          const dt = y - (r.top - pad), db = (r.bottom + pad) - y;
          const m = Math.min(dl, dr, dt, db);
          if (m === dl) x = r.left - pad;
          else if (m === dr) x = r.right + pad;
          else if (m === dt) y = r.top - pad;
          else y = r.bottom + pad;
        }
      }
      targetMarker.style.display = 'block';
      targetMarker.style.left = `${x}px`;
      targetMarker.style.top = `${y}px`;
      targetMarker.style.transform = `translate(-50%, -50%) rotate(${edge ? angleDeg : 45}deg)`;
      targetDist.textContent = edge ? '' : `${Math.round(dist)} m`;
      targetDist.style.left = `${x}px`;
      targetDist.style.top = `${y + 26}px`;
      targetDist.style.display = edge ? 'none' : 'block';
    },

    /** Floating "+N" beside the score when a ring is threaded. */
    scorePop(gained) {
      const item = document.createElement('div');
      item.className = 'score-pop-item';
      item.textContent = `+${gained}`;
      scorePopBox.appendChild(item);
      window.setTimeout(() => item.remove(), 1150);
    },

    /** Brief amber edge glow on a ring pass. */
    ringFlash() {
      ringFlashEl.classList.remove('go');
      void ringFlashEl.offsetWidth; // restart the animation
      ringFlashEl.classList.add('go');
    },

    setWarning(text) {
      warning.textContent = text || '';
      warning.style.display = text ? 'block' : 'none';
    },

    /** The weather warning banner across the top of the screen. */
    setWeatherBanner(text) {
      weatherBanner.textContent = text || '';
      weatherBanner.style.display = text ? 'block' : 'none';
    },

    /** Wind arrow: points where the wind pushes, labelled with its speed. */
    setWind({ show, angleDeg, strengthMs }) {
      windIndicator.style.display = show ? 'flex' : 'none';
      if (!show) return;
      windArrow.style.transform = `rotate(${angleDeg}deg)`;
      windValue.textContent = `${Math.round(strengthMs * 3.6)} km/h`;
    },

    /** Red vignette pulse when the hull takes a hit. */
    flashDamage() {
      damageFlash.style.opacity = '1';
      window.clearTimeout(damageTimer);
      damageTimer = window.setTimeout(() => { damageFlash.style.opacity = '0'; }, 90);
    },

    /** Full-screen white flash for a lightning bolt. */
    flashLightning() {
      lightningFlash.style.opacity = '0.85';
      window.clearTimeout(lightningTimer);
      lightningTimer = window.setTimeout(() => { lightningFlash.style.opacity = '0'; }, 70);
    },

    toast(text, ms = 1800) {
      toast.textContent = text;
      toast.style.opacity = '1';
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => { toast.style.opacity = '0'; }, ms);
    },

    setCountdown(n) {
      countdown.textContent = n === null ? '' : String(n);
      countdown.style.display = n === null ? 'none' : 'block';
      if (n !== null) {
        countdown.classList.remove('pop');
        void countdown.offsetWidth;
        countdown.classList.add('pop');
      }
    },

    setCockpit(on) {
      // The 3D cockpit replaced the CSS frame (kept hidden); in first
      // person the physical panel already carries horizon + throttle,
      // so hide the 2D duplicates. Side tapes stay — they clear the panel.
      cockpitFrame.style.display = 'none';
      horizonWrap.style.display = on ? 'none' : '';
      throttleWrap.style.display = on ? 'none' : '';
    },

    setFade(v) {
      fade.style.opacity = String(v);
    },

    /** */
    showResults({ timeSec, grade, ringsDone, ringsTotal, crashes, landed, breakdown }) {
      el('res-title').textContent = landed ? t('res.title') : t('res.over');
      el('res-time').textContent = formatTime(timeSec);
      el('res-rings').textContent = `${ringsDone} / ${ringsTotal}`;
      el('res-crashes').textContent = String(crashes);
      const badge = el('res-grade-badge');
      badge.textContent = grade;
      badge.className = `grade-${grade}`;
      badge.classList.remove('pop');
      void badge.offsetWidth;
      badge.classList.add('pop');
      const rows = [
        ['res-ringscore', breakdown.ringScore],
        ['res-finish', breakdown.finish],
        ['res-timebonus', breakdown.timeBonus],
        ['res-hpbonus', breakdown.hpBonus],
        ['res-crashpen', -breakdown.crashPenalty],
        ['res-total', breakdown.total],
      ];
      window.cancelAnimationFrame(countupRaf);
      const started = performance.now();
      const DURATION = 900;
      const tick = (now) => {
        const f = Math.min(1, (now - started) / DURATION);
        const eased = 1 - (1 - f) * (1 - f);
        for (const [id, value] of rows) el(id).textContent = String(Math.round(value * eased));
        if (f < 1) countupRaf = window.requestAnimationFrame(tick);
      };
      countupRaf = window.requestAnimationFrame(tick);
      screenEls.results.style.display = 'flex';
    },
    hideResults() {
      screenEls.results.style.display = 'none';
    },

    showPause(show) {
      screenEls.pause.style.display = show ? 'flex' : 'none';
    },

    showSettings(show) {
      screenEls.settings.style.display = show ? 'flex' : 'none';
    },

    /** Sync the settings controls to the stored values. */
    setSettingsValues(s) {
      el('set-sensitivity').value = s.sensitivity;
      el('set-musicvol').value = s.musicVol;
      el('set-sfxvol').value = s.sfxVol;
      el('set-sensitivity-val').textContent = Number(s.sensitivity).toFixed(1);
      el('set-musicvol-val').textContent = `${Math.round(s.musicVol * 100)}%`;
      el('set-sfxvol-val').textContent = `${Math.round(s.sfxVol * 100)}%`;
      for (const btn of document.querySelectorAll('[data-lang]')) {
        btn.classList.toggle('selected', btn.dataset.lang === s.lang);
      }
      el('set-events').textContent = s.events ? t('set.on') : t('set.off');
      el('set-events').classList.toggle('selected', s.events);
      el('set-fullscreen').textContent = s.fullscreen ? t('set.on') : t('set.off');
      el('set-fullscreen').classList.toggle('selected', s.fullscreen);
      for (const btn of document.querySelectorAll('[data-quality]')) {
        btn.classList.toggle('selected', btn.dataset.quality === s.quality);
      }
    },

    /** Wire the settings controls. */
    onSettings({ onSensitivity, onMusicVol, onSfxVol, onLanguage, onEvents, onQuality, onFullscreen, onBack }) {
      el('set-sensitivity').addEventListener('input', (e) => onSensitivity(Number(e.target.value)));
      el('set-musicvol').addEventListener('input', (e) => onMusicVol(Number(e.target.value)));
      el('set-sfxvol').addEventListener('input', (e) => onSfxVol(Number(e.target.value)));
      for (const btn of document.querySelectorAll('[data-lang]')) {
        btn.addEventListener('click', () => { onLanguage(btn.dataset.lang); btn.blur(); });
      }
      el('set-events').addEventListener('click', (e) => { onEvents(e); e.currentTarget.blur(); });
      el('set-fullscreen').addEventListener('click', (e) => { if (onFullscreen) onFullscreen(e); e.currentTarget.blur(); });
      for (const btn of document.querySelectorAll('[data-quality]')) {
        btn.addEventListener('click', () => { onQuality(btn.dataset.quality); btn.blur(); });
      }
      el('btn-settings-back').addEventListener('click', (e) => { onBack(e); e.currentTarget.blur(); });
    },

    /** Wire every front-end button; difficulty buttons carry data-diff. */
    onButtons(h) {
      // Blur after every click so Space/Enter (the confirm keys) can never
      // re-trigger a focused button and restart a flow by accident.
      const wire = (id, fn) => {
        if (fn) el(id).addEventListener('click', (e) => { fn(e); e.currentTarget.blur(); });
        el(id).addEventListener('mouseenter', () => { if (onHover) onHover(); });
      };
      wire('btn-play', h.onPlay);
      wire('btn-help', h.onHelp);
      wire('btn-best', h.onBest);
      wire('btn-settings', h.onSettings);
      wire('btn-map-back', h.onMapBack);
      wire('btn-map-next', h.onMapNext);
      wire('btn-plane-back', h.onPlaneBack);
      wire('btn-plane-next', h.onPlaneNext);
      wire('btn-diff-back', h.onDiffBack);
      wire('btn-start', h.onStart);
      wire('btn-help-back', h.onHelpBack);
      wire('btn-best-back', h.onBestBack);
      wire('btn-again', h.onAgain);
      wire('btn-results-title', h.onResultsTitle);
      wire('btn-resume', h.onResume);
      wire('btn-restart', h.onRestart);
      wire('btn-settings-pause', h.onSettings);
      wire('btn-menu', h.onMenu);
      wire('btn-music', h.onMusic);
      for (const btn of document.querySelectorAll('[data-diff]')) {
        btn.addEventListener('click', () => {
          for (const other of document.querySelectorAll('[data-diff]')) other.classList.remove('selected');
          btn.classList.add('selected');
          if (h.onDifficulty) h.onDifficulty(btn.dataset.diff);
          btn.blur();
        });
      }
    },

    setMusicButton(on) {
      const btn = el('btn-music');
      if (btn) btn.textContent = on ? t('music.on') : t('music.off');
    },
  };
}
