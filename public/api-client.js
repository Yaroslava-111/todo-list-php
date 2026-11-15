import {decode} from './core.js';
export class ApiFault extends Error {
  constructor(message, status = 0, code = 'network') {super(message);this.status = status;this.code = code;}
}
export class ApiClient {
  constructor(fetcher = globalThis.fetch.bind(globalThis)) {this.fetcher = fetcher;this.csrf = '';}
  async request(action, body) {
    const options = {method:body === undefined ? 'GET' : 'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}};
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';options.headers['X-CSRF-Token'] = this.csrf;
      options.body = JSON.stringify(body);
    }
    let response;
    try {response = await this.fetcher(`./api.php?action=${action}`, options);}
    catch {throw new ApiFault('Нет связи с сервером. Сохранение не подтверждено. Проверьте подключение и повторите действие.');}
    let result;
    try {result = await response.json();}
    catch {throw new ApiFault('Сервер вернул неверный ответ. Проверьте, что хостинг поддерживает PHP и база настроена.',response.status,'server');}
    if (!response.ok) throw new ApiFault(typeof result?.error === 'string' ? result.error : 'Не удалось выполнить запрос.',response.status,result?.code ?? 'server');
    if (!result || typeof result !== 'object') throw new ApiFault('Неверный ответ сервера.',0,'server');
    if (['bootstrap','login','logout'].includes(action)) {
      if (typeof result.authenticated !== 'boolean' || typeof result.csrf !== 'string' || !/^[a-f0-9]{64}$/.test(result.csrf)) throw new ApiFault('Неверный ответ авторизации.',0,'server');
      this.csrf = result.csrf;
    } else {
      if (!Number.isInteger(result.revision) || result.revision < 0 || result.revision > 2147483647) throw new ApiFault('Неверная версия списка от сервера.',0,'server');
      try {result.tasks = decode(JSON.stringify({version:1,tasks:result.tasks}));}
      catch {throw new ApiFault('Сервер вернул повреждённый список. Данные не изменены.',0,'server');}
    }
    return result;
  }
}
