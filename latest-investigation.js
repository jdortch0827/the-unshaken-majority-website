(() => {
  const section = document.querySelector('#latest-investigation-section');
  const card = document.querySelector('#latest-investigation-card');
  if (!section || !card) return;
  const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const dateLabel = (value) => value ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value)) : 'Not provided';
  fetch('/api/latest-investigation', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then((response) => response.json().then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok || !data.ok || !data.item) return;
      const item = data.item;
      card.innerHTML = `
        ${item.featured_image?.url ? `<img class="latest-case-image" src="${escapeHtml(item.featured_image.url)}" alt="${escapeHtml(item.featured_image.alt || item.title)}">` : ''}
        <div class="latest-case-content">
          <div class="latest-case-kicker"><span class="case-number">${escapeHtml(item.case_number)}</span>${item.status ? `<span class="status-badge">${escapeHtml(item.status)}</span>` : ''}</div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.short_summary || 'Open the complete case file for evidence, methodology, responses, findings, sources, and corrections.')}</p>
          <dl class="latest-case-meta">
            <div><dt>Finding</dt><dd>${escapeHtml(item.finding_label || 'No finding issued')}</dd></div>
            <div><dt>Published or updated</dt><dd>${escapeHtml(dateLabel(item.updated_at || item.published_at))}</dd></div>
          </dl>
        </div>
        <a class="btn btn-primary" href="/investigations/${encodeURIComponent(item.slug)}">View Investigation</a>`;
      section.hidden = false;
    })
    .catch(() => { section.hidden = true; });
})();
