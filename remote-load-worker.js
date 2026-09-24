
self.onmessage = async (e) => {
    const numToFetch = e.data;
    console.log(`RemoteLoadWorker: fetching ${numToFetch}`);
    let result = await fetchRemote(numToFetch);
    self.postMessage(result);
}

const endpoint = 'https://api.datamuse.com/words'
const fetchParamsObj = {
    

}

const fetchRemote = async (count) => {
    try {
        const ctrl = new AbortController();
        const tmo = setTimeout(() => ctrl.abort(), 15000); // big file, allow time
/*         const searchParams = new URLSearchParams();

        const url = new URL(endpoint);
        url.searchParams = searchParams;
        const res = await fetch(
            url,
            { signal: ctrl.signal }
        );
 */
        const res = await fetch(
            'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt',
            { signal: ctrl.signal }
        );
        
         clearTimeout(tmo);
        if (!res.ok) throw new Error(res.status);
        const text = await res.text();
        const result = text.split(/\r?\n/).filter(Boolean);
        console.log(`RemoteLoadWorker: num words fetched = ${result.length}`);
        return result;
    } catch(e) {
        console.log('RemoteLoadWorkder: error = {}', e);
        return [];
        // keep the fallback that was seeded above
        // statusEl.textContent = `using bundled list (${wordPool.length} words)`;
    }
}