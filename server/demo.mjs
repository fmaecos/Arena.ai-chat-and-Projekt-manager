const at = (h, m, offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  date.setHours(h, m, 0, 0);
  return date.toISOString();
};
const say = (id, role, minute, value, ...blocks) => ({ id, role, time: at(14, minute), blocks: [{ type: 'text', text: value }, ...blocks] });
const code = `// routes/dashboard.ts
router.get('/dashboard', async (req, res) => {
  const data = await dashboardService.getOverview(req.user.id);
  res.json({ data, status: 'ok' });
});`;

export const demoChat = {
  url: 'https://chatgpt.com/', platform: 'chatgpt', title: 'API-Architektur für Dashboard', capturedAt: at(14, 32),
  messages: [
    say('demo-1', 'user', 28, 'Wie würdest du die API-Architektur für unser Dashboard aufbauen? Wir nutzen TypeScript und Express.'),
    say('demo-2', 'assistant', 28, 'Ich würde die API in **Routes**, **Services** und eine **Datenzugriffsschicht** aufteilen. So bleiben die Routes schlank und die Geschäftslogik lässt sich unabhängig testen.\n\nEin Endpunkt für die Dashboard-Übersicht könnte so aussehen:', { type: 'code', language: 'typescript', text: code }),
    say('demo-3', 'user', 31, 'Das passt. Wie würdest du dabei mit Caching und Fehlerbehandlung umgehen?'),
    say('demo-4', 'assistant', 32, 'Für häufig abgefragte Übersichten würde ich einen kurzen Cache pro Nutzer nutzen. Fehler behandelst du zentral per Express-Middleware, die einen konsistenten Fehlercode und eine Request-ID zurückgibt.'),
  ],
};

export function seedDemo(store, channel) {
  store.saveProject({ name: 'Dashboard Redesign', color: 'violet', description: 'Architektur, API-Entwürfe und Notizen für das neue Dashboard.' }, 'dashboard');
  store.saveProject({ name: 'Website Relaunch', color: 'mint', description: 'Planung und Inhalte für den Relaunch der Team-Website.' }, 'website');
  store.saveProject({ name: 'KI Playground', color: 'amber', description: 'Ein Ort für Modelltests, Prompts und kleine Experimente.' }, 'playground');
  const examples = [
    ['chat-design', 'Design-System: Komponenten', 'claude', 'https://claude.ai', 'dashboard', 'Welche Komponenten sollten wir zuerst für unser Design-System definieren?', 'Beginne mit den Grundbausteinen: Farben, Typografie, Abstände, Buttons und Eingabefelder.'],
    ['chat-relaunch', 'Checkliste für den Relaunch', 'gemini', 'https://gemini.google.com/app', 'website', 'Erstelle eine Checkliste für unseren Website-Relaunch.', '1. Seitenstruktur prüfen\n2. Weiterleitungen testen\n3. Metadaten und Ladezeiten kontrollieren'],
    ['chat-prompts', 'Prompts für Modellvergleiche', 'arena', 'https://arena.ai', 'playground', 'Wie testen wir mehrere Modelle mit vergleichbaren Prompts?', 'Nutze die gleichen Aufgaben und eine feste Bewertung für Genauigkeit, Verständlichkeit und Quellenlage.'],
    ['chat-notes', 'Notizen zur Sprintplanung', 'chatgpt', 'https://chatgpt.com/', null, 'Fasse die Themen für den nächsten Sprint zusammen.', 'Der Schwerpunkt liegt auf Stabilität, der neuen Übersichtsseite und einem Testlauf vor dem Release.'],
  ];
  examples.forEach(([id, title, platform, url, projectId, question, answer], index) => {
    const capturedAt = at(10, 15, index + 1);
    store.saveChat({ title, platform, url, capturedAt, messages: [say(`${id}-1`, 'user', 0, question), say(`${id}-2`, 'assistant', 0, answer)] },
      { id, projectId, updatedAt: capturedAt });
  });
  store.addFile({ path: 'src/routes/dashboard.ts', projectId: 'dashboard', mime: 'text/plain' }, Buffer.from(code), 'file-dashboard');
  store.addFile({ path: 'Notizen.md', projectId: 'dashboard', mime: 'text/markdown' }, Buffer.from('# Dashboard Redesign\n\n## Nächste Schritte\n\n- Dashboard-Route entwerfen\n- Cache-Struktur besprechen\n- UI-Prototyp testen\n'), 'file-notes');
  store.addFile({ path: 'planung/checkliste.txt', projectId: 'website', mime: 'text/plain' }, Buffer.from('Relaunch-Checkliste\n\n1. Weiterleitungen testen\n2. Metadaten prüfen\n3. Go-live freigeben'), 'file-relaunch');
  store.addFile({ path: 'prompts/beispiele.json', projectId: 'playground', mime: 'application/json' }, Buffer.from(JSON.stringify({ name: 'Vergleich', prompt: 'Erkläre HTTP-Caching in drei Sätzen.' }, null, 2)), 'file-prompts');
  channel.setLive({ tab: { id: 1, windowId: 1, platform: 'chatgpt', url: demoChat.url, title: demoChat.title }, chat: demoChat });
}
