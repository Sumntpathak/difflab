// DiffLab background service worker
// Single responsibility: open the diff workspace when the toolbar icon is clicked.

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("diff.html");

  // Reuse an existing DiffLab tab if one is already open; otherwise create one.
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url });
  }
});
