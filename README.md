# Bastilla OS Ultimate

Panel React/Vite z serwerem Express, bazą SQLite i integracjami Ollama/Gemini.

## Uruchomienie

Wymagane: Node.js 22.18+ (lub 24+), npm i Python 3 z modułem `sqlite3`.

```sh
npm install --ignore-scripts
cp .env.example .env
npm run dev
```

Panel działa domyślnie pod `http://localhost:3000`. Zmienna `PORT` pozwala zmienić port.
Repozytorium zawiera też `bun.lock`: instalację z zablokowanymi wersjami można
wykonać przez `bun install --frozen-lockfile --ignore-scripts`.

Serwer inicjalizuje `.bastilla/bastilla.db` w katalogu projektu. Jeżeli istnieje
systemowa baza `/var/lib/bastilla/bastilla.db`, korzysta z niej, zachowując dane.
`BASTILLA_DB_PATH` wskazuje inną bazę. Migracje dodają brakujące kolumny
`svl_locked` i `avatar_url` bez zastępowania rekordów.

Zwykły start inicjalizuje wyłącznie bazę aplikacji. Konta agentów i narzędzia
systemowe wymagają osobno skonfigurowanego środowiska Linux. Dotychczasowy skrypt
konfiguracji hosta jest dostępny przez `BASTILLA_PROVISION_HOST=true` jako root
w środowisku dystrybucji z projektem w `/app/applet`. Gniazdo root wymaga
`BASTILLA_ROOT_SOCKET=true`, a automatyczna misja `BASTILLA_CONTINUOUS_MISSION=true`.

Do rzeczywistych odpowiedzi AI potrzebna jest działająca usługa Ollama pod
`OLLAMA_BASE_URL` z modelem wybranym w panelu albo `GEMINI_API_KEY` w `.env`.
Bez tych integracji panel nadal działa, a czat zgłasza brak połączenia.
Opcjonalny `BASTILLA_OLLAMA_BRIDGE=true` uruchamia dotychczasowy most zgodności
AI Studio na porcie 11434; jego katalog modeli jest statyczny i nie potwierdza
instalacji lokalnych wag Ollama.

## Weryfikacja i produkcja

```sh
npm run lint
npm test
npm run build
NODE_ENV=production npm start
```

Testy API używają tymczasowej bazy i lokalnej atrapy usługi modelu. Sprawdzają
migrację, zapis danych, wykonanie SVL, katalog terminala, rozdzielenie sesji czatu,
routing SSE i raportowanie niedostępnego modelu oraz błędów bazy.
Nie wymagają kluczy API ani kont systemowych agentów.

Przy działającym serwerze można wykonać test sześciu zakładek i obrazów produkcyjnych:

```sh
npx playwright install chromium
npm run test:ui
```

`TEST_BASE_URL` ustawia adres testowanego panelu, a
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pozwala użyć zainstalowanego Chromium.

## Codex CLI

Oficjalny `@openai/codex` 0.167.2 jest lokalną zależnością aplikacji. Serwer
korzysta z tego pliku wykonywalnego; `BASTILLA_CODEX_BIN` pozwala wskazać inny.
Panel logowania jest dostępny w zakładkach **Terminale** oraz **Diagnostyka i GitHub**.

- **Zaloguj przez ChatGPT** uruchamia `codex login --device-auth`. Otwórz
  wyświetlony adres, wpisz kod i potwierdź logowanie na swoim koncie. Jeżeli
  potrzeba, włącz logowanie kodem urządzenia w ustawieniach konta lub workspace.
  Panel sprawdza zakończenie procesu; można też anulować oczekujące logowanie.
- **Użyj klucza z serwera** przekazuje `OPENAI_API_KEY` z sekretów hostingu do
  `codex login --with-api-key` przez stdin. Klucz nie jest argumentem procesu
  ani częścią odpowiedzi API.
- **Sprawdź status Codex** odczytuje wynik CLI bez zmieniania poświadczeń.

CLI zarządza formatem i magazynem poświadczeń zgodnie z istniejącym `CODEX_HOME`
oraz konfiguracją Codex. Aplikacja nie kopiuje poświadczeń między kontami Linux.
Znane sztuczne tokeny `codex_tk_*` / `codex_rf_*` i dawny format `api_key` są
zgłaszane jako wymagające ponownego logowania. Sam poprawny status lokalnego
CLI nie potwierdza dostępu do modeli, ważności klucza w usłudze ani dostępnego limitu.

API: `GET /api/codex/status` i `POST /api/codex/auth` z akcją `status`,
`device_login`, `cancel_login` lub `use_api_key`. Dawne akcje generowania
tokenów i zbiorczego usuwania blokad zwracają błąd bez zmieniania plików.
Logowanie wymaga dostępu sieciowego do usług uwierzytelniania OpenAI;
dziedziczy ustawienia proxy i zaufanych certyfikatów serwera.
