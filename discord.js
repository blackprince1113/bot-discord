// Discord API and Chrome storage helpers.

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_STATUS_LIMIT = 128;
const STORAGE_KEYS = {
  token: 'discordToken',
  autoUpdate: 'autoUpdateDiscord',
  latestLyrics: 'latestLyrics',
  currentLyric: 'currentLyric'
};

async function updateDiscordStatus(token, status) {
  const text = String(status || '').trim().slice(0, DISCORD_STATUS_LIMIT);

  if (!text) {
    return false;
  }

  const response = await discordRequest(token, '/users/@me/settings', {
    method: 'PATCH',
    body: {
      custom_status: {
        text,
        emoji_id: null,
        emoji_name: null,
        expires_at: null
      }
    }
  });

  if (response.ok) {
    console.log('Discord status updated:', text);
    return true;
  }

  console.error('Discord status update failed:', response.error);
  return false;
}

async function saveDiscordToken(token) {
  await setChromeStorage({ [STORAGE_KEYS.token]: token });
  console.log('Discord token saved');
}

async function getDiscordToken() {
  const data = await getChromeStorage(STORAGE_KEYS.token);
  return data[STORAGE_KEYS.token] || '';
}

async function saveDiscordAutoUpdate(enabled) {
  await setChromeStorage({ [STORAGE_KEYS.autoUpdate]: Boolean(enabled) });
  console.log('Discord auto-update setting saved:', Boolean(enabled));
}

async function getDiscordAutoUpdate() {
  const data = await getChromeStorage(STORAGE_KEYS.autoUpdate);
  return data[STORAGE_KEYS.autoUpdate] !== false;
}

async function saveLatestLyrics(lyrics) {
  await setChromeLocalStorage({ [STORAGE_KEYS.latestLyrics]: String(lyrics || '').trim() });
}

async function saveCurrentLyric(lyric) {
  await setChromeLocalStorage({ [STORAGE_KEYS.currentLyric]: String(lyric || '').trim() });
}

async function getLatestLyrics() {
  const data = await getChromeLocalStorage(STORAGE_KEYS.latestLyrics);
  return data[STORAGE_KEYS.latestLyrics] || '';
}

async function getCurrentLyric() {
  const data = await getChromeLocalStorage(STORAGE_KEYS.currentLyric);
  return data[STORAGE_KEYS.currentLyric] || '';
}

async function discordRequest(token, path, options = {}) {
  try {
    const fetchOptions = {
      method: options.method || 'GET',
      headers: {
        Authorization: token
      }
    };

    if (options.body !== undefined) {
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, fetchOptions);
    const data = await parseDiscordResponse(response);

    return response.ok
      ? { ok: true, status: response.status, data }
      : { ok: false, status: response.status, error: data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.message
    };
  }
}

async function parseDiscordResponse(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function getChromeStorage(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(key, (data) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(data);
    });
  });
}

function setChromeStorage(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(data, () => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function setChromeLocalStorage(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function getChromeLocalStorage(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (data) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(data);
    });
  });
}

