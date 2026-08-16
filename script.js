// Small, dependency-free behaviour. Everything here is one-shot or passive so
// there is nothing running during scroll on slower machines.

(function () {
    'use strict';

    var root = document.documentElement;

    /* --- THEME TOGGLE ---------------------------------------------------- */
    // The initial theme is set by the inline script in <head> (avoids a flash).
    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.addEventListener('click', function () {
            var next = root.dataset.theme === 'light' ? 'dark' : 'light';
            root.dataset.theme = next;
            try { localStorage.setItem('theme', next); } catch (e) {}
        });
    }

    var reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* --- SCROLL REVEAL --------------------------------------------------- */
    // Replaces the AOS library: no extra requests, no scroll handler, and each
    // element is unobserved as soon as it has appeared.
    var reveals = document.querySelectorAll('.reveal');
    window.__revealReady = true;   // tells the <head> failsafe to stand down

    if (!('IntersectionObserver' in window) || reduceMotion) {
        for (var i = 0; i < reveals.length; i++) reveals[i].classList.add('is-in');
    } else {
        var revealObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-in');
                revealObserver.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

        reveals.forEach(function (el) { revealObserver.observe(el); });
    }

    /* --- NAV ACTIVE SECTION ---------------------------------------------- */
    var linkFor = {};
    document.querySelectorAll('.nav-links a[href^="#"]').forEach(function (a) {
        linkFor[a.getAttribute('href').slice(1)] = a;
    });

    var sections = Object.keys(linkFor)
        .map(function (id) { return document.getElementById(id); })
        .filter(Boolean)
        .sort(function (a, b) {
            // document order, whatever order the nav links happen to be in
            return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
        });

    if (sections.length) {
        var nav = document.querySelector('.nav');
        var activeId = null;
        var ticking = false;
        var locked = false;   // a click wins until the reader scrolls again

        var setActive = function (id) {
            if (id === activeId) return;
            activeId = id;
            for (var k in linkFor) linkFor[k].classList.toggle('is-active', k === activeId);
        };

        // The active section is the last one whose top edge has crossed a probe
        // line. The line sweeps from just under the nav (at the top of the page)
        // down to the bottom of the viewport (at the end of the page).
        //
        // A line at a fixed height cannot work here: on a tall window this page
        // only scrolls ~800px, so the last sections never reach the top of the
        // viewport and could never become active. Tying the line to scroll
        // progress guarantees every section gets its turn at any window size.
        var pickActive = function () {
            ticking = false;
            if (locked) return;

            var doc = document.scrollingElement || document.documentElement;
            var max = doc.scrollHeight - window.innerHeight;
            var progress = max > 0 ? Math.min(Math.max(doc.scrollTop / max, 0), 1) : 0;
            var navH = nav.getBoundingClientRect().height;
            var line = navH + (window.innerHeight - navH) * progress;

            var current = sections[0];
            for (var i = 0; i < sections.length; i++) {
                if (sections[i].getBoundingClientRect().top <= line) current = sections[i];
            }

            setActive(current.id);
        };

        // rAF-throttled: at most one pass per frame, and it only reads a handful
        // of rects — no styles are written unless the active section changed.
        var schedule = function () {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(pickActive);
        };

        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule, { passive: true });

        // Clicking a link states intent outright, so highlight that section and
        // hold it. Without this the probe line takes over as the smooth scroll
        // lands and immediately highlights a different section — and the last
        // sections can't reach the top of a tall window at all, so the landing
        // position alone can never identify what was clicked.
        Object.keys(linkFor).forEach(function (id) {
            linkFor[id].addEventListener('click', function () {
                setActive(id);
                locked = true;
            });
        });

        // Any scroll the reader starts themselves hands control back.
        ['wheel', 'touchmove', 'keydown'].forEach(function (evt) {
            window.addEventListener(evt, function () {
                if (!locked) return;
                locked = false;
                schedule();
            }, { passive: true });
        });

        // Honour a hash someone arrives on, e.g. alighavam.com/#projects
        var hash = window.location.hash.slice(1);
        if (hash && linkFor[hash]) {
            setActive(hash);
            locked = true;
        } else {
            pickActive();
        }
    }
})();
