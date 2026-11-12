# Bastilla Ultimate — uruchomienie bez GitHub Copilot

Ten dokument jest procedurą operacyjną, nie potwierdzeniem gotowości usług. GitHub Copilot nie jest zależnością wykonawczą Bastilla.

## 1. Warunki wejściowe

- Uruchomiony backend Express i baza SQLite, panel Sterowanie.
- Działający dostawca modelu: Ollama **albo** Gemini. Dla Gemini ustaw `GEMINI_API_KEY` jako sekret hosta i `BASTILLA_AGENT_PROVIDER=gemini`. Dla Ollama ustaw `BASTILLA_AGENT_PROVIDER=ollama`, poprawny `OLLAMA_BASE_URL` i pobrany model wskazany w profilu.
- Nie wklejaj tokenów do repozytorium ani logów. Uruchamiaj backend jako konto bez root.
- `BASTILLA_API_TOKEN` i `APP_URL` są wymagane dla zdalnego panelu, wraz z `BASTILLA_HOST=0.0.0.0` i HTTPS.
- Codex CLI jest opcjonalny i jego zalogowanie nie oznacza dostępnego limitu modelu.

## 2. Minimalna diagnostyka na hoście aplikacji

```bash
node --version
npm run lint && npm test && npm run build
./node_modules/.bin/codex --version
./node_modules/.bin/codex login status
command -v ollama || true
curl --max-time 5 -fsS "${OLLAMA_BASE_URL:-http://127.0.0.1:11434}/api/tags" || true
```

Nie publikuj wyników zawierających sekrety. `codex login status` nie potwierdza dostępu do modelu. Ollama musi zwrócić realne modele, a nie pusty adapter zgodności. Nie traktuj `curl || true` jako pozytywnego wyniku.

## 3. Kolejka misji — bez Copilota

W panelu Sterowanie wybierz Aria, Alex, Astyria albo Aurelius. Wyślij krótką misję diagnostyczną; sprawdź w `GET /api/agent-tasks` status, rzeczywistą odpowiedź i błędy. `GET /api/agents/capabilities?remote=true` sprawdza możliwości kont, o ile zostały utworzone. Wynik modelu nie jest dowodem, że konto Linux lub narzędzia działają.

### Pierwsze zadanie testowe

> Zidentyfikuj aktualną nazwę dostawcy i modelu. Zwróć krótką odpowiedź tekstową oraz ograniczenia. Nie deklaruj dostępu do plików, GitHub ani narzędzi, jeśli nie zostały wykonane.

### Zasady dalszych misji

- Nie przypisuj agentom praw root ani dostępu do tokenów operatora.
- Dla zadań kodowych wymagane są izolowane worktree, jawne uprawnienia narzędzi i rejestr kodów wyjścia.
- Zmiany kodu mają kończyć się draft PR; `main` nie jest nadpisywany automatycznie.
- Bez wykonawcy narzędziowego nie opisuj kolejki modelowej jako autonomicznego programisty.

## 4. MCP

Najpierw skonfiguruj stabilny publiczny adres rzeczywistego backendu, a nie sam Vite preview. Sprawdź JSON-RPC `initialize`, `tools/list`, a następnie bezpieczne `tools/call`. HTTP 404 oznacza, że endpoint na tym adresie nie jest dostępny; nie oznacza, że cały host jest wyłączony. Zapisz URL bez sekretów, status HTTP, wersję protokołu i identyfikator narzędzia.

## 5. Kryteria gotowości

- [ ] Dostawca modelu odpowiada na autentyczne zapytanie każdego profilu.
- [ ] MCP przechodzi initialize / tools/list / tools/call.
- [ ] Cztery niezależne wykonawce mają potwierdzone UID/PID, narzędzia i ograniczone uprawnienia.
- [ ] Pilotaż: zadanie → wykonawca → diff → test → draft PR.
- [ ] UI pokazuje rzeczywiste wyniki i błędy, bez fikcyjnych statusów.

Powiązane: [misja #9](https://github.com/Rush47/Bastilla_Ultimate/issues/9), [projekt agentów](AGENT_CONTROL_DESIGN.md), [diagnostyka](DIAGNOSTICS_2026-11-12.md).
