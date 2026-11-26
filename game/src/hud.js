// The instrument panel and screens, all DOM over the 3D view: altitude, speed
// and heading with a compass strip on the left, mission clock, rings and score
// on the right, an artificial horizon and throttle bar below, a target marker
// that clamps to the screen edge, and the menu / pause / results overlays.
// Dark translucent panels with bright numerals keep the instruments readable
// at a glance — and in the screenshots.

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
      // Aviation style: cardinals named, every 30 degrees numbered in tens,
      // the 15-degree ticks in between stay as quiet dots.
      const label = names[deg] ?? (deg % 30 === 0 ? String(deg / 10).padStart(2, '0') : '·');
      const major = deg % 45 === 0;
      html += `<span class="tick${major ? ' major' : ''}">${label}</span>`;
    }
  }
  strip.innerHTML = html;
}

export function createHud() {
  const hud = el('hud');
  const altValue = el('alt-value');
  const speedValue = el('speed-value');
  const headingValue = el('heading-value');
  const compassStrip = el('compass-strip');
  const timeValue = el('time-value');
  const ringsValue = el('rings-value');
  const scoreValue = el('score-value');
  const horizonBall = el('horizon-ball');
  const throttleFill = el('throttle-fill');
  const targetMarker = el('target-marker');
  const targetDist = el('target-dist');
  const warning = el('warning');
  const toast = el('toast');
  const countdown = el('countdown');
  const menu = el('menu');
  const results = el('results');
  const pause = el('pause');
  const cockpitFrame = el('cockpit-frame');
  const fade = el('fade');
  const bestLine = el('best-line');

  buildCompass(compassStrip);
  let toastTimer = 0;

  return {
    showHud(show) {
      hud.style.display = show ? 'block' : 'none';
    },

    /** Left cluster + horizon + throttle, updated every frame. */
    setInstruments({ alt, speedKmh, headingDeg, pitch, roll, throttle }) {
      altValue.textContent = `${Math.max(0, Math.round(alt))} m`;
      speedValue.textContent = `${Math.round(speedKmh)} km/h`;
      headingValue.textContent = `${String(Math.round(headingDeg) % 360).padStart(3, '0')}°`;
      // 15 degrees per 45px tick; the middle copy starts at 1080px.
      compassStrip.style.transform = `translateX(${-(1080 + headingDeg * 3 - 90)}px)`;
      const pitchPx = Math.max(-34, Math.min(34, pitch * 57.3 * 0.85));
      horizonBall.style.transform = `rotate(${-roll * 57.3}deg) translateY(${pitchPx}px)`;
      throttleFill.style.height = `${Math.round(throttle * 100)}%`;
    },

    /** Right cluster: mission clock, rings threaded, score. */
    setMission({ timeSec, ringsDone, ringsTotal, score }) {
      timeValue.textContent = formatTime(timeSec);
      ringsValue.textContent = `${ringsDone} / ${ringsTotal}`;
      scoreValue.textContent = String(Math.round(score));
    },

    /**
     * The next-ring marker. On screen it is a diamond with the distance;
     * off screen it clamps to the edge and rotates to point the way.
     */
    setTarget({ show, x, y, dist, edge, angleDeg }) {
      if (!show) {
        targetMarker.style.display = 'none';
        targetDist.style.display = 'none';
        return;
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

    setWarning(text) {
      warning.textContent = text || '';
      warning.style.display = text ? 'block' : 'none';
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
    },

    setCockpit(on) {
      cockpitFrame.style.display = on ? 'block' : 'none';
    },

    setFade(v) {
      fade.style.opacity = String(v);
    },

    showMenu(best) {
      menu.style.display = 'flex';
      bestLine.textContent = best > 0 ? `Best score: ${best}` : 'No flights yet — the canyon is waiting.';
    },
    hideMenu() {
      menu.style.display = 'none';
    },

    showResults({ timeSec, score, grade, ringsDone, ringsTotal, crashes, landed }) {
      el('res-title').textContent = landed ? 'Course complete!' : 'Flight over';
      el('res-time').textContent = formatTime(timeSec);
      el('res-score').textContent = String(Math.round(score));
      el('res-grade').textContent = grade;
      el('res-rings').textContent = `${ringsDone} / ${ringsTotal}`;
      el('res-crashes').textContent = String(crashes);
      results.style.display = 'flex';
    },
    hideResults() {
      results.style.display = 'none';
    },

    showPause(show) {
      pause.style.display = show ? 'flex' : 'none';
    },

    /** Wire the overlay buttons; difficulty buttons carry data-diff. */
    onButtons({ onStart, onDifficulty, onAgain, onResume, onRestart, onMusic }) {
      el('btn-start').addEventListener('click', onStart);
      el('btn-again').addEventListener('click', onAgain);
      el('btn-resume').addEventListener('click', onResume);
      el('btn-restart').addEventListener('click', onRestart);
      el('btn-music').addEventListener('click', onMusic);
      for (const btn of document.querySelectorAll('[data-diff]')) {
        btn.addEventListener('click', () => {
          for (const other of document.querySelectorAll('[data-diff]')) other.classList.remove('selected');
          btn.classList.add('selected');
          onDifficulty(btn.dataset.diff);
        });
      }
    },

    setMusicButton(on) {
      el('btn-music').textContent = on ? 'Music: on' : 'Music: off';
    },
  };
}
