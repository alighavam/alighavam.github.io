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
        .filter(Boolean);

    if ('IntersectionObserver' in window && sections.length) {
        var visible = new Set();

        var setActive = function () {
            var current = sections.filter(function (s) { return visible.has(s.id); }).pop();
            for (var id in linkFor) linkFor[id].classList.toggle('is-active', !!current && id === current.id);
        };

        var navObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) visible.add(entry.target.id);
                else visible.delete(entry.target.id);
            });
            setActive();
        }, { rootMargin: '-30% 0px -55% 0px' });

        sections.forEach(function (s) { navObserver.observe(s); });
    }
})();
