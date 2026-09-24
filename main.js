// Hard/obscure words, lowercase — offline fallback if network fetch fails.
const HARD_FALLBACK = [
"juxtapose","quintessence","idiosyncrasy","bureaucracy","entrepreneur","disenfranchise",
"onomatopoeia","meticulous","perspicacious","serendipity","ubiquitous","cacophony",
"dichotomy","ephemeral","exacerbate","grandiloquent","hyperbole","insouciant",
"kafkaesque","labyrinthine","mellifluous","nefarious","obfuscate","plethora",
"recalcitrant","sycophant","verisimilitude","whimsical","xenophobia","zealous",
"ambiguous","antediluvian","belligerent","capricious","circumlocution","conflagration",
"disingenuous","ebullient","effervescent","euphemism","facetious","fortuitous",
"gregarious","hegemony","incontrovertible","jejune","lugubrious","magnanimous",
"mendacious","obstreperous","pandemonium","paradigm","penultimate","perfidious",
"petulant","precocious","proclivity","quagmire","rancorous","recalcitrant",
"sanguine","scintillating","soliloquy","stultify","supercilious","taciturn",
"tendentious","ubiquity","unctuous","vacillate","vicissitude","vituperate",
"winsome","xanthic","yearling","zeitgeist","abstemious","bombastic","cogent",
"debilitate","egregious","fastidious","garrulous","histrionic","impecunious",
"laconic","maelstrom","neophyte","obsequious","pernicious","pusillanimous",
"quotidian","redolent","soporific","trenchant","ubiquitously","vapid","voracious"
];

// ------------------------------------------------------------------
// Config
const WORDS_PER_TEST = 50;

let wordPool = [];          // full lowercase pool fetched/bundled
let words = [];             // current test words
let statuses = [];          // per-word array of char statuses
let cursor = { w: 0, c: 0 };// position in flattened sequence

const elWords = document.getElementById('words');
const elWpm   = document.getElementById('wpm');
const elAcc   = document.getElementById('accuracy');
const elProg  = document.getElementById('progress');
const elTotal = document.getElementById('totalWords');
const elViewport = document.getElementById('viewport');
const elScrollPad = document.getElementById('scrollPad');
const statusEl = document.getElementById('sourceStatus');

let running = false;
let finished = false;
let startTime = null;
let correctKeystrokes = 0;
let totalKeystrokes = 0;

// The single most-recently-corrected letter, to animate a fresh wipe only on it.
let animTarget = null;

// Ensure the page can capture keystrokes regardless of focus state.
window.addEventListener('focus', () => document.body.focus());
if (document.hasFocus()) document.body.setAttribute('tabindex', '0');
const loadWorker = new Worker('worker.js');

loadWorker.onmessage = (e) => {
    const { event, result } = e.data;
    
    switch(event) {
        case 'getCachedWords':
            // Worker needs cached words from localStorage
            const cachedWords = fetchCachedWords(result);
            loadWorker.postMessage({ action: 'localWords', param: cachedWords });
            break;
        case 'storeWords':
            // Worker wants to store words to localStorage
            storeWordsToCache(result);
            loadWorker.postMessage({ action: 'stored' });
            break;
        case 'onFetch':
            // Word list received from worker
            words = result;
            console.log(`main: loadWorker fetched ${words.length}`);
            onWordsLoaded();
    }
}

// ------------------------------------------------------------------
// LocalStorage functions (must run on main thread)
function fetchCachedWords(count) {
    try {
        const cachedRaw = localStorage.getItem('tm_words');
        const cached = !!cachedRaw && JSON.parse(cachedRaw) || {};
        
        // Extract words from cache, filter by age (24 hours)
        const now = Date.now();
        return Object.entries(cached)
            .filter(([ts]) => (now - parseInt(ts)) < 86_400_000)
            .flatMap(([, w]) => Array.isArray(w) ? w : []);
            
    } catch (_) { return []; }
}

function loadSettings() {
    const { font_size } = JSON.parse(localStorage.getItem('tm_settings') || '{}');
    setFont(font_size || FONT_MIN);
}

function storeSettings() {
    const settings = { 
        ...JSON.parse(localStorage.getItem('tm_settings') || '{}'), 
        font_size: currentFont(),
        window_width: window.innerWidth,
        window_height: window.innerHeight
    };
    localStorage.setItem('tm_settings', JSON.stringify(settings));
}

function storeWordsToCache(words) {
    try {
        const now = Date.now();
        const isFresh = ts => now - parseInt(ts) >= 86_400_000;
        const cachedRaw = localStorage.getItem('tm_words');
        // Remove old cache
        const cached = Object.fromEntries(
            Object.entries(cachedRaw ? JSON.parse(cachedRaw) : {}).filter((ts, _) => isFresh(ts))
        );
        
        // Add new words with current timestamp
        const key = Date.now();
        cached[key] = words;
        
        localStorage.setItem('tm_words', JSON.stringify(cached));
        console.log(`main: stored ${words.length} words to cache`);
    } catch (_) { }
}


// ------------------------------------------------------------------
// Load word list (online first, bundled fallback)
function loadWordList() {
    elWords.textContent = 'Not enough words loaded yet — wait for the word list to load.';
    words.length = 0;
    const msgObj = { action: 'fetch', param: WORDS_PER_TEST};
    loadWorker.postMessage(msgObj);
}

function newTest() {
    animTarget = null;
    loadWordList();
}

const onWordsLoaded = () => {
    statuses = words.map(w => new Array(w.length).fill('untyped'));
    cursor = { w: 0, c: 0 };
    animToCursor();
    running = false;
    finished = false;
    startTime = null;
    correctKeystrokes = 0;
    totalKeystrokes = 0;
    
    statusEl.textContent = `loaded ${words.length} hard words`;

    resetScroll();   // start from the top on a new test
    elTotal.textContent = words.length;
    [elViewport, elWords].map(el => el.classList).forEach(cl => {
        cl.remove('loading', 'empty');
        cl.add('word-mode');
    })

    render();
}

function resetScroll() {
    elViewport.scrollTop = 0;
    _anchorPrevY = null;   // re-establish baseline on the next render
}

// Keep the scroll buffer in sync with the viewport's current height
function updateScrollPad() {
    const h = elViewport.getBoundingClientRect().height;
    elScrollPad.style.paddingTop = `${h}px`;
}

// ------------------------------------------------------------------
const isLastChar = (w, c) => (wordEnd(w) === c); 
const wordEnd = (w) => (statuses[w].length - 1)
function flattenedLength() { let n = 0; for (const s of statuses) n += s.length; return n; }
function allWordsComplete() { for (const s of statuses) if (!s.length || s.some(c => c !== 'correct')) return false; return true; }

function cursorIndex() {
    let n = 0;
    for (let i = 0; i < words.length; i++) {
        if (i === cursor.w) return n + cursor.c;
        n += statuses[i].length;
    }
    return flattenedLength();
}

// ------------------------------------------------------------------
function render() {
    let html = '';
    const anim = animTarget;
    for (let w = 0; w < words.length; w++) {
        html += `<span class="word" data-w="${w}">`;
        for (let c = 0; c < statuses[w].length; c++) {
            const cls = statuses[w][c];
            const isFresh = anim?.w === w && anim?.c === c;
            const isCursor = !finished && cursor.w === w && cursor.c === c;
            const classList = [
                "letter",
                (cls !== 'untyped') && cls,
                isFresh && 'just-typed',
                isCursor && 'cursor',
                isLastChar(w, c) && 'last-char',
                !c && 'first-char'
            ].filter(Boolean);
            html += `<span class="${classList.join(' ')}">${words[w][c]}</span>`;
        }
        html += '</span>';
    }
    animTarget = null;
    elWords.innerHTML = html;

    // Adjust scroll buffer height
    updateScrollPad();

    if (running && startTime) {
        const mins = ((Date.now() - startTime)) / 60000;
        const wpm = mins > 0 ? Math.round((correctKeystrokes / 5) / mins) : 0;
        elWpm.textContent = wpm;
    }
    const acc = totalKeystrokes > 0
        ? Math.round((correctKeystrokes / totalKeystrokes) * 100)
        : 100;
    elAcc.textContent = acc + '%';
    const doneWords = cursor.w;
    elProg.innerHTML = `${doneWords}<span id="totalWords">/${words.length}</span>`;

    anchorCaretLine();
}

function start() {
    running = true;
    finished = false;
    startTime = Date.now();
    render();
}

function finish() {
    running = false;
    finished = true;
    render();

    const mins = ((Date.now()) - startTime) / 60000 || Infinity;
    const grossWpm = mins > 0 ? Math.round((totalKeystrokes / 5) / mins) : 0;
    const netWpm   = mins > 0 ? Math.round((correctKeystrokes / 5) / mins) : 0;
    const acc = totalKeystrokes > 0
        ? Math.round((correctKeystrokes / totalKeystrokes) * 100)
        : 100;

    const tpl = document.getElementById('resultTemplate');
    const node = tpl.content.firstElementChild.cloneNode(true);
    const rs = node.querySelector('#resultStats');
    rs.innerHTML = `
        <div><div class="stat-value">${netWpm}</div><div class="stat-label">Net WPM</div></div>
        <div><div class="stat-value">${acc}%</div><div class="stat-label">Accuracy</div></div>
        <div><div class="stat-value">${grossWpm}</div><div class="stat-label">Gross WPM</div></div>`;
    node.querySelector('#results').addEventListener('click', () => {
        node.remove();
        newTest();
    });
    document.body.appendChild(node);
}

// ------------------------------------------------------------------
function restartSame() {
    if (words.length === 0) return;
    statuses = words.map(w => new Array(w.length).fill('untyped'));
    cursor = { w: 0, c: 0 };
    running = false; finished = false; startTime = null;
    correctKeystrokes = 0; totalKeystrokes = 0;
    resetScroll();
    render();
}

const updateStatus = (w, c, status) => { statuses[w][c] = status; }
const updateCursorStatus = status => {
    const {w, c} = cursor;  
    updateStatus(w, c, status);
}
const cursorToWordEnd = () => { cursor.c = wordEnd(cursor.w); }
const animToCursor = () => { animTarget = Object.assign(animTarget || {}, cursor); } 
const cursorStatus = () => statuses[cursor.w][cursor.c]
const invalidateRest = word => {
    statuses[word].forEach((_, idx) => {
        if (cursor.c <= idx) updateStatus(word, idx, 'incorrect');
    });
    cursorToWordEnd();
    animToCursor();
}

function handleKey(e) {
    if (e.repeat) return; // ignore auto-repeat (holding a key)
    if (e.key === 'Tab') { e.preventDefault(); newTest(); return; }
    if (e.key === 'Escape') {
        const modal = document.querySelector('[data-modal]');
        if (modal) modal.remove();
        restartSame();
        e.preventDefault();
        return;
    }
    if (finished || words.length === 0) return;

    if (!running && !/^(Shift|Control|Alt|Meta)$/.test(e.key)) start();
    
    const { w: word, c: char } = cursor;
    const isLastWord = cursor.w === words.length - 1;

    if (e.key === 'Backspace') {
        e.preventDefault();
        if (!running) { newTest(); return; }
        updateCursorStatus('untyped')
        if (!!char) {
            cursor.c--;
            updateCursorStatus('untyped');
        } 

        render();
        return;
    }

    if (!running || finished) return;

    if (e.code === 'Space') {
        e.preventDefault();
        totalKeystrokes++;

        if (isLastChar(word, char)) {
            correctKeystrokes++;
            if (!isLastWord) {
                cursor.w++;
                cursor.c = 0;
            } else if (allWordsComplete()) {
                finish();
                return;
            }
        } else {
            invalidateRest(word);
        }
        
       render();
       return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        totalKeystrokes++;
        const expected = words[word][char];
        const isCorrect = (e.key === expected);
        updateCursorStatus(isCorrect ? 'correct' : 'incorrect');
        isCorrect && correctKeystrokes++;
        animToCursor();
        if (!isLastChar(word, char)) {
            cursor.c++;
        } else if (isLastWord && isCorrect) {
            return finish();
        }
        
        render();
    }
}

// ------------------------------------------------------------------
// ---- adjustable font size ------------------------------------------
const FONT_MIN = 16, FONT_MAX = 40;
function setFont(px) {
    px = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(px)));
    document.documentElement.style.setProperty('--font-size', px + 'px');
    document.getElementById('fontLabel').textContent = px + 'px';
    storeSettings();
}
function currentFont() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--font-size');
    return parseFloat(v) || 26;
}
document.getElementById('fontPlusBtn').addEventListener('click', () => setFont(currentFont() + 2));
document.getElementById('fontMinusBtn').addEventListener('click', () => setFont(currentFont() - 2));

// ---- keep active line pinned so you don't shift your eyes ----------
let _anchorPrevY = null;

function anchorCaretLine() {
    if (!running || finished) return;
    const cont = elViewport;
    const caretEl = elWords.querySelector('.letter.cursor');
    if (!caretEl) return;

    const lineH = parseFloat(getComputedStyle(elWords).lineHeight);
    const relTop =
        caretEl.getBoundingClientRect().top +
        elWords.getBoundingClientRect().top -
        cont.getBoundingClientRect().top +
        cont.scrollTop;

    if (_anchorPrevY === null) {
        _anchorPrevY = relTop;
        return;
    }

    const deltaRows = (relTop - _anchorPrevY) / lineH;
    _anchorPrevY = relTop;

    if (deltaRows > 0) {
        const maxScroll = Math.max(0, cont.scrollHeight - cont.clientHeight);
        // const targetY = Math.min(Math.max(cont.scrollTop + deltaRows * lineH, 0), maxScroll);
        const targetY = cont.scrollTop + deltaRows * lineH;
        animateScrollTo(cont, targetY, 420);
    }
}

// Manual rAF tween so we can control the scroll duration (CSS smooth is fixed by
// the browser). Re-triggering on rapid keystrokes just retargets from current pos.
let _scrollAnim = null;
function animateScrollTo(cont, targetY, dur) {
    if (_scrollAnim) { cancelAnimationFrame(_scrollAnim); }
    const startY = cont.scrollTop;
    const diff = targetY - startY;
    const t0 = performance.now();
    (function step(now) {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        cont.scrollTop = Math.round(startY + diff * eased);
        if (p < 1 && cont.scrollTop !== targetY) {
            _scrollAnim = requestAnimationFrame(step);
        } else {
            cont.scrollTop = targetY;
        }
    })(performance.now());
}

document.getElementById('newTestBtn').addEventListener('click', newTest);
document.getElementById('restartBtn').addEventListener('click', restartSame);
window.addEventListener('keydown', handleKey);
document.body.setAttribute('tabindex', '0');
document.body.focus();

// ------------------------------------------------------------------
// Window resize handling: persist dimensions (localStorage) + adjust scroll
// const isTauri = typeof window.__TAURI__ !== 'undefined' && !!window.__TAURI__.core;

let _resizeDebounce = null;
function onWindowResize() {
    // Re-anchor the caret line so the active row stays pinned
    _anchorPrevY = null;
    updateScrollPad();
    if (words.length) render();

    // Debounce the persistence (writes to localStorage via storeSettings)
    clearTimeout(_resizeDebounce);
    _resizeDebounce = setTimeout(storeSettings, 500);
}

// Apply the saved window size to the Tauri window on boot
async function restoreWindowDimensions() {
    if (!window.isTauri) return;
    try {
        const { window_width, window_height } = JSON.parse(localStorage.getItem('tm_settings') || '{}');
        if (window_width && window_height) {
            const { getCurrentWindow } = window.__TAURI__.window;
            const { LogicalSize } = window.__TAURI__.dpi;
            const win = getCurrentWindow();
            // Saved from window.innerWidth/Height (logical px) → LogicalSize
            await win.setSize(new LogicalSize(window_width, window_height));
        }
    } catch (e) {
        console.warn('main: failed to restore window size', e);
    }
}

// Observe the viewport so scroll content adjusts on any size change
const resizeObserver = new ResizeObserver(() => onWindowResize());
resizeObserver.observe(elViewport);
resizeObserver.observe(document.body);

// Also catch window-level resizes (Tauri window drag-resize)
window.addEventListener('resize', onWindowResize);

// Boot
(async function init() {
    await restoreWindowDimensions();
    loadSettings();
    newTest();
})();