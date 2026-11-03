// --- 1. Constants & Configuration ---
const CONFIG = {
  SUN_COLOR: '#CACAC7',
  // GRID_COLOR: 'rgba(60, 95, 101, 1)',
  GRID_COLOR: '#666666',
  CANVAS_CX: 900,
  CANVAS_CY: 900,
  GRID_RADIUS: 890,
  GRID_LINE_WIDTH: 3,
  SUN_SIZE: 10,
  SUN_R: 5,
  SUN_OFFSET: 5,
  POSSIBLE_INTERVALS: [
    1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 16, 18, 20,
    24, 30, 32, 36, 40, 45, 48, 60, 72, 80, 90, 96,
    120, 144, 160, 180, 240, 288, 360, 480, 720, 1440
  ]
};

// Map input range IDs
const SLIDER_MAP = {
  lat: 'textLat',
  lon: 'textLon',
  step: 'textStep',
  intervalInput: 'textInterval'
};

// --- 2. DOM Elements Cache ---
const elements = {
  svgCanvas: document.getElementById('view-canvas'),
  gridLayer: document.getElementById('grid-layer'),
  curvesPath: document.getElementById('curves-path'),
  sunsLayer: document.getElementById('suns-layer'),
  startDate: document.getElementById('startDate'),
  endDate: document.getElementById('endDate'),
  startDisplay: document.getElementById('startDisplay'),
  endDisplay: document.getElementById('endDisplay'),
  projBtn: document.getElementById('projBtn'),
  projInput: document.getElementById('projection'),
  projDisplay: document.getElementById('projDisplay'),
  latInput: document.getElementById('lat'),
  lonInput: document.getElementById('lon'),
  stepInput: document.getElementById('step'),
  intervalInput: document.getElementById('intervalInput'),
  latVal: document.getElementById('latVal'),
  lonVal: document.getElementById('lonVal'),
  stepVal: document.getElementById('stepVal'),
  intervalVal: document.getElementById('intervalVal')
};

// --- 3. App State & Caches ---
const state = {
  isDrawing: false,
  needsRedraw: false,
  solarCache: [],
  lastStableLon: 1,
  visualRotationOffset: 0,
  globalLatRad: deg(-90),
  globalPointStep: 1,
  animeFrameId: null
};

const nearestIntervalCache = new Map();
for (let i = 1; i <= 1440; i++) {
  const nearest = CONFIG.POSSIBLE_INTERVALS.reduce((prev, curr) =>
    Math.abs(curr - i) < Math.abs(prev - i) ? curr : prev
  );
  nearestIntervalCache.set(i, nearest);
}

// --- 4. Math & Astronomy Utilities ---
function deg(v) { return v * Math.PI / 180; }
function rad(v) { return v * 180 / Math.PI; }

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function getSolarEcliptic(date) {
  const JD = date.getTime() / 86400000 + 2440587.5;
  const T = (JD - 2451545) / 36525;
  const L0 = (280.46646 + 36000.76983 * T) % 360;
  const M = 357.52911 + 35999.05029 * T;
  const C = Math.sin(deg(M)) * 1.914602 + Math.sin(deg(2 * M)) * 0.019993;
  const lambda = L0 + C;
  const eps = 23.439291;

  const ra = rad(Math.atan2(
    Math.cos(deg(eps)) * Math.sin(deg(lambda)),
    Math.cos(deg(lambda))
  ));
  const dec = rad(Math.asin(
    Math.sin(deg(eps)) * Math.sin(deg(lambda))
  ));
  const gst = 280.46061837 + 360.98564736629 * (JD - 2451545);

  return { ra, dec, gst };
}

function HDecToHorizontal(H, dec, latr) {
  const Hr = deg(H);
  const decr = deg(dec);
  const sinDec = Math.sin(decr);
  const cosDec = Math.cos(decr);
  const sinLat = Math.sin(latr);
  const cosLat = Math.cos(latr);

  const alt = Math.asin(sinLat * sinDec + cosLat * cosDec * Math.cos(Hr));
  const az = Math.atan2(
    Math.sin(Hr) * cosDec,
    Math.cos(Hr) * sinLat * cosDec - sinDec * cosLat
  );

  return {
    altitude: rad(alt),
    azimuth: (rad(az) + 540) % 360
  };
}

function project(az, alt, projType) {
  const zenith = 90 - alt;
  const rho = (projType === 'ortho')
    ? CONFIG.GRID_RADIUS * Math.sin(deg(zenith))
    : CONFIG.GRID_RADIUS * (zenith / 90);
    
  return {
    x: CONFIG.CANVAS_CX + rho * Math.sin(deg(az)),
    y: CONFIG.CANVAS_CY - rho * Math.cos(deg(az))
  };
}

// --- 5. Date & Value Formatter Helpers ---
function formatDateToDDMMYYYY(ymdStr) {
  if (!ymdStr) return '';
  const parts = ymdStr.split('-');
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : ymdStr;
}

function formatDays(count) {
  const rem10 = count % 10;
  const rem100 = count % 100;
  if (rem100 >= 11 && rem100 <= 14) return `${count} ДНЕЙ`;
  if (rem10 === 1) return `${count} ДЕНЬ`;
  if (rem10 >= 2 && rem10 <= 4) return `${count} ДНЯ`;
  return `${count} ДНЕЙ`;
}

function addOneYear(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let targetY = y + 1;
  let targetD = (m === 2 && d === 29 && !isLeapYear(targetY)) ? 28 : d;
  return `${targetY}-${String(m).padStart(2, '0')}-${String(targetD).padStart(2, '0')}`;
}

function subtractOneYear(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let targetY = y - 1;
  let targetD = (m === 2 && d === 29 && !isLeapYear(targetY)) ? 28 : d;
  return `${targetY}-${String(m).padStart(2, '0')}-${String(targetD).padStart(2, '0')}`;
}

function getSelectedMaxDays() {
  const startVal = elements.startDate.value;
  const endVal = elements.endDate.value;
  if (!startVal || !endVal) return 365;

  const s = startVal.split('-').map(Number);
  const e = endVal.split('-').map(Number);
  const startUTC = Date.UTC(s[0], s[1] - 1, s[2]);
  const endUTC = Date.UTC(e[0], e[1] - 1, e[2]);

  if (endUTC < startUTC) return 365;
  const diffDays = Math.round((endUTC - startUTC) / 86400000) + 1;
  return Math.max(1, diffDays);
}

// Non-linear normalization sliders mappings
function stepToRealValue(normalized) {
  const min = 1;
  const max = getSelectedMaxDays();
  return Math.round(min + (max - min) * Math.pow(normalized, 1.5));
}

function stepToNormalized(realValue) {
  const min = 1;
  const max = getSelectedMaxDays();
  if (max <= min) return 0;
  return Math.pow((realValue - min) / (max - min), 1 / 1.5);
}

function intervalToRealValue(normalized) {
  const min = 1;
  const max = 1440;
  return Math.round(min + (max - min) * Math.pow(normalized, 2));
}

function intervalToNormalized(realValue) {
  const min = 1;
  const max = 1440;
  if (max <= min) return 0;
  return Math.pow((realValue - min) / (max - min), 0.5);
}

// --- Dynamic Value Positioning Logic ---
function updateSliderValuePosition(inputId, valueId) {
  const input = document.getElementById(inputId);
  const valContainer = document.getElementById(valueId);
  if (!input || !valContainer) return;

  let span = valContainer.querySelector('span');
  if (!span) {
    span = document.createElement('span');
    span.textContent = valContainer.textContent;
    valContainer.innerHTML = '';
    valContainer.appendChild(span);
  }

  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  const val = parseFloat(input.value);

  // t: 0 at min value, 1 at max value
  const t = (val - min) / (max - min);
  const containerWidth = 144;
  const textWidth = span.offsetWidth;

  const maxShift = Math.max(0, containerWidth - textWidth);
  // At min value (t=0) shift is maxShift (right aligned in 144px column)
  // At max value (t=1) shift is 0 (left aligned in 144px column)
  const shift = (1 - t) * maxShift;

  span.style.transform = `translateX(${shift}px)`;
}

function setValueTextAndPosition(inputId, valueId, text) {
  const valContainer = document.getElementById(valueId);
  if (!valContainer) return;

  let span = valContainer.querySelector('span');
  if (!span) {
    span = document.createElement('span');
    valContainer.innerHTML = '';
    valContainer.appendChild(span);
  }
  span.textContent = text;
  updateSliderValuePosition(inputId, valueId);
}

function updateAllSliderValuePositions() {
  updateSliderValuePosition('lat', 'latVal');
  updateSliderValuePosition('lon', 'lonVal');
  updateSliderValuePosition('step', 'stepVal');
  updateSliderValuePosition('intervalInput', 'intervalVal');
}

function updateIntervalLabel(intervalMins) {
  const count = Math.floor(1440 / intervalMins);
  const text = `${intervalMins} МИН (${count}/СУТКИ)`;
  setValueTextAndPosition('intervalInput', 'intervalVal', text);
}

function updateSliderTextPosition(inputId, textId) {
  const input = document.getElementById(inputId);
  const textSpan = document.getElementById(textId);
  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  const val = parseFloat(input.value);

  const percent = ((val - min) / (max - min)) * 100;
  textSpan.style.left = `${percent}%`;
  textSpan.style.transform = `translateX(-${percent}%)`;
}

// --- 6. Solar Cache & Rendering Engine ---
function updateSolarCache() {
  state.solarCache = [];
  const startVal = elements.startDate.value;
  const endVal = elements.endDate.value;

  const intervalNormalized = parseFloat(elements.intervalInput.value);
  const intervalRaw = intervalToRealValue(intervalNormalized);
  const interval = nearestIntervalCache.get(intervalRaw);

  updateIntervalLabel(interval);

  if (!startVal || !endVal || interval < 1) return;

  const startParts = startVal.split('-');
  const endParts = endVal.split('-');
  if (startParts.length !== 3 || endParts.length !== 3) return;

  const startUTC = Date.UTC(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
  const endUTC = Date.UTC(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));

  if (isNaN(startUTC) || isNaN(endUTC) || startUTC > endUTC) return;

  const lon = parseFloat(elements.lonInput.value);
  const longitudeOffsetMs = lon * 4 * 60 * 1000;
  const d = new Date();

  for (let m = 0; m < 1440; m += interval) {
    const dayPoints = [];
    let currentDayLocalUTC = startUTC;

    while (currentDayLocalUTC <= endUTC) {
      const targetUTCMs = currentDayLocalUTC - longitudeOffsetMs + (m * 60 * 1000);
      d.setTime(targetUTCMs);
      dayPoints.push(getSolarEcliptic(d));
      currentDayLocalUTC += 86400000;
    }
    state.solarCache.push(dayPoints);
  }
}

function drawGrid() {
  const projType = elements.projInput.value;
  let markup = '';

  if (projType === 'equatorial') {
    let gridPathsD = '';
    const traceLine = (getCoords) => {
      let d = '';
      let active = false;
      for (let i = 0; i <= 360; i += 0.5) {
        const coords = getCoords(i);
        if (coords.altitude >= -1.0) {
          const pt = project(coords.azimuth, coords.altitude, 'polar');
          if (!active) {
            d += `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)} `;
            active = true;
          } else {
            d += `L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)} `;
          }
        } else {
          active = false;
        }
      }
      return d;
    };

    for (let decDeg = -75; decDeg <= 75; decDeg += 15) {
      gridPathsD += traceLine((i) => HDecToHorizontal(i - 180, decDeg, state.globalLatRad));
    }
    for (let hHour = 0; hHour < 360; hHour += 15) {
      gridPathsD += traceLine((i) => HDecToHorizontal(hHour, (i / 2) - 90, state.globalLatRad));
    }
    markup += `<path d="${gridPathsD}" fill="none" stroke="${CONFIG.GRID_COLOR}" stroke-width="${CONFIG.GRID_LINE_WIDTH}" />`;
  } else {
    for (let az = 0; az < 360; az += 15) {
      const x2 = CONFIG.CANVAS_CX + CONFIG.GRID_RADIUS * Math.sin(deg(az));
      const y2 = CONFIG.CANVAS_CY - CONFIG.GRID_RADIUS * Math.cos(deg(az));
      markup += `<line x1="${CONFIG.CANVAS_CX}" y1="${CONFIG.CANVAS_CY}" x2="${x2}" y2="${y2}" stroke="${CONFIG.GRID_COLOR}" stroke-width="${CONFIG.GRID_LINE_WIDTH}" />`;
    }
    for (let alt = 10; alt < 90; alt += 10) {
      const r = (projType === 'polar')
        ? CONFIG.GRID_RADIUS * ((90 - alt) / 90)
        : CONFIG.GRID_RADIUS * Math.sin(deg(90 - alt));
      markup += `<circle cx="${CONFIG.CANVAS_CX}" cy="${CONFIG.CANVAS_CY}" r="${r}" fill="none" stroke="${CONFIG.GRID_COLOR}" stroke-width="${CONFIG.GRID_LINE_WIDTH}" />`;
    }
  }

  markup += `<circle cx="${CONFIG.CANVAS_CX}" cy="${CONFIG.CANVAS_CY}" r="${CONFIG.GRID_RADIUS}" fill="none" stroke="${CONFIG.GRID_COLOR}" stroke-width="${CONFIG.GRID_LINE_WIDTH}" />`;
  elements.gridLayer.innerHTML = markup;
}

function drawAnalemmas() {
  const projType = elements.projInput.value;
  const lon = parseFloat(elements.lonInput.value);

  setValueTextAndPosition('step', 'stepVal', formatDays(state.globalPointStep));

  if (state.solarCache.length === 0) {
    elements.curvesPath.setAttribute('d', '');
    elements.sunsLayer.innerHTML = '';
    return;
  }

  let combinedD = '';
  const sunsPaths = [];

  for (let c = 0; c < state.solarCache.length; c++) {
    const dayPoints = state.solarCache[c];
    const subCurves = [];
    let currentSubCurve = [];

    for (let i = 0; i < dayPoints.length; i++) {
      const solarData = dayPoints[i];
      const H = ((solarData.gst + (lon + state.visualRotationOffset) - solarData.ra + 540) % 360) - 180;
      const pos = HDecToHorizontal(H, solarData.dec, state.globalLatRad);

      if (pos.altitude > -90) {
        const pt = project(pos.azimuth, pos.altitude, projType);

        if (pos.altitude > 0) {
          currentSubCurve.push(pt);
        } else {
          if (currentSubCurve.length > 0) {
            subCurves.push(currentSubCurve);
            currentSubCurve = [];
          }
        }

        if (pos.altitude > 0 && i % state.globalPointStep === 0) {
          // sunsPaths.push(`M ${(pt.x - CONFIG.SUN_OFFSET).toFixed(1)} ${(pt.y - CONFIG.SUN_OFFSET).toFixed(1)} h ${CONFIG.SUN_SIZE} v ${CONFIG.SUN_SIZE} h -${CONFIG.SUN_SIZE} z`);
          sunsPaths.push(`M ${(pt.x - CONFIG.SUN_R).toFixed(1)} ${pt.y.toFixed(1)} ` +`a ${CONFIG.SUN_R} ${CONFIG.SUN_R} 0 1 0 ${CONFIG.SUN_SIZE} 0 ` + `a ${CONFIG.SUN_R} ${CONFIG.SUN_R} 0 1 0 -${CONFIG.SUN_SIZE} 0 z`
          );
        }
      }
    }
    if (currentSubCurve.length > 0) subCurves.push(currentSubCurve);

    for (const curve of subCurves) {
      if (curve.length > 1) {
        combinedD += `M ${curve[0].x.toFixed(1)} ${curve[0].y.toFixed(1)} `;
        for (let i = 1; i < curve.length - 1; i++) {
          const xc = (curve[i].x + curve[i + 1].x) / 2;
          const yc = (curve[i].y + curve[i + 1].y) / 2;
          combinedD += `Q ${curve[i].x.toFixed(1)} ${curve[i].y.toFixed(1)} ${xc.toFixed(1)} ${yc.toFixed(1)} `;
        }
        const last = curve.length - 1;
        combinedD += `Q ${curve[last - 1].x.toFixed(1)} ${curve[last - 1].y.toFixed(1)} ${curve[last].x.toFixed(1)} ${curve[last].y.toFixed(1)} `;
      }
    }
  }

  elements.curvesPath.setAttribute('d', combinedD);
  elements.sunsLayer.innerHTML = sunsPaths.length ? `<path d="${sunsPaths.join(' ')}" fill="${CONFIG.SUN_COLOR}" />` : '';
}

function scheduleRedraw() {
  if (!state.isDrawing) {
    state.isDrawing = true;
    requestAnimationFrame(() => {
      drawAnalemmas();
      state.isDrawing = false;
      if (state.needsRedraw) {
        state.needsRedraw = false;
        scheduleRedraw();
      }
    });
  } else {
    state.needsRedraw = true;
  }
}

// --- 7. Event Listeners ---
function bindEvents() {
  // Date Picker Openers & Changes
  [elements.startDate, elements.endDate].forEach(input => {
    input.addEventListener('click', () => {
      if (input.showPicker) input.showPicker();
    });
  });

  elements.startDate.addEventListener('change', (e) => {
    const startVal = e.target.value;
    if (!startVal) return;

    let endVal = elements.endDate.value;
    if (!endVal || endVal < startVal) endVal = startVal;

    const maxEnd = addOneYear(startVal);
    if (endVal > maxEnd) endVal = maxEnd;

    elements.endDate.value = endVal;
    elements.startDisplay.textContent = formatDateToDDMMYYYY(startVal);
    elements.endDisplay.textContent = formatDateToDDMMYYYY(endVal);

    state.globalPointStep = stepToRealValue(parseFloat(elements.stepInput.value));
    updateSolarCache();
    scheduleRedraw();
  });

  elements.endDate.addEventListener('change', (e) => {
    const endVal = e.target.value;
    if (!endVal) return;

    let startVal = elements.startDate.value;
    if (!startVal || startVal > endVal) startVal = endVal;

    const minStart = subtractOneYear(endVal);
    if (startVal < minStart) startVal = minStart;

    elements.startDate.value = startVal;
    elements.startDisplay.textContent = formatDateToDDMMYYYY(startVal);
    elements.endDisplay.textContent = formatDateToDDMMYYYY(endVal);

    state.globalPointStep = stepToRealValue(parseFloat(elements.stepInput.value));
    updateSolarCache();
    scheduleRedraw();
  });

  // Projection Button Toggle
  elements.projBtn.addEventListener('click', () => {
    if (elements.projInput.value === 'polar') {
      elements.projInput.value = 'ortho';
      elements.projDisplay.textContent = 'ОРТОГОНАЛЬНАЯ СЕТКА';
    } else if (elements.projInput.value === 'ortho') {
      elements.projInput.value = 'equatorial';
      elements.projDisplay.textContent = 'ЭКВАТОРИАЛЬНАЯ СЕТКА';
    } else {
      elements.projInput.value = 'polar';
      elements.projDisplay.textContent = 'ПОЛЯРНАЯ СЕТКА';
    }

    drawGrid();
    scheduleRedraw();
  });

  // Range Sliders Input Handling
const rangeInputs = document.querySelectorAll('input[type="range"]');
  rangeInputs.forEach(input => {
    input.addEventListener('input', (e) => {
      const target = e.target;
      updateSliderTextPosition(target.id, SLIDER_MAP[target.id]);
      
      if (target.id === 'lat') {
        const valNum = parseFloat(target.value);
        setValueTextAndPosition('lat', 'latVal', valNum.toFixed(2));
        state.globalLatRad = deg(valNum);
        if (elements.projInput.value === 'equatorial') {
          drawGrid();
        }
      } else if (target.id === 'lon') {
        const valNum = parseFloat(target.value);
        setValueTextAndPosition('lon', 'lonVal', valNum.toFixed(2));
        state.visualRotationOffset = valNum - state.lastStableLon;
      } else if (target.id === 'step') {
        state.globalPointStep = stepToRealValue(parseFloat(target.value));
        setValueTextAndPosition('step', 'stepVal', formatDays(state.globalPointStep));
      }
      
      if (target.id === 'intervalInput' || target.id === 'lon') {
        updateSolarCache();
      }
      scheduleRedraw();
    });
  });

  // Longitude Change Animation
  elements.lonInput.addEventListener('change', () => {
    if (state.animeFrameId) cancelAnimationFrame(state.animeFrameId);

    const startOffset = state.visualRotationOffset;
    const startTime = performance.now();
    const duration = 800;

    function animate(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 4);

      state.visualRotationOffset = startOffset * (1 - ease);
      scheduleRedraw();

      if (progress < 1) {
        state.animeFrameId = requestAnimationFrame(animate);
      } else {
        state.visualRotationOffset = 0;
        state.lastStableLon = parseFloat(elements.lonInput.value);
        updateSolarCache();
        scheduleRedraw();
      }
    }
    state.animeFrameId = requestAnimationFrame(animate);
  });

  // Window Resize handling
  window.addEventListener('resize', updateAllSliderValuePositions);

  // Keybindings (Export SVG on 'S' key)
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 's' || key === 'ы') {
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(elements.svgCanvas);
      if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = 'analemma.svg';
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }
  });
}

// --- 8. Initialization & Asset Loading ---
function initAll() {
  const initialStep = 1;
  elements.stepInput.value = stepToNormalized(initialStep);
  state.globalPointStep = initialStep;
  
  const initialIntervalRaw = 10;
  elements.intervalInput.value = intervalToNormalized(initialIntervalRaw);
  const initialInterval = nearestIntervalCache.get(initialIntervalRaw);
  updateIntervalLabel(initialInterval);

  const initialLat = parseFloat(elements.latInput.value);
  const initialLon = parseFloat(elements.lonInput.value);

  setValueTextAndPosition('lat', 'latVal', initialLat.toFixed(2));
  setValueTextAndPosition('lon', 'lonVal', initialLon.toFixed(2));
  setValueTextAndPosition('step', 'stepVal', formatDays(initialStep));

  const startDate = elements.startDate.value;
  elements.startDisplay.textContent = startDate ? formatDateToDDMMYYYY(startDate) : 'НАЧАЛО';
  const endDate = elements.endDate.value;
  elements.endDisplay.textContent = endDate ? formatDateToDDMMYYYY(endDate) : 'КОНЕЦ';

  for (const [inputId, textId] of Object.entries(SLIDER_MAP)) {
    updateSliderTextPosition(inputId, textId);
  }

  state.globalLatRad = deg(parseFloat(elements.latInput.value));
  state.lastStableLon = parseFloat(elements.lonInput.value);
  state.visualRotationOffset = 0;

  bindEvents();
  updateSolarCache();
  drawGrid();
  drawAnalemmas();
}

async function revealPage() {
  initAll();

  const images = Array.from(document.querySelectorAll('img'));
  const imagePromises = images.map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  });

  await Promise.all(imagePromises);
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }
  updateAllSliderValuePositions();
  document.body.classList.add('loaded');
}

if (document.readyState === 'complete') {
  revealPage();
} else {
  window.addEventListener('load', revealPage);
}