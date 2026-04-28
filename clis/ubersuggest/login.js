/**
 * Ubersuggest Login — auto-detect and restore Google OAuth session.
 * 
 * Checks if Ubersuggest session is active. If expired, clicks "Sign in with Google"
 * to re-authenticate (browser must have active Google session).
 * 
 * Usage: opencli ubersuggest login
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

/** Run a simple expression in browser context */
async function evalExpr(page, expr) {
    return page.evaluate(expr);
}

cli({
    site: 'ubersuggest',
    name: 'login',
    description: 'Check Ubersuggest login status and auto sign-in via Google OAuth if needed',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['metric', 'value'],
    func: async function(page, args) {
        await page.goto('https://app.neilpatel.com/en-us/app/ubersuggest/keywords/test/0/us');
        
        // Wait for full SPA render
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
        
        // Check login — real avatars have Google CDN /a/ path or gravatar
        var isLoggedIn = await evalExpr(page, `(function(){
            var b = document.querySelector('button[data-testid="nav-avatar-button"]');
            if (!b) return false;
            var img = b.querySelector("img[alt*='avatar']");
            if (!img || !img.src) return false;
            return img.src.indexOf('/a/') !== -1 || img.src.indexOf('gravatar') !== -1;
        })()`);
        
        if (isLoggedIn) {
            var userInfo = await evalExpr(page, `(function(){
                var t = document.body.innerText || "";
                var qm = t.match(/(\\d+) out of (\\d+) free/i);
                return JSON.stringify({ quota: qm ? qm[0] : 'unknown' });
            })()`);
            
            return [
                { metric: 'Status', value: '\u2705 Logged in' },
                { metric: 'Quota', value: JSON.parse(userInfo).quota }
            ];
        }
        
        // Not logged in — find and click sign-in button
        console.error('[ubersuggest] Session expired, attempting Google OAuth...');
        
        var clicked = await evalExpr(page, `(function(){
            var buttons = Array.from(document.querySelectorAll("button, a"));
            var googleBtn = buttons.find(function(el) {
                var text = (el.innerText || "").toLowerCase();
                return text.indexOf("google") > -1 || text.indexOf("sign in") > -1;
            });
            if (!googleBtn) {
                googleBtn = buttons.find(function(el) {
                    var href = el.getAttribute("href") || "";
                    return href.indexOf("google") > -1 || href.indexOf("oauth") > -1;
                });
            }
            if (googleBtn) { googleBtn.click(); return true; }
            return false;
        })()`);
        
        if (!clicked) {
            throw new CliError('LOGIN_FAILED', 
                'Could not find Sign-in button on Ubersuggest page', 
                'Manual login at app.neilpatel.com');
        }
        
        // Wait for OAuth redirect + back to Ubersuggest
        console.error('[ubersuggest] Waiting for OAuth redirect...');
        var oauthWaited = 0;
        var OAUTH_MAX = 30;
        while (oauthWaited < OAUTH_MAX) {
            await new Promise(function(r) { setTimeout(r, 2000); });
            oauthWaited += 2;
            
            var currentUrl = await evalExpr(page, `window.location.href`);
            var stillOnGoogle = currentUrl.indexOf('accounts.google.com') > -1 
                              || currentUrl.indexOf('consent') > -1;
            
            if (currentUrl.indexOf('neilpatel') > -1 && !stillOnGoogle) {
                await new Promise(function(r) { setTimeout(r, 3000); });
                
                var nowLoggedIn = await evalExpr(page, `(function(){
                    var b = document.querySelector('button[data-testid="nav-avatar-button"]');
                    if (!b) return false;
                    var img = b.querySelector("img[alt*='avatar']");
                    if (!img || !img.src) return false;
                    return img.src.indexOf('/a/') !== -1 || img.src.indexOf('gravatar') !== -1;
                })()`);
                
                if (nowLoggedIn) {
                    return [
                        { metric: 'Status', value: '\u2705 Re-authenticated via Google' },
                        { metric: 'OAuth time', value: oauthWaited + 's' }
                    ];
                }
            }
            
            // Auto-click Continue/Allow on consent page
            if (stillOnGoogle && oauthWaited > 15) {
                await evalExpr(page, `(function(){
                    var btns = Array.from(document.querySelectorAll("button"));
                    var c = btns.find(function(b) {
                        var t = (b.innerText || "").toLowerCase();
                        return t === "continue" || t === "allow" || t === "accept" || t === "next";
                    });
                    if (c) c.click();
                })()`);
            }
        }
        
        // Final check
        var finalCheck = await evalExpr(page, `(function(){
            var b = document.querySelector('button[data-testid="nav-avatar-button"]');
            if (!b) return false;
            var img = b.querySelector("img[alt*='avatar']");
            if (!img || !img.src) return false;
            return img.src.indexOf('/a/') !== -1 || img.src.indexOf('gravatar') !== -1;
        })()`);
        
        if (finalCheck) {
            return [
                { metric: 'Status', value: '\u2705 Logged in (slow OAuth)' },
                { metric: 'Time', value: oauthWaited + 's' }
            ];
        }
        
        throw new CliError('LOGIN_TIMEOUT',
            'OAuth did not complete within timeout. May need manual Google account selection.',
            'Try: open app.neilpatel.com manually and click Sign in with Google');
    },
});
