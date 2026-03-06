# Deployment Runbook (VPS + systemd)

Этот проект уже крутится на VPS через `systemd` сервисы:
- `sailaway-api.service`
- `sailaway-bot.service`

Ниже только практические команды для текущей схемы деплоя.

## 1. Подключение к серверу

```bash
ssh <user>@<vps_ip>
```

Если нужен ключ/порт:

```bash
ssh -i ~/.ssh/<key_file> -p <port> <user>@<vps_ip>
```

## 2. Проверка статуса сервисов

```bash
sudo systemctl status sailaway-api.service --no-pager
sudo systemctl status sailaway-bot.service --no-pager
```

Короткий список:

```bash
systemctl list-units --type=service | grep -E "sailaway-api|sailaway-bot"
```

## 3. Просмотр логов

Последние 300 строк:

```bash
journalctl -u sailaway-api.service -n 300 --no-pager
journalctl -u sailaway-bot.service -n 300 --no-pager
```

Стрим в реальном времени:

```bash
journalctl -u sailaway-bot.service -f
```

Фильтр по scheduler/draft/error (без `rg`):

```bash
journalctl -u sailaway-bot.service -n 1000 --no-pager | grep -E "scheduler:|draft|error"
```

Проверка четвергового слота драфта (09:00 UTC):

```bash
journalctl -u sailaway-bot.service --since "2026-03-05 08:55:00 UTC" --until "2026-03-05 09:10:00 UTC" --no-pager | grep -E "scheduler:|draft|error"
```

Ищи строки:
- `[scheduler:draft.trigger]`
- `[scheduler:draft.sent]` или `[scheduler:draft.error]`

## 4. Обновление кода и деплой

Пример для директории проекта на сервере (`/opt/sail-away-posts-generator` замени на свой путь):

```bash
cd /opt/sail-away-posts-generator
git pull --ff-only
npm install
npm run build
sudo systemctl restart sailaway-api.service
sudo systemctl restart sailaway-bot.service
```

Проверка после рестарта:

```bash
sudo systemctl status sailaway-api.service --no-pager
sudo systemctl status sailaway-bot.service --no-pager
curl -fsS http://127.0.0.1:3000/health
```

Ожидаемый API ответ:
- `status: "ok"`
- `service: "api"`

## 5. Минимальный smoke test бота

В Telegram:
- `/queue`
- `/draft 1`
- `/scheduler_test`

## 6. Частые проблемы

- Нет сообщений по четвергам:
  - проверь, что бот был запущен в слот `четверг 09:00 UTC`;
  - проверь наличие `[scheduler:draft.trigger]` в логах.
- Логи пустые или редкие:
  - убедись, что смотришь правильный юнит (`sailaway-bot.service`).
- Ошибки генерации:
  - смотри `Draft generation failed` в API логах;
  - проверь `OPENAI_*` переменные окружения и сетевой доступ с VPS.
