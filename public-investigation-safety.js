(() => {
  'use strict';

  const VERSION = '20260808-public-publish-state-image-v2';
  const FALLBACK_IMAGE = '/social-preview.jpg';

  const INTERNAL_PUBLIC_LABELS = new Map([
    ['draft', 'Preliminary Finding'],
    ['internal review', 'Preliminary Finding'],
    ['under review', 'Preliminary Finding'],
    ['approved', 'Preliminary Finding'],
    ['open investigation', 'Preliminary Finding'],
    ['awaiting response', 'Preliminary Finding']
  ]);

  const normalize = value =>
    String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const looksLikePublicBadge = element => {
    if (!element || ['OPTION', 'SELECT', 'INPUT', 'TEXTAREA'].includes(element.tagName)) {
      return false;
    }

    const classes = String(element.className || '').toLowerCase();

    return (
      classes.includes('badge') ||
      classes.includes('status') ||
      classes.includes('pill') ||
      classes.includes('stage')
    );
  };

  const normalizePublicBadge = element => {
    if (!looksLikePublicBadge(element)) return;

    const current = normalize(element.textContent);
    const replacement = INTERNAL_PUBLIC_LABELS.get(current);

    if (!replacement) return;

    element.textContent = replacement;
    element.dataset.umPublicStageNormalized = VERSION;
    element.setAttribute(
      'aria-label',
      replacement
    );
  };

  const isBrandImage = image => {
    const source = String(
      image.currentSrc ||
      image.getAttribute('src') ||
      ''
    ).toLowerCase();

    const alt = String(image.alt || '').toLowerCase();

    return (
      /shield|seal|logo|favicon|banner/.test(source) ||
      /shield|seal|logo/.test(alt)
    );
  };

  const isInvestigationImage = image => {
    if (!image || image.tagName !== 'IMG') return false;
    if (isBrandImage(image)) return false;

    return Boolean(
      image.closest(
        'article,' +
        '[class*="investigation"],' +
        '[class*="case-card"],' +
        '[class*="card-media"],' +
        '[class*="case-media"],' +
        '[data-case-number]'
      )
    );
  };

  const hideFailedImage = image => {
    image.classList.add('um-investigation-image-hidden');
    image.removeAttribute('src');
    image.setAttribute('aria-hidden', 'true');

    const container = image.parentElement;
    if (container) {
      container.classList.add('um-investigation-image-container-hidden');
    }
  };

  const applyFallback = image => {
    if (!isInvestigationImage(image)) return;

    if (image.dataset.umFallbackAttempted === 'true') {
      hideFailedImage(image);
      return;
    }

    image.dataset.umFallbackAttempted = 'true';
    image.classList.add('um-investigation-image-fallback');
    image.src = FALLBACK_IMAGE;
  };

  const protectImage = image => {
    if (!isInvestigationImage(image)) return;
    if (image.dataset.umImageProtected === VERSION) return;

    image.dataset.umImageProtected = VERSION;

    image.addEventListener(
      'error',
      () => applyFallback(image)
    );

    if (
      image.complete &&
      image.naturalWidth === 0
    ) {
      applyFallback(image);
    }
  };

  const scan = root => {
    const scope = root instanceof Element || root instanceof Document
      ? root
      : document;

    if (scope instanceof Element) {
      normalizePublicBadge(scope);
      if (scope.tagName === 'IMG') protectImage(scope);
    }

    scope.querySelectorAll?.(
      '[class*="badge"],' +
      '[class*="status"],' +
      '[class*="pill"],' +
      '[class*="stage"]'
    ).forEach(normalizePublicBadge);

    scope.querySelectorAll?.('img').forEach(protectImage);
  };

  const style = document.createElement('style');
  style.dataset.umPublicInvestigationSafety = VERSION;
  style.textContent = `
    .um-investigation-image-fallback {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 160px;
      object-fit: cover;
      background: #07182b;
    }

    .um-investigation-image-hidden,
    .um-investigation-image-container-hidden {
      display: none !important;
    }
  `;

  document.head.append(style);

  document.addEventListener(
    'error',
    event => {
      if (event.target instanceof HTMLImageElement) {
        applyFallback(event.target);
      }
    },
    true
  );

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) scan(node);
      }
    }
  });

  const start = () => {
    scan(document);

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    window.setTimeout(() => scan(document), 500);
    window.setTimeout(() => scan(document), 1500);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
