import { setTimeout as delay } from 'node:timers/promises';

export const demoScope = { tabId: 1, origin: 'https://arena.ai', url: 'https://arena.ai/', title: 'Arena – Vorschau' };
const projects = [
  { name: 'Campus-App', description: 'Konzept, Implementierung und Review der Campus-App.', stages: ['Konzept', 'Umsetzung', 'Review'] },
  { name: 'Support-Automation', description: 'Entwürfe und Modellvergleiche für einen Support-Workflow.', stages: ['Entwurf', 'Vergleich', 'Test'] },
];
const data = [
  { id: 'campus-anforderungen', label: 'Campus-App: Anforderungen', project: 0, stage: 0, mode: 'chat', user: 'Welche Funktionen braucht die erste Version der Campus-App?', replies: [['Modell A', 'Priorisiere Suche, Termine und Hinweise. Teste zuerst, ob Studierende den Stundenplan schnell finden.']] },
  { id: 'campus-api', label: 'Campus-App: API-Entwurf', project: 0, stage: 1, mode: 'multi', user: 'Vergleiche zwei Entwürfe für die Termin-API.', replies: [['Modell A', 'Ein REST-Endpunkt mit paginierten Terminen ist leicht nutzbar.'], ['Modell B', 'Eine Abfrage mit Filtern reduziert unnötige Daten für die Kalenderansicht.']] },
  { id: 'campus-review', label: 'Campus-App: Review vor Release', project: 0, stage: 2, mode: 'chat', user: 'Welche Punkte fehlen vor dem Release?', replies: [['Modell A', 'Prüfe Bedienbarkeit mit Tastatur, die leere Terminansicht und Fehlermeldungen.']] },
  { id: 'support-flow', label: 'Support: Workflow-Entwurf', project: 1, stage: 0, mode: 'chat', user: 'Wie teile ich eine Support-Anfrage sinnvoll ein?', replies: [['Modell A', 'Unterscheide Kategorie, Dringlichkeit und erforderliche Rückfrage.']] },
  { id: 'support-duell', label: 'Support: Antwort-Duell', project: 1, stage: 1, mode: 'duel', user: 'Antworte auf eine verspätete Lieferung.', replies: [['Modell A', 'Es tut mir leid, dass deine Lieferung verspätet ist. Ich prüfe den Status.'], ['Modell B', 'Nenne mir bitte die Bestellnummer. Dann kann ich dir einen neuen Liefertermin nennen.']] },
  { id: 'support-test', label: 'Support: Testfälle', project: 1, stage: 2, mode: 'chat', user: 'Welche Fälle sollte der Prototyp testen?', replies: [['Modell B', 'Teste fehlenden Kontext, Rückfragen und eine Übergabe an einen Menschen.']] },
];
const urlOf = (id) => `${demoScope.origin}/c/${id}`;
const link = ({ id, label, project }) => ({ kind: 'link', ref: `link-${id}`, href: urlOf(id), label, context: projects[project].name, group: 'Chatverlauf' });

export function demoAgentServices() {
  let owner = '';
  let page = demoScope.url;
  let expanded = false;
  return {
    browse: async (run, operation, signal) => {
      await delay(180, undefined, { signal });
      if (run.id !== owner) { owner = run.id; page = demoScope.url; expanded = false; }
      if (operation.kind === 'open') page = operation.url;
      if (operation.kind === 'expand') expanded = true;
      const entry = data.find((chat) => urlOf(chat.id) === page);
      const targets = expanded ? data.map(link) : [{ kind: 'expand', ref: 'history', label: 'Chatverlauf anzeigen', context: 'Seitennavigation' }];
      return { url: page, title: entry?.label || demoScope.title, targets, ready: true, blocks: entry ? [
        { id: 'b1', role: 'user', type: 'text', text: entry.user, group: 'question' },
        ...entry.replies.map(([author, text], i) => ({ id: `b${i + 2}`, author, lane: entry.replies.length > 1 ? author : '', role: 'assistant', type: 'text', text, group: `answer-${i}` })),
      ] : [] };
    },
    decide: async (task, payload, signal) => {
      await delay(260, undefined, { signal });
      if (task === 'talk') return { reply: 'In der Demo kannst du den ganzen Archivablauf prüfen. In Chrome bekommst du die Antworten deines lokalen Ollama-Modells.' };
      if (task === 'plan' && payload.page.tools.some((target) => target.ref === 'history')) return { tool: 'expand', ref: 'history' };
      if (task === 'classify') {
        const item = data.find((entry) => urlOf(entry.id) === payload.target.url);
        return { isConversation: Boolean(item), mode: item?.mode, project: projects[item?.project]?.name, stage: projects[item?.project]?.stages[item?.stage] };
      }
      const items = (payload.catalog || []).flatMap(([id, name]) => {
        const entry = data.find((candidate) => candidate.label === name);
        if (!entry) return [];
        if (task === 'revise' && /(?:nur |ausschließlich )campus/i.test(payload.instruction) && entry.project !== 0) return [];
        return [{ id, project: projects[entry.project].name, stage: projects[entry.project].stages[entry.stage], mode: entry.mode }];
      });
      return { tool: 'propose', caption: 'Verlauf nach Projekten und Phasen', projects, items,
        explanation: 'Der aufgeklappte Verlauf zeigt zwei Projektgruppen. Normale Chats, parallele Antworten und Duelle bleiben getrennt erkennbar.',
        structure: 'Projekt → Phase → Chat → Nachricht → Antwortspur. Links und Code bleiben am ursprünglichen Beitrag; spätere Aufnahmen werden als Archivstände erhalten.',
        caution: 'Beispieldaten. In einem echten Lauf prüfst du die Chat-Auswahl und die vorgeschlagenen Projektphasen.' };
    },
  };
}
