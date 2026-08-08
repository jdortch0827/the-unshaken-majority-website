(() => {
  'use strict';

  const VERSION = '20260808-investigation-card-disappearance-v3';
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
    if (
      !element ||
      ['OPTION', 'SELECT', 'INPUT', 'TEXTAREA'].includes(element.tagName)
    ) {
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

    const replacement = INTERNAL_PUBLIC_LABELS.get(
      normalize(element.textContent)
    );

    if (!replacement) return;

    element.textContent = replacement;
    element.dataset.umPublicStageNormalized = VERSION;
    element.setAttribute('aria-label', replacement);
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

  const restoreAnyV2HiddenContainers = () => {
    document
      .querySelectorAll('.um-investigation-image-container-hidden')
      .forEach(element => {
        element.classList.remove(
          'um-investigation-image-container-hidden'
        );
      });
  };

  const hideOnlyFailedImage = image => {
    if (!image) return;

    image.classList.add('um-investigation-image-hidden');
    image.removeAttribute('src');
    image.removeAttribute('srcset');
    image.setAttribute('aria-hidden', 'true');

    // CRITICAL V3 RULE:
    // Never hide image.parentElement. In some card layouts the parent is
    // the entire investigation link/card.
  };

  const applyFallback = image => {
    if (!isInvestigationImage(image)) return;

    if (image.dataset.umFallbackAttempted === 'true') {
      hideOnlyFailedImage(image);
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

    // Wait one animation frame before judging a newly inserted image.
    // This avoids treating an image that has not started loading as failed.
    requestAnimationFrame(() => {
      if (
        image.isConnected &&
        image.complete &&
        image.naturalWidth === 0 &&
        image.getAttribute('src')
      ) {
        applyFallback(image);
      }
    });
  };

  const scan = root => {
    restoreAnyV2HiddenContainers();

    const scope =
      root instanceof Element || root instanceof Document
        ? root
        : document;

    if (scope instanceof Element) {
      normalizePublicBadge(scope);

      if (scope.tagName === 'IMG') {
        protectImage(scope);
      }
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

    .um-investigation-image-hidden {
      display: none !important;
    }

    /* V3 explicitly reverses the V2 rule that could hide a whole card. */
    .um-investigation-image-container-hidden {
      display: revert !important;
      visibility: visible !important;
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
    restoreAnyV2HiddenContainers();

    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          scan(node);
        }
      }
    }
  });

  const start = () => {
    restoreAnyV2HiddenContainers();
    scan(document);

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    window.setTimeout(() => scan(document), 500);
    window.setTimeout(() => scan(document), 1500);
    window.setTimeout(() => scan(document), 4000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
