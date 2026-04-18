/**
 * Google Trends Keyword Search — browser-based adapter for SEO research.
 * 
 * Queries a keyword on Google Trends and extracts:
 *   - Interest over time summary (avg/max from chart labels)
 *   - Top & rising related queries (from <a href> links)
 *   - Top & rising related topics (from [title] attrs)
 *   - Subregion ranking
 * 
 * Usage: opencli google trends-search "ai character generator" --geo US --months 12
 * 
 * Strategy: UI (browser required, uses shared Chrome via CDP)
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

/** Simple dedup by query text */
function dedup(items) {
    const seen = new Set();
    return items.filter(item => {
        const key = item.query.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Decode URL-encoded query string */
function decodeQ(raw) {
    try {
        return decodeURIComponent(String(raw).replace(/\+/g, ' '));
    } catch { return raw; }
}

cli({
    site: 'google',
    name: 'trends-search',
    description: 'Search Google Trends for a keyword: interest over time, related queries & topics',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'query', required: true, positional: true, help: 'Keyword to search' },
        { name: 'geo', default: 'US', help: 'Region code (US, CN, GB, etc.)' },
        { name: 'months', type: 'int', default: 12, help: 'Time range in months (1-60)' },
    ],
    columns: ['metric', 'value', 'details'],
    func: async (page, args) => {
        const query = encodeURIComponent(args.query);
        const geo = args.geo || 'US';
        const months = Math.max(1, Math.min(Number(args.months) || 12, 60));
        
        const dateRange = `today ${months}-m`;
        const url = `https://trends.google.com/trends/explore?q=${query}&date=${encodeURIComponent(dateRange)}&geo=${geo}&hl=en`;
        
        await page.goto(url);
        await page.wait(8);
        
        const data = await page.evaluate(`
            (function() {
                var results = {
                    keyword: '${args.query}',
                    geo: '${geo}',
                    interestValues: [],
                    relatedQueries: { top: [], rising: [] },
                    relatedTopics: { top: [], rising: [] },
                    subregion: [],
                    _meta: {}
                };
                
                try {
                    results._meta.widgetCount = document.querySelectorAll('widget[type]').length;
                    
                    // --- Interest Over Time ---
                    var lineChart = document.querySelector('widget[type="fe_line_chart"]');
                    if (lineChart) {
                        results._meta.hasLineChart = true;
                        var svg = lineChart.querySelector('svg');
                        if (svg) {
                            results._meta.svgPaths = svg.querySelectorAll('path[d]').length;
                            var nums = (lineChart.innerText || '').match(/\\b\\d{1,3}\\b/g);
                            if (nums) results.interestValues = nums.map(Number).filter(function(n) { return n <= 100; });
                        }
                    }
                    
                    // --- Extract items from widget: queries have plain-text q=, topics have /m/ or /g/ prefix ---
                    function extractItems(widgetEl) {
                        var items = [];
                        // Get all <a> tags with explore hrefs inside this widget
                        var links = widgetEl.querySelectorAll('a[href*="/trends/explore?q="]');
                        var seenHrefs = {};
                        
                        links.forEach(function(a) {
                            var href = a.getAttribute('href') || '';
                            if (seenHrefs[href]) return; // dedup by href
                            seenHrefs[href] = true;
                            
                            var qMatch = href.match(/[?&]q=([^&]+)/);
                            if (!qMatch) return;
                            
                            var qRaw = qMatch[1];
                            var isTopic = /^\\/[mg]\\//.test(qRaw); // /m/XXXX or /g/XXXX = topic
                            
                            var text;
                            if (isTopic) {
                                // Topic: get display name from title attribute of parent container
                                var titledEl = a.closest('[title]') || a.parentElement;
                                text = (titledEl ? titledEl.getAttribute('title') : '') || '';
                                text = text.replace(/^Explore\\s+/, '').trim();
                            } else {
                                // Query: decode the URL-encoded keyword
                                try { text = decodeURIComponent(qRaw.replace(/\\+/g, ' ')); }
                                catch(e) { text = qRaw; }
                            }
                            
                            if (text && text.length > 0 && text.length < 300) {
                                items.push({ 
                                    query: text, 
                                    isTopic: isTopic,
                                    rank: items.length + 1 
                                });
                            }
                        });
                        
                        return items;
                    }
                    
                    // --- Process each fe_related_queries widget ---
                    var rqWidgets = document.querySelectorAll('widget[type="fe_related_queries"]');
                    var allQueryItems = [];
                    var allTopicItems = [];
                    
                    // Determine section type from select label (Top vs Rising)
                    rqWidgets.forEach(function(w, idx) {
                        var wText = w.innerText || '';
                        var selectLabel = '';
                        var sel = w.querySelector('md-select[aria-label*="Bullets"]');
                        if (sel) selectLabel = sel.getAttribute('aria-label') || '';
                        var isRising = selectLabel.toLowerCase().indexOf('rising') !== -1;
                        
                        // If no aria-label, use position heuristic: first=Rising often in GT layout
                        // Actually GT usually shows: Related Queries(Top), Related Queries(Rising), Related Topics(Top), Related Topics(Rising)
                        // So even indices = Top-ish, odd = Rising-ish... but let's trust the label
                        
                        var items = extractItems(w);
                        var queries = items.filter(function(i) { return !i.isTopic; });
                        var topics = items.filter(function(i) { return i.isTopic; });
                        
                        if (isRising) {
                            results.relatedQueries.rising = results.relatedQueries.rising.concat(queries);
                            results.relatedTopics.rising = results.relatedTopics.rising.concat(topics);
                        } else {
                            results.relatedQueries.top = results.relatedQueries.top.concat(queries);
                            results.relatedTopics.top = results.relatedTopics.top.concat(topics);
                        }
                    });
                    
                    // --- Subregion ---
                    var geoWidget = document.querySelector('widget[type="fe_geo_chart"]');
                    if (geoWidget) {
                        geoWidget.querySelectorAll('a[href*="geo="], tr').forEach(function(el) {
                            var t = (el.innerText || el.getAttribute('title') || '').trim();
                            if (t.length > 2 && t.length < 150 && !/^\\d+$/.test(t)) {
                                results.subregion.push(t);
                            }
                        });
                    }
                    
                } catch(e) {
                    results._error = e.message;
                }
                
                return results;
            })()
        `);
        
        // Post-process: dedup on our side too
        data.relatedQueries.top = dedup(data.relatedQueries.top || []);
        data.relatedQueries.rising = dedup(data.relatedQueries.rising || []);
        data.relatedTopics.top = dedup(data.relatedTopics.top || []);
        data.relatedTopics.rising = dedup(data.relatedTopics.rising || []);
        
        // Validate
        const hasData = (data.relatedQueries.top.length > 0) 
                     || (data.relatedQueries.rising.length > 0)
                     || (data.relatedTopics.top.length > 0)
                     || (data._meta?.hasLineChart)
                     || (data.subregion.length > 0);
        
        if (!hasData) {
            throw new CliError('EMPTY_RESULT', 'No data extracted from Google Trends', 'Try --verbose');
        }
        
        // Format output
        const rows = [];
        
        // Interest
        if (data.interestValues.length > 0) {
            const avg = Math.round(data.interestValues.reduce((a, b) => a + b, 0) / data.interestValues.length);
            const max = Math.max(...data.interestValues);
            rows.push({ metric: '📈 Interest Over Time', value: `Avg ${avg}/100`, details: `Max ${max}, ${data.interestValues.length} samples` });
        } else if (data._meta?.hasLineChart) {
            rows.push({ metric: '📈 Interest Chart', value: 'Loaded', details: `${data._meta.svgPaths} SVG paths` });
        }
        
        // Top Related Queries
        if (data.relatedQueries.top.length > 0) {
            rows.push({ metric: '', value: '', details: '' });
            rows.push({ metric: '🔍 Top Related Queries', value: String(data.relatedQueries.top.length), details: '' });
            data.relatedQueries.top.slice(0, 10).forEach((rq, i) => {
                rows.push({ metric: `  ${i+1}`, value: rq.query, details: '' });
            });
        }
        
        // Rising Related Queries
        if (data.relatedQueries.rising.length > 0) {
            rows.push({ metric: '', value: '', details: '' });
            rows.push({ metric: '🚀 Rising Queries', value: String(data.relatedQueries.rising.length), details: '' });
            data.relatedQueries.rising.slice(0, 8).forEach((rq, i) => {
                rows.push({ metric: `  ${i+1}`, value: rq.query, details: '🔥' });
            });
        }
        
        // Top Related Topics
        if (data.relatedTopics.top.length > 0) {
            rows.push({ metric: '', value: '', details: '' });
            rows.push({ metric: '📎 Top Related Topics', value: String(data.relatedTopics.top.length), details: '' });
            data.relatedTopics.top.slice(0, 5).forEach((rt, i) => {
                rows.push({ metric: `  ${i+1}`, value: rt.query, details: '' });
            });
        }
        
        // Rising Topics
        if (data.relatedTopics.rising.length > 0) {
            rows.push({ metric: '', value: '', details: '' });
            rows.push({ metric: '📎 Rising Topics', value: String(data.relatedTopics.rising.length), details: '' });
            data.relatedTopics.rising.slice(0, 5).forEach((rt, i) => {
                rows.push({ metric: `  ${i+1}`, value: rt.query, details: '🔥' });
            });
        }
        
        // Subregion
        if (data.subregion.length > 0) {
            rows.push({ metric: '', value: '', details: '' });
            rows.push({ metric: '🗺️ Top Regions', value: String(data.subregion.length), details: '' });
            data.subregion.slice(0, 5).forEach((s, i) => {
                rows.push({ metric: `  ${i+1}`, value: s, details: '' });
            });
        }
        
        rows._raw = data;
        return rows;
    },
});
