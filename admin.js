(() => {
  'use strict';

  const PUBLIC_STATUSES = ['Open Investigation','Awaiting Response','Under Review','Preliminary Finding','Final Finding','Inconclusive','Corrected','Withdrawn','Archived'];
  const FINDING_TYPES = ['Supported','Partially Supported','Unsupported','Misleading','Inconsistent Enforcement','Insufficient Evidence','Inconclusive','Corrected','Withdrawn','Custom'];
  const RESPONSE_STATUSES = ['Not Yet Contacted','Contacted','Awaiting Response','Response Received','Declined to Respond','No Response Received','Response Published'];
  const EVIDENCE_TYPES = ['Screenshot','Screen Recording','Video','Audio','PDF','Document','Webpage','Email','Public Statement','Data Table','Other'];
  const EVIDENCE_VISIBILITIES = ['Public','Private','Internal Review Only','Withheld for Privacy','Withheld for Legal or Safety Reasons'];
  const SOURCE_TYPES = ['Primary Record','Official Policy','Webpage','News Report','Academic Research','Public Statement','Court Record','Government Record','Data','Other'];
  const UPDATE_TYPES = ['Evidence Added','Company Response Added','Clarification','Correction','Finding Updated','Status Updated','Source Added','Investigation Withdrawn','Other'];
  const page = document.body.dataset.adminPage;
  const state = { client:null, session:null, profile:null, bundle:null, categories:[], editors:[], dirty:false, saving:false, autosaveTimer:null, replacementEvidenceId:null };

  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value='') => String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const text = (value) => value == null ? '' : String(value);
  const dateOnly = (value) => value ? String(value).slice(0,10) : '';
  const localDateTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = n => String(n).padStart(2,'0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const formatDate = (value, withTime=false) => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-US', withTime ? {dateStyle:'medium',timeStyle:'short'} : {dateStyle:'medium'}).format(d);
  };
  const formatBytes = (bytes) => {
    const n = Number(bytes || 0); if (!n) return 'No file';
    const units=['B','KB','MB','GB']; let i=0,v=n; while(v>=1024&&i<units.length-1){v/=1024;i++;}
    return `${v.toFixed(i?1:0)} ${units[i]}`;
  };
  const slugify = value => text(value).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120) || 'investigation';

  function setStatus(element, message, kind='') {
    if (!element) return;
    element.hidden = !message;
    element.textContent = message || '';
    element.className = element.classList.contains('form-status') ? 'form-status' : 'admin-alert';
    if (kind) element.classList.add(`is-${kind}`);
  }

  async function jsonFetch(url, options={}) {
    const headers = new Headers(options.headers || {});
    if (state.session?.access_token) headers.set('Authorization', `Bearer ${state.session.access_token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type','application/json');
    const response = await fetch(url, {...options, headers});
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      if (page !== 'login') location.replace(`/admin/login?returnTo=${encodeURIComponent(location.pathname+location.search)}`);
      throw new Error(data.error || 'Your session has expired.');
    }
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  async function initializeSupabase() {
    const config = await fetch('/api/form-config').then(r => r.json());
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) throw new Error('Supabase authentication is not configured.');
    state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    const {data} = await state.client.auth.getSession();
    state.session = data.session;
    state.client.auth.onAuthStateChange((_event, session) => { state.session = session; });
  }

  async function requireAdmin() {
    if (!state.session) {
      location.replace(`/admin/login?returnTo=${encodeURIComponent(location.pathname+location.search)}`);
      return false;
    }
    const result = await jsonFetch('/api/admin-session');
    state.profile = result.profile;
    $$('[data-admin-user]').forEach(el => el.textContent = `${result.profile.display_name} · ${result.profile.role}`);
    $$('[data-admin-logout]').forEach(el => el.addEventListener('click', logout));
    return true;
  }

  async function logout() {
    if (state.client) await state.client.auth.signOut();
    location.replace('/admin/login');
  }

  function fillSelect(el, options, value='', placeholder=null) {
    if (!el) return;
    const first = placeholder == null ? '' : `<option value="">${escapeHtml(placeholder)}</option>`;
    el.innerHTML = first + options.map(item => {
      const val = typeof item === 'string' ? item : item.value;
      const label = typeof item === 'string' ? item : item.label;
      return `<option value="${escapeHtml(val)}">${escapeHtml(label)}</option>`;
    }).join('');
    el.value = value || '';
  }

  async function initLogin() {
    if (state.session) {
      try { await jsonFetch('/api/admin-session'); location.replace(new URLSearchParams(location.search).get('returnTo') || '/admin/investigations'); return; }
      catch (_) { /* show login */ }
    }
    const form = $('#admin-login-form');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const status = $('#admin-login-status');
      setStatus(status,'Signing in…');
      const button = $('button[type="submit"]',form); button.disabled=true;
      try {
        const {data,error} = await state.client.auth.signInWithPassword({email:$('#admin-email').value.trim(),password:$('#admin-password').value});
        if (error) throw error;
        state.session=data.session;
        await jsonFetch('/api/admin-session');
        location.replace(new URLSearchParams(location.search).get('returnTo') || '/admin/investigations');
      } catch(error) {
        await state.client.auth.signOut();
        setStatus(status,error.message || 'Sign-in failed.','error');
        button.disabled=false;
      }
    });
  }

  function dashboardRow(item, editors) {
    const editor = editors.find(e => e.user_id === item.assigned_editor_id)?.display_name || 'Unassigned';
    const finding = item.finding_classification === 'Custom' ? item.custom_finding_label : item.finding_classification;
    return `<tr data-row-id="${escapeHtml(item.id)}">
      <td data-label="Case"><strong>${escapeHtml(item.case_number)}</strong></td>
      <td data-label="Title / Subject"><span class="table-title">${escapeHtml(item.title)}</span><span class="table-subject">${escapeHtml(item.subject || 'No subject')}</span></td>
      <td data-label="Workflow"><span class="workflow-badge">${escapeHtml(item.workflow_status.replaceAll('_',' '))}</span></td>
      <td data-label="Status / Finding"><span class="status-badge">${escapeHtml(item.status)}</span>${finding?`<br><span class="finding-badge">${escapeHtml(finding)}</span>`:''}</td>
      <td data-label="Editor">${escapeHtml(editor)}</td>
      <td data-label="Updated">${escapeHtml(formatDate(item.updated_at,true))}</td>
      <td data-label="Evidence">${Number(item.evidence_count||0)}</td>
      <td data-label="Actions"><div class="admin-actions"><a class="btn btn-light" href="/admin/investigations/${encodeURIComponent(item.id)}/edit">Edit</a><a class="btn btn-light" href="/admin/investigations/${encodeURIComponent(item.id)}/preview">Preview</a><button class="btn btn-light" type="button" data-duplicate="${escapeHtml(item.id)}">Duplicate</button></div></td>
    </tr>`;
  }

  function renderCorrections(items=[]) {
    $('#correction-count').textContent = String(items.length);
    $('#correction-empty').hidden = items.length>0;
    const list=$('#correction-list');
    list.innerHTML=items.map(item=>`<article class="correction-review-card" data-correction-id="${escapeHtml(item.id)}">
      <header><div><h3>${escapeHtml(item.reference_number)} · ${escapeHtml(item.case_number)}</h3><div class="correction-review-meta">${escapeHtml(item.name)} · ${escapeHtml(item.email)} · ${escapeHtml(formatDate(item.created_at,true))}</div></div><span class="status-badge">${escapeHtml(item.status)}</span></header>
      <details><summary>Review request</summary><p><strong>Statement challenged:</strong><br>${escapeHtml(item.challenged_statement)}</p><p><strong>Explanation:</strong><br>${escapeHtml(item.explanation || '')}</p><p><strong>Requested correction:</strong><br>${escapeHtml(item.requested_correction)}</p>${item.source_url ? `<p><a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">Open supporting source ↗</a></p>` : ''}${(item.correction_attachments||[]).map(a=>a.admin_url?`<p><a href="${escapeHtml(a.admin_url)}" target="_blank" rel="noopener noreferrer">Open private attachment: ${escapeHtml(a.original_filename)} ↗</a></p>`:'').join('')}</details>
      <div class="correction-review-controls"><div class="field"><label>Status</label><select data-correction-status>${['received','reviewing','accepted','declined','closed'].map(v=>`<option ${v===item.status?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Internal notes</label><input data-correction-notes placeholder="Private review notes"></div><button class="btn btn-dark" type="button" data-save-correction>Save Review</button></div>
    </article>`).join('');
    $$('[data-save-correction]',list).forEach(button=>button.addEventListener('click',async()=>{
      const card=button.closest('[data-correction-id]'); button.disabled=true;
      try { await jsonFetch('/api/admin-corrections',{method:'POST',body:JSON.stringify({id:card.dataset.correctionId,status:$('[data-correction-status]',card).value,internalNotes:$('[data-correction-notes]',card).value})}); button.textContent='Saved'; }
      catch(error){ alert(error.message); }
      finally { setTimeout(()=>{button.disabled=false;button.textContent='Save Review';},900); }
    }));
  }

  async function initDashboard() {
    await requireAdmin();
    const status=$('#admin-dashboard-status');
    setStatus(status,'Loading investigations…');
    try {
      const data=await jsonFetch('/api/admin-investigations');
      state.categories=data.categories||[]; state.editors=data.editors||[];
      const items=data.items||[];
      fillSelect($('#status-filter'),PUBLIC_STATUSES,'','All statuses');
      fillSelect($('#finding-filter'),FINDING_TYPES,'','All findings');
      fillSelect($('#response-filter'),RESPONSE_STATUSES,'','All response statuses');
      fillSelect($('#editor-filter'),state.editors.map(e=>({value:e.user_id,label:e.display_name})),'','All editors');
      const render=()=>{
        const q=$('#admin-search').value.trim().toLowerCase(), workflow=$('#workflow-filter').value,statusValue=$('#status-filter').value,finding=$('#finding-filter').value,response=$('#response-filter').value,editor=$('#editor-filter').value;
        const filtered=items.filter(i=>(!q||[i.case_number,i.title,i.subject].join(' ').toLowerCase().includes(q))&&(!workflow||i.workflow_status===workflow)&&(!statusValue||i.status===statusValue)&&(!finding||i.finding_classification===finding)&&(!response||i.response_status===response)&&(!editor||i.assigned_editor_id===editor));
        $('#admin-investigation-table tbody').innerHTML=filtered.map(i=>dashboardRow(i,state.editors)).join('');
        $('#admin-investigation-empty').hidden=filtered.length>0;
        $$('[data-duplicate]').forEach(button=>button.addEventListener('click',async()=>{
          if(!confirm('Create a new draft copy of this investigation? Uploaded files will not be copied.'))return;
          button.disabled=true;
          try { const result=await jsonFetch('/api/admin-investigations',{method:'POST',body:JSON.stringify({action:'duplicate',id:button.dataset.duplicate})}); location.href=`/admin/investigations/${result.investigation.id}/edit`; }
          catch(error){alert(error.message);button.disabled=false;}
        }));
      };
      $('#admin-investigation-filters').addEventListener('submit',e=>{e.preventDefault();render();});
      $('#admin-clear-filters').addEventListener('click',()=>{$$('#admin-investigation-filters input,#admin-investigation-filters select').forEach(el=>el.value='');render();});
      render();
      const correctionData = await jsonFetch('/api/admin-corrections');
      renderCorrections(correctionData.items || []);
      setStatus(status,'');
    } catch(error){setStatus(status,error.message,'error');}
  }

  function toolbarButton(command,label,value=null){return `<button type="button" data-command="${command}"${value?` data-value="${value}"`:''} aria-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`;}
  function initRichEditors(){
    $$('[data-toolbar]').forEach(toolbar=>{
      toolbar.innerHTML=[toolbarButton('formatBlock','P','p'),toolbarButton('formatBlock','H2','h2'),toolbarButton('formatBlock','H3','h3'),toolbarButton('bold','B'),toolbarButton('italic','I'),toolbarButton('insertUnorderedList','• List'),toolbarButton('insertOrderedList','1. List'),toolbarButton('formatBlock','Quote','blockquote'),toolbarButton('createLink','Link')].join('');
      const editor=$(`#${CSS.escape(toolbar.dataset.toolbar)}`);
      toolbar.addEventListener('click',event=>{
        const button=event.target.closest('[data-command]');if(!button)return;event.preventDefault();editor.focus();
        const cmd=button.dataset.command;let value=button.dataset.value||null;
        if(cmd==='createLink'){value=prompt('Enter a complete https:// link:');if(!value)return;}
        document.execCommand(cmd,false,value);markDirty();
      });
    });
  }

  function field(label, name, value = '', opts = {}) {
    let control;
    if (opts.type === 'textarea') {
      control = `<textarea data-field="${escapeHtml(name)}">${escapeHtml(value)}</textarea>`;
    } else if (opts.type === 'select') {
      control = `<select data-field="${escapeHtml(name)}">${(opts.options || []).map(v => `<option value="${escapeHtml(v)}" ${v === value ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select>`;
    } else {
      control = `<input data-field="${escapeHtml(name)}" type="${escapeHtml(opts.type || 'text')}" value="${escapeHtml(value)}" ${opts.placeholder ? `placeholder="${escapeHtml(opts.placeholder)}"` : ''}>`;
    }
    return `<div class="field ${escapeHtml(opts.className || '')}"><label>${escapeHtml(label)}</label>${control}</div>`;
  }
  function repeaterRow(type,data={}){
    let html='';
    if(type==='comparison') html=field('Comparison group','comparison_group',data.comparison_group)+field('Item or phrase tested','tested_item',data.tested_item)+field('Result','result',data.result)+field('Date tested','tested_at',localDateTime(data.tested_at),{type:'datetime-local'})+field('Evidence exhibit','evidence_label',data.evidence_label)+field('Notes','notes',data.notes,{type:'textarea',className:'full'});
    if(type==='supported'||type==='limitation') html=field(type==='supported'?'Supported statement':'Limitation','statement',data.statement,{type:'textarea',className:'full'});
    if(type==='response-question'||type==='remaining-question') html=field('Question','question',data.question,{type:'textarea',className:'full'});
    if(type==='source') html=field('Source title','title',data.title)+field('Publisher / organization','publisher',data.publisher)+field('URL','url',data.url,{type:'url',className:'half'})+field('Archived URL','archived_url',data.archived_url,{type:'url',className:'half'})+field('Publication date','publication_date',dateOnly(data.publication_date),{type:'date'})+field('Date accessed','accessed_date',dateOnly(data.accessed_date),{type:'date'})+field('Source type','source_type',data.source_type||'Other',{type:'select',options:SOURCE_TYPES})+field('Description','description',data.description,{type:'textarea',className:'full'});
    if(type==='update') html=`<input type="hidden" data-field="id" value="${escapeHtml(data.id||'')}">`+field('Update type','update_type',data.update_type||'Other',{type:'select',options:UPDATE_TYPES})+field('Date','occurred_at',localDateTime(data.occurred_at),{type:'datetime-local'})+field('Description','description',data.description,{type:'textarea',className:'full'})+field('Previous wording','previous_wording',data.previous_wording,{type:'textarea',className:'half'})+field('New wording','new_wording',data.new_wording,{type:'textarea',className:'half'})+`<div class="field checkbox-field"><input type="checkbox" data-field="finding_changed" ${data.finding_changed?'checked':''}><label>Finding changed</label></div><div class="field checkbox-field"><input type="checkbox" data-field="public_visible" ${data.public_visible===false?'':'checked'}><label>Show publicly</label></div>`;
    const row=document.createElement('div');row.className='repeater-row';row.dataset.rowType=type;const lockedUpdate=type==='update'&&Boolean(data.id)&&Boolean(state.bundle?.investigation?.published_at);row.innerHTML=`<button class="remove-row" type="button" aria-label="Remove row">×</button>${html}${lockedUpdate?'<p class="locked-history-note">Published history entry — add a new update to change the public record.</p>':''}`;const removeButton=row.querySelector('.remove-row');if(lockedUpdate){row.classList.add('is-locked-history');removeButton.hidden=true;row.querySelectorAll('input,select,textarea').forEach(control=>control.disabled=true);}else{removeButton.addEventListener('click',()=>{row.remove();markDirty();});row.addEventListener('input',markDirty);row.addEventListener('change',markDirty);}return row;
  }
  function repeaterTarget(type){return {comparison:'#comparison-repeater',supported:'#supported-repeater',limitation:'#limitations-repeater','response-question':'#response-question-repeater',source:'#source-repeater',update:'#update-repeater','remaining-question':'#remaining-question-repeater'}[type];}
  function addRepeater(type,data={}){const target=$(repeaterTarget(type));if(target)target.append(repeaterRow(type,data));}
  function collectRepeater(type){return $$(repeaterTarget(type)+' .repeater-row').map(row=>{const obj={};$$('[data-field]',row).forEach(el=>obj[el.dataset.field]=el.type==='checkbox'?el.checked:el.value);return obj;});}

  function markDirty(){if(!state.bundle||state.saving)return;state.dirty=true;const el=$('#editor-save-state');if(el){el.textContent='Unsaved changes';el.className='save-state is-dirty';}clearTimeout(state.autosaveTimer);state.autosaveTimer=setTimeout(()=>saveEditor(true).catch(()=>{}),45000);}
  function markSaved(){state.dirty=false;const el=$('#editor-save-state');if(el){el.textContent=`Saved ${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`;el.className='save-state';}}

  function setEditorData(bundle,categories,editors){
    state.bundle=bundle;state.categories=categories;state.editors=editors;const inv=bundle.investigation;
    $('#editor-case-label').textContent=inv.case_number;$('#editor-workflow-label').textContent=inv.workflow_status.replaceAll('_',' ');$('#case-number').value=inv.case_number;$('#workflow-status').value=inv.workflow_status;
    fillSelect($('#investigation-status'),PUBLIC_STATUSES,inv.status);fillSelect($('#investigation-response-status'),RESPONSE_STATUSES,inv.response_status);fillSelect($('#response-status'),RESPONSE_STATUSES,(bundle.responses[0]?.response_status||inv.response_status));fillSelect($('#finding-type'),FINDING_TYPES,(bundle.findings.find(f=>f.is_current)?.finding_type||inv.finding_classification||'Inconclusive'));fillSelect($('#evidence-type'),EVIDENCE_TYPES,'Screenshot');fillSelect($('#evidence-visibility'),EVIDENCE_VISIBILITIES,'Private');
    fillSelect($('#investigation-category'),categories.map(c=>({value:c.id,label:c.name})),inv.category_id,'Uncategorized');fillSelect($('#investigation-editor'),editors.map(e=>({value:e.user_id,label:`${e.display_name} (${e.role})`})),inv.assigned_editor_id,'Unassigned');
    $$('[data-parent]').forEach(el=>{const key=el.dataset.parent; if(el.type==='checkbox')el.checked=inv[key]!==false; else el.value=inv[key]??'';});
    $$('[data-rich]').forEach(el=>el.innerHTML=inv[el.dataset.rich]||'');
    $('#investigation-tags').value=(bundle.tags||[]).map(t=>t.name).join(', ');
    const response=bundle.responses[0]||{};$('#response-contacted').checked=!!response.contacted;$('#response-contacted-at').value=localDateTime(response.contacted_at);$('#response-method').value=response.contact_method||'';$('#response-deadline').value=localDateTime(response.response_deadline);$('#response-received-at').value=localDateTime(response.response_received_at);$('#response-editor').innerHTML=response.response_html||'';$('#response-document-url').value=response.response_document_url||'';$('#response-note-editor').innerHTML=response.editorial_note_html||'';$('#response-public').checked=response.public_visible!==false;
    const finding=bundle.findings.find(f=>f.is_current)||{};$('#finding-stage').value=finding.stage||inv.finding_stage||'Preliminary';$('#custom-finding-label').value=finding.custom_label||inv.custom_finding_label||'';$('#finding-headline').value=finding.headline||'';$('#finding-editor').innerHTML=finding.explanation_html||'';$('#finding-issued').value=localDateTime(finding.issued_at);$('#finding-approver').value=finding.approving_editor_name||inv.approving_editor_name||'';$('#custom-finding-field').hidden=$('#finding-type').value!=='Custom';$('#material-change-confirm').hidden=!inv.published_at;
    const map=[['comparison',bundle.comparisons],['supported',(bundle.assertions||[]).filter(a=>a.assertion_type==='supported')],['limitation',(bundle.assertions||[]).filter(a=>a.assertion_type==='limitation')],['response-question',(bundle.questions||[]).filter(q=>q.question_type==='right_of_response')],['remaining-question',(bundle.questions||[]).filter(q=>q.question_type==='remaining')],['source',bundle.sources],['update',bundle.updates]];
    map.forEach(([type,rows])=>{const target=$(repeaterTarget(type));target.innerHTML='';(rows||[]).forEach(row=>addRepeater(type,row));});
    renderEvidence(bundle.evidence||[]);renderWorkflow(inv,state.profile);renderTimeline('#revision-list',bundle.revisions||[],r=>`Revision ${r.revision_number}`,r=>r.change_summary||'Saved revision');renderTimeline('#audit-list',bundle.audit||[],r=>r.action.replaceAll('_',' '),r=>JSON.stringify(r.details||{}));
    markSaved();
  }

  function renderTimeline(selector,items,title,detail){const root=$(selector);root.className='timeline-list';root.innerHTML=items.length?items.slice(0,30).map(item=>`<div class="timeline-item"><strong>${escapeHtml(title(item))}</strong><span>${escapeHtml(detail(item))}</span><small> · ${escapeHtml(formatDate(item.created_at,true))}</small></div>`).join(''):'<p class="help">No entries yet.</p>';}

  function renderEvidence(items){
    const root=$('#evidence-admin-list');root.innerHTML=items.map((item,index)=>`<article class="admin-evidence-card" data-evidence-id="${escapeHtml(item.id)}">
      ${item.admin_preview_url?`<img src="${escapeHtml(item.admin_preview_url)}" alt="${escapeHtml(item.alt_text||item.title)}">`:item.admin_original_url&&item.content_type?.startsWith('video/')?`<video controls src="${escapeHtml(item.admin_original_url)}"></video>`:`<div class="evidence-file-card"><strong>${escapeHtml(item.evidence_type)}</strong><span>${escapeHtml(formatBytes(item.size_bytes))}</span></div>`}
      <div class="admin-evidence-meta"><span class="status-badge">${escapeHtml(item.visibility)}</span>${item.placeholder?'<span class="finding-badge">Empty slot</span>':''}${item.upload_status!=='ready'?`<span class="finding-badge">${escapeHtml(item.upload_status)}</span>`:''}</div>
      ${field('Exhibit label','exhibit_label',item.exhibit_label,{className:'full'})}${field('Title','title',item.title,{className:'full'})}${field('Description','description',item.description,{type:'textarea',className:'full'})}${field('Evidence type','evidence_type',item.evidence_type,{type:'select',options:EVIDENCE_TYPES})}${field('Visibility','visibility',item.visibility,{type:'select',options:EVIDENCE_VISIBILITIES})}${field('Withheld explanation','withheld_reason',item.withheld_reason,{type:'textarea',className:'full'})}${field('Source','source_name',item.source_name)}${field('Original URL','source_url',item.source_url,{type:'url'})}${field('Date captured','captured_at',localDateTime(item.captured_at),{type:'datetime-local'})}${field('Authenticity note','authenticity_note',item.authenticity_note,{type:'textarea',className:'full'})}${field('Alt text / description','alt_text',item.alt_text,{className:'full'})}${field('Transcript / captions','transcript',item.transcript,{type:'textarea',className:'full'})}
      <div class="checkbox-field"><input type="checkbox" data-field="allow_download" ${item.allow_download?'checked':''}><label>Allow public download</label></div><div class="checkbox-field"><input type="checkbox" data-field="featured" ${item.featured?'checked':''}><label>Featured exhibit</label></div><input type="hidden" data-field="placeholder" value="${item.placeholder?'true':'false'}"><input type="hidden" data-field="id" value="${escapeHtml(item.id)}"><div class="admin-actions">${item.admin_original_url?`<a class="btn btn-light" href="${escapeHtml(item.admin_original_url)}" target="_blank" rel="noopener">Open Original</a>`:''}${item.placeholder||!item.admin_original_url?'<button class="btn btn-light" type="button" data-replace-evidence>Fill Exhibit Slot</button>':''}<button class="btn btn-danger" type="button" data-delete-evidence>Remove</button></div>
    </article>`).join('');
    $$('.admin-evidence-card',root).forEach(card=>{
      card.addEventListener('input',markDirty);card.addEventListener('change',markDirty);
      $('[data-delete-evidence]',card).addEventListener('click',()=>deleteEvidence(card.dataset.evidenceId));
      const replaceButton=$('[data-replace-evidence]',card);if(replaceButton)replaceButton.addEventListener('click',()=>{
        const get=name=>$(`[data-field="${name}"]`,card);
        state.replacementEvidenceId=card.dataset.evidenceId;
        $('#evidence-exhibit-label').value=get('exhibit_label')?.value||'';
        $('#evidence-title').value=get('title')?.value||'';
        $('#evidence-type').value=get('evidence_type')?.value||'Other';
        $('#evidence-visibility').value=get('visibility')?.value||'Private';
        $('#evidence-description').value=get('description')?.value||'';
        $('#evidence-captured').value=get('captured_at')?.value||'';
        $('#evidence-source-name').value=get('source_name')?.value||'';
        $('#evidence-source-url').value=get('source_url')?.value||'';
        $('#evidence-authenticity').value=get('authenticity_note')?.value||'';
        $('#evidence-alt').value=get('alt_text')?.value||'';
        $('#evidence-transcript').value=get('transcript')?.value||'';
        $('#evidence-download').checked=!!get('allow_download')?.checked;
        $('#evidence-featured').checked=!!get('featured')?.checked;
        $('#upload-evidence').textContent='Upload Exhibit File';
        $('#evidence-drop-zone').scrollIntoView({behavior:'smooth',block:'center'});
      });
    });
  }
  function collectEvidence(){return $$('.admin-evidence-card').map(card=>{const obj={};$$('[data-field]',card).forEach(el=>obj[el.dataset.field]=el.type==='checkbox'?el.checked:el.value);obj.placeholder=obj.placeholder==='true';return obj;});}

  function editorPayload(autosave=false){
    const investigation={};$$('[data-parent]').forEach(el=>investigation[el.dataset.parent]=el.type==='checkbox'?el.checked:el.value);$$('[data-rich]').forEach(el=>investigation[el.dataset.rich]=el.innerHTML.trim());
    const response={contacted:$('#response-contacted').checked,contacted_at:$('#response-contacted-at').value,contact_method:$('#response-method').value,response_deadline:$('#response-deadline').value,response_status:$('#response-status').value,response_received_at:$('#response-received-at').value,response_html:$('#response-editor').innerHTML.trim(),response_document_url:$('#response-document-url').value,editorial_note_html:$('#response-note-editor').innerHTML.trim(),public_visible:$('#response-public').checked};
    investigation.response_status=response.response_status;
    const finding={finding_type:$('#finding-type').value,custom_label:$('#custom-finding-label').value,headline:$('#finding-headline').value,explanation_html:$('#finding-editor').innerHTML.trim(),issued_at:$('#finding-issued').value,stage:$('#finding-stage').value,approving_editor_name:$('#finding-approver').value,is_current:true};
    return {autosave,changeSummary:autosave?'Automatic draft save':'Editor save',investigation,tags:$('#investigation-tags').value.split(',').map(name=>({name:name.trim()})).filter(t=>t.name),comparisons:collectRepeater('comparison'),assertions:[...collectRepeater('supported').map(r=>({...r,assertion_type:'supported'})),...collectRepeater('limitation').map(r=>({...r,assertion_type:'limitation'}))],questions:[...collectRepeater('response-question').map(r=>({...r,question_type:'right_of_response'})),...collectRepeater('remaining-question').map(r=>({...r,question_type:'remaining'}))],responses:[response],findings:[finding],sources:collectRepeater('source'),updates:collectRepeater('update'),evidence:collectEvidence(),confirmMaterialChange:$('#confirm-material-change').checked,findingChangeDescription:$('#finding-change-description').value};
  }

  async function saveEditor(autosave=false){
    if(!state.bundle||state.saving||(!state.dirty&&autosave))return state.bundle;
    state.saving=true;const saveState=$('#editor-save-state');if(saveState){saveState.textContent=autosave?'Autosaving…':'Saving…';saveState.className='save-state is-saving';}
    try {const result=await jsonFetch(`/api/admin-investigation?id=${encodeURIComponent(state.bundle.investigation.id)}`,{method:'PUT',body:JSON.stringify(editorPayload(autosave))});setEditorData(result.bundle,state.categories,state.editors);if(!autosave)setStatus($('#editor-status'),'Investigation saved.','success');return result.bundle;}
    catch(error){setStatus($('#editor-status'),error.message,'error');if(saveState){saveState.textContent='Save failed';saveState.className='save-state is-dirty';}throw error;}
    finally{state.saving=false;}
  }

  function renderWorkflow(inv,profile){
    const root=$('#workflow-actions'),danger=$('#workflow-danger-actions');root.innerHTML='';danger.innerHTML='';const role=profile.role,workflow=inv.workflow_status;
    const add=(target,label,action,kind='dark',needsReason=false)=>{const b=document.createElement('button');b.type='button';b.className=`btn btn-${kind}`;b.textContent=label;b.addEventListener('click',()=>workflowAction(action,label,needsReason));target.append(b);};
    if(workflow==='draft'&&['admin','editor'].includes(role))add(root,'Submit for Internal Review','submit_review');
    if(workflow==='internal_review'&&['admin','reviewer'].includes(role)){add(root,'Approve Investigation','approve','primary');add(root,'Return to Draft','return_draft','light');}
    if(workflow==='approved'&&['admin','reviewer'].includes(role)){add(root,'Publish Investigation','publish','primary');add(root,'Return to Draft','return_draft','light');}
    if(workflow==='published'&&['admin','reviewer'].includes(role))add(danger,'Unpublish','unpublish','danger',true);
    if(!['archived','withdrawn'].includes(workflow)&&['admin','reviewer'].includes(role)){add(danger,'Archive','archive','danger',true);add(danger,'Withdraw','withdraw','danger',true);}
    if(role==='admin')add(danger,'Override Case Number','override_case_number','light');
    if(workflow==='draft'&&!inv.published_at&&role==='admin')add(danger,'Delete Unpublished Draft','delete','danger',true);
  }
  async function workflowAction(action,label,needsReason){
    if(state.dirty)await saveEditor(false);
    let reason='';if(needsReason){reason=prompt(`${label} requires a written reason that may become part of the case record:`)||'';if(!reason.trim())return;}
    let caseNumber='';
    if(action==='override_case_number'){caseNumber=(prompt('Enter the replacement case number in UM-YYYY-### format:',state.bundle.investigation.case_number)||'').trim();if(!caseNumber)return;}
    if(!confirm(`Confirm: ${label}?`))return;
    try {const result=await jsonFetch(`/api/admin-investigation?id=${encodeURIComponent(state.bundle.investigation.id)}`,{method:'POST',body:JSON.stringify({action,confirm:true,reason,caseNumber})});if(result.deleted){location.replace('/admin/investigations');return;}setEditorData(result.bundle,state.categories,state.editors);setStatus($('#editor-status'),`${label} completed.`,'success');}
    catch(error){setStatus($('#editor-status'),error.message,'error');}
  }

  async function makeImagePreview(file){
    if(!file.type.startsWith('image/'))return null;
    const bitmap=await createImageBitmap(file);const max=1800;const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();return new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.84));
  }
  function progress(value,message){const box=$('#admin-evidence-progress'),bar=$('.upload-progress-bar',box),span=$('span',bar),label=$('[data-progress-text]',box);box.hidden=false;bar.setAttribute('aria-valuenow',String(value));span.style.width=`${value}%`;label.textContent=message;if(value>=100)setTimeout(()=>box.hidden=true,1200);}
  async function uploadEvidence(){
    const file=$('#evidence-file').files[0];if(!file){alert('Choose an evidence file first.');return;}const button=$('#upload-evidence');button.disabled=true;
    try {progress(5,'Preparing secure upload…');const body={action:'prepare',investigationId:state.bundle.investigation.id,evidenceId:state.replacementEvidenceId||undefined,exhibitLabel:$('#evidence-exhibit-label').value,title:$('#evidence-title').value,evidenceType:$('#evidence-type').value,visibility:$('#evidence-visibility').value,description:$('#evidence-description').value,capturedAt:$('#evidence-captured').value,sourceName:$('#evidence-source-name').value,sourceUrl:$('#evidence-source-url').value,authenticityNote:$('#evidence-authenticity').value,altText:$('#evidence-alt').value,transcript:$('#evidence-transcript').value,allowDownload:$('#evidence-download').checked,featured:$('#evidence-featured').checked,file:{name:file.name,type:file.type,size:file.size}};const prepared=await jsonFetch('/api/admin-evidence',{method:'POST',body:JSON.stringify(body)});const upload=prepared.upload;progress(25,'Uploading original evidence…');const {error:originalError}=await state.client.storage.from(upload.bucket).uploadToSignedUrl(upload.original.path,upload.original.token,file,{contentType:file.type});if(originalError)throw originalError;let previewUploaded=false;if(upload.preview){progress(70,'Creating an optimized public preview…');const preview=await makeImagePreview(file);if(preview){const {error}=await state.client.storage.from(upload.bucket).uploadToSignedUrl(upload.preview.path,upload.preview.token,preview,{contentType:'image/webp'});if(error)throw error;previewUploaded=true;}}
      progress(90,'Finalizing evidence record…');await jsonFetch('/api/admin-evidence',{method:'POST',body:JSON.stringify({action:'finalize',investigationId:state.bundle.investigation.id,evidenceId:upload.evidenceId,previewUploaded})});const refreshed=await jsonFetch(`/api/admin-investigation?id=${encodeURIComponent(state.bundle.investigation.id)}`);setEditorData(refreshed.bundle,refreshed.categories,refreshed.editors);['#evidence-exhibit-label','#evidence-title','#evidence-description','#evidence-captured','#evidence-source-name','#evidence-source-url','#evidence-authenticity','#evidence-alt','#evidence-transcript'].forEach(s=>$(s).value='');$('#evidence-file').value='';state.replacementEvidenceId=null;$('#upload-evidence').textContent='Upload Evidence';progress(100,'Evidence uploaded securely.');setStatus($('#editor-status'),'Evidence uploaded and retained privately unless marked public.','success');
    } catch(error){progress(0,`Upload failed: ${error.message}`);setStatus($('#editor-status'),error.message,'error');}
    finally{button.disabled=false;}
  }
  async function deleteEvidence(id){const evidence=state.bundle.evidence.find(item=>item.id===id);let reason='';if(state.bundle.investigation.published_at&&evidence?.visibility==='Public'){reason=(prompt('This exhibit has appeared publicly. Enter the explanation that should be added to the permanent update log:')||'').trim();if(!reason)return;}if(!confirm('Remove this evidence record and its stored files? This action is audited and cannot be undone.'))return;try{await jsonFetch('/api/admin-evidence',{method:'POST',body:JSON.stringify({action:'delete',investigationId:state.bundle.investigation.id,evidenceId:id,confirm:true,reason})});const refreshed=await jsonFetch(`/api/admin-investigation?id=${encodeURIComponent(state.bundle.investigation.id)}`);setEditorData(refreshed.bundle,refreshed.categories,refreshed.editors);setStatus($('#editor-status'),'Evidence removed.','success');}catch(error){setStatus($('#editor-status'),error.message,'error');}}

  async function initEditor(){
    await requireAdmin();initRichEditors();$$('[data-add-row]').forEach(button=>button.addEventListener('click',()=>{addRepeater(button.dataset.addRow);markDirty();}));$('#finding-type').addEventListener('change',()=>{$('#custom-finding-field').hidden=$('#finding-type').value!=='Custom';markDirty();});
    const summaryResponseStatus=$('#investigation-response-status');const detailedResponseStatus=$('#response-status');
    summaryResponseStatus.addEventListener('change',()=>{detailedResponseStatus.value=summaryResponseStatus.value;markDirty();});
    detailedResponseStatus.addEventListener('change',()=>{summaryResponseStatus.value=detailedResponseStatus.value;markDirty();});
    $('#upload-evidence').addEventListener('click',uploadEvidence);const drop=$('#evidence-drop-zone');['dragenter','dragover'].forEach(name=>drop.addEventListener(name,e=>{e.preventDefault();drop.classList.add('is-dragover');}));['dragleave','drop'].forEach(name=>drop.addEventListener(name,e=>{e.preventDefault();drop.classList.remove('is-dragover');if(name==='drop'&&e.dataTransfer.files.length){const dt=new DataTransfer();dt.items.add(e.dataTransfer.files[0]);$('#evidence-file').files=dt.files;}}));
    const params=new URLSearchParams(location.search);const isNew=params.get('mode')==='new'||location.pathname.endsWith('/new');
    if(isNew){$('#admin-editor-loading').hidden=true;$('#new-investigation-panel').hidden=false;const dash=await jsonFetch('/api/admin-investigations');state.categories=dash.categories||[];fillSelect($('#new-category'),state.categories.map(c=>({value:c.id,label:c.name})),'','Uncategorized');$('#new-investigation-form').addEventListener('submit',async e=>{e.preventDefault();const status=$('#new-investigation-status');setStatus(status,'Creating case file…');try{const result=await jsonFetch('/api/admin-investigations',{method:'POST',body:JSON.stringify({action:'create',title:$('#new-title').value,subject:$('#new-subject').value,categoryId:$('#new-category').value||null,shortSummary:$('#new-summary').value})});location.replace(`/admin/investigations/${result.investigation.id}/edit`);}catch(error){setStatus(status,error.message,'error');}});return;}
    const id=params.get('id')||location.pathname.match(/\/admin\/investigations\/([^/]+)\/edit/)?.[1];if(!id){setStatus($('#editor-status'),'Investigation ID is missing.','error');return;}
    try{const result=await jsonFetch(`/api/admin-investigation?id=${encodeURIComponent(id)}`);state.profile=result.profile;setEditorData(result.bundle,result.categories,result.editors);$('#admin-editor-loading').hidden=true;$('#investigation-editor-panel').hidden=false;$('#save-investigation').addEventListener('click',()=>saveEditor(false));$('#preview-investigation').addEventListener('click',async()=>{if(state.dirty)await saveEditor(false);window.open(`/admin/investigations/${encodeURIComponent(id)}/preview`,'_blank','noopener');});$('#investigation-form').addEventListener('input',markDirty);$('#investigation-form').addEventListener('change',markDirty);window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});}
    catch(error){$('#admin-editor-loading').textContent=error.message;}
  }

  function previewSection(title,html){return html?`<section class="case-section"><span class="case-section-label">Case File</span><h2>${escapeHtml(title)}</h2><div class="rich-content">${html}</div></section>`:'';}
  function renderProtectedPreview(bundle){
    const inv=bundle.investigation,finding=bundle.findings.find(f=>f.is_current),supported=bundle.assertions.filter(a=>a.assertion_type==='supported'),limitations=bundle.assertions.filter(a=>a.assertion_type==='limitation');
    const comparisons=bundle.comparisons.length?`<section class="case-section"><span class="case-section-label">Structured Results</span><h2>Test Results</h2><div class="comparison-table-wrap"><table class="comparison-table"><thead><tr><th>Group</th><th>Item Tested</th><th>Result</th><th>Date</th><th>Notes</th></tr></thead><tbody>${bundle.comparisons.map(c=>`<tr><td data-label="Group">${escapeHtml(c.comparison_group||'Comparison')}</td><td data-label="Item Tested"><strong>${escapeHtml(c.tested_item)}</strong></td><td data-label="Result">${escapeHtml(c.result)}</td><td data-label="Date">${escapeHtml(c.tested_at||'Not recorded')}</td><td data-label="Notes">${escapeHtml(c.notes||'')}</td></tr>`).join('')}</tbody></table></div></section>`:'';
    return `<article class="investigation-detail admin-preview-frame"><header class="case-header"><div class="container case-header-grid"><div><span class="case-number">${escapeHtml(inv.case_number)}</span><h1>${escapeHtml(inv.title)}</h1>${inv.subtitle?`<p class="case-subtitle">${escapeHtml(inv.subtitle)}</p>`:''}<div class="case-badges"><span class="status-badge">${escapeHtml(inv.status)}</span>${finding?`<span class="finding-badge">${escapeHtml(finding.finding_type)}</span>`:''}<span class="status-badge">Protected Draft Preview</span></div></div><img class="case-header-mark" src="/assets/shield.png" alt="The Unshaken Majority shield"></div></header><div class="container case-layout"><main class="case-document">${previewSection('Case Summary',inv.case_summary_html)}${previewSection('Claim Being Examined',inv.claim_html)}${previewSection('Standard Being Applied',inv.standard_html)}${previewSection('Methodology',inv.methodology_html)}${comparisons}${supported.length?`<section class="case-section"><span class="case-section-label">Supported by the Record</span><h2>What the Evidence Supports</h2><ul class="assertion-list">${supported.map(a=>`<li>${escapeHtml(a.statement)}</li>`).join('')}</ul></section>`:''}${limitations.length?`<section class="case-section"><span class="case-section-label">Required Limitations</span><h2>What the Evidence Does Not Establish</h2><ul class="assertion-list limitation-list">${limitations.map(a=>`<li>${escapeHtml(a.statement)}</li>`).join('')}</ul></section>`:''}${finding?`<section class="case-section finding-panel"><span class="case-section-label">${escapeHtml(finding.stage)} Finding</span><h2>${escapeHtml(finding.headline)}</h2><div class="rich-content">${finding.explanation_html}</div></section>`:''}${previewSection('Bottom Line',inv.bottom_line_html)}</main></div></article>`;
  }
  async function initPreview(){await requireAdmin();const id=new URLSearchParams(location.search).get('id')||location.pathname.match(/\/admin\/investigations\/([^/]+)\/preview/)?.[1];if(!id){$('#admin-preview-root').textContent='Missing investigation ID.';return;}$('#preview-edit-link').href=`/admin/investigations/${id}/edit`;try{const result=await jsonFetch(`/api/admin-investigation?id=${encodeURIComponent(id)}`);$('#admin-preview-root').innerHTML=renderProtectedPreview(result.bundle);}catch(error){$('#admin-preview-root').innerHTML=`<div class="admin-loading">${escapeHtml(error.message)}</div>`;}}

  document.addEventListener('DOMContentLoaded',async()=>{
    try{await initializeSupabase();if(page==='login')await initLogin();else if(page==='dashboard')await initDashboard();else if(page==='editor')await initEditor();else if(page==='preview')await initPreview();}
    catch(error){const target=$('#admin-login-status')||$('#admin-dashboard-status')||$('#editor-status')||$('#admin-preview-root')||document.body;setStatus(target,error.message,'error');}
  });
})();
