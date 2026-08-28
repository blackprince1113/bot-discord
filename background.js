// Background Service Worker for Spotify Lyrics Extension.
// Owns Discord status updates so they continue after the popup closes.

importScripts('discord.js');

const ACTIONS = {
  TRACK_CHANGED: 'trackChanged',
  PLAYBACK_CHANGED: 'spotifyPlaybackChanged',
  LYRIC_CHANGED: 'currentLyricChanged'
};

const SPOTIFY_URL_PATTERN = 'https://open.spotify.com/*';
const MUSIC_NOTE_TEXT = '\u266a';
const STATUS_PREFIX = MUSIC_NOTE_TEXT;
const DISCORD_UPDATE_COOLDOWN_MS = 1500;
const SPOTIFY_TAB_CHECK_DEBOUNCE_MS = 500;

const discordState = {
  appliedStatus: undefined,
  pendingStatus: '',
  lastUpdateAt: 0,
  updateTimerId: null,
  tabCheckTimerId: null,
  hasSpotifyTabs: undefined,
  forceNextLyricUpdate: true
};

chrome.runtime.onMessage.addListener((message) => {
  switch (message.action) {
    case ACTIONS.TRACK_CHANGED:
      console.log('Track changed:', message.track);
      discordState.forceNextLyricUpdate = true;
      break;

    case ACTIONS.PLAYBACK_CHANGED:
      handlePlaybackChanged(Boolean(message.isPlaying));
      break;

    case ACTIONS.LYRIC_CHANGED:
      handleLyricChanged(message.lyric);
      break;

    default:
      break;
  }
});

chrome.tabs.onRemoved.addListener(scheduleSpotifyTabCheck);
chrome.tabs.onUpdated.addListener(scheduleSpotifyTabCheck);

chrome.runtime.onStartup.addListener(scheduleSpotifyTabCheck);
chrome.runtime.onInstalled.addListener(scheduleSpotifyTabCheck);

function handlePlaybackChanged(isPlaying) {
  if (isPlaying) {
    discordState.forceNextLyricUpdate = true;
  } else {
    clearDiscordStatusNow();
  }
}

function handleLyricChanged(lyric) {
  const cleanLyric = normalizeText(lyric);

  if (!cleanLyric) {
    return;
  }

  scheduleDiscordStatusUpdate(formatDiscordStatus(cleanLyric), discordState.forceNextLyricUpdate);
  console.log('Lyric changed:', cleanLyric);
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

async function clearDiscordStatusNow() {
  clearScheduledDiscordUpdate();
  discordState.pendingStatus = '';

  try {
    const credentials = await getDiscordCredentials();

    if (!credentials) {
      return;
    }

    const cleared = await clearDiscordStatus(credentials.token);

    if (cleared) {
      discordState.appliedStatus = null;
      discordState.lastUpdateAt = Date.now();
      discordState.forceNextLyricUpdate = true;
    }
  } catch (error) {
    console.error('Error clearing Discord status in background:', error);
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

function scheduleSpotifyTabCheck() {
  if (discordState.tabCheckTimerId) {
    clearTimeout(discordState.tabCheckTimerId);
  }

  discordState.tabCheckTimerId = setTimeout(checkSpotifyTabs, SPOTIFY_TAB_CHECK_DEBOUNCE_MS);
}

function checkSpotifyTabs() {
  discordState.tabCheckTimerId = null;

  chrome.tabs.query({ url: SPOTIFY_URL_PATTERN }, (tabs) => {
    if (chrome.runtime.lastError) {
      console.warn('Unable to query Spotify tabs:', chrome.runtime.lastError.message);
      return;
    }

    const hasSpotifyTabs = tabs.length > 0;

    if (discordState.hasSpotifyTabs === hasSpotifyTabs) {
      return;
    }

    discordState.hasSpotifyTabs = hasSpotifyTabs;

    if (!hasSpotifyTabs) {
      clearDiscordStatusNow();
    }
  });
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
