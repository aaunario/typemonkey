// filepath: worker.js
const CACHE_MAX = 5000;

let wordCache = [];
let used = [];
const remoteLoadWorker = new Worker('remote-load-worker.js');
let fetchSize = 0;

// Handle messages from main thread for localStorage operations
self.onmessage = (e) => {
    const { action, param } = e.data;
    
    switch(action) {
        case 'localWords':
            // Main thread returned cached words from localStorage
            wordCache = wordCache.concat(param.slice(0, CACHE_MAX - wordCache.length));
            const numRemoteToFetch = Math.max(fetchSize - wordCache.length, 0);
            console.log(`LoadWorker: fetched ${param.length} local storage words -- remaining = ${numRemoteToFetch}`);
            getRemoteWords(numRemoteToFetch);
            break;
        case 'stored':
            // Words were stored to localStorage
            console.log('LoadWorker: words stored to localStorage');
            break;
        case 'fetch':
            // Initial fetch request from main thread
            // fetchSize = e.data.count || e.data;
            fetchSize = param
            const neededFromLocal = Math.max(fetchSize - wordCache.length, 0);
            
            if (neededFromLocal > 0) {
                // Request cached words from main thread (which has access to localStorage)
                self.postMessage({ event: 'getCachedWords', result: neededFromLocal });
            } else {
                pickAndPost();
            }
    }
}

remoteLoadWorker.onmessage = (e) => {
    // Save remote words to local cache
    const numWords = Math.max(CACHE_MAX - wordCache.length, 0);
    const result = normalize(e.data).slice(0, numWords);
    console.log(`LoadWorker::remoteLoadWorker.onmessage() = ${result.length}`);
    
    // Add to wordCache and store to localStorage via main thread
    wordCache = wordCache.concat(result);
    
    if (wordCache.length >= fetchSize) pickAndPost();

    // Request main thread to store the new words
    self.postMessage({ event: 'storeWords', result });
};

const getRemoteWords = (count) => {
    console.log('LoadWorker: getting remote words, count = {}', count);
    if (count <= 0) return pickAndPost();
    remoteLoadWorker.postMessage(count);
}

function normalize(list, hardMode) {
    const lenRe = hardMode ? /^[a-z]{6,12}$/ : /^[a-z]{2,15}$/;
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const w = String(raw).trim().toLowerCase();
        if (!lenRe.test(w) || w === "don't") continue;
        if (seen.has(w)) continue;   // O(1) dedupe (was O(n²) via indexOf)
        seen.add(w);
        out.push(w);
    }
    // Fisher-Yates shuffle (unbiased, O(n))
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

const pickAndPost = () => {
    const result = [];
    const event = 'onFetch';
    
    while (result.length < fetchSize && wordCache.length > 0) {
        // Pick random words from cache
        const idx = Math.floor(Math.random() * wordCache.length);
        result.push(wordCache[idx]);
        wordCache.splice(idx, 1); // Remove to avoid duplicates
    }
    fetchSize = 0;
    console.log(`LoadWorker: picked ${result.length} words`);
    self.postMessage({event, result});
}