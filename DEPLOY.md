# Запуск GAS SHOP на VPS

Инструкция для нового VPS/VDS с Ubuntu 24.04 LTS и root-доступом, например в AdminVPS или Timeweb Cloud. Рекомендуется 1–2 vCPU, 2 ГБ памяти и 20 ГБ постоянного SSD. Приложению нужен Node.js 24; внешних npm-зависимостей и сборки нет.

Команды ниже выполняются **на вашем VPS от root через SSH или консоль провайдера**. Настройка виртуального хостинга Optimo отличается: поддержка Timeweb подтвердила, что запуск веб-сервера Node.js там запрещён.

Приложение работает от отдельного пользователя `gas-shop`. Код находится в `/opt/gas-shop`, база — в `/var/lib/gas-shop/shop.db`. Служба systemd запускает приложение после перезагрузки и перезапускает при сбоях.

## 1. Подготовить домен и доступ

Создайте DNS-запись **A** для выбранного домена или поддомена, указав публичный IPv4 VPS. Например: `shop.example.ru → IP вашего VPS`. Дождитесь обновления DNS. Если для этого же имени существует запись AAAA, она должна указывать на работающий IPv6 этого сервера.

В сетевом экране провайдера разрешите входящие TCP-соединения на **80** и **443**, а также SSH-порт сервера (обычно **22**). Node.js будет слушать только `127.0.0.1:3000` внутри VPS.

Подключитесь к VPS:

```bash
ssh root@IP_ВАШЕГО_VPS
```

Ниже везде замените `shop.example.ru` на свой домен. Протокол `https://` и путь `/miniapp` в имя домена не входят.

## 2. Установить Node.js 24 и необходимые программы

```bash
apt-get update
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx sqlite3

curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/gas-shop-node24.sh
bash /tmp/gas-shop-node24.sh
apt-get install -y nodejs

node --version
npm --version
```

`node --version` должен показать `v24.x.x`. Официальный установщик NodeSource подключает репозиторий с проверкой подписи пакетов. При ошибке скачивания или установки устраните её перед переходом дальше; отключать проверку TLS или подписей не требуется.

## 3. Скачать код и подготовить базу

```bash
git clone --branch main https://github.com/vshnkvm-max/ruslan.git /opt/gas-shop
cd /opt/gas-shop
npm run check
npm test

id -u gas-shop >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/gas-shop --create-home --shell /usr/sbin/nologin gas-shop
install -d -o gas-shop -g gas-shop -m 0700 /var/lib/gas-shop

```

`npm install` для работы приложения не нужен. Если каталог `/opt/gas-shop` уже существует, используйте раздел обновления ниже вместо повторного клонирования. Для приватного репозитория сначала потребуется настроить на VPS доступ к GitHub.

Если магазин уже заполнен на другой машине, данные через GitHub не переносятся: **сейчас, до создания администратора и запуска службы**, перенесите согласованную резервную копию SQLite в `/var/lib/gas-shop/shop.db` и назначьте владельца `gas-shop:gas-shop` с правами `0600`. Прежние аккаунты сохранятся. У работающей SQLite нельзя копировать один файл `shop.db`, игнорируя WAL; используйте SQLite `.backup`, как в разделе резервного копирования. Для нового магазина этот перенос не требуется, база будет пустой.

Теперь создайте администратора:

```bash
runuser -u gas-shop -- env DB_PATH=/var/lib/gas-shop/shop.db /usr/bin/node /opt/gas-shop/scripts/create-admin.js
```

Команда создаёт администратора `admin` со случайным паролем. Данные входа находятся в **`/var/lib/gas-shop/initial-admin.txt`** с правами `0600`. Откройте этот файл лично через SFTP или редактор, сохраните пароль в менеджере паролей и удалите файл после сохранения. Не отправляйте пароль в чат и не добавляйте его в Git. Повторное создание администратора не меняет существующую учётную запись.

## 4. Включить постоянный запуск

```bash
install -m 0644 /opt/gas-shop/deploy/gas-shop.service /etc/systemd/system/gas-shop.service
systemctl daemon-reload
systemctl enable --now gas-shop
systemctl status gas-shop --no-pager
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
```

Проверка должна вернуть `{"ok":true}`. Если служба не запустилась, посмотрите причину:

```bash
journalctl -u gas-shop -n 100 --no-pager
```

В конфигурации уже указаны постоянный путь базы и `COOKIE_SECURE=true` для доступа через HTTPS. Закрытие терминала не останавливает службу.

## 5. Подключить Nginx и HTTPS

Укажите свой домен:

```bash
SHOP_DOMAIN=shop.example.ru
sed "s/SHOP_DOMAIN/${SHOP_DOMAIN}/g" /opt/gas-shop/deploy/nginx.conf > /etc/nginx/sites-available/gas-shop
ln -s /etc/nginx/sites-available/gas-shop /etc/nginx/sites-enabled/gas-shop
nginx -t
systemctl enable --now nginx
systemctl reload nginx

certbot --nginx --redirect -d "$SHOP_DOMAIN"
systemctl enable --now certbot.timer
certbot renew --dry-run

curl -fsS "https://${SHOP_DOMAIN}/api/health"
curl -fsS "https://${SHOP_DOMAIN}/api/storefront"
```

Certbot запросит контактный email и согласие с условиями центра сертификации. Он выпустит сертификат и настроит перенаправление на HTTPS. Для выпуска домен уже должен вести на VPS, а порт 80 — быть доступен из интернета.

Если символьная ссылка Nginx уже существует, повторять `ln -s` не нужно. Перед перезагрузкой Nginx его проверка `nginx -t` должна завершиться успешно.

Входите в админку после настройки HTTPS: в службе включены защищённые cookie.

- Админка: **`https://shop.example.ru/`**.
- Витрина: **`https://shop.example.ru/miniapp`**.
- Проверка сервера: **`https://shop.example.ru/api/health`**.

Откройте админку, войдите, создайте товар и проверьте его появление на витрине. Фотографии и картинку баннера можно загрузить через админку.

## 6. Подключить Telegram

В **@BotFather** выберите своего бота, откройте настройки кнопки меню (`/setmenubutton`) и укажите:

```text
https://shop.example.ru/miniapp
```

Это подключает существующую витрину и локальную корзину. Серверная авторизация Telegram, оформление заказов и платежи пока не реализованы; подробнее — в README.

## Резервное копирование и обновление

Перед обновлением создайте согласованную копию SQLite. Команда `.backup` учитывает данные из WAL и подходит для работающего приложения:

```bash
install -d -m 0700 /var/backups/gas-shop
SHOP_BACKUP="/var/backups/gas-shop/shop-$(date +%Y%m%d-%H%M%S).db"
sqlite3 -readonly /var/lib/gas-shop/shop.db ".backup '$SHOP_BACKUP'"
chmod 0600 "$SHOP_BACKUP"
sqlite3 -readonly "$SHOP_BACKUP" 'PRAGMA integrity_check;'
```

Последняя проверка должна вернуть `ok`. Храните дополнительные копии на отдельной машине или в закрытом облачном хранилище: база содержит данные магазина и учётных записей.

Для обновления кода:

```bash
cd /opt/gas-shop
git pull --ff-only origin main
npm run check
npm test
systemctl restart gas-shop
curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
```

Если `git pull` или проверки завершились ошибкой, устраните её до перезапуска. База лежит вне репозитория; миграции применяются автоматически при старте приложения. Обновление галереи переносит старые фото товаров в отдельную таблицу той же базы, сохраняя товары, остатки и сортировку. Перед первым запуском новой версии обязательно сделайте резервную копию по инструкции выше: для отката к старому коду понадобится и прежняя база. Новых зависимостей и изменения Nginx для этого обновления не требуется: каждое фото загружается отдельным небольшим запросом.

Если при обновлении изменились файлы `deploy/gas-shop.service` или `deploy/nginx.conf`, проверьте изменения и перенесите нужные настройки в `/etc`. После изменения службы выполните `systemctl daemon-reload` и `systemctl restart gas-shop`; после изменения Nginx — `nginx -t` и `systemctl reload nginx`. Nginx-конфигурация в `/etc` после выпуска сертификата содержит добавленные Certbot настройки HTTPS — сохраняйте их при обновлении.

Сжатие файлов интерфейса и ETag работают в Node.js без дополнительной настройки Nginx. После обновления нужен перезапуск `gas-shop`, чтобы загрузить новые файлы интерфейса. Баннеры остаются в существующей таблице SQLite; новая версия выдаёт изображения отдельными запросами, поэтому повторная загрузка старых баннеров не нужна.

Обновление витрины добавляет описание акции и ссылку закупки на её оплату. Перед обновлением сделайте резервную копию по инструкции выше. Миграция сохраняет существующие остатки, документы и суммы; старые оплаты связываются только при однозначном совпадении записи. Новых пакетов и изменений Nginx не требуется.
