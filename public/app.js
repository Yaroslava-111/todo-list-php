import {STORAGE_KEY, MAX_LENGTH, normalize, lengthOf, createTask, decode} from './core.js';
import {ApiClient} from './api-client.js';
const $ = selector => document.querySelector(selector);
const api = new ApiClient();
const form = $('#task-form'), input = $('#task-input'), list = $('#task-list');
let tasks = [], revision = 0, authenticated = false, busy = false, composing = false, needsRefresh = true;
let localTasks = null;
function announce(text) {$('#announcement').textContent = text;}
function notice(text = '') {$('#server-message').textContent = text;$('#server-notice').hidden = !text;}
function inputError(text = '') {$('#input-error').textContent = text;$('#input-error').hidden = !text;input.setAttribute('aria-invalid',String(Boolean(text)));}
function counter() {
  const n = lengthOf(normalize(input.value));$('#char-count').textContent = `${n} / ${MAX_LENGTH}`;$('#char-count').classList.toggle('over-limit',n > MAX_LENGTH);
}
function updateControls() {
  const disabled = busy || !authenticated || needsRefresh;
  form.querySelector('button').disabled = disabled;
  list.querySelectorAll('input, button').forEach(control => {control.disabled = disabled;});
  $('#login-button').disabled = busy;$('#logout').disabled = busy;
  $('#refresh').disabled = busy || !authenticated;
  $('#import-button').disabled = disabled;
  $('#task-count').textContent = `${tasks.filter(task=>task.completed).length} из ${tasks.length} выполнено`;
  $('#empty-state').hidden = tasks.length !== 0;
  $('#workspace').hidden = !authenticated;$('#login-panel').hidden = authenticated;
  $('#logout').hidden = !authenticated;
  $('#refresh').hidden = !authenticated;
}
function setBusy(value) {busy = value;updateControls();}
function makeRow(task) {
  const row = document.createElement('li');row.className = 'task';row.dataset.id = task.id;
  const label = document.createElement('label');
  const check = document.createElement('input');check.type = 'checkbox';check.checked = task.completed;
  const text = document.createElement('span');text.textContent = task.text;label.append(check,text);
  const remove = document.createElement('button');remove.type = 'button';remove.className = 'remove';remove.setAttribute('aria-label',`Удалить задачу: ${task.text}`);
  remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
  row.append(label,remove);return row;
}
function render() {list.replaceChildren(...tasks.map(makeRow));updateControls();}
function accept(state) {tasks = state.tasks;revision = state.revision;needsRefresh = false;notice();$('#save-status').textContent = 'Сохранено на сервере';render();}
function failed(error) {
  if (error.status === 401 && error.code === 'auth') {authenticated = false;tasks = [];render();$('#password').focus();}
  if (error.status === 409) needsRefresh = true;
  notice(error.message);$('#save-status').textContent = 'Сохранение не подтверждено';updateControls();
}
async function refresh() {
  if (busy) return;
  setBusy(true);
  try {accept(await api.request('tasks'));announce('Список обновлён.');}
  catch (error) {failed(error);}
  finally {setBusy(false);}
}
async function commit(nextTasks, action = 'tasks') {
  if (busy || needsRefresh || !authenticated) return false;
  setBusy(true);$('#save-status').textContent = 'Сохраняем…';
  try {const state = await api.request(action,{revision,tasks:nextTasks});accept(state);return state;}
  catch (error) {failed(error);return false;}
  finally {setBusy(false);}
}
function findLocal() {
  try {const source = decode(localStorage.getItem(STORAGE_KEY));localTasks = source.length ? source : null;}
  catch {localTasks = null;}
  $('#import-panel').hidden = !localTasks;
  if (localTasks) $('#import-button').textContent = `Перенести ${localTasks.length} задач из браузера`;
}
input.addEventListener('input',()=>{inputError();counter();});
input.addEventListener('paste',event=>{
  if (!event.clipboardData) return;event.preventDefault();
  input.setRangeText(event.clipboardData.getData('text/plain').replace(/\s+/gu,' '),input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}));
});
input.addEventListener('compositionstart',()=>{composing = true;});input.addEventListener('compositionend',()=>{composing = false;});
input.addEventListener('keydown',event=>{if(event.key === 'Enter' && (event.isComposing || composing || event.keyCode === 229)) event.preventDefault();});
form.addEventListener('submit',async event=>{
  event.preventDefault();if (busy || composing || needsRefresh || !authenticated) return;
  const original = input.value,result = createTask(tasks,original,crypto.randomUUID());
  if (result.error) {inputError(result.error);input.focus();return;}
  if (await commit([...tasks,result.task])) {if(input.value === original) input.value = '';inputError();counter();input.focus();announce('Задача добавлена.');}
});
list.addEventListener('change',async event=>{
  const row = event.target.closest('.task');if (!row || event.target.type !== 'checkbox') return;
  const task = tasks.find(task=>task.id === row.dataset.id);if(!task) return;
  const completed = event.target.checked;event.target.checked = task.completed;
  if(await commit(tasks.map(item=>item.id === task.id ? {...item,completed} : item))) {
    const target = Array.from(list.children).find(item=>item.dataset.id === task.id);target?.querySelector('input').focus();announce(completed ? 'Задача выполнена.' : 'Задача снова активна.');
  }
});
list.addEventListener('click',async event=>{
  const button = event.target.closest('.remove');if (!button || busy) return;
  const row = button.closest('.task'),index = tasks.findIndex(task=>task.id === row.dataset.id);
  const focusId = tasks[index+1]?.id || tasks[index-1]?.id;
  if(await commit(tasks.filter(task=>task.id !== row.dataset.id))) {
    const target = Array.from(list.children).find(item=>item.dataset.id === focusId);(target?.querySelector('button') || input).focus();announce('Задача удалена.');
  }
});
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy) return;
  const password = $('#password').value,n = lengthOf(password);
  if(n < 12 || n > 128 || /\p{Cc}/u.test(password)) {$('#login-error').textContent = 'Введите пароль из 12–128 символов без управляющих символов.';$('#password').setAttribute('aria-invalid','true');return;}
  $('#login-error').textContent = '';$('#password').setAttribute('aria-invalid','false');setBusy(true);
  try {
    await api.request('bootstrap');
    const result = await api.request('login',{password});authenticated = result.authenticated;needsRefresh = true;$('#password').value = '';
    accept(await api.request('tasks'));findLocal();input.focus();
  } catch(error) {if(error.code === 'login') $('#login-error').textContent = error.message;else failed(error);}
  finally {setBusy(false);}
});
$('#logout').addEventListener('click',async()=>{
  if(busy) return;setBusy(true);
  try {await api.request('logout',{});authenticated = false;tasks = [];input.value = '';inputError();counter();notice();$('#save-status').textContent = '';render();$('#password').focus();}
  catch(error) {failed(error);}
  finally {setBusy(false);}
});
$('#refresh').addEventListener('click',refresh);
$('#import-button').addEventListener('click',async()=>{
  if(!localTasks || busy || needsRefresh) return;
  const result = await commit(localTasks,'import');
  if(result) {$('#import-panel').hidden = true;localTasks = null;announce(result.alreadyImported ? 'Этот список уже переносили. Повторные задачи не добавлены.' : 'Задачи перенесены на сервер.');}
});
async function start() {
  setBusy(true);
  try {
    const result = await api.request('bootstrap');authenticated = result.authenticated;
    if(authenticated) {accept(await api.request('tasks'));findLocal();}
    else {notice();$('#save-status').textContent = '';}
  } catch(error) {failed(error);}
  finally {setBusy(false);$('#login-loading').hidden = true;}
}
render();counter();start();
