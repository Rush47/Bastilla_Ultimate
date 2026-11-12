# Diagnostyka Bastilla Ultimate — 2026-11-12

Repozytorium: `Rush47/Bastilla_Ultimate`. Punkt odniesienia: `e39ae8f6b04880df9f82948b1a9e967a29d20634` z `main`. Prace wykonano na gałęzi `codex/backend-agent-diagnostics`. Raport dotyczy kodu repozytorium i uruchomionej lokalnie aplikacji w środowisku roboczym. Nie potwierdza stanu osobnego hosta produkcyjnego.

## Wynik diagnostyki

Backend Express, SQLite, interfejs React/Vite oraz cztery tryby terminala uruchomiono i sprawdzono. Nie ma dowodu, że cztery profile agentów są niezależnymi wykonawcami AI. Ich worker Python wykonywał jedynie heartbeat. Zastane deklaracje pełnej autonomii, roota i aktywnych modeli były niezgodne z obserwacją.

| Agent | Konfiguracja profilu w istniejącej bazie | Konto i terminal Linux w środowisku roboczym | Rzeczywisty model agenta | Narzędzia i repozytorium agenta |
| --- | --- | --- | --- | --- |
| Aria | Ollama `llama3.2-vision:11b`, fallback `gemini-3.8-flash` | Konto nie istnieje; `runuser` exit 1 | Niezweryfikowany | Brak potwierdzonego dostępu |
| Alex | Ollama `llama3.2-vision:11b`, fallback `gemini-3.8-flash` | Konto nie istnieje; `runuser` exit 1 | Niezweryfikowany | Brak potwierdzonego dostępu |
| Astyria | Ollama `llama3.2-vision:11b`, fallback `gemini-3.8-flash` | Konto nie istnieje; `runuser` exit 1 | Niezweryfikowany | Brak potwierdzonego dostępu |
| Aurelius | Ollama `llama3.2-vision:11b`, fallback `gemini-3.8-flash` | Konto nie istnieje; `runuser` exit 1 | Niezweryfikowany | Brak potwierdzonego dostępu |

Istniejąca baza zawierała dla wszystkich agentów status `UNLOCKED_ROOT_ONLINE`, UID/GID 0 oraz PID 0. Nie stanowiło to dowodu istnienia kont. Zachowano bazę i dane użytkownika; nowa migracja oznacza historię starszej wersji jako niezweryfikowaną. Nowe profile nie dostają fałszywego heartbeat ani UID 0. Nowa konfiguracja Gemini używa `GEMINI_MODEL` (domyślnie `gemini-flash-latest`); zapisanych ustawień użytkownika nie nadpisywano.

## Wykonane próby integracji

- System: Debian GNU/Linux 13 (trixie), Linux 6.18.57 x86_64, Node 24.22.1, Python 3.12.14.
- Powłoka Linux: prawdziwe `id`, exit 0, UID/GID 1000 (`agent`). Etykieta „Linux Root” nie przyznawała uprawnień.
- Python: prawdziwe `os.getuid()`, exit 0, UID 1000. Wykonanie SVL oraz migracja i zapis SQLite przeszły testy API.
- AI CLI: oficjalny `codex-cli 0.167.2`, exit 0. Tryb binarny prawidłowo odczytał nagłówek `/bin/bash` i zrzut bajtów.
- Codex: `login status` potwierdził logowanie ChatGPT procesu serwera. Dwie minimalne próby `codex exec` w trybie read-only, bez narzędzi i odczytu plików, nie potwierdziły odpowiedzi modelu. Próba z istniejącą konfiguracją osiągnęła limit 30 s i raportowała zdarzenia błędów połączenia z kodami 403/429. Próba bez konfiguracji użytkownika osiągnęła limit 45 s. Nie przesądzono, czy blokuje sieć, konfiguracja usługi czy limit konta.
- Ollama: brak binarium i dostępnego demona pod domyślnym adresem; brak potwierdzonych wag. Czat zwraca rzeczywisty HTTP 503 zamiast pozornej odpowiedzi.
- Gemini: brak `GEMINI_API_KEY` w środowisku aplikacji. Nie wykonano uwierzytelnionego wnioskowania Gemini. Testy potwierdzają poprawny błąd przy braku konfiguracji.
- GitHub: podłączony konektor konta Rush47 potwierdził dostęp do repozytorium i uprawnienie push. Lokalny Git potwierdził SHA `main`. Lokalny test uprawnień `gh api` zakończył się exit 1, więc nie przenoszono uprawnień konektora na konta agentów ani na CLI. Odczyt ochrony gałęzi przez konektor zwrócił 403 „Resource not accessible by integration”; ochrona gałęzi pozostaje niezweryfikowana.
- Podłączony serwer AI Linux/Bastilla MCP: odczyty statusu i listy agentów zwróciły HTTP 404 z endpointu `/mcp` na skonfigurowanym hoście preview. To problem połączenia MCP, nie dowód wyłączenia usług na hoście docelowym. Potrzebny jest poprawny trwały adres wdrożenia.
- Istniejąca baza lokalna: `PRAGMA quick_check` zwrócił `ok`. Nie usuwano zapisów starszej wersji.

Logi diagnostyczne nie zawierają opublikowanych sekretów. Status logowania i uprawnienia konektora są dowodami o określonym zakresie; nie stanowią potwierdzenia modelu i narzędzi wszystkich agentów.

## Naprawione problemy

1. **Fikcyjne odpowiedzi modeli.** Usunięto statyczne odpowiedzi, fałszywe wyniki wizji, procesy i telemetrię z mostu Ollama. Adapter na porcie 11435 identyfikuje się jako Gemini, zwraca pusty katalog lokalnych wag i rzeczywisty błąd wnioskowania. Gemini używa konfigurowanego modelu z limitem czasu zamiast listy niepotwierdzonych nazw i narzuconych parametrów bezpieczeństwa.
2. **Fikcyjne działanie CLI.** Klient Ollama wykonuje prawdziwe HTTP `pull`, sprawdza odpowiedź i zwraca niezerowy kod przy błędzie. Nie ogłasza pobrania modelu lub wersji niedostępnej usługi.
3. **Pozorne samoleczenie.** Zastąpiono pętlę deklarującą wdrożenia funkcji, zwalnianie stałych 45 MB RAM i zmianę awatarów rzeczywistym SQLite `quick_check`. Usunięto przepisywanie historycznych błędów `zenity exit=1` na sukces oraz sztuczne heartbeat agentów.
4. **Fałszywe uprawnienia.** Worker raportuje rzeczywiste UID/GID/PID i zakres `HEARTBEAT_ONLY`. SVL jest biblioteką matematyczną; nie zmienia operacyjnego statusu agentów. GUI nie deklaruje domyślnego roota, gotowości modelu ani wzrostu wydajności bez pomiaru. `/api/system/unlock` zwraca 410.
5. **Sztuczne wyniki w GUI.** Renderer nie dodaje wykresów RAM ani telemetrii do samych skryptów i komend. Brakujące dane pozostają nieznane. Dane z wiadomości modelu mają oznaczenie braku weryfikacji pomiarem. Mermaid działa z `securityLevel: strict`.
6. **Niebezpieczna synchronizacja Git.** Wyłączono endpoint, który wykonywał `checkout -B main`, zmieniał origin, dodawał wszystkie pliki i robił push bez przeglądu. `/api/git/sync` zwraca 409 z procedurą gałęzi i PR. Usunięto również wymuszanie nazwy `main` w provisioningu.
7. **Dostęp do konsoli.** Domyślne nasłuchiwanie ograniczono do loopback. Zdalne udostępnienie wymaga tokenu; dodano formularz dostępu, cookie HttpOnly/SameSite oraz Bearer API, kontrolę Origin i JSON dla zapisów. Polecenia przez GET SSE są odrzucane. Sekrety z otoczenia i rozpoznawane tokeny są maskowane w wynikach i odpowiedziach.
8. **Terminale i walidacja.** Dodano walidację trybów i identyfikatorów IPC, usunięto wywołania powłoki z niecytowanymi ścieżkami inspektora ELF i `ldd` dla badanego pliku. Terminal oraz NLP pokazują błędy połączenia. Brak tłumaczącego modelu nie jest zastępowany wykonaniem surowego tekstu użytkownika. Ścieżki SQLite i SVL odnoszą się do uruchomionej konfiguracji.
9. **Provisioning i atrapy.** Skrypt nie nadaje nowym kontom roota ani NOPASSWD, nie zastępuje sudo, nie instaluje atrap CLI i nie zmienia gałęzi repozytorium. Usunięto shimy udające sudo, pkexec, zenity, matplotlib oraz psutil z fikcyjnym CPU. Starszej konfiguracji systemowej nie zmieniano automatycznie. Opcjonalne legacy gniazdo roota ograniczono do 0600 i nie uruchamiano go podczas diagnostyki.
10. **Kolejka i monitorowanie.** Dodano SQLite `agent_tasks`, priorytety, idempotencję, atomowe pobieranie, dzierżawę, heartbeat, limit czasu, trwałość po restarcie i anulowanie z odrzucaniem spóźnionych wyników. Diagnostyka kont wykonuje próby w ich rzeczywistych tożsamościach, a potwierdzenie modelu jest przypisane do konkretnego wyniku serwera.
11. **Panel mobilny i ładowanie.** Dodano zakładkę Sterowanie, formularz zadania, wyniki i anulowanie; poprawiono zawijanie nawigacji. Zakładki są ładowane na żądanie. Początkowy pakiet JS zmalał z około 1598 kB do około 247 kB przed gzip. Biblioteki diagramów i widok 3D nadal tworzą większe, odroczone fragmenty.

## Wyniki testów

| Weryfikacja | Wynik |
| --- | --- |
| Bazowe `npm test` przed zmianami | 34/34 |
| Końcowe `npm run lint` | zaliczone |
| Końcowe `npm test` | 45/45, 0 błędów |
| `npm run build` | zaliczone; ostrzeżenia o większych odroczonych fragmentach |
| `npm run test:ui` z systemowym Chromium | siedem zakładek, obrazy produkcyjne, pełny ekran, brak błędów strony |
| Test formularza dostępu | logowanie do instancji z syntetycznym tokenem: zaliczone |
| Panel mobilny | 360, 390, 768 px: brak poziomego przepełnienia panelu i pola zadania |
| `python3 -m compileall -q distro/bastilla-overlay` | zaliczone |
| `bash -n distro/bastilla-overlay/provision-runtime.sh` | zaliczone |
| `git diff --check` | zaliczone |

Nowe i rozszerzone testy obejmują priorytety, idempotencję, restart wykonawcy, anulowanie, wygasanie dzierżaw, pojedynczą współbieżność przy dwóch workerach, błędy modelu, realną drogę API → kolejka → testowy endpoint modelu, zabezpieczenie main, zachowanie dowodów błędów, brak fałszywych wag i odpowiedzi mostu, prawdziwą operację klienta Ollama oraz autoryzację API. Testy modelowe korzystają z jawnych fixture; nie są dowodem dostępu do zewnętrznych usług AI. Odrębne próby lokalnych terminali i Codex opisano powyżej.

Pierwsze uruchomienie testów w domyślnej piaskownicy zwróciło `EPERM` dla procesów potomnych. Powtórzenie w dozwolonym środowisku wykonawczym przeszło. Skryptów zmieniających host, usług root, budowy całego obrazu bootc/ISO i testów maszyny wirtualnej nie uruchamiano. Rust/Cargo nie jest zainstalowany, więc testów bootguard nie wykonano.

## Pozostałe działania operatora

- Skonfigurować rzeczywistą Ollama i pobrany model albo Gemini przez sekrety hostingu; ponowić minimalny test odpowiedzi dla każdego profilu. Brakującego klucza nie da się zastąpić poprawką kodu.
- Zweryfikować łączność i limity konta Codex; zachować istniejące poświadczenia. Nie kopiować ich automatycznie do kont agentów.
- Jeśli mają istnieć cztery niezależne konta i wykonawcy: przygotować je na przeznaczonym do tego hoście, nadać minimalne uprawnienia do worktree oraz indywidualne tożsamości usług. Obecna kolejka nie ma autonomicznych narzędzi ani wykonawcy Codex.
- Przejrzeć stare instalacje pod kątem zmienionych sudo/sudoers, grup root/docker i atrap narzędzi. Repozytorium naprawiono, ale bez dostępu do hosta docelowego nie zadeklarowano jego naprawy.
- Naprawić adres MCP i potwierdzić `initialize`/`tools/list` oraz diagnostykę po wdrożeniu.
- Przejrzeć draft PR i wyniki CI. Zmiany nie zostały scalone do `main` ani wdrożone produkcyjnie.

Projekt architektury i kontrakt kolejki: [AGENT_CONTROL_DESIGN.md](AGENT_CONTROL_DESIGN.md).
