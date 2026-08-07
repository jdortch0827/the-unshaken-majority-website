const menuButton = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');

if (menuButton && navLinks) {
  menuButton.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
  });
}

document.querySelectorAll('[data-current-year]').forEach((element) => {
  element.textContent = new Date().getFullYear();
});

const FORM_CONFIG_URL = '/api/form-config';
let sharedConfigPromise;
let turnstileScriptPromise;

function getFormConfig() {
  if (!sharedConfigPromise) {
    sharedConfigPromise = fetch(FORM_CONFIG_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'The form configuration could not be loaded.');
        return data;
      });
  }
  return sharedConfigPromise;
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('The security check did not load.'));
      };
      script.onerror = () => reject(new Error('The security check could not be loaded.'));
      document.head.appendChild(script);
    });
  }
  return turnstileScriptPromise;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || 'The submission could not be completed.');
  return data;
}

function setStatus(element, message, type = '') {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('is-error', 'is-success', 'is-working');
  if (type) element.classList.add(`is-${type}`);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFiles(files, limits) {
  if (files.length > limits.maxFiles) throw new Error(`Choose no more than ${limits.maxFiles} files.`);
  let total = 0;
  for (const file of files) {
    if (!limits.acceptedTypes.includes(file.type)) throw new Error(`${file.name} is not an accepted PDF, JPG, PNG, or WEBP file.`);
    if (file.size > limits.maxFileSizeBytes) throw new Error(`${file.name} is larger than ${formatBytes(limits.maxFileSizeBytes)}.`);
    total += file.size;
  }
  if (total > limits.maxTotalSizeBytes) throw new Error(`The files total ${formatBytes(total)}. The combined limit is ${formatBytes(limits.maxTotalSizeBytes)}.`);
}

function updateProgress(container, current, total, message) {
  if (!container) return;
  container.hidden = false;
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar = container.querySelector('[role="progressbar"]');
  const fill = bar?.querySelector('span');
  if (bar) bar.setAttribute('aria-valuenow', String(percentage));
  if (fill) fill.style.width = `${percentage}%`;
  const text = container.querySelector('[data-progress-text]');
  if (text) text.textContent = message;
}

function resetProgress(container) {
  if (!container) return;
  container.hidden = true;
  updateProgress(container, 0, 1, 'Preparing submission…');
  container.hidden = true;
}

async function setupTurnstile({ config, containerId, action, button, state }) {
  const turnstile = await loadTurnstile();
  state.widgetId = turnstile.render(`#${containerId}`, {
    sitekey: config.turnstileSiteKey,
    action,
    theme: 'light',
    size: 'normal',
    'response-field': false,
    callback(token) {
      state.turnstileToken = token;
      button.disabled = false;
    },
    'expired-callback'() {
      state.turnstileToken = '';
      button.disabled = true;
    },
    'error-callback'() {
      state.turnstileToken = '';
      button.disabled = true;
      return true;
    }
  });
}

function resetTurnstile(state, button) {
  state.turnstileToken = '';
  button.disabled = true;
  if (window.turnstile && state.widgetId !== undefined) window.turnstile.reset(state.widgetId);
}

async function initializeCaseForm(form) {
  const status = document.querySelector('#form-status');
  const button = form.querySelector('.submit-button');
  const fileInput = form.querySelector('#evidence-files');
  const fileList = document.querySelector('#file-list');
  const progress = document.querySelector('#case-progress');
  const success = document.querySelector('#case-success');
  const state = { turnstileToken: '', widgetId: undefined, config: null, submitting: false };

  try {
    const config = await getFormConfig();
    state.config = config;
    if (!config.configured) throw new Error('Secure submissions are being configured. Please use the campaign email until setup is complete.');
    await setupTurnstile({ config, containerId: 'case-turnstile', action: 'case_submission', button, state });
  } catch (error) {
    setStatus(status, error.message, 'error');
    button.disabled = true;
  }

  fileInput?.addEventListener('change', () => {
    fileList.replaceChildren();
    const files = Array.from(fileInput.files || []);
    try {
      if (state.config) validateFiles(files, state.config.limits);
      files.forEach((file) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        const name = document.createElement('span');
        name.textContent = file.name;
        const size = document.createElement('span');
        size.textContent = formatBytes(file.size);
        item.append(name, size);
        fileList.append(item);
      });
      setStatus(status, '');
    } catch (error) {
      fileInput.value = '';
      fileList.replaceChildren();
      setStatus(status, error.message, 'error');
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.submitting || !state.config) return;
    if (!form.reportValidity()) return;
    if (!state.turnstileToken) {
      setStatus(status, 'Complete the security check before submitting.', 'error');
      return;
    }

    const files = Array.from(fileInput?.files || []);
    try {
      validateFiles(files, state.config.limits);
      state.submitting = true;
      button.disabled = true;
      setStatus(status, 'Securing your submission…', 'working');
      updateProgress(progress, 0, files.length + 2, 'Preparing your private submission…');
      const formData = new FormData(form);
      const prepared = await postJson('/api/prepare-case', {
        name: formData.get('name'),
        email: formData.get('email'),
        title: formData.get('title'),
        organization: formData.get('organization'),
        date: formData.get('date'),
        summary: formData.get('summary'),
        comparison: formData.get('comparison'),
        sources: formData.get('sources'),
        permission: formData.get('permission'),
        consent: formData.get('consent'),
        website: formData.get('website'),
        turnstileToken: state.turnstileToken,
        files: files.map((file) => ({ name: file.name, type: file.type, size: file.size }))
      });
      updateProgress(progress, 1, files.length + 2, files.length ? 'Uploading evidence privately…' : 'Saving case details…');

      if (prepared.uploads.length) {
        if (!window.supabase?.createClient) throw new Error('The secure file uploader did not load. Please refresh and try again.');
        const storageClient = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        for (let index = 0; index < prepared.uploads.length; index += 1) {
          const upload = prepared.uploads[index];
          const file = files[upload.clientIndex];
          if (!file) throw new Error('An attachment could not be matched to the secure upload.');
          const { error } = await storageClient.storage
            .from('case-evidence')
            .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type, cacheControl: '3600' });
          if (error) throw new Error(`Could not upload ${file.name}: ${error.message}`);
          updateProgress(progress, index + 2, files.length + 2, `Uploaded ${index + 1} of ${files.length} evidence file${files.length === 1 ? '' : 's'}…`);
        }
      }

      const finalized = await postJson('/api/finalize-case', { sessionToken: prepared.sessionToken });
      updateProgress(progress, files.length + 2, files.length + 2, 'Submission complete.');
      setStatus(status, '');
      form.hidden = true;
      success.hidden = false;
      success.querySelector('[data-reference]').textContent = finalized.reference;
      success.focus();
    } catch (error) {
      setStatus(status, error.message, 'error');
      resetProgress(progress);
      resetTurnstile(state, button);
    } finally {
      state.submitting = false;
      if (!form.hidden && state.turnstileToken) button.disabled = false;
    }
  });

  success?.querySelector('[data-submit-another]')?.addEventListener('click', () => {
    form.reset();
    fileList.replaceChildren();
    resetProgress(progress);
    success.hidden = true;
    form.hidden = false;
    setStatus(status, '');
    resetTurnstile(state, button);
    form.querySelector('input:not([type="hidden"])')?.focus();
  });
}

async function initializeContactForm(form) {
  const status = document.querySelector('#contact-status');
  const button = form.querySelector('.submit-button');
  const success = document.querySelector('#contact-success');
  const state = { turnstileToken: '', widgetId: undefined, config: null, submitting: false };

  try {
    const config = await getFormConfig();
    state.config = config;
    if (!config.configured) throw new Error('Direct messaging is being configured. Please use the campaign email until setup is complete.');
    await setupTurnstile({ config, containerId: 'contact-turnstile', action: 'contact_submission', button, state });
  } catch (error) {
    setStatus(status, error.message, 'error');
    button.disabled = true;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.submitting || !state.config) return;
    if (!form.reportValidity()) return;
    if (!state.turnstileToken) {
      setStatus(status, 'Complete the security check before sending.', 'error');
      return;
    }

    try {
      state.submitting = true;
      button.disabled = true;
      setStatus(status, 'Sending your message securely…', 'working');
      const formData = new FormData(form);
      const result = await postJson('/api/submit-contact', {
        name: formData.get('name'),
        email: formData.get('email'),
        category: formData.get('category'),
        subject: formData.get('subject'),
        message: formData.get('message'),
        consent: formData.get('consent'),
        website: formData.get('website'),
        turnstileToken: state.turnstileToken
      });
      setStatus(status, '');
      form.hidden = true;
      success.hidden = false;
      success.querySelector('[data-reference]').textContent = result.reference;
      success.focus();
    } catch (error) {
      setStatus(status, error.message, 'error');
      resetTurnstile(state, button);
    } finally {
      state.submitting = false;
      if (!form.hidden && state.turnstileToken) button.disabled = false;
    }
  });

  success?.querySelector('[data-send-another]')?.addEventListener('click', () => {
    form.reset();
    success.hidden = true;
    form.hidden = false;
    setStatus(status, '');
    resetTurnstile(state, button);
    form.querySelector('input:not([type="hidden"])')?.focus();
  });
}

const caseForm = document.querySelector('#case-form');
if (caseForm) initializeCaseForm(caseForm);

const contactForm = document.querySelector('#contact-form');
if (contactForm) initializeContactForm(contactForm);
