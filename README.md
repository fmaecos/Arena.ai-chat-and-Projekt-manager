# Kontext — lokaler Archiv-Agent für Chrome

Kontext ist ein deutschsprachiger Chat- und Projekt-Workspace für **Linux und Windows**. Der eigentliche Archivlauf beginnt in **Chrome**: Öffne deine normale Chat-Seite und klicke auf das Kontext-Symbol. Im Seitenbereich sprichst oder schreibst du mit dem lokalen KI-Assistenten. Er erkundet den freigegebenen Tab, schlägt eine Archivstruktur vor und sichert deine Auswahl **Chat für Chat**. Im Desktop findest du das lokale SQLite-Archiv, Projekte, Dateien und die Code-Ansicht.

## Starten und koppeln

Für den Start aus dem Quellcode: **Node.js 22.13 oder neuer**, npm und **Chrome 120 oder neuer**. Ein gebauter Desktop-Installer braucht kein separates Node.js.

```sh
npm ci
npm run desktop
```

1. Öffne im Desktop **Einstellungen → Chrome → Erweiterungsordner anzeigen**. Beim Start aus dem Quellcode ist das `extension/`. Wenn du `kontext-chrome.zip` hast, entpacke die Datei zuerst.
2. Aktiviere in `chrome://extensions` den **Entwicklermodus**. Wähle **Entpackte Erweiterung laden** und den Ordner mit `manifest.json`. Hefte das Kontext-Symbol über das Chrome-Erweiterungsmenü an.
3. Klicke auf das Kontext-Symbol. Im **Seitenbereich** fügst du den Kopplungscode aus **Einstellungen → Chrome** ein. Die Desktop-App muss während eines Archivlaufs geöffnet sein.
4. Für den Archiv-Agenten und freie Antworten starte [Ollama](https://ollama.com/) lokal. Lade etwa das voreingestellte Modell mit `ollama pull qwen2.5:3b`. In **Einstellungen → KI & Sprache** kannst du die Verbindung prüfen und ein anderes installiertes Modell wählen. Für anspruchsvolle Oberflächen empfiehlt sich ein Modell mit zuverlässiger Tool-Auswahl und strukturierten Ausgaben.

**Nur ausprobieren:** `npm run dev` öffnet eine Web-Demo. Unter **Archiv-Agent → Demo-Lauf starten** kannst du sechs Beispiel-Chats nach Projekten und Phasen ordnen, die Auswahl ändern und anschließend die gespeicherten Antworten ansehen. Die Demo benutzt eine temporäre Datenbank pro Browser-Sitzung und einen simulierten Browser und ein simuliertes Modell. Sie koppelt sich nicht mit deinem Chrome. Den aktuellen Erweiterungs-ZIP findest du unter **Einstellungen → Chrome**.

## Archivieren: vom offenen Tab bis zur SQLite-Kopie

1. **Seite erkunden.** Öffne in Chrome die angemeldete Chat-Seite oder ihre Verlaufsübersicht, zum Beispiel auf Arena.ai. Klicke **in diesem Tab** auf das Kontext-Symbol. Im Tab **Archivlauf** klicke **Aktive Seite untersuchen** oder diktiere einen Auftrag: „Ordne meine Chats nach Projekten und Phasen. Bewahre bei Duellen beide Antworten.“ Der Agent nutzt sichtbare Links, beschriftete Verlaufselemente und Scrollbereiche. Die Archivwerkzeuge sind nicht an einen Anbieter gebunden.
2. **Plan prüfen.** Das Modell schlägt Projekte, Phasen und konkrete beobachtete Chat-Ziele vor. Die feste lokale Struktur ist *Projekt → Phase → Chat → Nachrichten und Antwortspuren*; das Modell schlägt die Zuordnung vor, keinen ausführbaren Datenbankcode. Wähle die Chats aus und diktiere oder tippe nötige Änderungen. **Vor der Freigabe wird kein Chat ins Archiv geschrieben.**
3. **Einzeln sichern.** Bestätige im Seitenbereich **Chats archivieren**. Der Agent öffnet die ausgewählten Chats nacheinander im freigegebenen Tab, liest den gerenderten Verlauf und speichert ihn. Unklare Zuordnungen werden zur Prüfung markiert; nicht eindeutig lesbare Ziele werden übersprungen. Bei einer Unterbrechung bleiben bereits gesicherte Chats erhalten. Setze den Lauf im Kontext-Seitenbereich auf derselben Website fort.
4. **Im Desktop weiterarbeiten.** **Archiv-Agent** zeigt Fortschritt, Prüfhinsweise und Ergebnisse. Im **Chat-Archiv** findest du Chat, Multi-Chat und Duell mit getrennten erkennbaren Antwortspuren. **Projekte** erlaubt das Filtern nach Phase. Wenn sich der Chat oder seine Zuordnung bei der erneuten Aufnahme geändert hat, findest du frühere Aufnahmen unter **Archivstand**.

### Sprachchat in Chrome

- Im Bereich **Sprachchat** kannst du freie Fragen stellen und über den Archivlauf sprechen. Für Fragen zur Website aktiviere **Aktiven Tab für diese Frage lesen**. Das Modell erhält dann für diese Frage einen Ausschnitt aus der sichtbaren Seite. Aus einer Bitte um Archivierung oder Planänderung kann der Assistent eine Aktion vorschlagen. Ein Klick auf den Vorschlag startet die Erkundung oder überarbeitet den Plan; eine Archivfreigabe erfolgt immer separat über die Chat-Auswahl.
- Das **Mikrofon** nimmt auf Klick bis zu 45 Sekunden auf. Erkannten Text kannst du korrigieren. Wenn du den Text automatisch senden lässt, betrifft das in Chrome nur den **Sprachchat mit Kontext**, niemals den Webchat oder die Archivfreigabe. Falls Chrome die Berechtigung nicht direkt anbietet, klicke **Mikrofonberechtigung in Chrome öffnen** und erteile sie dort.
- **Vorlesen: an** benötigt eine lokale Systemstimme. Auf Linux kann dafür Speech Dispatcher mit einem lokalen Synthesizer (z. B. eSpeak NG) nötig sein. Unter **Einstellungen → KI & Sprache** wählst du lokales Whisper oder die Browser-Spracherkennung. Die Browser-Option kann Audio an den Browseranbieter übertragen und ist nicht auf allen Systemen verfügbar.

**Optional: lokales Whisper** mit Python 3.10 oder neuer. Das Skript ist im Quellordner oder im Desktop unter **Einstellungen → KI & Sprache → Ordner mit Whisper-Helfer öffnen** zu finden.

Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install faster-whisper
.venv/bin/python scripts/speech_server.py
```

Windows (PowerShell):

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install faster-whisper
.\.venv\Scripts\python.exe scripts/speech_server.py
```

Passe den Skriptpfad an, wenn du den Helfer aus dem Desktop-Installer verwendest. Beim ersten Start lädt der Helfer das Modell, sofern es nicht schon vorliegt. Warte auf `Whisper listening …`. Danach kann er offline unter `http://127.0.0.1:17861` arbeiten; er speichert das Audio nicht. Alternativ kann Kontext einen kompatiblen lokalen Dienst mit `POST /v1/audio/transcriptions` verwenden.

## Welche Inhalte übernommen werden

- Kontext übernimmt den **sichtbaren Wortlaut** samt Codeblöcken, Listen, Links und erkannten Antwortspuren. Das Modell ordnet die Originalblöcke zu, statt einen neuen Chattext zu schreiben. Es kann Chat-Modi, Projektzuordnungen und Phasen falsch einschätzen; prüfe den Plan und die markierten Einträge.
- Anhänge werden als **sichtbare Namen bzw. Verweise** gespeichert, nicht als Dateikopien. Ein Link kann fehlen, ablaufen oder eine Anmeldung erfordern. Originaldateien kannst du separat in **Dateien** importieren.
- Archive können unvollständig sein: Die Extension hat keinen Zugriff auf Inhalte, die nie gerendert werden, andere Origins oder versteckte Browserdaten. Manche Websites zeigen ältere Chats nur nach Scrollen, verwenden Navigation ohne erkennbare Links oder verlangen erneutes Anmelden. Öffne den Verlauf gegebenenfalls manuell und setze den Lauf fort. Pro Plan sind bis zu 120 erkannte Ziele vorgesehen, nicht eine feste Anzahl pro Anbieter.
- Der Archiv-Agent füllt keine Formulare aus, sendet nichts an Webchats und hat keine Werkzeuge, um Online-Unterhaltungen zu bearbeiten. Er bleibt bei einem freigegebenen aktiven HTTPS-Tab und dessen Origin. Er nutzt nur beobachtete Ziele und bestimmte beschriftete Lesesteuerungen. Der Desktop und Ollama kommunizieren auf Loopback; Modelle und Whisper-Gewichte müssen separat installiert sein.

## Archiv, Live-Ansicht und Dateimanager

- **Ctrl+K** durchsucht Chat-Titel, archivierte Nachrichten, Projekte und Dateipfade. Einzelne Chats kannst du als Markdown oder JSON exportieren; der Projekt-JSON-Export enthält die aktuellen Chats und die Bytes zugeordneter Dateien.
- **Live-Chat** ist eine optionale Vorschau. Aktiviere **Live-Spiegelung im Desktop** in den Verbindungseinstellungen des Chrome-Seitenbereichs oder prüfe den Tab einmalig im Desktop. Diese separate Vorschau unterstützt ChatGPT, Claude, Gemini und Arena über Adapter; sie ist für den generischen Archiv-Agenten nicht erforderlich. Bereits offene Chats nach der Installation einmal neu laden. Die Vorschau ist schreibgeschützt.
- **Dateien** verwaltet importierte Kopien, nicht beliebige Dateien auf dem Gerät. Dateien (bis 12 MiB pro Datei) und Ordner können importiert werden. Umbenennen und Verschieben ändern nur den Archivpfad. Die **Code-Ansicht** zeigt importierte Dateien und Codeblöcke schreibgeschützt an.
- Unter **Einstellungen → Speicher** findest du den Datenordner. Für ein Komplett-Backup beende Kontext und kopiere `workspace.sqlite` (einschließlich gegebenenfalls vorhandener `-wal`/`-shm`-Dateien). Die Datenbank ist nicht separat verschlüsselt. Beim Löschen eines Projekts bleiben zugehörige Chats und Dateien ohne Projektzuordnung erhalten. Die Assistenten-Unterhaltung wird nicht in SQLite gespeichert.

## Pakete bauen

| Ziel | Befehl | Ausgabe |
| --- | --- | --- |
| Linux x64 | `npm run package:linux` | `release/*.AppImage` |
| Windows x64 | `npm run package:windows` | `release/*.exe` (NSIS) |
| Chrome | `npm run extension:zip` | `release/kontext-chrome.zip` |

Baue die Desktop-Pakete auf dem jeweiligen Zielsystem mit Zugriff auf die Electron- und Packaging-Downloads. Der Workflow **Build Kontext** baut beide Pakete auf GitHub Actions und stellt sie nach einem erfolgreichen Lauf als Artefakte bereit. Die Standard-Builds sind nicht signiert. Unter Linux kann AppImage je nach Distribution FUSE 2 benötigen. Die Desktop-Pakete enthalten die entpackte Chrome-Erweiterung und das optionale Whisper-Skript, aber weder ein Ollama- noch ein Whisper-Modell.

## Entwicklung und Tests

- `extension/`: MV3-Seitenbereich, Audioaufnahme, generische DOM-Werkzeuge und Browser-Relay. `adapters.js` dient nur der optionalen Live-Spiegelung.
- `server/`: Modellanfragen, Freigabe mit Planversion, fortsetzbare Archivläufe und SQLite-Versionen. Chrome verbindet sich mit einem lokalen Kopplungscode auf `127.0.0.1:17654` und erhält keinen Direktzugriff auf archivierte Chats.
- `desktop/` und `src/`: Electron und React, inklusive Datei- und Projektexport. Die Desktop-Weboberfläche zeigt den Archivlauf; die Freigabe echter Chat-Ziele findet im Chrome-Seitenbereich statt.

`npm test` prüft unter anderem Tab-/Origin-Bindung, Planänderungen und Freigaben, einen simulierten 40-Chat-Lauf mit Fortsetzung, Antwortspuren und Aufnahmeversionen, DOM-Extraktion, Kopplung, Suche und Exporte. `npm run build` baut die Oberfläche. Ein Testlauf gegen ein echtes angemeldetes Chat-Konto, ein lokales Modell und Mikrofon ist für die konkrete Website und das Zielsystem zusätzlich sinnvoll.
