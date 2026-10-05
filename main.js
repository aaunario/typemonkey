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

async function storeSettings() {
    const settings = { 
        ...JSON.parse(localStorage.getItem('tm_settings') || '{}'), 
        font_size: currentFont(),
        window_width: window.innerWidth,
        window_height: window.innerHeight,
        position: (await appWindow.outerPosition()).toJSON()
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
    disableCursorAnim()
    loadWordList();
}

const onWordsLoaded = () => {
    statusEl.textContent = `loaded ${words.length} hard words`;    
    elTotal.textContent = words.length;
    [elViewport, elWords].map(el => el.classList).forEach(cl => {
        cl.remove('loading', 'empty');
        cl.add('word-mode');
    })
    
    resetTest();
    render();
    updateScrollPad();
}

const resetTest = () => {
    const modal = document.querySelector('[data-modal]');
    if (modal) modal.remove();
    
    statuses = words.map(w => new Array(w.length).fill('untyped'));
    cursor = { w: 0, c: 0 };
    running = false;
    finished = false;
    startTime = null;
    correctKeystrokes = 0;
    totalKeystrokes = 0;
    resetScroll();
}

const resetScroll = () => {
    elViewport.scrollTop = 0;
    _anchorPrevY = null;   // re-establish baseline on the next render
}

// Keep the scroll buffer in sync with the viewport's current height
const updateScrollPad = () => {
    const h = elViewport.getBoundingClientRect().height;
    elScrollPad.style.height = `${h}px`;
    elScrollPad.style.top = elWords.style.bottom;
}

// ------------------------------------------------------------------
const isPreviousWordAccessible = () => !!cursor.w && !isWordComplete(cursor.w - 1);
const isWordComplete = (w) => statuses?.[w]?.every(status => status === 'correct');
const isLastChar = (w, c) => (wordEnd(w) === c); 
const wordEnd = (w) => Math.abs((Number(words?.[w]?.length || 0) - 1));
const isLastWord = w => words.length - 1 <= w; 
function flattenedLength() { let n = 0; for (const s of statuses) n += s.length; return n; }
const allWordsComplete = () => isLastWord(cursor.w) && isLastChar(cursor.w, cursor.c)

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
    disableCursorAnim()
    elWords.innerHTML = html;
    
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

    resetTest();
    render();
}

const isTestComplete = () => (
    isLastWord(cursor.w) 
    && isLastChar(cursor.w, cursor.c)
    && cursorStatus() !== 'untyped'
)

const updateStatus = (w, c, status) => { statuses[w][c] = status; }
const updateCursorStatus = status => {
    const {w, c} = cursor;  
    updateStatus(w, c, status);
    render()
}
const cursorToWordStart = () => {
    cursor.c = 0;
}
const cursorToWordEnd = () => { 
    cursor.c = wordEnd(cursor.w);
}

// Called only on Backspace or Space key press
const cursorToAdjacentWord = (advance) => {
    disableCursorAnim();
    const { w: word } = cursor;

    if (advance && isLastWord(word)) // Finish session if on last word moving to the next 
        return finish();
    else if (!advance && !isPreviousWordAccessible()) // Disable move to previous word if not allowed
        return;

    const increment = Number(advance) - Number(!advance);
    cursor.w += increment;

    if (advance) {
        cursorToWordStart();
    } else
        cursorToWordEnd();
    render();
}

// This is called only by Backspace and non-space key presses
const cursorToAdjacentChar = (advance) => {
    const { w: word, c: char } = cursor;

    // Exit early on special cases (end of test, end of word, etc.)
    if (advance) {
        animToCursor();  // Animate only char-advance event 
        if (isLastChar(word, char)) {
            return isLastWord(word)
                ? finish()
                : null; 
        }
    } else if (!char) 
        return cursorToAdjacentWord(advance );
    
    cursor.c += Number(advance) - Number(!advance);
    !advance && setRemainingStatuses('untyped'); // Clear previously-typed char status on Backspace press 
    render();
}

const disableCursorAnim = () => { animTarget = null; };
const animToCursor = () => { animTarget = Object.assign(animTarget || {}, cursor); } 
const cursorStatus = () => statuses?.[cursor.w]?.[cursor.c]

const setRemainingStatuses = status => {
    statuses?.[cursor.w]?.forEach((_, idx) => {
        (cursor.c <= idx) && updateStatus(cursor.w, idx, status);
    });
}

function handleKey(e) {
    if (e.repeat) return; // ignore auto-repeat (holding a key)
    if (e.key === 'Tab') { e.preventDefault(); newTest(); return; }
    if (e.key === 'Escape') {
        restartSame();
        e.preventDefault();
        return;
    }
    if (finished || words.length === 0) return;

    if (!running && !/^(Shift|Control|Alt|Meta)$/.test(e.key)) start();
    
    const { w: word, c: char } = cursor;

    // Move cursor back to previous char/word
    if (e.key === 'Backspace') {
        e.preventDefault();
        if (!running) { newTest(); return; }

        cursorToAdjacentChar(false);
        return;
    }

    if (!running || finished) return;

    // Move cursor forward to next word
    if (e.code === 'Space') {
        e.preventDefault();
        totalKeystrokes++;
        const isCorrect = isLastChar(word, char) && cursorStatus() === 'correct'

        if (isCorrect)
            correctKeystrokes++;
        else {
            disableCursorAnim();
            setRemainingStatuses('incorrect');
        }

        cursorToAdjacentWord(true);        
        return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        totalKeystrokes++;
        const expected = words[word][char];
        const isCharCorrect = (e.key === expected);
        updateCursorStatus(isCharCorrect 
            ? 'correct'
            : 'incorrect'
        );
        isCharCorrect && correctKeystrokes++;
        cursorToAdjacentChar(true);
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

    // Caret's position within the scrollable content (document-relative).
    // This is stable for a given caret position regardless of the current
    // scroll offset, so the delta below reflects only real line movement.
    const caretDocTop =
        caretEl.getBoundingClientRect().top -
        cont.getBoundingClientRect().top +
        cont.scrollTop;

    if (_anchorPrevY === null) {
        _anchorPrevY = caretDocTop;
        return;
    }

    const delta = caretDocTop - _anchorPrevY;
    _anchorPrevY = caretDocTop;

    // Same row (or sub-pixel noise) — nothing to scroll.
    if (Math.abs(delta) < 1) return;

    // Shift the scroll by exactly the caret's movement so the active line
    // stays pinned. Works for wrapping down and backspacing up a line.
    animateScrollTo(cont, cont.scrollTop + delta, 420);
}

// Manual rAF tween so we can control the scroll duration (CSS smooth is fixed by
// the browser). Re-triggering on rapid keystrokes just retargets from current pos.
let _scrollAnim = null;
function animateScrollTo(cont, targetY, dur) {
    if (_scrollAnim) { cancelAnimationFrame(_scrollAnim); }
    const startY = cont.scrollTop;
    const diff = targetY - startY;
    if (!diff) return;
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
// Window re-size/position handling: persist dimensions + physical/outer position (localStorage) + adjust scroll
let _settingsUpdateDebounce = null;
const debounceSettingsUpdate = () => {
    // Debounce the persistence (writes to localStorage via storeSettings)
    clearTimeout(_settingsUpdateDebounce);
    _settingsUpdateDebounce = setTimeout(storeSettings, 500);
}


function onWindowResize() {
    // Re-anchor the caret line so the active row stays pinned
    _anchorPrevY = null;
    updateScrollPad();
    if (words.length) render();
    debounceSettingsUpdate();
}

const appWindow = window.isTauri && window.__TAURI__.window?.getCurrentWindow();
appWindow?.onMoved(({payload: position}) => {
    debounceSettingsUpdate();
})

// Apply the saved window size/position to the Tauri window on boot
async function restoreSettings() {
    const { font_size, window_width, window_height, position } = JSON.parse(localStorage.getItem('tm_settings') || '{}');
    setFont(font_size);

    if (!appWindow) return;

    try {
        const { LogicalSize, PhysicalPosition } = window.__TAURI__.dpi;
        if (window_width && window_height) {
            await appWindow.setSize(new LogicalSize(window_width, window_height));
        }
        if (position) {
            await appWindow.setPosition(new PhysicalPosition(position));
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
    await restoreSettings();
    newTest();
})();