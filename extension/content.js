(() => {
  let timer;
  let observing = false;
  const observer = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!document.hidden) chrome.runtime.sendMessage({ type: 'KONTEXT_DIRTY' }).catch(() => {});
    }, 850);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.type === 'KONTEXT_CAPTURE') {
      if (!observing) {
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        observing = true;
      }
      respond({ chat: KontextAdapters.capture(document, location), url: location.href });
    }
    return false;
  });
})();
