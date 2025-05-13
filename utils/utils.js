export const fetchJson = async (url, params = {}, noWarnings = false) => {
    let res;
    try {
        res = await fetch(url, params);
        if (res.status !== 200) {
            if (noWarnings) return;
            console.log('res error');
            console.log(await res.text());
            throw res;
        }
        return res.json();
    } catch (e) {
        if (noWarnings) return;
        console.log('fetchJson error', JSON.stringify(e));
    }
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const sleepThen = async (dur, fn) => {
    await sleep(dur);
    return fn();
};
