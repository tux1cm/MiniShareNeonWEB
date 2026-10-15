// MiniShare v2.2.0 P2W3a — static Web/PWA client (no secret in repository).
const API_BASE = 'https://br-still-hat-ao5nj8oh-miniapi.compute.c-2.ap-southeast-1.aws.neon.tech';
const SESSION_STORAGE_KEY='minishare.web.session.p2w2';
const STORAGE_BUDGET_BYTES = 5_000_000_000; // total project quota, not 50MB/file
const PROXY_MAX_BYTES = 8 * 1024 * 1024;
const PREVIEW_TEXT_MAX = 6 * 1024 * 1024;
const PREVIEW_DOCX_MAX = 12 * 1024 * 1024;
const PREVIEW_BLOB_MAX = 36 * 1024 * 1024;
const state = { token: '', files: [], messages: [], usage: null, page: 'files', uploadsRunning: false, targetAttachment: false, pendingConfirm: null, previewFileId: null, previewObjectUrl: null, previewEpoch: 0 };
const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const icon = (name, size=18) => `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fileType = name => {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  if(['jpg','jpeg','png','webp','gif','bmp'].includes(ext)) return 'IMG';
  if(['xlsx','xls','csv'].includes(ext)) return 'XLS';
  if(['doc','docx'].includes(ext)) return 'DOC';
  if(['mp4','mov','mkv','webm'].includes(ext)) return 'VID';
  if(['zip','7z','rar'].includes(ext)) return 'ZIP';
  if(ext==='pdf') return 'PDF';
  if(ext==='txt') return 'TXT';
  return 'FILE';
};
const badge = name => {const type=fileType(name);return `<span class="file-badge ${type.toLowerCase()}">${escapeHtml(type)}</span>`;};
// Chỉ hiện nút Xem cho định dạng trình duyệt xử lý được.
function previewKind(file){
  const ext=String(file?.name||'').split('.').pop().toLowerCase();
  if(['png','jpg','jpeg','webp','gif','bmp'].includes(ext))return 'image';
  if(ext==='pdf')return 'pdf';
  if(['txt','md','log','csv','json','xml','yaml','yml','ini','sql'].includes(ext))return 'text';
  if(ext==='docx')return 'docx'; // chỉ xem nội dung chữ, không bảo toàn bố cục Word
  if(['mp4','webm','mov'].includes(ext))return 'video';
  if(['mp3','m4a','aac','wav','ogg','flac'].includes(ext))return 'audio';
  return null; // ZIP/APK/DOC cũ và tệp khác không có trình xem tích hợp
}
const previewAction=(file,scope='file')=>file?.status==='ready'&&previewKind(file)
  ?`<button class="icon-button preview-action" data-${scope}-action="preview" data-id="${escapeHtml(file.id)}" aria-label="Xem trước ${escapeHtml(file.name)}" title="Xem trước">${icon('eye')}</button>`
  :`<span class="preview-spacer" aria-hidden="true"></span>`;

const fmtSize = bytes => {const n=Number(bytes)||0;return n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';};
const fmtTime = date => {const t=new Date(date);return Number.isFinite(t.getTime())?new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(t):'—';};
const statusText = status => ({ready:'Đã đồng bộ trên Neon',uploading:'Đang chờ hoàn tất',deleting:'Đang xóa',delete_error:'Lỗi xóa — có thể thử lại'})[status]||status;
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));

function toast(message, level='good', duration=5400){
  const el=document.createElement('div');el.className=`toast ${level}`;el.innerHTML=icon(level==='bad'?'alert':'check')+'<span></span>';
  el.querySelector('span').textContent=message;$('toast-stack').append(el);setTimeout(()=>el.remove(),duration);
}
function switchPage(page){
  if(!['files','chat','settings'].includes(page))return;
  state.page=page;
  $$('.page').forEach(el=>{const active=el.id===`page-${page}`;el.hidden=!active;el.classList.toggle('active',active);});
  $$('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  if(page==='chat')scrollChat();
}
function updateConnection(){
  const connected=Boolean(state.token);
  $('status-dot').classList.toggle('online',connected);
  $('connection-label').textContent=connected?'Đã đăng nhập':'Chưa đăng nhập';
  $('mobile-status').textContent=connected?'Neon online':'Chưa đăng nhập';
  $('mobile-status').style.color=connected?'':'#ffbd72';
  $('settings-api').textContent=API_BASE;
}
function showAuth(){
  $('auth-error').hidden=true;$('auth-password').value='';$('auth-modal').hidden=false;
  setTimeout(()=>$('auth-password').focus(),80);
}
function hideAuth(){ $('auth-password').value='';$('auth-modal').hidden=true; }

async function request(path,opts={}){
  if(!state.token)throw new Error('Chưa kết nối Neon.');
  const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),opts.timeout??35000);
  try{
    const headers={Authorization:`Bearer ${state.token}`};
    if(opts.json!==undefined)headers['Content-Type']='application/json';
    const res=await fetch(API_BASE+path,{method:opts.method||'GET',headers,body:opts.json!==undefined?JSON.stringify(opts.json):undefined,cache:'no-store',mode:'cors',credentials:'omit',signal:ctrl.signal});
    const payload=await res.json().catch(()=>({}));
    if(!res.ok){const e=new Error(payload.message||`API trả về HTTP ${res.status}`);e.status=res.status;e.code=payload.error;if(res.status===401){clearWebSession();showAuth();}throw e;}
    return payload;
  }catch(e){
    if(e.name==='AbortError')throw new Error('Kết nối hết thời gian chờ. Thử lại.');
    if(e instanceof TypeError)throw new Error('Không kết nối được API. Kiểm tra Internet và cấu hình CORS của Neon Function.');
    throw e;
  }finally{clearTimeout(timeout);}
}
function clearWebSession(){
  state.token='';
  try{sessionStorage.removeItem(SESSION_STORAGE_KEY);}catch{}
  updateConnection();
}
async function connect(password){
  const input=String(password||'');
  if(input.length<6)throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
  let res;
  try{
    res=await fetch(API_BASE+'/v1/web/login',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({password:input}),cache:'no-store',credentials:'omit',mode:'cors'
    });
  }catch{throw new Error('Không thể kết nối Neon API. Kiểm tra mạng và CORS Function.');}
  const body=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(body.message||`Đăng nhập không thành công (HTTP ${res.status}).`);
  if(typeof body.access_token!=='string'||!body.access_token.startsWith('msw1.'))
    throw new Error('Backend chưa hỗ trợ xác thực phiên Web P2W3.');
  state.token=body.access_token;
  try{
    await loadAll();
    sessionStorage.setItem(SESSION_STORAGE_KEY,body.access_token);
    hideAuth();updateConnection();toast('Đăng nhập MiniShare thành công.');
  }catch(e){clearWebSession();throw e;}
}
async function restoreSession(){
  let saved='';
  try{saved=sessionStorage.getItem(SESSION_STORAGE_KEY)||'';}catch{}
  if(!saved.startsWith('msw1.')){clearWebSession();showAuth();return;}
  state.token=saved;
  try{await request('/v1/health/auth');await loadAll();hideAuth();updateConnection();}
  catch{clearWebSession();showAuth();}
}

async function loadAll(){
  if(!state.token)return;
  const [fs,msgs,usage]=await Promise.all([request('/v1/files'),request('/v1/messages'),request('/v1/storage/usage')]);
  state.files=Array.isArray(fs.files)?fs.files:[];state.messages=Array.isArray(msgs.messages)?msgs.messages:[];state.usage=usage;
  renderFiles();renderChat();renderAttachList();
}
async function refresh(silent=false){
  if(!state.token){showAuth();return;}
  try{await loadAll();if(!silent)toast('Đã cập nhật dữ liệu từ Neon.');}
  catch(e){toast(e.message,'bad');}
}
function renderFiles(){
  const files=state.files;
  const ready=files.filter(f=>f.status==='ready');
  $('stat-total').textContent=String(files.length);
  $('stat-ready').textContent=String(ready.length);
  $('stat-size').textContent=state.usage?`${fmtSize(state.usage.used_bytes)} / ${fmtSize(state.usage.limit_bytes)}`:fmtSize(ready.reduce((acc,f)=>acc+Number(f.size||0),0));
  const keyword=$('file-search').value.trim().toLocaleLowerCase('vi');
  const filtered=files.filter(f=>String(f.name||'').toLocaleLowerCase('vi').includes(keyword));
  $('file-summary').textContent=`${filtered.length} tệp`;
  $('file-footer').textContent=`${ready.length} tệp đã đồng bộ • ${files.length-ready.length} đang chờ/xử lý • Còn ${fmtSize(state.usage?.available_bytes??0)} / 5 GB`;
  $('file-empty').hidden=filtered.length>0;
  $('file-empty').querySelector('h3').textContent=keyword?'Không tìm thấy tệp':'Chưa có tệp';
  $('file-empty').querySelector('p').textContent=keyword?'Hãy thử từ khóa khác.':'Chọn hoặc kéo thả tệp vào đây để tải lên Neon.';
  $('file-rows').innerHTML=filtered.map(f=>{
    const ready=f.status==='ready';const time=fmtTime(f.updated_at||f.created_at);
    return `<tr data-file-row="${escapeHtml(f.id)}"><td><div class="file-main">${badge(f.name)}<div class="file-info"><strong title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</strong><small class="${ready?'':'pending'}">${escapeHtml(statusText(f.status))}</small></div></div></td><td>${fmtSize(f.size)}</td><td>${escapeHtml(time)}</td><td><div class="file-actions">${previewAction(f)}<button class="icon-button cyan" data-file-action="download" data-id="${escapeHtml(f.id)}" aria-label="Tải xuống ${escapeHtml(f.name)}" title="Tải xuống" ${ready?'':'disabled'}>${icon('download')}</button><button class="icon-button" data-file-action="attach" data-id="${escapeHtml(f.id)}" title="Đính kèm vào Chat" aria-label="Đính kèm ${escapeHtml(f.name)}" ${ready?'':'disabled'}>${icon('paperclip')}</button><button class="icon-button delete" data-file-action="delete" data-id="${escapeHtml(f.id)}" title="Xóa tệp khỏi Neon và tin liên quan" aria-label="Xóa ${escapeHtml(f.name)}">${icon('trash')}</button></div></td></tr>`;
  }).join('');
}
function renderChat(){
  const el=$('chat-messages'); const messages=[...state.messages].reverse();
  $('chat-empty').hidden=messages.length>0;
  $('chat-count').hidden=!messages.length;$('chat-count').textContent=messages.length>99?'99+':String(messages.length);
  el.innerHTML=messages.map(m=>{
    const id=escapeHtml(m.id),time=fmtTime(m.created_at);
    if(m.kind==='attachment'){
      const name=m.file_name||'Tệp đã bị xóa';
      return `<div class="message-bubble attach-bubble" data-msg-id="${id}"><div class="attach-heading"><span>${icon('paperclip')} Tệp đính kèm</span><div class="message-actions"><button class="message-icon" data-msg-action="copy" data-id="${id}" title="Sao chép tên tệp" aria-label="Sao chép">${icon('copy',14)}</button></div></div><div class="attach-content">${badge(name)}<div class="attach-details"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><small>${fmtSize(m.file_size)}</small></div>${(state.files.find(f=>f.id===m.file_id)&&previewKind(state.files.find(f=>f.id===m.file_id))) ? `<button class="icon-button preview-action" data-msg-action="preview" data-id="${id}" title="Xem trước" aria-label="Xem trước tệp đính kèm">${icon('eye')}</button>` : ''}<button class="icon-button cyan" data-msg-action="download" data-id="${id}" title="Tải tệp" aria-label="Tải tệp">${icon('download')}</button></div><div class="attach-button-row" style="justify-content:flex-end;margin-top:9px"><button class="attach-danger" data-msg-action="delete-message" data-id="${id}">Xóa tin</button><button class="attach-danger" data-msg-action="delete-file" data-id="${id}">Xóa tệp</button></div><div class="message-time">${escapeHtml(time)}</div></div>`;
    }
    return `<div class="message-bubble" data-msg-id="${id}"><div class="message-row"><div class="message-body">${escapeHtml(m.text||'')}</div><div class="message-actions"><button class="message-icon" data-msg-action="copy" data-id="${id}" title="Sao chép" aria-label="Sao chép tin nhắn">${icon('copy',14)}</button><button class="message-icon" data-msg-action="delete-message" data-id="${id}" title="Xóa tin" aria-label="Xóa tin nhắn">${icon('close',14)}</button></div></div><div class="message-time">${escapeHtml(time)}</div></div>`;
  }).join('');
}
function scrollChat(){const box=$('chat-scroll'); requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight;});}
function renderAttachList(){
  const q=$('attach-search').value.trim().toLocaleLowerCase('vi');
  const found=state.files.filter(f=>f.status==='ready'&&String(f.name).toLocaleLowerCase('vi').includes(q));
  $('attach-list').innerHTML=found.length?found.map(f=>`<button class="attach-choice" data-attach-id="${escapeHtml(f.id)}">${badge(f.name)}<span class="attach-choice-info"><strong>${escapeHtml(f.name)}</strong><small>${fmtSize(f.size)} • Đã đồng bộ Neon</small></span>${icon('paperclip')}</button>`).join(''):'<p style="text-align:center;color:var(--mute);padding:26px">Không có tệp phù hợp.</p>';
}
function showAttachmentPicker(){if(!state.token){showAuth();return;}$('attach-search').value='';renderAttachList();$('attach-modal').hidden=false;setTimeout(()=>$('attach-search').focus(),30);}
function hideAttachmentPicker(){ $('attach-modal').hidden=true; }
function askConfirm(text,{mode='delete',title='Xác nhận xóa',yesLabel='Xóa'}={}){
  if(state.pendingConfirm)return Promise.resolve(false);
  $('confirm-title').textContent=title;
  $('confirm-text').textContent=text;
  $('confirm-yes').textContent=yesLabel;
  $('confirm-yes').className=`button ${mode==='upload'?'primary':'danger'}`;
  $('confirm-icon').classList.toggle('upload-warning',mode==='upload');
  $('confirm-icon-use').setAttribute('href',mode==='upload'?'#i-alert':'#i-trash');
  $('confirm-modal').hidden=false;
  return new Promise(resolve=>state.pendingConfirm=resolve);
}
const askDelete=text=>askConfirm(text);
const askUploadWarning=name=>askConfirm(`Tệp “${name}” có tên gợi ý có thể chứa mật khẩu hoặc token. Bạn vẫn muốn tải tệp này lên Neon Storage?`,{
  mode:'upload',title:'Cảnh báo trước khi tải lên',yesLabel:'Vẫn tải lên'
});
function resolveDelete(ok){
  const resolver=state.pendingConfirm;state.pendingConfirm=null;
  $('confirm-modal').hidden=true;
  if(resolver)resolver(ok);
}
async function deleteMessage(msg){
  if(!await askDelete('Chỉ xóa tin nhắn này? Tệp đính kèm vẫn còn trên Neon.'))return;
  try{await request(`/v1/messages/${encodeURIComponent(msg.id)}`,{method:'DELETE'});await loadAll();toast('Đã xóa tin nhắn, giữ nguyên tệp.');}
  catch(e){toast(e.message,'bad');}
}
async function deleteFile(file){
  if(!file)return;
  if(!await askDelete(`Xóa vĩnh viễn “${file.name}” khỏi Neon Storage và xóa tất cả tin nhắn đính kèm tệp này? Hành động không thể hoàn tác.`))return;
  try{await request(`/v1/files/${encodeURIComponent(file.id)}`,{method:'DELETE',timeout:65000});await loadAll();toast('Đã xóa tệp khỏi Storage và Chat liên quan.');}
  catch(e){toast('Xóa chưa hoàn tất: '+e.message+'. Có thể thử lại.','bad',9000);await refresh(true);}
}
async function sendMessage(){
  if(!state.token){showAuth();return;}
  const editor=$('message-input'),text=editor.value.trim();if(!text)return;
  if(text.length>2047){toast('Tin nhắn quá 2047 ký tự.','bad');return;}
  const btn=$('send-message');btn.disabled=true;
  try{await request('/v1/messages',{method:'POST',json:{kind:'text',text}});editor.value='';editor.style.height='46px';await loadAll();scrollChat();}
  catch(e){toast(e.message,'bad');}finally{btn.disabled=false;editor.focus();}
}
async function sendAttachment(id){
  hideAttachmentPicker();
  try{await request('/v1/messages',{method:'POST',json:{kind:'attachment',file_id:id}});await loadAll();switchPage('chat');scrollChat();toast('Đã đính kèm tệp có sẵn trên Neon.');}
  catch(e){toast(e.message,'bad');}
}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast('Đã sao chép.');}catch{toast('Trình duyệt không cho truy cập clipboard.','bad');}}

// Xem trước từ private Storage: mỗi lần mở xin URL ký tạm thời, không làm public bucket.
function closePreview(){
  ++state.previewEpoch;
  $('preview-modal').hidden=true;
  $('preview-body').replaceChildren();
  state.previewFileId=null;
  if(state.previewObjectUrl){URL.revokeObjectURL(state.previewObjectUrl);state.previewObjectUrl=null;}
}
function previewInfo(message){
  const p=document.createElement('p');p.className='preview-info';p.textContent=message;
  $('preview-body').replaceChildren(p);
}
async function previewSource(file){
  const result=await request(`/v1/files/${encodeURIComponent(file.id)}/download`);
  if(!result.download_url)throw new Error('API chưa cấp URL xem tệp.');
  return result.download_url;
}
async function fetchPreviewData(file,url,maxBytes){
  if(Number(file.size)>maxBytes)throw new Error('Tệp quá lớn để xem nội dung trực tiếp. Hãy tải về để mở trên máy.');
  try{
    const res=await fetch(url,{mode:'cors',credentials:'omit',cache:'no-store'});
    if(!res.ok)throw new Error(`Storage HTTP ${res.status}`);
    const data=await res.blob();
    if(data.size>maxBytes)throw new Error('Nội dung xem trước vượt mức an toàn.');
    return data;
  }catch(err){
    // CORS GET của S3 có thể bị hạn chế. Thử đường Function cho tệp nhỏ.
    if(Number(file.size)>PROXY_MAX_BYTES)throw err;
    const res=await fetch(`${API_BASE}/v1/files/${encodeURIComponent(file.id)}/content`,{
      headers:{Authorization:`Bearer ${state.token}`},credentials:'omit',mode:'cors',cache:'no-store'
    });
    if(!res.ok)throw new Error(`Không lấy được nội dung tệp (HTTP ${res.status}).`);
    const data=await res.blob();
    if(data.size>maxBytes)throw new Error('Nội dung xem trước vượt mức an toàn.');
    return data;
  }
}
// DOCX: giải nén riêng word/document.xml bằng API trình duyệt (không gửi file sang dịch vụ khác).
// Đây là bản xem chữ đơn giản; định dạng/bảng/hình trong Word có thể không giữ nguyên.
async function docxToText(blob){
  const buf=await blob.arrayBuffer(), v=new DataView(buf);
  let end=-1;
  for(let i=buf.byteLength-22;i>=Math.max(0,buf.byteLength-65557);i--){
    if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  }
  if(end<0)throw new Error('Không tìm thấy cấu trúc DOCX hợp lệ.');
  const count=v.getUint16(end+10,true), offset=v.getUint32(end+16,true);
  let p=offset;
  for(let i=0;i<count;i++){
    if(p+46>buf.byteLength||v.getUint32(p,true)!==0x02014b50)break;
    const method=v.getUint16(p+10,true),size=v.getUint32(p+20,true),unpacked=v.getUint32(p+24,true);
    const len=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true);
    const name=new TextDecoder().decode(new Uint8Array(buf,p+46,len));
    if(name==='word/document.xml'){
      if(unpacked>8*1024*1024)throw new Error('Nội dung DOCX quá lớn để xem trước.');
      const local=v.getUint32(p+42,true);
      if(v.getUint32(local,true)!==0x04034b50)throw new Error('DOCX bị lỗi cấu trúc ZIP.');
      const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true);
      if(start+size>buf.byteLength)throw new Error('DOCX thiếu dữ liệu.');
      let xmlBytes=new Uint8Array(buf,start,size);
      if(method===8){
        if(typeof DecompressionStream==='undefined')throw new Error('Trình duyệt chưa hỗ trợ xem DOCX; hãy tải về.');
        const stream=new Blob([xmlBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        xmlBytes=new Uint8Array(await new Response(stream).arrayBuffer());
      }else if(method!==0)throw new Error('Định dạng nén DOCX không được hỗ trợ.');
      if(xmlBytes.byteLength>8*1024*1024)throw new Error('DOCX quá lớn để xem trước.');
      const doc=new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes),'application/xml');
      if(doc.querySelector('parsererror'))throw new Error('Nội dung XML của DOCX không hợp lệ.');
      const lines=[...doc.getElementsByTagName('*')].filter(el=>el.localName==='p').map(el=>
        [...el.getElementsByTagName('*')].filter(n=>n.localName==='t').map(n=>n.textContent).join('')
      );
      return lines.join('\n').trim()||'(Tệp Word không có đoạn văn bản để hiển thị.)';
    }
    p+=46+len+extra+comment;
  }
  throw new Error('Không có nội dung Word (word/document.xml).');
}
async function previewFile(file){
  const kind=previewKind(file);
  if(!file||file.status!=='ready'||!kind)return;
  closePreview();
  const epoch=state.previewEpoch;
  state.previewFileId=file.id;
  $('preview-name').textContent=file.name;
  $('preview-type').textContent=`${fmtSize(file.size)} • Xem trước trên Web`;
  $('preview-modal').hidden=false;
  previewInfo('Đang chuẩn bị xem trước...');
  try{
    const url=await previewSource(file);
    if(epoch!==state.previewEpoch)return;
    const content=$('preview-body');
    const big=Number(file.size)>PREVIEW_BLOB_MAX;
    if(kind==='video'||kind==='audio'){
      const media=document.createElement(kind==='video'?'video':'audio');
      media.controls=true;media.preload='metadata';media.src=url;
      media.className='preview-media';
      content.replaceChildren(media);
    }else if((kind==='image'||kind==='pdf') && big){
      // Browser xử lý qua liên kết ký trực tiếp, tránh nạp tệp lớn vào RAM JS.
      const view=document.createElement(kind==='image'?'img':'iframe');
      view.className=kind==='image'?'preview-image':'preview-pdf';
      view.src=url;
      view.title=`Xem trước ${file.name}`;
      view.referrerPolicy='no-referrer';
      content.replaceChildren(view);
    }else{
      const blob=await fetchPreviewData(file,url,
        kind==='text'?PREVIEW_TEXT_MAX:kind==='docx'?PREVIEW_DOCX_MAX:PREVIEW_BLOB_MAX);
      if(epoch!==state.previewEpoch)return;
      if(kind==='text'||kind==='docx'){
        const pre=document.createElement('pre');pre.className='preview-text';
        pre.textContent=kind==='docx'?await docxToText(blob):await blob.text();
        if(epoch!==state.previewEpoch)return;
        content.replaceChildren(pre);
        if(kind==='docx')$('preview-type').textContent=`${fmtSize(file.size)} • Word: xem nội dung chữ (không giữ định dạng)`;
      }else{
        const objectUrl=URL.createObjectURL(blob);
        state.previewObjectUrl=objectUrl;
        const view=document.createElement(kind==='image'?'img':'iframe');
        view.className=kind==='image'?'preview-image':'preview-pdf';
        view.src=objectUrl;view.title=`Xem trước ${file.name}`;
        content.replaceChildren(view);
      }
    }
  }catch(e){if(epoch===state.previewEpoch)previewInfo(`Không thể xem trước: ${e.message}. Bạn có thể tải tệp về máy.`);}
}

// Download through the authenticated Function proxy (CORS-safe, preserves filename).
// Fallback to the signed link for an older backend that lacks GET /content.
async function downloadFile(file){
  if(!file||file.status!=='ready')return;
  const name=String(file.name||'download').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');
  showProgress(`Đang tải ${name}`,3);
  try{
    // For large files use a signed direct S3 URL, avoiding in-memory Blob and Function egress.
    if(Number(file.size)>8*1024*1024){
      const signed=await request(`/v1/files/${encodeURIComponent(file.id)}/download`);
      if(!signed.download_url)throw new Error('API không cấp liên kết tải xuống.');
      const link=document.createElement('a');link.href=signed.download_url;link.target='_blank';link.rel='noopener noreferrer';link.download=name;
      document.body.append(link);link.click();link.remove();
      toast('Đã mở tải xuống trực tiếp. Nếu trình duyệt mở xem trước, chọn Tải xuống.');return;
    }
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),120000);
    let res;
    try{res=await fetch(`${API_BASE}/v1/files/${encodeURIComponent(file.id)}/content`,{headers:{Authorization:`Bearer ${state.token}`},mode:'cors',cache:'no-store',signal:controller.signal});}
    finally{clearTimeout(timer);}
    if(res.status===404){
      hideProgress();
      const signed=await request(`/v1/files/${encodeURIComponent(file.id)}/download`);
      if(!signed.download_url)throw new Error('API không trả URL tải xuống.');
      const a=document.createElement('a');a.href=signed.download_url;a.target='_blank';a.rel='noopener noreferrer';a.download=name;document.body.append(a);a.click();a.remove();
      toast('Đã mở liên kết tải. Nếu trình duyệt hiển thị xem trước, chọn Tải xuống ở tab mới.');return;
    }
    if(!res.ok)throw new Error(`HTTP ${res.status} khi tải tệp`);
    const length=Number(res.headers.get('content-length'))||Number(file.size)||0;
    const reader=res.body?.getReader();const chunks=[];let total=0;
    if(reader){for(;;){const{done,value}=await reader.read();if(done)break;chunks.push(value);total+=value.byteLength;if(length)showProgress(`Đang tải ${name}`,Math.min(99,total/length*100));}}
    else{const bytes=new Uint8Array(await res.arrayBuffer());chunks.push(bytes);total=bytes.length;}
    if(Number(file.size)>0 && total!==Number(file.size))throw new Error('Tệp tải về không đúng dung lượng.');
    const url=URL.createObjectURL(new Blob(chunks,{type:file.mime||'application/octet-stream'}));
    const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast(`Đã tải ${name}`);
  }catch(e){toast('Tải xuống thất bại: '+e.message,'bad',7500);}
  finally{hideProgress();}
}

function showProgress(title,percent){$('progress-box').hidden=false;$('progress-title').textContent=title;$('progress-percent').textContent=`${Math.max(0,Math.min(100,Math.round(percent)))}%`;$('progress-bar').style.width=`${Math.max(0,Math.min(100,percent))}%`;}
function hideProgress(){$('progress-box').hidden=true;}
function xhrUpload(url,file,headers,onProgress){return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open(url.startsWith('https://')?'PUT':'POST',url.startsWith('https://')?url:API_BASE+url);xhr.timeout=0; // Large direct S3 uploads may take longer than three minutes
  Object.entries(headers||{}).forEach(([k,v])=>xhr.setRequestHeader(k,v));
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total*95);};
  xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)resolve(xhr.status);else{const error=new Error(`Upload HTTP ${xhr.status}`);error.status=xhr.status;reject(error);}};
  xhr.onerror=()=>reject(new Error('Upload bị chặn bởi mạng/CORS hoặc không tới được máy chủ.'));
  xhr.ontimeout=()=>reject(new Error('Upload hết thời gian chờ.'));
  xhr.send(file);
});}
async function uploadOne(file){
  if(!Number.isSafeInteger(file.size)||file.size<=0){throw new Error(`“${file.name}” là tệp rỗng hoặc kích thước không hợp lệ.`);}
  if(file.size>STORAGE_BUDGET_BYTES){throw new Error(`“${file.name}” lớn hơn tổng ngân sách Storage 5 GB.`);}
  // Backend checks remaining quota atomically; do not trust stale browser totals.
  if(/(^\.env|token|password|secret|\.pem$|\.key$)/i.test(file.name)){
    const ok=await askUploadWarning(file.name);if(!ok)return null;
  }
  const init=await request('/v1/files/init',{method:'POST',json:{name:file.name,size:file.size,mime:file.type||'application/octet-stream'}});
  const id=init.file_id;
  let succeeded=false;
  if(file.size<=PROXY_MAX_BYTES){
    try{
      showProgress(`Đang tải ${file.name}`,1);
      await xhrUpload(`/v1/files/${encodeURIComponent(id)}/content`,file,{'Authorization':`Bearer ${state.token}`,'Content-Type':'application/octet-stream'},p=>showProgress(`Đang tải ${file.name}`,p));
      succeeded=true;
    }catch(e){if(e.status!==404 && e.status!==413)console.warn('Function proxy upload unavailable:',e.message);}
  }
  if(!succeeded){
    if(!init.upload_url)throw new Error('API không cung cấp URL upload.');
    try {await xhrUpload(init.upload_url,file,init.required_headers||{},p=>showProgress(`Đang tải ${file.name}`,p));}
    catch(error){
      // Release failed reservations. A failed DELETE is visible as an uploading record;
      // users can delete it manually to recover quota.
      try{await request(`/v1/files/${encodeURIComponent(id)}`,{method:'DELETE'});}catch{}
      throw error;
    }
  }
  showProgress(`Đang xác nhận ${file.name}`,98);
  await request(`/v1/files/${encodeURIComponent(id)}/complete`,{method:'POST',json:{},timeout:60000});
  return id;
}
async function uploadFiles(fileList,attachAfter=false){
  const files=[...fileList].filter(f=>f instanceof File);
  if(!files.length)return;if(!state.token){toast('Hãy kết nối Neon trước khi tải tệp.','bad');showAuth();return;}
  if(state.uploadsRunning){toast('Đang có một lượt upload khác. Vui lòng chờ.','bad');return;}
  state.uploadsRunning=true;
  const btn=$('upload-button');btn.disabled=true;let passed=0;
  try{
    for(let i=0;i<files.length;i++){
      const f=files[i];
      try{const id=await uploadOne(f);if(!id)continue;passed++;toast(`Đã upload: ${f.name}`);if(attachAfter)await sendAttachment(id);}
      catch(e){toast(`Lỗi ${f.name}: ${e.message}`, 'bad',8500);}
    }
    await refresh(true);
    if(passed)toast(`Hoàn tất ${passed}/${files.length} tệp.`);
  }finally{state.uploadsRunning=false;btn.disabled=false;hideProgress();$('file-picker').value='';}
}
function openPicker(attach=false){state.targetAttachment=attach;$('file-picker').click();}

// UI wiring
$$('[data-page]').forEach(button=>button.addEventListener('click',()=>switchPage(button.dataset.page)));
$('refresh-files').addEventListener('click',()=>refresh());$('refresh-chat').addEventListener('click',()=>refresh());
$('file-search').addEventListener('input',renderFiles);$('upload-button').addEventListener('click',()=>openPicker(false));$('empty-upload').addEventListener('click',()=>openPicker(false));
$('file-picker').addEventListener('change',e=>uploadFiles(e.target.files,state.targetAttachment));
$('chat-attach').addEventListener('click',showAttachmentPicker);$('close-attach').addEventListener('click',hideAttachmentPicker);$('attach-cancel').addEventListener('click',hideAttachmentPicker);$('attach-search').addEventListener('input',renderAttachList);
$('attach-upload').addEventListener('click',()=>{hideAttachmentPicker();openPicker(true);});
$('attach-list').addEventListener('click',e=>{const btn=e.target.closest('[data-attach-id]');if(btn)sendAttachment(btn.dataset.attachId);});
$('file-rows').addEventListener('click',async e=>{const button=e.target.closest('[data-file-action]');if(!button)return;const file=state.files.find(f=>f.id===button.dataset.id);if(!file)return;if(button.dataset.fileAction==='preview')await previewFile(file);if(button.dataset.fileAction==='download')await downloadFile(file);if(button.dataset.fileAction==='attach')await sendAttachment(file.id);if(button.dataset.fileAction==='delete')await deleteFile(file);});
$('chat-messages').addEventListener('click',async e=>{const button=e.target.closest('[data-msg-action]');if(!button)return;const m=state.messages.find(x=>x.id===button.dataset.id);if(!m)return;switch(button.dataset.msgAction){case'copy':await copyText(m.kind==='attachment'?m.file_name||'':m.text||'');break;case'delete-message':await deleteMessage(m);break;case'delete-file':await deleteFile(state.files.find(f=>f.id===m.file_id));break;case'preview':await previewFile(state.files.find(f=>f.id===m.file_id));break;case'download':await downloadFile(state.files.find(f=>f.id===m.file_id));break;}});
$('send-message').addEventListener('click',sendMessage);$('message-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();sendMessage();}});$('message-input').addEventListener('input',e=>{e.target.style.height='46px';e.target.style.height=Math.min(115,Math.max(46,e.target.scrollHeight))+'px';});
$('change-token').addEventListener('click',()=>{clearWebSession();state.files=[];state.messages=[];renderFiles();renderChat();showAuth();});$('disconnect').addEventListener('click',()=>{clearWebSession();state.files=[];state.messages=[];renderFiles();renderChat();showAuth();toast('Đã đăng xuất.');});
$('auth-form').addEventListener('submit',async e=>{e.preventDefault();const btn=$('auth-submit');btn.disabled=true;$('auth-error').hidden=true;try{await connect($('auth-password').value);}catch(err){$('auth-error').textContent=err.message;$('auth-error').hidden=false;}finally{btn.disabled=false;}});
$('preview-close').addEventListener('click',closePreview);
$('preview-modal').addEventListener('click',e=>{if(e.target===$('preview-modal'))closePreview();});
$('preview-download').addEventListener('click',async()=>{const file=state.files.find(f=>f.id===state.previewFileId);if(file){closePreview();await downloadFile(file);}});
$('confirm-cancel').addEventListener('click',()=>resolveDelete(false));$('confirm-yes').addEventListener('click',()=>resolveDelete(true));
$('confirm-modal').addEventListener('click',e=>{if(e.target===$('confirm-modal'))resolveDelete(false);});$('attach-modal').addEventListener('click',e=>{if(e.target===$('attach-modal'))hideAttachmentPicker();});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('preview-modal').hidden)closePreview();else if(state.pendingConfirm)resolveDelete(false);else if(!$('attach-modal').hidden)hideAttachmentPicker();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();switchPage('files');$('file-search').focus();}});
let dropDepth=0;
window.addEventListener('dragenter',e=>{if([...e.dataTransfer?.types||[]].includes('Files')){dropDepth++;e.preventDefault();$('drop-overlay').hidden=false;}});
window.addEventListener('dragover',e=>{if([...e.dataTransfer?.types||[]].includes('Files'))e.preventDefault();});
window.addEventListener('dragleave',e=>{e.preventDefault();dropDepth=Math.max(0,dropDepth-1);if(dropDepth===0)$('drop-overlay').hidden=true;});
window.addEventListener('drop',e=>{e.preventDefault();dropDepth=0;$('drop-overlay').hidden=true;if(e.dataTransfer?.files?.length)uploadFiles(e.dataTransfer.files,state.page==='chat');});
window.addEventListener('paste',e=>{const files=[...e.clipboardData?.items||[]].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();uploadFiles(files,state.page==='chat');}});
window.addEventListener('beforeunload',e=>{if(state.uploadsRunning){e.preventDefault();e.returnValue='';}});
// Network polling only while page is visible and authenticated: keep Neon Free usage low.
setInterval(()=>{if(state.token&&!document.hidden&&!state.uploadsRunning)refresh(true);},120000);
updateConnection();renderFiles();renderChat();switchPage('files');restoreSession();
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
