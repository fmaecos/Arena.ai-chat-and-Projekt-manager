document.getElementById('allow').addEventListener('click', async () => {
  const status = document.getElementById('status');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    status.textContent = 'Zugriff erlaubt. Kehre zum Chat-Tab und zum Kontext-Assistenten zurück.';
  } catch { status.textContent = 'Zugriff nicht erlaubt. Prüfe die Website-Berechtigungen in Chrome oder die Mikrofon-Einstellungen des Systems.'; }
});
