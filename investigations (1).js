(() => {
  const page = document.body.dataset.investigationsPage;
  if (!page) return;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function formatDate(value, includeTime = false) {
    if (!value) return 'Not provided';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {})
    }).format(date);
  }

  function setText(selector, value, { hideEmpty = false } = {}) {
    const element = document.querySelector(selector);
    if (!element) return;
    const text = value == null ? '' : String(value);
    element.textContent = text;
    if (hideEmpty) element.hidden = !text;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'The requested information could not be loaded.');
    return data;
  }

  function statusClass(value) {
    return `status-${String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }

  function investigationCard(item) {
    const article = document.createElement('article');
    article.className = 'investigation-card';
    const finding = item.finding_label || 'No finding issued';
    const date = item.updated_at || item.published_at || item.date_opened;
    article.innerHTML = `
      <div class="investigation-card-top">
        <span class="case-number">${escapeHtml(item.case_number)}</span>
        ${item.status ? `<span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span>` : ''}
      </div>
      ${item.featured_image?.url ? `<img class="investigation-card-image" src="${escapeHtml(item.featured_image.url)}" alt="${escapeHtml(item.featured_image.alt || item.title)}" loading="lazy">` : ''}
      <div class="investigation-card-body">
        ${item.category?.name ? `<span class="case-topic">${escapeHtml(item.category.name)}</span>` : ''}
        <h2><a href="/investigations/${encodeURIComponent(item.slug)}">${escapeHtml(item.title)}</a></h2>
        ${item.subtitle ? `<p class="investigation-subtitle">${escapeHtml(item.subtitle)}</p>` : ''}
        <p class="investigation-summary">${escapeHtml(item.short_summary || 'Open the complete case file for the documented evidence and findings.')}</p>
        <dl class="card-meta">
          <div><dt>Subject</dt><dd>${escapeHtml(item.subject || 'Not specified')}</dd></div>
          <div><dt>Finding</dt><dd><span class="finding-badge">${escapeHtml(finding)}</span></dd></div>
          <div><dt>Opened</dt><dd>${escapeHtml(formatDate(item.date_opened))}</dd></div>
          <div><dt>Updated</dt><dd>${escapeHtml(formatDate(date))}</dd></div>
        </dl>
      </div>
      <a class="btn btn-primary card-button" href="/investigations/${encodeURIComponent(item.slug)}">View Full Investigation</a>`;
    return article;
  }

  async function initializeArchive() {
    const form = document.querySelector('#investigation-filters');
    const grid = document.querySelector('#investigation-grid');
    const empty = document.querySelector('#archive-empty');
    const count = document.querySelector('#archive-count');
    const loadMore = document.querySelector('#load-more-investigations');
    const clear = document.querySelector('#clear-filters');
    let pageNumber = 1;
    let filterOptionsLoaded = false;

    function queryString(pageValue = 1) {
      const data = new FormData(form);
      const params = new URLSearchParams({ page: String(pageValue), pageSize: '9' });
      for (const [key, value] of data.entries()) if (String(value).trim()) params.set(key, String(value).trim());
      return params.toString();
    }

    function addOptions(selectId, values, valueKey = null, labelKey = null) {
      const select = document.querySelector(selectId);
      if (!select) return;
      for (const item of values || []) {
        const value = valueKey ? item[valueKey] : item;
        const label = labelKey ? item[labelKey] : item;
        if (!value || [...select.options].some((option) => option.value === String(value))) continue;
        select.add(new Option(String(label), String(value)));
      }
    }

    async function load({ append = false } = {}) {
      count.textContent = 'Loading published investigations…';
      loadMore.disabled = true;
      try {
        const data = await fetchJson(`/api/investigations?${queryString(pageNumber)}`);
        if (!filterOptionsLoaded) {
          addOptions('#archive-subject', data.filters.subjects);
          addOptions('#archive-status', data.filters.statuses);
          addOptions('#archive-finding', data.filters.findings);
          addOptions('#archive-year', data.filters.years);
          addOptions('#archive-category', data.filters.categories, 'slug', 'name');
          filterOptionsLoaded = true;
        }
        if (!append) grid.replaceChildren();
        data.items.forEach((item) => grid.append(investigationCard(item)));
        empty.hidden = data.pagination.total !== 0;
        count.textContent = `${data.pagination.total.toLocaleString()} published investigation${data.pagination.total === 1 ? '' : 's'}`;
        loadMore.hidden = !data.pagination.hasMore;
        loadMore.disabled = false;
      } catch (error) {
        grid.replaceChildren();
        empty.hidden = false;
        empty.querySelector('h2').textContent = 'The investigation archive could not be loaded.';
        empty.querySelector('p').textContent = error.message;
        count.textContent = '';
        loadMore.hidden = true;
      }
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      pageNumber = 1;
      load();
    });
    clear.addEventListener('click', () => {
      form.reset();
      pageNumber = 1;
      load();
    });
    loadMore.addEventListener('click', () => {
      pageNumber += 1;
      load({ append: true });
    });
    let debounce;
    form.querySelector('input[type="search"]')?.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { pageNumber = 1; load(); }, 350);
    });
    await load();
  }

  function addMeta(container, label, value) {
    if (!value) return;
    const wrapper = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    wrapper.append(dt, dd);
    container.append(wrapper);
  }

  function renderComparisonTable(rows) {
    const container = document.querySelector('#comparison-results');
    container.replaceChildren();
    if (!rows.length) {
      container.innerHTML = '<p class="case-empty-note">No structured comparison table has been published for this case.</p>';
      return;
    }
    const groups = new Map();
    rows.forEach((row) => {
      const key = row.comparison_group || 'Comparison';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    for (const [group, items] of groups) {
      const wrapper = document.createElement('div');
      wrapper.className = 'comparison-group';
      const heading = document.createElement('h3');
      heading.textContent = group;
      const tableWrap = document.createElement('div');
      tableWrap.className = 'responsive-table-wrap';
      const table = document.createElement('table');
      table.className = 'comparison-table';
      table.innerHTML = '<thead><tr><th scope="col">Phrase, statement, person, group, or action tested</th><th scope="col">Result</th><th scope="col">Date</th><th scope="col">Exhibit</th><th scope="col">Notes</th></tr></thead>';
      const tbody = document.createElement('tbody');
      items.forEach((row) => {
        const tr = document.createElement('tr');
        const cells = [row.tested_item, row.result, row.tested_at ? formatDate(row.tested_at) : 'Not recorded', row.evidence_label || '—', row.notes || '—'];
        const labels = ['Item tested', 'Result', 'Date', 'Exhibit', 'Notes'];
        cells.forEach((value, index) => {
          const td = document.createElement('td');
          td.dataset.label = labels[index];
          td.textContent = value;
          tr.append(td);
        });
        tbody.append(tr);
      });
      table.append(tbody);
      tableWrap.append(table);
      wrapper.append(heading, tableWrap);
      container.append(wrapper);
    }
  }

  function evidenceMedia(item) {
    if (item.visibility !== 'Public') {
      const withheld = document.createElement('div');
      withheld.className = 'withheld-evidence';
      withheld.innerHTML = `<strong>${escapeHtml(item.visibility)}</strong><p>${escapeHtml(item.withheld_reason || 'This exhibit is described publicly but the underlying file is not displayed.')}</p>`;
      return withheld;
    }
    if (!item.media_url && item.source_url) {
      const link = document.createElement('a');
      link.className = 'evidence-external-link';
      link.href = item.source_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open original source ↗';
      return link;
    }
    if (!item.media_url) {
      const missing = document.createElement('p');
      missing.className = 'case-empty-note';
      missing.textContent = 'No public media file is attached to this exhibit.';
      return missing;
    }
    if (item.media_kind === 'image') {
      const img = document.createElement('img');
      img.src = item.media_url;
      img.alt = item.alt_text || `${item.exhibit_label}: ${item.title}`;
      img.loading = 'lazy';
      return img;
    }
    if (item.media_kind === 'video') {
      const video = document.createElement('video');
      video.src = item.media_url;
      video.controls = true;
      video.preload = 'metadata';
      if (item.transcript) video.setAttribute('aria-describedby', `transcript-${item.id}`);
      return video;
    }
    if (item.media_kind === 'audio') {
      const audio = document.createElement('audio');
      audio.src = item.media_url;
      audio.controls = true;
      audio.preload = 'metadata';
      return audio;
    }
    if (item.media_kind === 'pdf') {
      const iframe = document.createElement('iframe');
      iframe.src = item.media_url;
      iframe.title = `${item.exhibit_label}: ${item.title} PDF preview`;
      iframe.loading = 'lazy';
      return iframe;
    }
    const link = document.createElement('a');
    link.className = 'evidence-file-card';
    link.href = item.original_url || item.media_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = item.allow_download ? 'Open or download document ↗' : 'Open document preview ↗';
    return link;
  }

  function renderEvidence(items) {
    const container = document.querySelector('#evidence-exhibits');
    container.replaceChildren();
    if (!items.length) {
      container.innerHTML = '<p class="case-empty-note">No public or withheld evidence exhibits are listed.</p>';
      return;
    }
    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'evidence-card';
      const header = document.createElement('header');
      header.innerHTML = `<span class="exhibit-label">${escapeHtml(item.exhibit_label)}</span><h3>${escapeHtml(item.title)}</h3>`;
      const media = document.createElement('div');
      media.className = `evidence-media evidence-${item.media_kind}`;
      media.append(evidenceMedia(item));
      const body = document.createElement('div');
      body.className = 'evidence-body';
      const metadata = [
        item.evidence_type && ['Type', item.evidence_type],
        item.captured_at && ['Captured', formatDate(item.captured_at)],
        item.source_name && ['Source', item.source_name]
      ].filter(Boolean);
      body.innerHTML = `${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}${metadata.length ? `<dl>${metadata.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : ''}${item.authenticity_note ? `<p class="authenticity-note"><strong>Authenticity/editing note:</strong> ${escapeHtml(item.authenticity_note)}</p>` : ''}`;
      if (item.transcript) {
        const details = document.createElement('details');
        details.id = `transcript-${item.id}`;
        details.className = 'transcript-panel';
        details.innerHTML = `<summary>Transcript or captions</summary><p>${escapeHtml(item.transcript).replaceAll('\n', '<br>')}</p>`;
        body.append(details);
      }
      const links = document.createElement('div');
      links.className = 'evidence-links';
      if (item.source_url) links.innerHTML += `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">Original source ↗</a>`;
      if (item.allow_download && item.original_url) links.innerHTML += `<a href="${escapeHtml(item.original_url)}" target="_blank" rel="noopener noreferrer">Download exhibit ↗</a>`;
      body.append(links);
      card.append(header, media, body);
      container.append(card);
    });
  }

  function renderList(selector, rows, emptyMessage) {
    const list = document.querySelector(selector);
    list.replaceChildren();
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'case-empty-note';
      li.textContent = emptyMessage;
      list.append(li);
      return;
    }
    rows.forEach((row) => {
      const li = document.createElement('li');
      li.textContent = row.statement || row.question;
      list.append(li);
    });
  }

  function renderResponse(bundle) {
    const record = document.querySelector('#response-record');
    const questions = document.querySelector('#response-questions');
    record.replaceChildren();
    questions.replaceChildren();
    const response = bundle.responses[0];
    const status = bundle.investigation.response_status || response?.response_status || 'Not Yet Contacted';
    const dl = document.createElement('dl');
    dl.className = 'response-meta';
    addMeta(dl, 'Response status', status);
    addMeta(dl, 'Contacted', response?.contacted ? 'Yes' : 'No');
    if (response?.contacted_at) addMeta(dl, 'Date contacted', formatDate(response.contacted_at));
    if (response?.contact_method) addMeta(dl, 'Method', response.contact_method);
    if (response?.response_deadline) addMeta(dl, 'Response deadline', formatDate(response.response_deadline, true));
    if (response?.response_received_at) addMeta(dl, 'Response received', formatDate(response.response_received_at, true));
    record.append(dl);
    if (response?.response_html) {
      const heading = document.createElement('h3');
      heading.textContent = 'Response';
      const content = document.createElement('div');
      content.className = 'rich-content response-content';
      content.innerHTML = response.response_html;
      record.append(heading, content);
    }
    if (response?.response_document_url) {
      const link = document.createElement('a');
      link.className = 'text-link';
      link.href = response.response_document_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open response document ↗';
      record.append(link);
    }
    if (response?.editorial_note_html) {
      const note = document.createElement('div');
      note.className = 'editorial-note';
      note.innerHTML = `<strong>Editorial note:</strong>${response.editorial_note_html}`;
      record.append(note);
    }
    const responseQuestions = bundle.questions.filter((item) => item.question_type === 'right_of_response');
    if (responseQuestions.length) {
      questions.innerHTML = '<h3>Questions submitted or prepared</h3>';
      const list = document.createElement('ol');
      list.className = 'question-list';
      responseQuestions.forEach((item) => { const li = document.createElement('li'); li.textContent = item.question; list.append(li); });
      questions.append(list);
    }
  }

  function renderFinding(bundle) {
    const container = document.querySelector('#current-finding');
    const finding = bundle.findings.find((item) => item.is_current) || bundle.findings.at(-1);
    if (!finding) {
      container.innerHTML = '<h2>No finding issued</h2><p>This investigation has not reached a preliminary or final finding.</p>';
      return;
    }
    const label = finding.finding_type === 'Custom' ? finding.custom_label : finding.finding_type;
    container.innerHTML = `<div class="finding-heading-row"><span class="finding-stage">${escapeHtml(finding.stage)} Finding</span><span class="finding-badge">${escapeHtml(label)}</span></div><h2>${escapeHtml(finding.headline)}</h2><div class="rich-content">${finding.explanation_html}</div><dl class="finding-meta">${finding.issued_at ? `<div><dt>Date issued</dt><dd>${escapeHtml(formatDate(finding.issued_at))}</dd></div>` : ''}${finding.approving_editor_name ? `<div><dt>Approving editor</dt><dd>${escapeHtml(finding.approving_editor_name)}</dd></div>` : ''}</dl>`;
  }

  function renderSources(sources) {
    const list = document.querySelector('#source-list');
    list.replaceChildren();
    if (!sources.length) {
      list.innerHTML = '<li class="case-empty-note">No structured public sources are listed.</li>';
      return;
    }
    sources.forEach((source) => {
      const li = document.createElement('li');
      li.className = 'source-item';
      const title = document.createElement('a');
      title.href = source.url;
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
      title.textContent = source.title;
      const details = [source.publisher, source.source_type, source.publication_date ? `Published ${formatDate(source.publication_date)}` : null, source.accessed_date ? `Accessed ${formatDate(source.accessed_date)}` : null].filter(Boolean);
      li.append(title);
      if (details.length) { const meta = document.createElement('p'); meta.className = 'source-meta'; meta.textContent = details.join(' • '); li.append(meta); }
      if (source.description) { const description = document.createElement('p'); description.textContent = source.description; li.append(description); }
      if (source.archived_url) { const archive = document.createElement('a'); archive.className = 'archived-source'; archive.href = source.archived_url; archive.target = '_blank'; archive.rel = 'noopener noreferrer'; archive.textContent = 'Archived copy ↗'; li.append(archive); }
      list.append(li);
    });
  }

  function renderUpdates(updates) {
    const timeline = document.querySelector('#update-timeline');
    timeline.replaceChildren();
    if (!updates.length) {
      timeline.innerHTML = '<p class="case-empty-note">No public corrections or updates have been recorded.</p>';
      return;
    }
    updates.forEach((update) => {
      const item = document.createElement('article');
      item.className = `update-item ${update.update_type === 'Correction' || update.finding_changed ? 'material-update' : ''}`;
      item.innerHTML = `<div class="update-marker" aria-hidden="true"></div><div><div class="update-header"><span class="update-type">${escapeHtml(update.update_type)}</span><time datetime="${escapeHtml(update.occurred_at)}">${escapeHtml(formatDate(update.occurred_at, true))}</time></div><p>${escapeHtml(update.description)}</p>${update.previous_wording || update.new_wording ? `<details><summary>View wording change</summary>${update.previous_wording ? `<p><strong>Previous:</strong> ${escapeHtml(update.previous_wording)}</p>` : ''}${update.new_wording ? `<p><strong>New:</strong> ${escapeHtml(update.new_wording)}</p>` : ''}</details>` : ''}</div>`;
      timeline.append(item);
    });
  }

  function updateDocumentMetadata(bundle) {
    const inv = bundle.investigation;
    const title = inv.seo_title || `${inv.title} | ${inv.case_number}`;
    const description = inv.seo_description || inv.short_summary || 'Evidence, methodology, response, findings, sources, and corrections.';
    const canonical = `https://www.theunshakenmajority.com/investigations/${inv.slug}`;
    document.title = `${title} | The Unshaken Majority`;
    document.querySelector('meta[name="description"]').content = description;
    document.querySelector('#canonical-url').href = canonical;
    document.querySelector('#og-title').content = title;
    document.querySelector('#og-description').content = description;
    document.querySelector('#og-url').content = canonical;
    document.querySelector('#twitter-title').content = title;
    document.querySelector('#twitter-description').content = description;
    if (bundle.featured_image_url) {
      document.querySelector('#og-image').content = bundle.featured_image_url;
      document.querySelector('#twitter-image').content = bundle.featured_image_url;
    }
    const jsonLd = document.querySelector('#investigation-jsonld') || document.createElement('script');
    jsonLd.type = 'application/ld+json';
    jsonLd.id = 'investigation-jsonld';
    jsonLd.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Report',
      headline: inv.title,
      alternativeHeadline: inv.subtitle || undefined,
      description,
      datePublished: inv.published_at || undefined,
      dateModified: inv.updated_at,
      url: canonical,
      publisher: { '@type': 'Organization', name: 'The Unshaken Majority', url: 'https://www.theunshakenmajority.com' },
      about: inv.subject || undefined,
      identifier: inv.case_number,
      image: bundle.featured_image_url || 'https://www.theunshakenmajority.com/assets/social-preview.jpg'
    });
    if (!jsonLd.isConnected) document.head.append(jsonLd);
  }

  async function initializeDetail() {
    const pathParts = location.pathname.split('/').filter(Boolean);
    const slug = pathParts.at(-1) === 'investigations' ? new URLSearchParams(location.search).get('slug') : pathParts.at(-1);
    const loading = document.querySelector('#investigation-loading');
    const errorPanel = document.querySelector('#investigation-error');
    const content = document.querySelector('#investigation-content');
    try {
      const bundle = await fetchJson(`/api/investigation?slug=${encodeURIComponent(slug || '')}`);
      const inv = bundle.investigation;
      updateDocumentMetadata(bundle);
      setText('[data-case-number]', inv.case_number);
      const statusElement = document.querySelector('[data-status]');
      setText('[data-status]', inv.status, { hideEmpty: true });
      if (inv.status) statusElement.classList.add(statusClass(inv.status));
      const findingLabel = inv.finding_classification === 'Custom' ? inv.custom_finding_label : inv.finding_classification;
      setText('[data-finding]', findingLabel || 'No finding issued');
      setText('[data-title]', inv.title);
      setText('[data-subtitle]', inv.subtitle, { hideEmpty: true });
      setText('[data-subject]', inv.subject || 'Not specified');
      document.querySelector('[data-case-summary]').innerHTML = inv.case_summary_html || '<p>No case summary has been published.</p>';
      document.querySelector('[data-claim]').innerHTML = inv.claim_html || '<p>The exact claim has not been published.</p>';
      document.querySelector('[data-standard]').innerHTML = inv.standard_html || '<p>The applicable standard has not been published.</p>';
      document.querySelector('[data-methodology]').innerHTML = inv.methodology_html || '<p>The methodology has not been published.</p>';
      document.querySelector('[data-bottom-line]').innerHTML = inv.bottom_line_html || '<p>No closing statement has been published.</p>';

      const meta = document.querySelector('#case-meta');
      addMeta(meta, 'Case number', inv.case_number);
      if (inv.status) addMeta(meta, 'Status', inv.status);
      addMeta(meta, 'Finding', findingLabel || 'No finding issued');
      addMeta(meta, 'Finding stage', inv.finding_stage);
      addMeta(meta, 'Date opened', formatDate(inv.date_opened));
      if (inv.published_at) addMeta(meta, 'Date published', formatDate(inv.published_at));
      addMeta(meta, 'Last updated', formatDate(inv.updated_at, true));
      addMeta(meta, 'Evidence type', inv.evidence_type);
      addMeta(meta, 'Response status', inv.response_status);
      addMeta(meta, 'Topic', bundle.category?.name);

      renderComparisonTable(bundle.comparisons || []);
      renderEvidence(bundle.evidence || []);
      renderList('[data-supported-list]', (bundle.assertions || []).filter((item) => item.assertion_type === 'supported'), 'No supported-finding statements are published.');
      renderList('[data-limitations-list]', (bundle.assertions || []).filter((item) => item.assertion_type === 'limitation'), 'No limitations have been published.');
      renderResponse(bundle);
      renderFinding(bundle);
      renderList('[data-remaining-questions]', (bundle.questions || []).filter((item) => item.question_type === 'remaining'), 'No unresolved questions are listed.');
      renderSources(bundle.sources || []);
      renderUpdates(bundle.updates || []);

      const submitUrl = new URL('/submit', location.origin);
      submitUrl.searchParams.set('case', inv.case_number);
      submitUrl.searchParams.set('title', inv.title);
      document.querySelector('#submit-evidence-button').href = submitUrl.pathname + submitUrl.search;
      const correctionUrl = new URL('/correction', location.origin);
      correctionUrl.searchParams.set('case', inv.case_number);
      document.querySelector('#report-error-button').href = correctionUrl.pathname + correctionUrl.search;
      document.querySelector('#share-investigation').addEventListener('click', async () => {
        const shareData = { title: `${inv.case_number}: ${inv.title}`, text: inv.short_summary || inv.title, url: location.href };
        try {
          if (navigator.share) await navigator.share(shareData);
          else { await navigator.clipboard.writeText(location.href); document.querySelector('#share-investigation').textContent = 'Link Copied'; }
        } catch (error) {
          if (error.name !== 'AbortError') window.prompt('Copy this investigation link:', location.href);
        }
      });
      loading.hidden = true;
      content.hidden = false;
    } catch (error) {
      loading.hidden = true;
      errorPanel.hidden = false;
      errorPanel.querySelector('[data-error-message]').textContent = error.message;
    }
  }

  if (page === 'archive') initializeArchive();
  if (page === 'detail') initializeDetail();
})();
