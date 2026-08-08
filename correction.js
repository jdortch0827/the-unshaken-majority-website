(() => {
  const form = document.querySelector('#correction-form');
  if (!form) return;
  const caseField = document.querySelector('#correction-case');
  const params = new URLSearchParams(location.search);
  caseField.value = params.get('case') || '';
  const status = document.querySelector('#correction-status');
  const button = form.querySelector('.submit-button');
  const fileInput = document.querySelector('#correction-file');
  const fileList = document.querySelector('#correction-file-list');
  const success = document.querySelector('#correction-success');
  const state = { token: '', widgetId: undefined, config: null, submitting: false };

  function setStatus(message, type = '') {
    status.textContent = message;
    status.className = `form-status${type ? ` is-${type}` : ''}`;
  }
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'The correction request could not be completed.');
    return data;
  }
  async function loadTurnstile() {
    if (window.turnstile) return window.turnstile;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('The security check could not be loaded.'));
      document.head.append(script);
    });
    return window.turnstile;
  }

  fileInput.addEventListener('change', () => {
    fileList.replaceChildren();
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      fileInput.value = '';
      setStatus('The correction attachment must be 10 MB or smaller.', 'error');
      return;
    }
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `<span></span><span>${formatBytes(file.size)}</span>`;
    item.firstElementChild.textContent = file.name;
    fileList.append(item);
    setStatus('');
  });

  async function initialize() {
    try {
      state.config = await fetchJson('/api/form-config', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const turnstile = await loadTurnstile();
      state.widgetId = turnstile.render('#correction-turnstile', {
        sitekey: state.config.turnstileSiteKey,
        action: 'correction_submission',
        theme: 'light',
        'response-field': false,
        callback(token) { state.token = token; button.disabled = false; },
        'expired-callback'() { state.token = ''; button.disabled = true; },
        'error-callback'() { state.token = ''; button.disabled = true; return true; }
      });
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.submitting || !form.reportValidity()) return;
    if (!state.token) return setStatus('Complete the security check before submitting.', 'error');
    const file = fileInput.files?.[0] || null;
    try {
      state.submitting = true;
      button.disabled = true;
      setStatus('Securing your correction request…', 'working');
      const fd = new FormData(form);
      const prepared = await fetchJson('/api/prepare-correction', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          caseNumber: fd.get('caseNumber'), name: fd.get('name'), email: fd.get('email'),
          organization: fd.get('organization'), challengedStatement: fd.get('challengedStatement'),
          explanation: fd.get('explanation'), sourceUrl: fd.get('sourceUrl'),
          requestedCorrection: fd.get('requestedCorrection'), permission: fd.get('permission'),
          certification: fd.get('certification'), website: fd.get('website'), turnstileToken: state.token,
          file: file ? { name: file.name, type: file.type, size: file.size } : null
        })
      });
      if (prepared.upload) {
        if (!window.supabase?.createClient) throw new Error('The secure file uploader did not load.');
        const client = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { error } = await client.storage.from('investigation-evidence').uploadToSignedUrl(prepared.upload.path, prepared.upload.token, file, { contentType: file.type, cacheControl: '3600' });
        if (error) throw new Error(`The supporting file could not be uploaded: ${error.message}`);
      }
      const finalized = await fetchJson('/api/finalize-correction', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ sessionToken: prepared.sessionToken })
      });
      form.hidden = true;
      success.hidden = false;
      success.querySelector('[data-reference]').textContent = finalized.reference;
      success.focus();
      setStatus('');
    } catch (error) {
      setStatus(error.message, 'error');
      state.token = '';
      button.disabled = true;
      if (window.turnstile && state.widgetId !== undefined) window.turnstile.reset(state.widgetId);
    } finally {
      state.submitting = false;
      if (state.token) button.disabled = false;
    }
  });

  initialize();
})();
