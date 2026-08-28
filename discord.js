// Discord API and Chrome storage helpers.

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_STATUS_LIMIT = 128;
const STORAGE_KEYS = {
  token: 'discordToken',
  autoUpdate: 'autoUpdateDiscord',
  lyricsDebug: 'lyricsDebugMode'
};

async function updateDiscordStatus(token, status) {
  const text = String(status || '').trim().slice(0, DISCORD_STATUS_LIMIT);

  if (!text) {
    return clearDiscordStatus(token);
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

async function testDiscordToken(token) {
  const response = await discordRequest(token, '/users/@me');

  if (response.ok) {
    console.log('Discord token valid for user:', response.data.username);
    return {
      valid: true,
      username: response.data.username,
      userId: response.data.id
    };
  }

  return {
    valid: false,
    error: response.status === 401
      ? 'Token ไม่ถูกต้อง'
      : 'เชื่อมต่อ Discord ไม่สำเร็จ'
  };
}

async function clearDiscordStatus(token) {
  const response = await discordRequest(token, '/users/@me/settings', {
    method: 'PATCH',
    body: { custom_status: null }
  });

  if (response.ok) {
    console.log('Discord status cleared');
    return true;
  }

  console.error('Discord status clear failed:', response.error);
  return false;
}

async function getDiscordUserInfo(token) {
  const response = await discordRequest(token, '/users/@me');
  return response.ok ? response.data : null;
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

async function saveLyricsDebugMode(enabled) {
  await setChromeStorage({ [STORAGE_KEYS.lyricsDebug]: Boolean(enabled) });
}

async function getLyricsDebugMode() {
  const data = await getChromeStorage(STORAGE_KEYS.lyricsDebug);
  return Boolean(data[STORAGE_KEYS.lyricsDebug]);
}

async function deleteDiscordToken() {
  await removeChromeStorage(STORAGE_KEYS.token);
  console.log('Discord token removed');
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

function removeChromeStorage(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.remove(key, () => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}
