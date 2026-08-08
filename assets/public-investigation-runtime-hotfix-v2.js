/* UM_PUBLIC_INVESTIGATION_RUNTIME_HOTFIX_V2
   Removes a stale investigation loading shell after the actual case content
   has rendered. Also corrects known date-only display shifts caused by UTC
   parsing of YYYY-MM-DD values. */
(() => {
  'use strict';

  const normalize = value => String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  const loaderPattern = /^Loading (?:published )?investigation(?:\.\.\.|…)?$/i;

  function caseNumber() {
    const body = normalize(document.body?.innerText);
    const match = body.match(/UM-\d{4}-\d{3}/i);
    return match ? match[0].toUpperCase() : '';
  }

  function caseHasRendered() {
    const body = normalize(document.body?.innerText);
    return (
      /UM-\d{4}-\d{3}/i.test(body) &&
      (
        /CASE SUMMARY/i.test(body) ||
        /What this investigation examines/i.test(body) ||
        document.querySelector('#case-summary, [data-case-summary], .case-summary, .investigation-hero')
      )
    );
  }

  function largestLoaderShell(node) {
    let shell = node;
    let current = node.parentElement;

    while (
      current &&
      current !== document.body &&
      current.tagName !== 'MAIN' &&
      loaderPattern.test(normalize(current.innerText))
    ) {
      shell = current;
      current = current.parentElement;
    }

    return shell;
  }

  function hideStaleLoadingShell() {
    if (!caseHasRendered()) return;

    const elements = Array.from(document.querySelectorAll('body *'));
    for (const element of elements) {
      if (!loaderPattern.test(normalize(element.innerText))) continue;

      const shell = largestLoaderShell(element);
      shell.classList.add('um-investigation-loader-resolved');
      shell.setAttribute('hidden', '');
      shell.setAttribute('aria-hidden', 'true');
      shell.style.setProperty('display', 'none', 'important');
      shell.style.setProperty('min-height', '0', 'important');
      shell.style.setProperty('height', '0', 'important');
      shell.style.setProperty('padding', '0', 'important');
      shell.style.setProperty('margin', '0', 'important');
      shell.style.setProperty('overflow', 'hidden', 'important');
    }
  }

  function replaceExactText(oldValue, newValue) {
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      if (normalize(element.textContent) !== oldValue) continue;
      if (element.children.length) continue;
      element.textContent = newValue;
    }
  }

  function correctKnownDateOnlyDisplay() {
    const number = caseNumber();
    const expected = {
      'UM-2026-001': {
        wrong: 'August 3, 2026',
        correct: 'August 4, 2026'
      },
      'UM-2026-002': {
        wrong: 'August 7, 2026',
        correct: 'August 8, 2026'
      }
    }[number];

    if (!expected) return;
    replaceExactText(expected.wrong, expected.correct);
  }

  function resolvePage() {
    hideStaleLoadingShell();
    correctKnownDateOnlyDisplay();
  }

  const observer = new MutationObserver(resolvePage);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  document.addEventListener('DOMContentLoaded', resolvePage);
  window.addEventListener('load', resolvePage);

  setTimeout(resolvePage, 0);
  setTimeout(resolvePage, 500);
  setTimeout(resolvePage, 1500);
  setTimeout(resolvePage, 5000);

  setTimeout(() => {
    if (caseHasRendered()) {
      hideStaleLoadingShell();
      return;
    }

    for (const element of Array.from(document.querySelectorAll('body *'))) {
      if (!loaderPattern.test(normalize(element.innerText))) continue;
      element.textContent = 'This investigation could not be loaded. Refresh the page or return to Investigations.';
    }
  }, 20000);
})();
