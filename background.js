// Background Service Worker for Spotify Lyrics Extension.
// Owns Discord status updates so they continue after the popup closes.

importScripts('discord.js');

const ACTIONS = {
  TRACK_CHANGED: 'trackChanged',
  LYRIC_CHANGED: 'currentLyricChanged'
};

const MUSIC_NOTE_TEXT = '\u266a';
const STATUS_PREFIX = MUSIC_NOTE_TEXT;
const DISCORD_UPDATE_COOLDOWN_MS = 1500;

const discordState = {
  appliedStatus: undefined,
  pendingStatus: '',
  lastUpdateAt: 0,
  updateTimerId: null,
  forceNextLyricUpdate: true
};

chrome.runtime.onMessage.addListener((message) => {
  switch (message.action) {
    case ACTIONS.TRACK_CHANGED:
      console.log('Track changed:', message.track);
      discordState.forceNextLyricUpdate = true;
      break;

    case ACTIONS.LYRIC_CHANGED:
      handleLyricChanged(message);
      break;

    default:
      break;
  }
});

function handleLyricChanged(message) {
  const cleanLyric = normalizeText(message.lyric);

  if (message.lyrics) {
    saveLatestLyrics(message.lyrics);
  }

  if (cleanLyric) {
    saveCurrentLyric(cleanLyric);
  }

  if (!cleanLyric) {
    return;
  }

  scheduleDiscordStatusUpdate(formatDiscordStatus(cleanLyric), discordState.forceNextLyricUpdate);
}

function formatDiscordStatus(lyric) {
  return lyric === MUSIC_NOTE_TEXT
    ? MUSIC_NOTE_TEXT
    : `${STATUS_PREFIX} ${lyric}`;
}

function scheduleDiscordStatusUpdate(statusText, forceImmediate = false) {
  const cleanStatus = normalizeText(statusText);

  if (!cleanStatus || cleanStatus === discordState.appliedStatus) {
    return;
  }

  discordState.pendingStatus = cleanStatus;
  clearScheduledDiscordUpdate();

  const elapsed = Date.now() - discordState.lastUpdateAt;
  const delay = forceImmediate ? 0 : Math.max(DISCORD_UPDATE_COOLDOWN_MS - elapsed, 0);

  discordState.updateTimerId = setTimeout(applyPendingDiscordStatus, delay);
}

async function applyPendingDiscordStatus() {
  discordState.updateTimerId = null;

  const status = discordState.pendingStatus;

  if (!status || status === discordState.appliedStatus) {
    return;
  }

  try {
    const credentials = await getDiscordCredentials();

    if (!credentials) {
      return;
    }

    const updated = await updateDiscordStatus(credentials.token, status);

    if (updated) {
      discordState.appliedStatus = status;
      discordState.lastUpdateAt = Date.now();
      discordState.forceNextLyricUpdate = false;
    }
  } catch (error) {
    console.error('Error updating Discord status in background:', error);
  }
}

async function getDiscordCredentials() {
  const [autoUpdate, token] = await Promise.all([
    getDiscordAutoUpdate(),
    getDiscordToken()
  ]);

  if (!autoUpdate || !token) {
    return null;
  }

  return { token };
}

function clearScheduledDiscordUpdate() {
  if (!discordState.updateTimerId) {
    return;
  }

  clearTimeout(discordState.updateTimerId);
  discordState.updateTimerId = null;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
