export const MAX_LENGTH = 200;
export const MAX_TASKS = 500;
export const STORAGE_KEY = 'spectrum-todo:v1';
export const normalize = value => value.replace(/\s+/gu, ' ').trim();
export const lengthOf = value => Array.from(value).length;

export function validateText(value) {
  const text = normalize(value);
  if (!text || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(text)) return {error: 'Введите название задачи — от 1 до 200 символов.'};
  if (/\p{Cc}/u.test(text)) return {error: 'Удалите управляющие символы из названия задачи.'};
  if (lengthOf(text) > MAX_LENGTH) return {error: `Максимум ${MAX_LENGTH} символов. Сейчас: ${lengthOf(text)}.`};
  return {text};
}

export function createTask(tasks, value, id) {
  const result = validateText(value);
  if (result.error) return result;
  if (tasks.length >= MAX_TASKS) return {error: 'Достигнут лимит: 500 задач. Удалите ненужную задачу, чтобы добавить новую.'};
  return {task: {id, text: result.text, completed: false}};
}

export function decode(raw) {
  if (raw === null) return [];
  if (raw.length > 2_000_000) throw new Error('Storage is too large');
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || !Array.isArray(data.tasks) || data.tasks.length > MAX_TASKS) throw new Error('Invalid storage schema');
  const ids = new Set();
  return data.tasks.map(task => {
    if (!task || typeof task.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(task.id) || ids.has(task.id) || typeof task.text !== 'string' || typeof task.completed !== 'boolean') throw new Error('Invalid task');
    const result = validateText(task.text);
    if (result.error || result.text !== task.text) throw new Error('Invalid task text');
    ids.add(task.id);
    return {id: task.id, text: task.text, completed: task.completed};
  });
}
export const encode = tasks => JSON.stringify({version: 1, tasks});
