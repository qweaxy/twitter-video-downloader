# X Feed Download

**Download videos and GIFs without leaving your X feed.**  
**Скачивай видео и GIF прямо из ленты X.**

A lightweight extension for desktop Firefox. / Лёгкое расширение для настольного Firefox.

[English](#english) · [Русский](#русский)

---

## English

X Feed Download adds a small download icon next to the **⋯** menu on posts with video. Save a clip directly from your feed, without copying the post URL or opening a separate downloader website.

The button follows X’s visual style: a muted icon with a blue hover state. Downloads come directly from X’s video servers at `video.twimg.com`.

### Features

- **Download from the feed.** Click the icon beside the post’s menu to start saving a video.
- **Automatic MP4 selection.** The extension chooses the available MP4 variant with the highest reported bitrate.
- **Multiple videos.** If a post has several downloadable videos, choose one from a compact menu.
- **Reposts and quotes.** Supports video metadata in reposts and quoted posts. If a quote has its own video, that video takes priority.
- **Real GIF files.** Media marked as an animation by X is converted locally into an animated `.gif`. Ordinary videos remain `.mp4`.
- **English and Russian.** Messages follow the Firefox interface language, with English as the fallback for other languages.
- **GIF size controls.** Set resolution as a percentage of the source, choose a frame rate and palette size, and control where downloads are saved.
- **Local processing.** No separate downloader server, API key, or additional account is required.

### Requirements

Desktop Firefox **115 or later**, with access to the post on `x.com` or `twitter.com`.

### Installation

#### Try it locally

1. Extract the extension archive into a folder.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on…**.
4. Choose `manifest.json` from the extracted folder.
5. Reload your open X tabs.

A temporary installation lasts until Firefox closes. Keep the extracted folder if you want to load it again.

#### Install permanently

Standard Firefox requires a Mozilla-signed extension for permanent installation. The source ZIP is unsigned.

To sign a personal build, submit the ZIP through the [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/) and choose **On your own** for distribution outside the public catalog. Once Mozilla provides the signed `.xpi`, install it through Firefox’s add-on manager.

### How to use

1. Find a post with video.
2. Click the download icon immediately to the left of **⋯**.
3. If the post contains multiple videos, choose the one you want.
4. Check Firefox’s downloads panel for progress and the saved file.

Files are named `X_<post ID>_<media number>.mp4` for videos and `X_<post ID>_<media number>.gif` for animations. Firefox’s download settings determine where they are saved and whether a file picker appears.

For GIFs, the extension first retrieves X’s MP4 animation source and converts it into a looping GIF in your browser. A progress message appears during conversion. Keep the X tab open until the download starts; reloading or closing it cancels conversion. Only one GIF is converted at a time; ordinary MP4 downloads remain available.

The extension needs to receive the post’s video metadata after it loads. If a link is not found, open the post itself, reload the page, and try again.

### Settings

Click **X Feed Download** in Firefox’s extensions menu or on the toolbar to open settings. You can also open the extension’s preferences in `about:addons`.

| Setting | Choices | Default |
| --- | --- | --- |
| GIF resolution | 10–100% of the source width and height; shortcuts for 25%, 50%, 75%, 100% | 100% |
| GIF frame rate | 5, 10, 15, 20, 25 or 30 fps | 20 fps |
| GIF colors per frame | 64, 128 or 256 | 256 |
| Saving files | Follow Firefox settings, ask every time, or use the default downloads folder | Follow Firefox settings |

At **50%**, a 1280 × 720 animation becomes **640 × 360**: half the width and height, one quarter of the pixels. The settings page shows an example as you change the percentage. Actual file-size savings depend on the animation, frame rate and palette.

For a smaller GIF, try **50%, 15 fps, 128 colors**. Lower frame rates reduce smoothness; fewer colors can make gradients less smooth. Video downloads remain at their selected MP4 quality.

Click **Save settings** to apply your choices. They are kept locally in your Firefox profile and used for the next download. A conversion already in progress keeps the settings it started with. **Reset to defaults** restores values in the form; save to apply them. Uninstalling the extension can remove its stored settings.

### Privacy and permissions

Video metadata is processed locally in your browser. The extension does not send post data to an external downloader or analytics service, and it does not request your password, an API key, or permission to read cookies.

It temporarily keeps post IDs, media types, and video URLs/bitrates in memory, with a limit of 600 posts per tab. This cache is cleared when the tab reloads or closes. GIF conversion also holds the source animation and encoded frames in memory until they can be released. Direct-message requests are not among the operations it processes.

| Permission | Purpose |
| --- | --- |
| Access to X/Twitter and their API domains | Add the button and read video metadata in supported post and timeline responses. |
| `webRequest` and `webRequestBlocking` | Read those responses while passing their original contents through to the page. |
| `downloads` | Save video files and report completion or interruption. |
| `storage` | Keep your download preferences in this Firefox profile. |
| Access to `video.twimg.com` | Access X’s video host. |

### Limitations

- Only available direct MP4 variants are supported. HLS-only streams (`.m3u8`), live streams without an MP4 variant, and third-party video players are not supported.
- The highest-bitrate MP4 is not necessarily the creator’s original upload quality.
- GIFs loop indefinitely and use your selected resolution, frame rate and palette. Defaults are 100%, 20 fps and 256 colors. They may be much larger than their MP4 source; conversion can change colors and smoothness. This produces a new GIF, not the original uploaded GIF file.
- Local GIF conversion supports animations up to 120 seconds and 2,073,600 output pixels per frame (for example, 1920 × 1080). Reducing the resolution can bring a larger source within the output limit. The source is limited to 50 MiB, the encoded GIF to 128 MiB, and processing to 10 minutes. If conversion fails or a limit is exceeded, an error is shown; the extension does not save an MP4 instead.
- Changes to X’s page layout or API may require an extension update.
- English and Russian are the supported interface languages. The language setting inside X does not control the extension’s language.

### Updating and troubleshooting

For a temporary installation, replace the files in the extension folder, click **Reload** in `about:debugging`, and reload your X tabs. For a signed installation, install a signed newer version of the same extension.

If a download fails, check Firefox’s downloads panel and reload the post to obtain fresh metadata. When reporting a problem, include your Firefox version, extension version, a post URL if it can be shared, and the error message.

### Development

The extension uses plain JavaScript, CSS, and Firefox WebExtensions APIs. No build step is required.

Run the core tests from the extension folder:

```sh
node --test tests/core.test.cjs tests/settings.test.cjs
```

Conversion and encoder tests:

```sh
node --test tests/converter.test.cjs tests/gif.test.cjs
```

The encoder test additionally requires Python 3 and Pillow. It independently decodes generated GIFs and checks their frames, colors, timing, and looping. The converter test simulates browser media APIs; live Firefox decoding still needs a browser check.

The optional UI test requires Playwright and its Chromium browser:

```sh
node tests/ui.test.cjs
```

The UI test uses a synthetic page; it does not replace testing the extension in Firefox on X.

---

## Русский

X Feed Download добавляет небольшую иконку скачивания рядом с меню **⋯** в постах с видео. Сохраняй ролики прямо из ленты, без копирования ссылки на пост и перехода на отдельный сайт-загрузчик.

Кнопка оформлена в стиле X: приглушённая иконка с синей подсветкой при наведении. Видео скачиваются напрямую с серверов X — `video.twimg.com`.

### Возможности

- **Скачивание из ленты.** Нажми иконку рядом с меню поста, чтобы сохранить видео.
- **Автоматический выбор MP4.** Расширение выбирает доступный MP4-вариант с наибольшим указанным битрейтом.
- **Несколько видео.** Если в посте несколько доступных роликов, выбери нужный в небольшом меню.
- **Репосты и цитаты.** Поддерживаются метаданные видео из репостов и цитируемых постов. Если у цитаты есть собственное видео, приоритет отдаётся ему.
- **Настоящие GIF-файлы.** Медиа, отмеченные X как анимации, локально преобразуются в анимированный `.gif`. Обычные видео сохраняются в `.mp4`.
- **Русский и английский.** Язык сообщений определяется языком интерфейса Firefox. Для остальных языков используется английский.
- **Настройка размера GIF.** Выбирай разрешение в процентах от исходного, частоту кадров, размер палитры и способ сохранения файлов.
- **Локальная обработка.** Отдельный сервер-загрузчик, API-ключ и дополнительный аккаунт не нужны.

### Требования

Настольный Firefox **115 или новее** и доступ к нужному посту на `x.com` или `twitter.com`.

### Установка

#### Попробовать локально

1. Распакуй архив расширения в отдельную папку.
2. Открой в Firefox `about:debugging#/runtime/this-firefox`.
3. Нажми **«Загрузить временное дополнение…»**.
4. Выбери `manifest.json` из распакованной папки.
5. Обнови открытые вкладки X.

Временная установка действует до закрытия Firefox. Сохрани распакованную папку, чтобы при необходимости загрузить расширение снова.

#### Установить постоянно

Для постоянной установки в обычный Firefox нужна подпись Mozilla. ZIP-архив с исходниками не подписан.

Чтобы подписать личную сборку, отправь ZIP через [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/) и выбери **On your own** — распространение вне публичного каталога. Полученный от Mozilla подписанный файл `.xpi` можно установить через менеджер дополнений Firefox.

### Как пользоваться

1. Найди пост с видео.
2. Нажми иконку скачивания слева от **⋯**.
3. Если видео несколько, выбери нужное.
4. Следи за загрузкой и открой сохранённый файл через панель загрузок Firefox.

Видео получают имена `X_<номер поста>_<номер медиа>.mp4`, а анимации — `X_<номер поста>_<номер медиа>.gif`. Папка сохранения и появление диалога выбора файла зависят от настроек загрузок Firefox.

Для GIF расширение сначала получает MP4-источник анимации с серверов X и преобразует его в зацикленный GIF прямо в браузере. Во время преобразования отображается прогресс. Держи вкладку X открытой до начала скачивания: её закрытие или перезагрузка отменяет преобразование. Одновременно создаётся один GIF; скачивание обычных MP4 остаётся доступным.

Расширению нужно получить метаданные видео после своего запуска. Если ссылка не найдена, открой сам пост, обнови страницу и попробуй снова.

### Настройки

Нажми **X Feed Download** в меню расширений Firefox или на панели инструментов, чтобы открыть настройки. Они также доступны в параметрах дополнения на странице `about:addons`.

| Настройка | Варианты | По умолчанию |
| --- | --- | --- |
| Разрешение GIF | 10–100% исходной ширины и высоты; быстрые кнопки 25%, 50%, 75%, 100% | 100% |
| Частота кадров GIF | 5, 10, 15, 20, 25 или 30 кадров/с | 20 кадров/с |
| Цветов на кадр GIF | 64, 128 или 256 | 256 |
| Сохранение файлов | По настройкам Firefox, спрашивать каждый раз или использовать папку загрузок по умолчанию | По настройкам Firefox |

При **50%** анимация 1280 × 720 превращается в **640 × 360**: ширина и высота вдвое меньше, пикселей — вчетверо меньше. На странице настроек есть пример, который меняется вместе с процентом. Насколько уменьшится вес файла, зависит от содержимого анимации, частоты кадров и палитры.

Для небольшого GIF попробуй **50%, 15 кадров/с, 128 цветов**. Уменьшение частоты кадров снижает плавность движения, а небольшая палитра может сделать переходы цветов грубее. Качество скачиваемых MP4 не меняется.

Нажми **«Сохранить настройки»**, чтобы применить выбор. Настройки хранятся локально в профиле Firefox и используются при следующем скачивании. Уже запущенное преобразование продолжит работу с прежними параметрами. **«Вернуть исходные»** восстанавливает значения в форме — для применения нужно сохранить их. При удалении расширения его настройки могут быть удалены.

### Конфиденциальность и разрешения

Метаданные видео обрабатываются локально в браузере. Расширение не отправляет данные постов стороннему загрузчику или сервису аналитики и не запрашивает пароль, API-ключ или разрешение на чтение cookies.

Номера постов, типы медиа, ссылки на видео и их битрейты временно хранятся в оперативной памяти — до 600 постов на вкладку. Кэш очищается при перезагрузке или закрытии вкладки. При создании GIF в памяти также временно хранятся исходная анимация и закодированные кадры. Запросы личных сообщений не входят в список обрабатываемых операций.

| Разрешение | Для чего нужно |
| --- | --- |
| Доступ к X/Twitter и их API-доменам | Добавление кнопки и чтение метаданных видео в поддерживаемых ответах постов и ленты. |
| `webRequest` и `webRequestBlocking` | Чтение этих ответов с передачей исходного содержимого странице без изменений. |
| `downloads` | Сохранение видео и уведомления о завершении или прерывании загрузки. |
| `storage` | Хранение настроек скачивания в этом профиле Firefox. |
| Доступ к `video.twimg.com` | Доступ к серверу видео X. |

### Ограничения

- Поддерживаются доступные прямые MP4-варианты. Потоки только в HLS (`.m3u8`), прямые эфиры без MP4-варианта и сторонние видеоплееры не поддерживаются.
- MP4 с наибольшим битрейтом не обязательно совпадает по качеству с оригиналом автора.
- GIF бесконечно зацикливается и использует выбранные разрешение, частоту кадров и палитру. По умолчанию: 100%, 20 кадров/с и 256 цветов. Он может занимать значительно больше места, чем MP4-источник; цвета и плавность могут измениться. Создаётся новый GIF, а не восстанавливается оригинальный GIF-файл автора.
- Локальное преобразование GIF поддерживает анимации до 120 секунд и 2 073 600 пикселей на выходной кадр (например, 1920 × 1080). Уменьшение разрешения позволяет обработать исходник, превышающий этот лимит. Лимит исходного файла — 50 МиБ, готового GIF — 128 МиБ, обработки — 10 минут. При ошибке или превышении лимита появится сообщение; расширение не сохраняет MP4 вместо GIF.
- Изменения разметки или API X могут потребовать обновления расширения.
- Интерфейс доступен на русском и английском. Настройка языка внутри X не управляет языком расширения.

### Обновление и решение проблем

При временной установке замени файлы в папке расширения, нажми **«Перезагрузить»** в `about:debugging` и обнови вкладки X. Для подписанной установки используй подписанную новую версию того же дополнения.

Если скачивание не удалось, проверь панель загрузок Firefox и обнови пост, чтобы получить свежие метаданные. При сообщении о проблеме укажи версии Firefox и расширения, ссылку на пост, если ею можно поделиться, и текст ошибки.

### Разработка

Расширение написано на обычных JavaScript и CSS с использованием Firefox WebExtensions API. Сборка не требуется.

Основные тесты запускаются из папки расширения:

```sh
node --test tests/core.test.cjs tests/settings.test.cjs
```

Тесты преобразования и кодировщика:

```sh
node --test tests/converter.test.cjs tests/gif.test.cjs
```

Тесту кодировщика дополнительно нужны Python 3 и Pillow. Он независимо декодирует созданные GIF и проверяет кадры, цвета, тайминги и зацикливание. Тест преобразования имитирует браузерные API; декодирование в живом Firefox нужно проверять отдельно в браузере.

Дополнительному тесту интерфейса нужны Playwright и установленный для него Chromium:

```sh
node tests/ui.test.cjs
```

Тест интерфейса работает с тестовой страницей и не заменяет проверку расширения в Firefox на X.
