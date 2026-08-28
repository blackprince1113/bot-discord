const SAVE_LABEL = '\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01';
const SAVING_LABEL = '\u0e01\u0e33\u0e25\u0e31\u0e07\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01...';

const discordTokenInput = document.getElementById('discordToken');
const saveDiscordSettingsBtn = document.getElementById('saveDiscordSettings');
const lyricsDebugModeInput = document.getElementById('lyricsDebugMode');
const lyricsOutput = document.getElementById('lyricsOutput');
const loadLyricsBtn = document.getElementById('loadLyrics');
const lyricsStatus = document.getElementById('lyricsStatus');
const discordStatus = document.getElementById('discordStatus');

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadLyrics();
});
saveDiscordSettingsBtn.addEventListener('click', saveDiscordSettings);
lyricsDebugModeInput.addEventListener('change', saveLyricsDebugSetting);
loadLyricsBtn.addEventListener('click', loadLyrics);

discordTokenInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    saveDiscordSettings();
  }
});

async function loadSettings() {
  try {
    discordTokenInput.value = await getDiscordToken();
    lyricsDebugModeInput.checked = await getLyricsDebugMode();
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('\u0e42\u0e2b\u0e25\u0e14\u0e15\u0e31\u0e49\u0e07\u0e04\u0e48\u0e32\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08', 'error');
  }
}

async function saveLyricsDebugSetting() {
  try {
    await saveLyricsDebugMode(lyricsDebugModeInput.checked);
  } catch (error) {
    console.error('Error saving lyrics debug mode:', error);
    lyricsDebugModeInput.checked = !lyricsDebugModeInput.checked;
    showStatus('\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01 debug mode \u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08', 'error');
  }
}

async function loadLyrics() {
  loadLyricsBtn.disabled = true;
  lyricsStatus.textContent = 'กำลังโหลดเนื้อเพลง...';
  lyricsStatus.className = 'status-message';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab.url?.startsWith('https://open.spotify.com/')) {
      throw new Error('กรุณาเปิดหน้า Spotify ที่กำลังเล่นเพลง');
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getLyricsFromDOM' });

    if (!response?.lyrics) {
      throw new Error('ไม่พบเนื้อเพลง หรือเพลงยังไม่ได้เล่น');
    }

    lyricsOutput.value = response.lyrics;
    lyricsStatus.textContent = 'โหลดเนื้อเพลงแล้ว';
    lyricsStatus.className = 'status-message success';
  } catch (error) {
    lyricsOutput.value = '';
    lyricsStatus.textContent = error.message || 'โหลดเนื้อเพลงไม่สำเร็จ';
    lyricsStatus.className = 'status-message error';
  } finally {
    loadLyricsBtn.disabled = false;
  }
}

async function saveDiscordSettings() {
  const token = discordTokenInput.value.trim();

  if (!token) {
    showStatus('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e43\u0e2a\u0e48 token', 'error');
    return;
  }

  saveDiscordSettingsBtn.disabled = true;
  saveDiscordSettingsBtn.textContent = SAVING_LABEL;

  try {
    await saveDiscordToken(token);
    await saveDiscordAutoUpdate(true);
    showStatus('\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e41\u0e25\u0e49\u0e27', 'success');
  } catch (error) {
    console.error('Error saving Discord token:', error);
    showStatus('\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08', 'error');
  } finally {
    saveDiscordSettingsBtn.disabled = false;
    saveDiscordSettingsBtn.textContent = SAVE_LABEL;
  }
}

function showStatus(message, type) {
  discordStatus.textContent = message;
  discordStatus.className = `status-message ${type}`;
}
