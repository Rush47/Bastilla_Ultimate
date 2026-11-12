import test from "node:test";
import assert from "node:assert/strict";
import {
  MetricCardSchema,
  ChartComponentSchema,
  ActionButtonGroupSchema,
  DataTableSchema,
  MermaidDiagramSchema,
  GenerativeComponentPayloadSchema,
} from "./types";
import { extractGenerativeUI } from "./ComponentRegistry";

test("MetricCardSchema validates valid metric props", () => {
  const result = MetricCardSchema.safeParse({
    title: "Obciążenie CPU",
    value: "14.2",
    unit: "%",
    status: "normal",
  });
  assert.equal(result.success, true);
});

test("ChartComponentSchema validates line and bar chart props", () => {
  const result = ChartComponentSchema.safeParse({
    title: "Telemetria Jądra",
    chartType: "area",
    data: [
      { name: "T0", value: 10 },
      { name: "T1", value: 25 },
    ],
    color: "#8b5cf6",
  });
  assert.equal(result.success, true);
});

test("ActionButtonGroupSchema validates actions and buttons", () => {
  const result = ActionButtonGroupSchema.safeParse({
    title: "Szybkie Akcje ROOT",
    buttons: [
      {
        label: "Sprawdź procesy",
        actionType: "exec_root",
        payload: "ps aux | head -n 10",
        variant: "primary",
      },
    ],
  });
  assert.equal(result.success, true);
});

test("MermaidDiagramSchema validates mermaid diagram payload", () => {
  const result = MermaidDiagramSchema.safeParse({
    title: "Architektura Magistrali IPC",
    diagramType: "flowchart",
    code: "graph TD\n  A[Aria] --> B[Aurelius]",
  });
  assert.equal(result.success, true);
});

test("extractGenerativeUI safely extracts component payloads from model text", () => {
  const rawText = `Oto wykres stanu jądra:
\`\`\`generative-ui
{
  "id": "comp-1",
  "type": "metric_card",
  "props": {
    "title": "Metryka C",
    "value": 2.5,
    "unit": "SVL",
    "status": "success"
  }
}
\`\`\`
Wszystkie systemy działają sprawnie.`;

  const { cleanText, components } = extractGenerativeUI(rawText);
  assert.equal(components.length, 1);
  assert.equal(components[0].type, "metric_card");
  assert.equal(components[0].props.title, "Metryka C");
  assert.equal(cleanText.includes("Oto wykres stanu jądra"), true);
  assert.equal(cleanText.includes("Wszystkie systemy działają sprawnie"), true);
});

test("extractGenerativeUI extracts mermaid code block into interactive mermaid_diagram component", () => {
  const rawText = `To jest schemat blokowy procesu **Telemetry-Relay-Loop**:
\`\`\`mermaid
graph TD
  A[Sensor Array: Wenchang] -->|Raw Data| B{Bastilla RT-Kernel}
  B --> C[Net-Proxy]
\`\`\`
Wyjaśnienie schematu poniżej.`;

  const { cleanText, components } = extractGenerativeUI(rawText);
  assert.equal(components.length, 1);
  assert.equal(components[0].type, "mermaid_diagram");
  assert.equal(components[0].props.code.includes("Sensor Array: Wenchang"), true);
  assert.equal(cleanText.includes("To jest schemat blokowy procesu"), true);
  assert.equal(cleanText.includes("Wyjaśnienie schematu poniżej"), true);
  // Verify backticks were stripped from cleanText
  assert.equal(cleanText.includes("```mermaid"), false);
});

test("extractGenerativeUI extracts markdown table into data_table component", () => {
  const rawText = `Zestawienie portów:
\`\`\`table
| Port | Usługa | Status |
|---|---|---|
| 3000 | Web UI | ONLINE |
| 11434 | Ollama | ACTIVE |
\`\`\`
Koniec raportu.`;

  const { cleanText, components } = extractGenerativeUI(rawText);
  assert.equal(components.length, 1);
  assert.equal(components[0].type, "data_table");
  assert.equal(components[0].props.columns.length, 3);
  assert.equal(components[0].props.rows.length, 2);
  assert.equal(cleanText.includes("```table"), false);
});

test("extractGenerativeUI extracts section markdown button lists into action_buttons components", () => {
  const rawText = `Oto zestawienie przycisków szybkich akcji:
### 1. Zarządzanie uprawnieniami (Podstawowe)
* **[Grant Access]** – Przyznaj uprawnienia root wybranej aplikacji.
* **[Revoke Access]** – Natychmiastowe odebranie uprawnień.
* **[Toggle Root]** – Szybki włącznik/wyłącznik dostępu root dla całego systemu.

### 2. System i Czyszczenie (Szybkie akcje)
* **[Clear Cache]** – Wyczyszczenie pamięci podręcznej partycji \`/cache\`.
* **[Optimize RAM]** – Zwolnienie pamięci przez wymuszone czyszczenie bufora (drop_caches).
* **[Kill Background]** – Zabicie wszystkich procesów działających w tle.
`;

  const { components } = extractGenerativeUI(rawText);
  assert.equal(components.length, 2);
  assert.equal(components[0].type, "action_buttons");
  assert.equal(components[0].props.title, "1. Zarządzanie uprawnieniami (Podstawowe)");
  assert.equal(components[0].props.buttons.length, 3);
  assert.equal(components[0].props.buttons[0].label, "Grant Access");

  assert.equal(components[1].type, "action_buttons");
  assert.equal(components[1].props.title, "2. System i Czyszczenie (Szybkie akcje)");
  assert.equal(components[1].props.buttons.length, 3);
  assert.equal(components[1].props.buttons[1].label, "Optimize RAM");
});

test("extractGenerativeUI extracts inline un-fenced markdown tables into data_table", () => {
  const rawText = `Tabela kolorów:
| Grupa | Kolor przycisku | Uwagi |
| :--- | :--- | :--- |
| **Operacje bezpieczne** | Niebieski | Optymalizacja |
| **Operacje systemowe** | Pomarańczowy | Reboot |
| **Operacje krytyczne** | Czerwony | Revoke |

Dalszy tekst.`;

  const { components } = extractGenerativeUI(rawText);
  assert.equal(components.length, 1);
  assert.equal(components[0].type, "data_table");
  assert.equal(components[0].props.columns.length, 3);
  assert.equal(components[0].props.rows.length, 3);
  assert.equal(components[0].props.rows[0][0], "Operacje bezpieczne");
});

test("extractGenerativeUI shows Python code without inventing RAM measurements", () => {
  const rawText = `Przykładowy kod monitorowania:
\`\`\`python
import psutil
import matplotlib.pyplot as plt
import time

data = []
for i in range(10):
    data.append(psutil.virtual_memory().percent)
    time.sleep(1)

plt.plot(data)
plt.ylabel('Zużycie RAM (%)')
plt.show()
\`\`\`
Wykres pojawi się powyżej.`;

  const { components } = extractGenerativeUI(rawText);
  // A script is not evidence that measurements were collected.
  assert.equal(components.length, 1);
  const sandbox = components.find((c) => c.type === "code_sandbox");
  const chart = components.find((c) => c.type === "chart");
  assert.notEqual(sandbox, undefined);
  assert.equal(chart, undefined);
  assert.equal(sandbox?.props.language, "python");

});

test("extractGenerativeUI preserves exact document order in segments and parses telemetry + Polish emoji buttons", () => {
  const rawText = `### 1. Kategoria: Bezpieczeństwo i Uprawnienia (Security)
* **[ 🔒 Zablokuj Root ]** – Natychmiastowe wylogowanie z sesji uprzywilejowanej.
* **[ 🔑 Zmień Hasło ]** – Szybki formularz zmiany hasła administratora.

---

### Propozycja układu w UI (Grid Layout)
| Diagnostyka | Zarządzanie |
| :--- | :--- |
| [ 📊 Status ] | [ 🚀 Restart WWW ] |

Oto telemetria jądra Bastilla OS:

\`\`\`telemetry
{
  "ollama_model": "Qwen3.8-27B-Uncensored",
  "active_agent": "Alex (SUPREME ROOT UID 0)",
  "ram_used_mb": 412,
  "ram_total_mb": 2048,
  "system_load": "0.18, 0.22, 0.15",
  "kernel_version": "5.6.0-QuantumWheel"
}
\`\`\`

Stan jądra pozostaje optymalny.`;

  const { components, segments } = extractGenerativeUI(rawText);
  assert.equal(components.length, 3);
  assert.equal(components[0].type, "action_buttons");
  assert.equal(components[0].props.buttons[0].label, "🔒 Zablokuj Root");
  assert.equal(components[1].type, "data_table");
  assert.equal(components[1].props.rows[0][0], "[ 📊 Status ]");
  assert.equal(components[2].type, "system_telemetry");
  assert.equal(components[2].props.kernel_version, "5.6.0-QuantumWheel");
  assert.equal(components[2].props.system_load, "0.18, 0.22, 0.15");

  const compSegments = segments.filter((s) => s.kind === "component");
  assert.equal(compSegments.length, 3);
});


test("extractGenerativeUI extracts zenity bash script into interactive action_buttons", () => {
  const zenityText = `Mogę przygotować dla Ciebie skrypt bash:
\`\`\`bash
#!/bin/bash
while true; do
    ACTION=$(zenity --list --title="Panel ROOT" --text="Wybierz procedurę:" \\
        --column="ID" --column="Akcja" \\
        1 "Aktualizacja systemu (apt update && upgrade)" \\
        2 "Wyczyść pamięć podręczną RAM (Drop Caches)" \\
        3 "Pokaż logi jądra (dmesg)" \\
        4 "Sprawdź status dysków (smartctl)" \\
        5 "Wyjdź")

    case $ACTION in
        1*) pkexec apt update && pkexec apt upgrade -y ;;
        2*) pkexec sh -c "sync; echo 3 > /proc/sys/vm/drop_caches" ; zenity --info --text="Pamięć cache wyczyszczona." ;;
        3*) dmesg | tail -n 50 | zenity --text-info --title="Logi jądra" --width=600 --height=400 ;;
        4*) pkexec smartctl -a /dev/sda | zenity --text-info --title="Status SMART" --width=600 ;;
        5*) exit ;;
    esac
done
\`\`\`
Zenity nie jest zainstalowane. Zainstaluj je komendą: sudo apt install zenity`;

  const { components, cleanText } = extractGenerativeUI(zenityText);
  const btns = components.find((c) => c.type === "action_buttons");
  assert.notEqual(btns, undefined);
  assert.equal(btns?.props.buttons.length, 5);
  assert.equal(btns?.props.buttons[0].label.includes("Aktualizacja"), true);
  assert.equal(btns?.props.buttons[1].label.includes("Drop Caches"), true);
  assert.equal(cleanText.includes("Zenity nie jest zainstalowane"), false);
});

test("extractGenerativeUI extracts diagnostic commands without inventing telemetry", () => {
  const diagText = `Dostęp do danych telemetrycznych jądra oraz szczegółowego statusu pamięci RAM:
* **Logi jądra (Kernel messages):**
* \`dmesg | tail -n 20\` – wyświetla ostatnie 20 komunikatów jądra.
* **Parametry jądra:**
* \`sysctl -a\` – wyświetla wszystkie dostępne parametry jądra.
* **Informacje o wersji i czasie pracy:**
* \`uname -a\` – pokazuje wersję jądra i architekturę.
* \`uptime\` – pokazuje, jak długo jądro działa.
* **Wykorzystanie zasobów przez jądro:**
* \`cat /proc/meminfo\` – informacje o pamięci RAM.
* \`free -h\` – szybki stan pamięci.
* \`vmstat -s\` – szczegółowe statystyki wirtualnej pamięci.`;

  const { components } = extractGenerativeUI(diagText);
  const btns = components.find((c) => c.type === "action_buttons");
  const telem = components.find((c) => c.type === "system_telemetry");
  const chart = components.find((c) => c.type === "chart");
  assert.notEqual(btns, undefined);
  assert.equal(telem, undefined);
  assert.equal(chart, undefined);
  assert.equal(btns?.props.buttons.length >= 5, true);
});

test("extractGenerativeUI extracts numbered procedure lists into action_buttons", () => {
  const procText = `Dostępne procedury ROOT:
1) Aktualizacja systemu (apt update && upgrade)
2) Wyczyść pamięć podręczną RAM (Drop Caches)
3) Pokaż logi jądra (dmesg)
4) Sprawdź status dysków (smartctl)`;

  const { components } = extractGenerativeUI(procText);
  const btns = components.find((c) => c.type === "action_buttons");
  assert.notEqual(btns, undefined);
  assert.equal(btns?.props.buttons.length, 4);
  assert.equal(btns?.props.buttons[0].label.includes("Aktualizacja"), true);
});


