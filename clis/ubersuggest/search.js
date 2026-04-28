/**
 * Ubersuggest Keyword Search — extract keyword data from Ubersuggest.
 * 
 * Queries a keyword and extracts:
 *   - Summary: Volume, SEO Difficulty, Paid Difficulty, Backlinks
 *   - SERP: Top 10 competitors  
 *   - Keyword Ideas: Autocomplete / Questions / Prepositions / Comparisons
 * 
 * Usage: opencli ubersuggest search "image to 3d model" --loc US
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

var LOCATIONS = {
    'US': 2840, 'GB': 2826, 'CA': 2838, 'AU': 2895,
    'IN': 2800, 'DE': 2886, 'FR': 2876, 'JP': 2921,
};

function getLocCode(loc) {
    if (!loc) return 2840;
    if (/^\d+$/.test(loc)) return Number(loc);
    return LOCATIONS[loc.toUpperCase()] || 2840;
}

function parseIdeasTable(text, sectionName) {
    var lines = text.split('\n');
    var ideas = [];
    var inSection = false;
    
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.toLowerCase().indexOf(sectionName.toLowerCase()) !== -1) { inSection = true; continue; }
        if (inSection && /^(Questions|Prepositions|Comparisons|Autocomplete|##)/i.test(line) && line.indexOf(sectionName) === -1) break;
        if (inSection && line.startsWith('-')) {
            var keyword = line.replace(/^-+\s*/, '').trim();
            i++; var volLine = i < lines.length ? lines[i].trim() : '';
            i++; var diffLine = i < lines.length ? lines[i].trim() : '';
            var vol = /^\d+$/.test(volLine) ? Number(volLine) : null;
            var diff = /^-?\d+$/.test(diffLine) || /^[a-z]+$/i.test(diffLine) ? diffLine : null;
            if (keyword && keyword.length > 1) ideas.push({ keyword: keyword, vol: vol, sd: diff });
        }
    }
    return ideas;
}

/** Run a simple expression in browser context */
async function evalExpr(page, expr) {
    return page.evaluate(expr);
}

cli({
    site: 'ubersuggest',
    name: 'search',
    description: 'Search Ubersuggest for keyword data: volume, difficulty, backlinks, ideas & competitors',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'query', required: true, positional: true, help: 'Keyword to search' },
        { name: 'loc', default: 'US', help: 'Location code (US/GB/CA/AU or numeric)' },
    ],
    columns: ['metric', 'value', 'details'],
    func: async function(page, args) {
        var query = args.query;
        
        // Step 1: Navigate to Ubersuggest main page
        await page.goto('https://app.neilpatel.com/en-us/app/ubersuggest/keywords/test/0/us');
        
        // Step 2: Wait for full SPA render (body content + nav bar with avatar)
        var waited = 0;
        while (waited < 20) {
            await new Promise(function(r) { setTimeout(r, 2000); });
            waited += 2;
            
            var ready = await evalExpr(page, `(function(){
                return JSON.stringify({
                    bodyLen: document.body.innerText.length,
                    hasNav: !!document.querySelector('button[data-testid="nav-avatar-button"]')
                });
            })()`);
            var state = JSON.parse(ready);
            
            if (state.bodyLen > 2000 && state.hasNav) break;
        }
        
        // Step 3: Check login — real avatars have Google CDN /a/ path or gravatar
        var isLoggedIn = await evalExpr(page, `(function(){
            var b = document.querySelector('button[data-testid="nav-avatar-button"]');
            if (!b) return false;
            var img = b.querySelector("img[alt*='avatar']");
            if (!img || !img.src) return false;
            // Real avatars: lh3.googleusercontent.com/a/... or gravatar.com
            return img.src.indexOf('/a/') !== -1 || img.src.indexOf('gravatar') !== -1;
        })()`);
        
        if (!isLoggedIn) {
            throw new CliError('AUTH_REQUIRED',
                'Not logged into Ubersuggest. Run: opencli ubersuggest login',
                'Session expired');
        }
        
        // Step 3.5: Set language to English and location to US (Global data)
        // Default is IP-based (e.g., Japanese/Japan), must override for global results
        await evalExpr(page, `(function(){
            var langInput = document.getElementById('Language');
            var locInput = document.getElementById('Location');
            
            var changes = {};
            
            if (langInput && langInput.value !== 'English') {
                var ls = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                ls.call(langInput, 'English');
                langInput.dispatchEvent(new Event('input', {bubbles:true}));
                langInput.dispatchEvent(new Event('change', {bubbles:true}));
                changes.language = langInput.value;
            }
            
            if (locInput && locInput.value !== 'United States') {
                var ls2 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                ls2.call(locInput, 'United States');
                locInput.dispatchEvent(new Event('input', {bubbles:true}));
                locInput.dispatchEvent(new Event('change', {bubbles:true}));
                changes.location = locInput.value;
            }
            
            return JSON.stringify(changes);
        })()`);
        
        // Brief wait for location change to take effect
        await new Promise(function(r) { setTimeout(r, 1000); });
        
        // Step 4: Type keyword into search box (React-compatible input)
        var safeQuery = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
        var typeResult = await evalExpr(page, `(function(){
            var input = document.getElementById('search-bar-keyword');
            if (!input) return JSON.stringify({ok:false, reason:'no input'});
            var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(input, '${safeQuery}');
            input.dispatchEvent(new Event('input', {bubbles:true}));
            input.dispatchEvent(new Event('change', {bubbles:true}));
            return JSON.stringify({ok:true});
        })()`);
        
        if (!JSON.parse(typeResult).ok) {
            throw new CliError('NAV_ERROR', 
                'Cannot find search input box on Ubersuggest page',
                'Page layout may have changed');
        }
        
        // Submit via Enter key event
        await evalExpr(page, `(function(){
            var input = document.getElementById('search-bar-keyword');
            if (input) {
                input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', keyCode:13, bubbles:true}));
                input.dispatchEvent(new KeyboardEvent('keypress', {key:'Enter', keyCode:13, bubbles:true}));
                input.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', keyCode:13, bubbles:true}));
            }
        })()`);
        
        // Step 5: Wait for results to load
        var resultWaited = 0;
        while (resultWaited < 25) {
            await new Promise(function(r) { setTimeout(r, 2000); });
            resultWaited += 2;
            
            var loaded = await evalExpr(page, `(function(){
                var t = document.body.innerText || "";
                return JSON.stringify({
                    hasVolume: t.indexOf('Keyword Search Volume') > -1,
                    hasIdeas: t.indexOf('Keyword Ideas') > -1,
                    bodyLen: t.length
                });
            })()`);
            loaded = JSON.parse(loaded);
            
            if ((loaded.hasVolume || loaded.hasIdeas) && loaded.bodyLen > 1000) break;
        }
        
        // Step 6: Extract all data
        var raw = await evalExpr(page, `(function(){
            var t = document.body.innerText || "";
            
            var volumeMatch = t.match(/Keyword Search Volume[\\s\\S]*?(\\d[\\d,]*)/i)
                || t.match(/Volume[\\s\\S]*?(\\d[\\d,]*)/i);
            var sdMatch = t.match(/SEO Difficulty[\\s\\S]*?(\\d+)/i);
            var pdMatch = t.match(/Paid Difficulty[\\s\\S]*?(\\d+)/i);
            var blMatch = t.match(/Backlinks[\\s\\S]*?([\\d.]+[KkMm]?)/i);
            var quotaMatch = t.match(/(\\d+) out of (\\d+) free/i);
            
            var serpItems = [];
            var serpSection = t.indexOf("Google Search Results");
            if (serpSection > -1) {
                var serpText = t.substring(serpSection);
                var serpLines = serpText.split("\\n");
                for (var i = 0; i < serpLines.length; i++) {
                    var dm = serpLines[i].trim().match(/^\\d+\\.\\s+(.+)$/);
                    if (dm) { serpItems.push(dm[1]); }
                    if (serpItems.length >= 10) break;
                }
            }
            
            var ideasStart = t.indexOf("Keyword Ideas");
            var ideasEnd = t.indexOf("## AI Prompt Ideas");
            var ideasText = ideasStart > -1 
                ? t.substring(ideasStart, ideasEnd > -1 ? ideasEnd : ideasStart + 3000) 
                : "";
            
            return JSON.stringify({
                volume: volumeMatch ? volumeMatch[1] : null,
                sd: sdMatch ? Number(sdMatch[1]) : null,
                pd: pdMatch ? Number(pdMatch[1]) : null,
                backlinks: blMatch ? blMatch[1] : null,
                quota: quotaMatch ? quotaMatch[0] : null,
                serpCount: serpItems.length,
                serp: serpItems,
                hasIdeas: ideasStart > -1,
                ideasText: ideasText.substring(0, 2500),
                _bodyLen: t.length
            });
        })()`);
        raw = JSON.parse(raw);
        
        // Build output rows
        var rows = [];
        rows.push({ metric: '\u{1F4CA} Summary', value: query, details: '' });
        rows.push({ metric: '  Volume', value: raw.volume || 'N/A', details: 'monthly searches' });
        rows.push({ metric: '  SEO Difficulty', value: raw.sd != null ? raw.sd + '%' : 'N/A', details: '' });
        if (raw.pd != null) rows.push({ metric: '  Paid Difficulty', value: raw.pd + '%', details: '' });
        if (raw.backlinks) rows.push({ metric: '  Backlinks', value: raw.backlinks, details: 'top pages' });
        if (raw.quota) rows.push({ metric: '  Quota', value: raw.quota, details: '' });
        
        if (raw.serp.length > 0) {
            rows.push({ metric: '', value: '', details: '' });
            rows.push({ metric: '\u{1F50D} Top Competitors', value: String(raw.serp.length), details: '' });
            raw.serp.forEach(function(d, i) { rows.push({ metric: '  ' + (i+1), value: d, details: '' }); });
        }
        
        if (raw.hasIdeas && raw.ideasText) {
            var sections = [
                { name: 'Autocomplete', label: '\u{1F4A1} Autocomplete' },
                { name: 'Questions', label: '\u{2753} Questions' },
                { name: 'Prepositions', label: '\u{1F517} Prepositions' },
                { name: 'Comparisons', label: '\u{2696} Comparisons' },
            ];
            sections.forEach(function(sec) {
                var ideas = parseIdeasTable(raw.ideasText, sec.name);
                if (ideas.length > 0) {
                    rows.push({ metric: '', value: '', details: '' });
                    rows.push({ metric: sec.label, value: String(ideas.length), details: '' });
                    ideas.slice(0, 8).forEach(function(idea, i) {
                        var detail = idea.vol != null ? 'Vol=' + idea.vol : (idea.sd || '');
                        rows.push({ metric: '  ' + (i+1), value: idea.keyword, details: detail });
                    });
                }
            });
        }
        
        // Validate — at least some data must exist
        var hasData = raw.volume || raw.sd || raw.serp.length > 0 || raw.hasIdeas;
        if (!hasData) {
            throw new CliError('EMPTY_RESULT',
                'No keyword data extracted (waited ' + resultWaited + 's, bodyLen: ' + raw._bodyLen + ')',
                'Page may not have loaded correctly or keyword returned no results');
        }
        
        rows._raw = raw;
        return rows;
    },
});
