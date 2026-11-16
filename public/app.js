import {STORAGE_KEY, MAX_LENGTH, normalize, lengthOf, validateText, createTask, decode} from './core.js';
import {ApiClient} from './api-client.js';
const $ = selector => document.querySelector(selector);
const api = new ApiClient();
const form = $('#task-form'), input = $('#task-input'), list = $('#task-list');
let tasks = [], revision = 0, authenticated = false, busy = false, composing = false, needsRefresh = true;
let localTasks = null;
let hideCompleted = false;
let editing = false;
let undoState = null; // {task, index, timer}
let saveTimer = null; // debounced reorder save
try {hideCompleted = localStorage.getItem('todo-hide-completed') === '1';} catch {}

function announce(text) {$('#announcement').textContent = text;}
function notice(text = '') {$('#server-message').textContent = text;$('#server-notice').hidden = !text;}
function inputError(text = '') {$('#input-error').textContent = text;$('#input-error').hidden = !text;input.setAttribute('aria-invalid',String(Boolean(text)));}
function passwordError(text = '') {$('#password-error').textContent = text;$('#password-error').hidden = !text;}
function counter() {
  const n = lengthOf(normalize(input.value));$('#char-count').textContent = `${n} / ${MAX_LENGTH}`;$('#char-count').classList.toggle('over-limit',n > MAX_LENGTH);
}
function applyFilterButtons() {
  $('#filter-all').setAttribute('aria-pressed',String(!hideCompleted));
  $('#filter-active').setAttribute('aria-pressed',String(hideCompleted));
}
function visibleTasks() {return tasks.map((task,index)=>({task,index})).filter(item=>!hideCompleted || !item.task.completed);}
function updateControls() {
  const disabled = busy || editing || !authenticated || needsRefresh;
  form.querySelector('button').disabled = disabled;
  list.querySelectorAll('input, button').forEach(control => {
    if (control.classList.contains('task-edit')) return;
    control.disabled = disabled || control.dataset.boundary === '1';
  });
  $('#login-button').disabled = busy;$('#logout').disabled = busy;$('#change-password').disabled = busy;
  $('#refresh').disabled = busy || !authenticated;
  $('#import-button').disabled = disabled;
  $('#filter-all').disabled = !authenticated;$('#filter-active').disabled = !authenticated;
  $('#task-count').textContent = `${tasks.filter(task=>task.completed).length} из ${tasks.length} выполнено`;
  $('#empty-state').hidden = tasks.length !== 0;
  $('#done-state').hidden = !(hideCompleted && tasks.length > 0 && visibleTasks().length === 0);
  $('#workspace').hidden = !authenticated;$('#login-panel').hidden = authenticated;
  $('#logout').hidden = !authenticated;$('#change-password').hidden = !authenticated;
  $('#refresh').hidden = !authenticated;
}
function setBusy(value) {busy = value;updateControls();}
const icon = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
function makeRow(item, arr) {
  const {task, index} = item;
  const row = document.createElement('li');row.className = task.completed ? 'task done' : 'task';row.dataset.id = task.id;
  const label = document.createElement('label');
  const check = document.createElement('input');check.type = 'checkbox';check.checked = task.completed;
  check.setAttribute('aria-label', `Выполнено: ${task.text}`);
  label.append(check);
  const text = document.createElement('button');text.type = 'button';text.className = 'task-text';text.textContent = task.text;
  text.title = 'Нажмите, чтобы переименовать';
  text.setAttribute('aria-label', `Переименовать задачу: ${task.text}`);
  const up = document.createElement('button');up.type = 'button';up.className = 'move up';up.innerHTML = icon('<path d="M18 15l-6-6-6 6"/>');
  up.setAttribute('aria-label', `Поднять задачу: ${task.text}`);
  if (index === 0) {up.disabled = true;up.dataset.boundary = '1';}
  const down = document.createElement('button');down.type = 'button';down.className = 'move down';down.innerHTML = icon('<path d="M6 9l6 6 6-6"/>');
  down.setAttribute('aria-label', `Опустить задачу: ${task.text}`);
  if (index === arr.length - 1) {down.disabled = true;down.dataset.boundary = '1';}
  const remove = document.createElement('button');remove.type = 'button';remove.className = 'remove';remove.setAttribute('aria-label', `Удалить задачу: ${task.text}`);
  remove.innerHTML = icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>');
  row.append(label,text,up,down,remove);return row;
}
function render() {list.replaceChildren(...visibleTasks().map(item=>makeRow(item,tasks)));updateControls();}
function accept(state) {tasks = state.tasks;revision = state.revision;needsRefresh = false;notice();$('#save-status').textContent = 'Сохранено на сервере';clearSaveTimer();render();}
function failed(error) {
  if (error.status === 401 && error.code === 'auth') {authenticated = false;tasks = [];render();$('#password').focus();}
  if (error.status === 409) {needsRefresh = true;$('#save-status').textContent = 'Список устарел — нажмите «Обновить список»';}
  else {$('#save-status').textContent = 'Сохранение не подтверждено';}
  notice(error.message);updateControls();
}
async function refresh() {
  if (busy) return;
  setBusy(true);
  try {accept(await api.request('tasks'));announce('Список обновлён.');}
  catch (error) {failed(error);}
  finally {setBusy(false);}
}
function clearSaveTimer() {if (saveTimer !== null) {clearTimeout(saveTimer);saveTimer = null;}}
async function commit(nextTasks, action = 'tasks') {
  if (busy || editing || needsRefresh || !authenticated) return false;
  clearSaveTimer();
  setBusy(true);$('#save-status').textContent = 'Сохраняем…';
  try {const state = await api.request(action,{revision,tasks:nextTasks});accept(state);return state;}
  catch (error) {failed(error);return false;}
  finally {setBusy(false);}
}
function moveTask(id, direction) {
  if (busy || editing || needsRefresh || !authenticated) return;
  const index = tasks.findIndex(task=>task.id === id);
  const target = direction < 0 ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= tasks.length) return;
  const next = [...tasks];[next[index],next[target]] = [next[target],next[index]];
  tasks = next;render();scheduleSave();
}
function scheduleSave() {
  clearSaveTimer();
  saveTimer = setTimeout(() => {saveTimer = null;commit(tasks).then(ok => {if (ok) announce('Порядок задач сохранён.');});}, 400);
}
function rememberUndo(task, index) {
  if (undoState?.timer) clearTimeout(undoState.timer);
  undoState = {task, index: Math.max(0, Math.min(index, tasks.length))};
  $('#undo-text').textContent = 'Задача удалена.';
  $('#undo-toast').hidden = false;$('#undo-button').disabled = false;
  undoState.timer = setTimeout(() => {$('#undo-toast').hidden = true;undoState = null;}, 7000);
}
function startEdit(row) {
  const task = tasks.find(task=>task.id === row.dataset.id);
  if (!task || row.querySelector('.task-edit') || busy || needsRefresh || !authenticated) return;
  editing = true;
  const textButton = row.querySelector('.task-text');textButton.hidden = true;
  const editor = document.createElement('input');
  editor.type = 'text';editor.className = 'task-edit';editor.value = task.text;editor.maxLength = 400;
  editor.setAttribute('aria-label', 'Новое название задачи');
  const errorLine = document.createElement('p');errorLine.className = 'error edit-error';
  textButton.after(editor);editor.after(errorLine);
  editor.focus();editor.setSelectionRange(editor.value.length, editor.value.length);
  updateControls();
  let finished = false;
  const finish = save => {
    if (finished) return;finished = true;
    const value = editor.value;
    editor.remove();errorLine.remove();textButton.hidden = false;
    editing = false;updateControls();
    if (!save) return;
    const result = validateText(value);
    if (result.error) {announce(result.error);return;}
    if (result.text === task.text) return;
    commit(tasks.map(item=>item.id === task.id ? {...item,text:result.text} : item)).then(ok => {if (ok) announce('Задача переименована.');});
  };
  editor.addEventListener('blur',()=>finish(true));
  editor.addEventListener('keydown',event=>{
    if (event.key === 'Enter' && !event.isComposing) {event.preventDefault();finish(true);}
    else if (event.key === 'Escape') {event.preventDefault();finished = true;editor.remove();errorLine.remove();textButton.hidden = false;editing = false;updateControls();input.focus();}
  });
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
  const move = event.target.closest('.move');
  if (move) {moveTask(move.closest('.task').dataset.id, move.classList.contains('up') ? -1 : 1);return;}
  const textButton = event.target.closest('.task-text');
  if (textButton) {event.preventDefault();startEdit(textButton.closest('.task'));return;}
  const button = event.target.closest('.remove');if (!button || busy) return;
  const row = button.closest('.task'),index = tasks.findIndex(task=>task.id === row.dataset.id);
  if (index < 0) return;
  const focusId = tasks[index+1]?.id || tasks[index-1]?.id;
  const removed = tasks[index];
  if(await commit(tasks.filter(task=>task.id !== row.dataset.id))) {
    rememberUndo(removed, index);
    const target = Array.from(list.children).find(item=>item.dataset.id === focusId);(target?.querySelector('.remove') || target?.querySelector('.task-text') || input).focus();announce('Задача удалена.');
  }
});
$('#undo-button').addEventListener('click',async()=>{
  if (!undoState || busy || needsRefresh || !authenticated) return;
  const {task, index} = undoState;clearTimeout(undoState.timer);undoState = null;$('#undo-toast').hidden = true;
  const next = [...tasks];next.splice(Math.min(index, next.length), 0, task);
  if (await commit(next)) announce('Задача возвращена в список.');
});
$('#filter-all').addEventListener('click',()=>{if (hideCompleted) {hideCompleted = false;try {localStorage.setItem('todo-hide-completed','0');} catch {} applyFilterButtons();render();announce('Показаны все задачи.');}});
$('#filter-active').addEventListener('click',()=>{if (!hideCompleted) {hideCompleted = true;try {localStorage.setItem('todo-hide-completed','1');} catch {} applyFilterButtons();render();announce('Показаны активные задачи.');}});
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
  try {await api.request('logout',{});authenticated = false;tasks = [];input.value = '';inputError();counter();notice();$('#save-status').textContent = '';clearSaveTimer();undoState = null;$('#undo-toast').hidden = true;$('#password-panel').hidden = true;passwordError();editing = false;render();$('#password').focus();}
  catch(error) {failed(error);}
  finally {setBusy(false);}
});
$('#refresh').addEventListener('click',refresh);
$('#change-password').addEventListener('click',()=>{
  if (busy || editing) return;
  $('#password-form').reset();passwordError();$('#password-panel').hidden = false;$('#current-password').focus();
});
$('#password-cancel').addEventListener('click',()=>{$('#password-panel').hidden = true;passwordError();input.focus();});
$('#password-form').addEventListener('submit',async event=>{
  event.preventDefault();if (busy || editing) return;
  const current = $('#current-password').value, next = $('#next-password').value, confirm = $('#confirm-password').value;
  if (lengthOf(current) < 12 || lengthOf(current) > 128 || /\p{Cc}/u.test(current)) {passwordError('Введите текущий пароль (12–128 символов без управляющих символов).');return;}
  if (lengthOf(next) < 12 || lengthOf(next) > 128 || /\p{Cc}/u.test(next)) {passwordError('Новый пароль — от 12 до 128 символов без управляющих символов.');return;}
  if (next !== confirm) {passwordError('Пароли не совпадают.');return;}
  passwordError();setBusy(true);
  try {
    const result = await api.request('password',{current,next});
    tasks = result.tasks;revision = result.revision;needsRefresh = false;
    $('#save-status').textContent = 'Сохранено на сервере';render();
    $('#password-panel').hidden = true;$('#password-form').reset();
    announce('Пароль изменён. Следующий вход — с новым паролем.');
  } catch (error) {
    if (error.status === 401 && error.code === 'auth') {$('#password-panel').hidden = true;failed(error);}
    else passwordError(error.message);
  }
  finally {setBusy(false);}
});
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
applyFilterButtons();render();counter();start();