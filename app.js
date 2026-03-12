/**
 * METAR Decoder — app.js
 * Pure vanilla JS: parsing + DOM rendering
 */

'use strict';

/* ================================================================
   SECURITY UTILITIES
   ================================================================ */

/**
 * Escape HTML special characters to prevent XSS when inserting
 * user-supplied text into innerHTML.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ================================================================
   METAR PARSER
   ================================================================ */

const CLOUD_COVER = {
  SKC: 'Sky Clear',
  CLR: 'Clear',
  NSC: 'No Significant Cloud',
  NCD: 'No Cloud Detected',
  FEW: 'Few',
  SCT: 'Scattered',
  BKN: 'Broken',
  OVC: 'Overcast',
  VV:  'Vertical Visibility'
};

const WX_CODES = {
  // Intensity / Proximity
  '-': 'Light',
  '+': 'Heavy',
  VC: 'In the Vicinity',
  // Descriptor
  MI: 'Shallow',
  PR: 'Partial',
  BC: 'Patches',
  DR: 'Low Drifting',
  BL: 'Blowing',
  SH: 'Shower(s)',
  TS: 'Thunderstorm',
  FZ: 'Freezing',
  // Precipitation
  RA: 'Rain',
  DZ: 'Drizzle',
  SN: 'Snow',
  SG: 'Snow Grains',
  IC: 'Ice Crystals',
  PL: 'Ice Pellets',
  GR: 'Hail',
  GS: 'Small Hail',
  UP: 'Unknown Precipitation',
  // Obscuration
  BR: 'Mist',
  FG: 'Fog',
  FU: 'Smoke',
  VA: 'Volcanic Ash',
  DU: 'Widespread Dust',
  SA: 'Sand',
  HZ: 'Haze',
  PY: 'Spray',
  // Other
  PO: 'Dust/Sand Whirls',
  SQ: 'Squalls',
  FC: 'Funnel Cloud / Tornado',
  SS: 'Sandstorm',
  DS: 'Duststorm'
};

function parseWxCode(token) {
  let desc = '';
  let t = token;

  // Intensity prefix
  if (t.startsWith('+')) { desc += 'Heavy '; t = t.slice(1); }
  else if (t.startsWith('-')) { desc += 'Light '; t = t.slice(1); }

  // Proximity VC
  if (t.startsWith('VC')) { desc += 'In the Vicinity '; t = t.slice(2); }

  // Descriptor (2-letter codes)
  const descriptors = ['MI','PR','BC','DR','BL','SH','TS','FZ'];
  for (const d of descriptors) {
    if (t.startsWith(d)) { desc += (WX_CODES[d] || d) + ' '; t = t.slice(2); break; }
  }

  // Remaining 2-letter precipitation / obscuration codes
  while (t.length >= 2) {
    const code = t.slice(0, 2);
    desc += (WX_CODES[code] || code);
    t = t.slice(2);
    if (t.length > 0) desc += ' + ';
  }

  return desc.trim() || token;
}

const EASTER_EGG_METAR = 'METAR LOVE 140214Z 00000KT 9999 VCFG RMK MADE W/ LV FOR THE MST BUTF GIRL I HV EVR SEEN';

function parseMetar(raw) {
  // Easter egg: special codes trigger a hidden METAR.
  // Short-circuit immediately so the non-standard string never hits the parser.
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'THIA' || normalized === '1402') {
    return { _isEasterEgg: true, raw: EASTER_EGG_METAR };
  }

  const result = {
    raw,
    type: null,
    station: null,
    time: null,
    auto: false,
    wind: null,
    visibility: null,
    rvr: [],
    weather: [],
    clouds: [],
    temperature: null,
    dewpoint: null,
    altimeter: null,
    remarks: null,
    errors: []
  };

  // Strip leading/trailing whitespace and normalise spaces
  const str = raw.trim().replace(/\s+/g, ' ').toUpperCase();
  const tokens = str.split(' ');
  let idx = 0;

  function peek() { return tokens[idx]; }
  function consume() { return tokens[idx++]; }

  // 1. Report type (optional METAR / SPECI)
  if (peek() === 'METAR' || peek() === 'SPECI') {
    result.type = consume();
  } else {
    result.type = 'METAR';
  }

  // 2. Station identifier — 4 chars
  if (idx < tokens.length && /^[A-Z0-9]{4}$/.test(peek())) {
    result.station = consume();
  } else {
    result.errors.push('Could not find a valid station identifier.');
  }

  // 3. Date/Time — DDHHMMz
  if (idx < tokens.length && /^\d{6}Z$/.test(peek())) {
    const t = consume();
    result.time = {
      raw: t,
      day: parseInt(t.slice(0, 2), 10),
      hour: parseInt(t.slice(2, 4), 10),
      minute: parseInt(t.slice(4, 6), 10)
    };
  }

  // 4. Modifier (AUTO / COR)
  if (idx < tokens.length && (peek() === 'AUTO' || peek() === 'COR')) {
    result.auto = consume();
  }

  // 5. Wind
  if (idx < tokens.length) {
    const wToken = peek();
    // Standard: dddssKT or dddssGggKT (also MPS)
    const windRe = /^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?(KT|MPS|KMH)$/;
    // CALM: 00000KT
    const calmRe = /^00000(KT|MPS|KMH)$/;
    // Wind variation: dddVddd
    if (calmRe.test(wToken)) {
      consume();
      result.wind = { calm: true, raw: wToken };
    } else if (windRe.test(wToken)) {
      const m = consume().match(windRe);
      result.wind = {
        direction: m[1] === 'VRB' ? 'VRB' : parseInt(m[1], 10),
        speed: parseInt(m[2], 10),
        gust: m[4] ? parseInt(m[4], 10) : null,
        unit: m[5],
        raw: m[0],
        calm: false
      };
      // Optional variation dddVddd
      if (idx < tokens.length && /^\d{3}V\d{3}$/.test(peek())) {
        const v = consume();
        result.wind.varFrom = parseInt(v.slice(0, 3), 10);
        result.wind.varTo   = parseInt(v.slice(4, 7), 10);
      }
    }
  }

  // 6. Visibility
  if (idx < tokens.length) {
    const vTok = peek();
    // CAVOK
    if (vTok === 'CAVOK') {
      consume();
      result.visibility = { cavok: true, raw: 'CAVOK' };
    }
    // US statute miles: number SM or fraction SM
    else if (/^\d+SM$/.test(vTok) || /^\d+\/\d+SM$/.test(vTok)) {
      const tok = consume();
      result.visibility = { value: tok.replace(/SM$/, ''), unit: 'SM', raw: tok };
      // Check for combined fraction like "1 1/2SM"
    } else if (/^\d+$/.test(vTok) && idx + 1 < tokens.length && /^\d+\/\d+SM$/.test(tokens[idx + 1])) {
      const whole = consume();
      const frac = consume();
      const combined = whole + ' ' + frac.replace(/SM$/, '');
      result.visibility = { value: combined, unit: 'SM', raw: whole + ' ' + frac };
    }
    // Metric: 4-digit metres or 9999
    else if (/^\d{4}$/.test(vTok)) {
      const v = parseInt(consume(), 10);
      result.visibility = {
        value: v,
        unit: 'm',
        raw: String(v).padStart(4, '0'),
        km: (v / 1000).toFixed(1)
      };
    }
  }

  // 7. RVR (Runway Visual Range) — optional, multiple
  while (idx < tokens.length && /^R\d{2}[LRC]?\/(M|P)?\d{4}(V(M|P)?\d{4})?(FT|N|U|D)?$/.test(peek())) {
    result.rvr.push(consume());
  }

  // 8. Present weather — tokens starting with - + VC or two uppercase letters matching wx codes
  const wxRe = /^(\+|-|VC)?((MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)$/;
  while (idx < tokens.length && wxRe.test(peek())) {
    const w = consume();
    result.weather.push({ raw: w, description: parseWxCode(w) });
  }

  // 9. Sky condition / clouds
  const skyRe = /^(SKC|CLR|NSC|NCD|CAVOK|FEW|SCT|BKN|OVC|VV)(\d{3})?(CB|TCU)?$/;
  while (idx < tokens.length && skyRe.test(peek())) {
    const c = consume();
    const m = c.match(skyRe);
    result.clouds.push({
      raw: c,
      cover: m[1],
      coverDesc: CLOUD_COVER[m[1]] || m[1],
      height: m[2] ? parseInt(m[2], 10) * 100 : null,
      type: m[3] || null
    });
  }

  // 10. Temperature / Dewpoint  TT/DD  (M prefix = minus)
  if (idx < tokens.length && /^(M?\d{2})\/(M?\d{2})$/.test(peek())) {
    const td = consume();
    const parts = td.split('/');
    const toNum = s => s.startsWith('M') ? -parseInt(s.slice(1), 10) : parseInt(s, 10);
    result.temperature = toNum(parts[0]);
    result.dewpoint    = toNum(parts[1]);
  }

  // 11. Altimeter  A (inches Hg * 100)  or  Q (hPa)
  if (idx < tokens.length && /^[AQ]\d{4}$/.test(peek())) {
    const a = consume();
    if (a[0] === 'A') {
      const raw = parseInt(a.slice(1), 10);
      result.altimeter = { value: (raw / 100).toFixed(2), unit: 'inHg', raw: a };
    } else {
      result.altimeter = { value: parseInt(a.slice(1), 10), unit: 'hPa', raw: a };
    }
  }

  // 12. Remarks (everything after RMK)
  if (idx < tokens.length) {
    const rest = tokens.slice(idx).join(' ');
    if (rest.startsWith('RMK')) {
      result.remarks = rest.replace(/^RMK\s*/, '');
    }
  }

  return result;
}

/* ================================================================
   FLIGHT CATEGORY
   ================================================================ */
function flightCategory(parsed) {
  // Determine ceiling: lowest BKN or OVC layer
  let ceiling = Infinity;
  for (const c of parsed.clouds) {
    if ((c.cover === 'BKN' || c.cover === 'OVC') && c.height !== null) {
      ceiling = Math.min(ceiling, c.height);
    }
  }

  // Visibility in SM (approximate for metric)
  let visSM = Infinity;
  if (parsed.visibility) {
    if (parsed.visibility.cavok) {
      visSM = 999;
    } else if (parsed.visibility.unit === 'SM') {
      const valStr = String(parsed.visibility.value);
      // Parse whole number + optional fraction, e.g. "1 1/2" or "10"
      const fracMatch = valStr.match(/^(\d+)\s+(\d+)\/(\d+)$/);
      if (fracMatch) {
        visSM = parseInt(fracMatch[1], 10) + parseInt(fracMatch[2], 10) / parseInt(fracMatch[3], 10);
      } else {
        const match = valStr.match(/^(\d+)(?:\/(\d+))?$/);
        if (match) visSM = match[2] ? parseInt(match[1], 10) / parseInt(match[2], 10) : parseFloat(match[1]);
      }
    } else if (parsed.visibility.unit === 'm') {
      visSM = parsed.visibility.value / 1609.34;
    }
  }

  if (ceiling < 500 || visSM < 1)       return 'LIFR';
  if (ceiling < 1000 || visSM < 3)      return 'IFR';
  if (ceiling < 3000 || visSM < 5)      return 'MVFR';
  return 'VFR';
}

/* ================================================================
   DOM RENDERING
   ================================================================ */
function compassPoint(deg) {
  if (typeof deg !== 'number') return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function celsiusToFahrenheit(c) {
  return ((c * 9 / 5) + 32).toFixed(1);
}

function makeCard(icon, label, valueHTML, subHTML, colorVar) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.setProperty('--card-color', `var(${colorVar})`);
  card.innerHTML = `
    <span class="card-icon">${icon}</span>
    <div class="card-label">${label}</div>
    <div class="card-value">${valueHTML}</div>
    ${subHTML ? `<div class="card-sub">${subHTML}</div>` : ''}
  `;
  return card;
}

function renderResults(parsed) {
  const grid = document.getElementById('cards-grid');
  grid.innerHTML = '';

  const cat = flightCategory(parsed);

  /* ── Station ───────────────────────────────────── */
  if (parsed.station) {
    const catBadge = `<span class="flight-cat ${cat.toLowerCase()}">${cat}</span>`;
    const sub = `ICAO station · ${parsed.type}${parsed.auto ? ' · AUTO' : ''}`;
    grid.appendChild(makeCard('📍', 'Station', parsed.station + ' ' + catBadge, sub, '--col-station'));
  }

  /* ── Date / Time ───────────────────────────────── */
  if (parsed.time) {
    const t = parsed.time;
    const hhmm = `${String(t.hour).padStart(2,'0')}:${String(t.minute).padStart(2,'0')} UTC`;
    const day  = `Day ${t.day} of month`;
    grid.appendChild(makeCard('🕐', 'Date / Time', hhmm, day, '--col-time'));
  }

  /* ── Wind ──────────────────────────────────────── */
  if (parsed.wind) {
    const w = parsed.wind;
    let val, sub;
    if (w.calm) {
      val = 'Calm';
      sub = 'Wind speed 0 kt';
    } else {
      const dir  = w.direction === 'VRB' ? 'Variable' : `${w.direction}°`;
      const comp = w.direction === 'VRB' ? '' : ` (${compassPoint(w.direction)})`;
      const arrow = w.direction === 'VRB' ? '🔄' : `<span class="wind-arrow" style="--wd:${w.direction}deg">↑</span>`;
      val = `${arrow}${dir}${comp} @ ${w.speed} ${w.unit}`;
      sub = w.gust ? `Gusting to ${w.gust} ${w.unit}` : '';
      if (w.varFrom != null) sub += (sub ? ' · ' : '') + `Variable ${w.varFrom}°–${w.varTo}°`;
    }
    grid.appendChild(makeCard('💨', 'Wind', val, sub, '--col-wind'));
  }

  /* ── Visibility ────────────────────────────────── */
  if (parsed.visibility) {
    const v = parsed.visibility;
    let val, sub;
    if (v.cavok) {
      val = 'CAVOK';
      sub = 'Ceiling & Visibility OK · No significant weather';
    } else if (v.unit === 'SM') {
      val = `${v.value} SM`;
      sub = 'Statute miles';
    } else {
      val = `${v.value.toLocaleString()} m`;
      sub = `${v.km} km`;
    }
    grid.appendChild(makeCard('👁️', 'Visibility', val, sub, '--col-vis'));
  }

  /* ── Present Weather ───────────────────────────── */
  if (parsed.weather.length > 0) {
    const items = parsed.weather.map(w => `<div>${w.raw} — ${w.description}</div>`).join('');
    grid.appendChild(makeCard('🌧️', 'Present Weather', items, '', '--col-wx'));
  }

  /* ── Sky Condition ─────────────────────────────── */
  if (parsed.clouds.length > 0) {
    const rows = parsed.clouds.map(c => {
      const ft   = c.height != null ? `${c.height.toLocaleString()} ft` : '';
      const type = c.type ? ` (${c.type})` : '';
      return `<div class="cloud-row">
        <span class="cloud-badge">${c.cover}</span>
        <span>${c.coverDesc}${type}${ft ? ' @ ' + ft : ''}</span>
      </div>`;
    }).join('');
    grid.appendChild(makeCard('☁️', 'Sky Condition', rows, '', '--col-sky'));
  }

  /* ── Temperature / Dewpoint ────────────────────── */
  if (parsed.temperature !== null) {
    const t   = parsed.temperature;
    const dp  = parsed.dewpoint;
    const val  = `${t}°C / ${celsiusToFahrenheit(t)}°F`;
    const dpLine = dp !== null
      ? `Dewpoint ${dp}°C (${celsiusToFahrenheit(dp)}°F) · Spread ${(t - dp).toFixed(0)}°`
      : '';
    grid.appendChild(makeCard('🌡️', 'Temperature', val, dpLine, '--col-temp'));
  }

  /* ── Altimeter ─────────────────────────────────── */
  if (parsed.altimeter) {
    const a = parsed.altimeter;
    let val, sub;
    if (a.unit === 'inHg') {
      const hpa = (parseFloat(a.value) * 33.8639).toFixed(0);
      val = `${a.value} inHg`;
      sub = `≈ ${hpa} hPa`;
    } else {
      const inhg = (a.value / 33.8639).toFixed(2);
      val = `${a.value} hPa`;
      sub = `≈ ${inhg} inHg`;
    }
    grid.appendChild(makeCard('🔵', 'Altimeter', val, sub, '--col-alt'));
  }

  /* ── Remarks ───────────────────────────────────── */
  if (parsed.remarks) {
    grid.appendChild(makeCard('📝', 'Remarks', escapeHtml(parsed.remarks), '', '--col-raw'));
  }

  /* ── Raw METAR (full-width) ────────────────────── */
  const rawCard = makeCard('📄', 'Raw METAR', escapeHtml(parsed.raw), '', '--col-raw');
  rawCard.classList.add('card-full');
  grid.appendChild(rawCard);
}

/* ================================================================
   EASTER EGG OVERLAY
   ================================================================ */
function showEasterEgg() {
  const overlay = document.getElementById('easter-egg-overlay');
  if (overlay) overlay.classList.add('visible');
}

function dismissEasterEgg() {
  const overlay = document.getElementById('easter-egg-overlay');
  if (overlay) overlay.classList.remove('visible');
}

/* ================================================================
   UI LOGIC
   ================================================================ */
const inputEl   = document.getElementById('metar-input');
const decodeBtn = document.getElementById('btn-decode');
const clearBtn  = document.getElementById('btn-clear');
const errorEl   = document.getElementById('error-banner');
const resultsEl = document.getElementById('results');

function decode() {
  const raw = inputEl.value.trim();
  errorEl.classList.remove('visible');
  resultsEl.classList.remove('visible');

  if (!raw) {
    errorEl.textContent = '⚠️  Please paste a METAR string first.';
    errorEl.classList.add('visible');
    return;
  }

  const parsed = parseMetar(raw);

  if (parsed._isEasterEgg) {
    showEasterEgg();
    return;
  }

  if (!parsed.station) {
    errorEl.textContent = '⚠️  ' + (parsed.errors[0] || 'Invalid METAR — could not find station ID.');
    errorEl.classList.add('visible');
    return;
  }

  renderResults(parsed);
  resultsEl.classList.add('visible');

  // Scroll to results smoothly
  setTimeout(() => resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

// Easter egg dismiss button and overlay background click
const easterEggDismissBtn = document.getElementById('easter-egg-dismiss-btn');
if (easterEggDismissBtn) easterEggDismissBtn.addEventListener('click', dismissEasterEgg);

const easterEggOverlay = document.getElementById('easter-egg-overlay');
if (easterEggOverlay) {
  easterEggOverlay.addEventListener('click', e => {
    if (e.target === easterEggOverlay) dismissEasterEgg();
  });
}

decodeBtn.addEventListener('click', decode);

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    decode();
  }
});

clearBtn.addEventListener('click', () => {
  inputEl.value = '';
  errorEl.classList.remove('visible');
  resultsEl.classList.remove('visible');
  inputEl.focus();
});

// Sample METAR buttons
document.querySelectorAll('.btn-sample').forEach(btn => {
  btn.addEventListener('click', () => {
    inputEl.value = btn.dataset.metar;
    decode();
  });
});

/* ================================================================
   SERVICE WORKER REGISTRATION
   ================================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
