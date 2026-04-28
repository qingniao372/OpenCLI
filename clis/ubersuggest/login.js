/**
 * Ubersuggest Login — auto-detect and restore Google OAuth session.
 * 
 * Handles 3 states:
 *   1. Already logged in → report status
 *   2. Logged out (overview page, "Sign in" link) → click Sign in → then click Continue with Google
 *   3. On /login page → click Continue with Google directly
 * 
 * Usage: opencli ubersuggest login
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

async function evalExpr(page, expr) {
    return page.evaluate(expr);
}

/** Wait for any recognizable page state */
async function waitForPage(page, maxWait) {
    var waited = 0;
    while (waited < maxWait) {
        await new Promise(function(r) { setTimeout(r, 2000); });
        waited += 2;
        
        var state = await evalExpr(page, `(function(){
            var t = document.body.innerText || '';
            var hasNav = !!document.querySelector('button[data-testid="nav-avatar-button"]');
            var hasSignIn = t.indexOf('Sign in') > -1 && !hasNav;
            var hasGoogleLink = !!Array.from(document.querySelectorAll('a')).find(function(a){
                var txt = (a.innerText||'').toLowerCase();
                return txt.indexOf('google') > -1 && txt.indexOf('continue') > -1;
            });
            var isLogin = window.location.pathname.indexOf('/login') > -1;
            
            return JSON.stringify({
                url: window.location.href,
                bodyLen: t.length,
                isLogin: isLogin,
                hasNav: hasNav,
                hasSignIn: hasSignIn,
                hasGoogleLink: hasGoogleLink
            });
        })()`);
        
        state = JSON.parse(state);
        
        // Any of these means we can proceed
        if (state.hasNav || state.hasSignIn || state.hasGoogleLink || state.isLogin) {
            return { ready: true, state: state, waited: waited };
        }
    }
    
    var finalState = await evalExpr(page, `(function(){
        return JSON.stringify({url: window.location.href, bodyLen: document.body.innerText.length});
    })()`);
    return { ready: false, state: JSON.parse(finalState), waited: waited };
}

/** Click a link by text content */
async function clickLink(page, text) {
    return evalExpr(page, `(function(){
        var link = Array.from(document.querySelectorAll('a, button')).find(function(el){
            return (el.innerText||'').trim().toLowerCase() === '${text.toLowerCase()}';
        });
        if (link) { link.click(); return 'clicked'; }
        // Fallback: contains match
        var fallback = Array.from(document.querySelectorAll('a, button')).find(function(el){
            return (el.innerText||'').toLowerCase().indexOf('${text.toLowerCase()}') > -1;
        });
        if (fallback) { fallback.click(); return 'clicked-fallback'; }
        return 'not-found';
    })()`);
}

cli({
    site: 'ubersuggest',
    name: 'login',
    description: 'Check Ubersuggest login status and auto sign-in via Google OAuth',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['metric', 'value'],
    func: async function(page, args) {
        await page.goto('https://app.neilpatel.com/en-us/app/ubersuggest/keywords/test/0/us');
        
        console.error('[ubersuggest] Waiting for page...');
        var result = await waitForPage(page, 20);
        console.error('[ubersuggest] State:', JSON.stringify({
            waited: result.waited,
            hasNav: result.state.hasNav,
            hasSignIn: result.state.hasSignIn,
            hasGoogleLink: result.state.hasGoogleLink,
            isLogin: result.state.isLogin
        }));
        
        // === Case 1: Already logged in ===
        if (result.state.hasNav) {
            var loggedIn = await evalExpr(page, `(function(){
                var b = document.querySelector('button[data-testid="nav-avatar-button"]');
                var img = b ? b.querySelector("img[alt*='avatar']") : null;
                if (!img || !img.src) return false;
                return img.src.indexOf('/a/') !== -1 || img.src.indexOf('gravatar') !== -1;
            })()`);
            
            if (loggedIn) {
                var quota = await evalExpr(page, `(function(){
                    var t = document.body.innerText || '';
                    var m = t.match(/(\\d+) out of (\\d+) free/i);
                    return m ? m[0] : 'unknown';
                })()`);
                return [
                    { metric: 'Status', value: '\u2705 Already logged in' },
                    { metric: 'Quota', value: quota }
                ];
            }
        }
        
        // === Case 2: On overview page but not logged in ("Sign in" link) ===
        if (result.state.hasSignIn && !result.state.isLogin) {
            console.error('[ubersuggest] Clicking Sign in...');
            var signResult = await clickLink(page, 'Sign in');
            console.error('[ubersuggest] Sign in:', signResult);
            
            // Wait for redirect to /login page
            await new Promise(function(r) { setTimeout(r, 5000); });
            
            // Re-check state
            var afterSignIn = await waitForPage(page, 15);
            result = afterSignIn;
        }
        
        // === Case 3: On /login page or redirected here ===
        if (result.state.hasGoogleLink || result.state.isLogin) {
            console.error('[ubersuggest] Clicking Continue with Google...');
            var googleResult = await clickLink(page, 'Continue with Google');
            console.error('[ubersuggest] Google auth:', googleResult);
            
            if (googleResult === 'not-found') {
                throw new CliError('LOGIN_FAILED', 'Cannot find Continue with Google link');
            }
            
            // Wait for OAuth round-trip
            console.error('[ubersuggest] Waiting for OAuth...');
            var oauthWaited = 0;
            while (oauthWaited < 35) {
                await new Promise(function(r) { setTimeout(r, 2000); });
                oauthWaited += 2;
                
                var url = await evalExpr(page, `window.location.href`);
                var onGoogle = url.indexOf('accounts.google.com') > -1 || url.indexOf('consent') > -1;
                var backToNeilpatel = url.indexOf('neilpatel') > -1 && !onGoogle;
                
                if (backToNeilpatel) {
                    await new Promise(function(r) { setTimeout(r, 3000); });
                    
                    var success = await evalExpr(page, `(function(){
                        var b = document.querySelector('button[data-testid="nav-avatar-button"]');
                        if (!b) return false;
                        var img = b.querySelector("img[alt*='avatar']");
                        if (!img || !img.src) return false;
                        return img.src.indexOf('/a/') !== -1 || img.src.indexOf('gravatar') !== -1;
                    })()`);
                    
                    if (success) {
                        return [
                            { metric: 'Status', value: '\u2705 Logged in via Google OAuth' },
                            { metric: 'Time', value: oauthWaited + 's' }
                        ];
                    }
                }
                
                // Auto-click consent buttons
                if (onGoogle && oauthWaited > 10) {
                    await evalExpr(page, `(function(){
                        var btns = Array.from(document.querySelectorAll("button"));
                        var c = btns.find(function(b){
                            var t = (b.innerText||'').toLowerCase();
                            return t==='continue'||t==='allow'||t==='accept';
                        });
                        if(c) c.click();
                    })()`);
                }
            }
            
            // Final check
            var finalOk = await evalExpr(page, `(function(){
                var b = document.querySelector('button[data-testid="nav-avatar-button"]');
                if (!b) return false;
                var img = b.querySelector("img[alt*='avatar']");
                if (!img || !img.src) return false;
                return img.src.indexOf('/a/') !== -1 || img.src.indexOf('gravatar') !== -1;
            })()`);
            
            if (finalOk) {
                return [
                    { metric: 'Status', value: '\u2705 Logged in' },
                    { metric: 'Time', value: oauthWaited + 's' }
                ];
            }
            
            throw new CliError('LOGIN_TIMEOUT',
                'OAuth did not complete within timeout',
                'May need manual account selection on Google consent page');
        }
        
        // Unknown state
        throw new CliError('NAV_ERROR',
            'Unexpected page state after navigation',
            'URL: ' + result.state.url + ', bodyLen: ' + result.state.bodyLen);
    },
});
