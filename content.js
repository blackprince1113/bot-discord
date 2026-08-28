// Content Script - Runs on Spotify pages.
// Reads Spotify DOM state and reports playback/lyric changes to the extension.

const ACTIONS = {
  GET_CURRENT_TRACK: 'getCurrentTrack',
  GET_LYRICS: 'getLyricsFromDOM',
  TRACK_CHANGED: 'trackChanged',
  PLAYBACK_CHANGED: 'spotifyPlaybackChanged',
  LYRIC_CHANGED: 'currentLyricChanged'
};

const SELECTORS = {
  playPauseButton: '[data-testid="control-button-playpause"]',
  lyricLine: '[data-testid="lyrics-line"]',
  lyricTextFallback: '.WnslfFBWTgOIUgNH',
  contextArtist: '[data-testid="context-item-info-artist"]',
  contextTitle: 'h1[data-testid="context-item-info-title"]',
  nowPlayingHeader: '[data-testid="now-playing-header"]'
};

const INTERVALS = {
  lyricTrackingMs: 300,
  trackTrackingMs: 1000,
  playbackTrackingMs: 1000
};

const LYRICS_WAIT_MS = 5000;
const LYRICS_WAIT_STEP_MS = 500;
const MIN_LYRIC_LENGTH = 2;
const MIN_FULL_LYRICS_LENGTH = 10;
const MUSIC_NOTE_TEXT = '\u266a';

let lastReportedLyric = '';
let lastReportedTrack = null;
let lastReportedPlayState = null;
let extensionContextActive = true;
const observerIntervalIds = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === ACTIONS.GET_CURRENT_TRACK) {
    sendResponse(getCurrentTrackInfo());
    return;
  }

  if (message.action === ACTIONS.GET_LYRICS) {
    getLyricsFromSpotifyDOM().then((lyrics) => {
      sendResponse({ lyrics });
    });
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.lyricsDebugMode?.newValue === true) {
    getLyricsFromSpotifyDOM();
  }
});

startSpotifyObservers();

function startSpotifyObservers() {
  observerIntervalIds.push(
    setInterval(reportCurrentLyricIfChanged, INTERVALS.lyricTrackingMs),
    setInterval(reportCurrentTrackIfChanged, INTERVALS.trackTrackingMs),
    setInterval(reportPlaybackStateIfChanged, INTERVALS.playbackTrackingMs)
  );
}

function reportCurrentLyricIfChanged() {
  if (!extensionContextActive) {
    return;
  }

  if (!isSpotifyPlaying()) {
    return;
  }

  const currentLyric = findCurrentLyric();

  if (!currentLyric || currentLyric === lastReportedLyric) {
    return;
  }

  lastReportedLyric = currentLyric;
  safeSendMessage({
    action: ACTIONS.LYRIC_CHANGED,
    lyric: currentLyric
  });
}

function reportCurrentTrackIfChanged() {
  if (!extensionContextActive) {
    return;
  }

  const currentTrack = getCurrentTrackInfo();

  if (!currentTrack.found || isSameTrack(currentTrack, lastReportedTrack)) {
    return;
  }

  lastReportedTrack = currentTrack;
  lastReportedLyric = '';
  isLyricsDebugModeEnabled().then((isEnabled) => {
    if (isEnabled) {
      getLyricsFromSpotifyDOM();
    }
  });
  safeSendMessage({
    action: ACTIONS.TRACK_CHANGED,
    track: currentTrack
  });
}

function reportPlaybackStateIfChanged() {
  if (!extensionContextActive) {
    return;
  }

  const isPlaying = isSpotifyPlaying();

  if (isPlaying === lastReportedPlayState) {
    return;
  }

  lastReportedPlayState = isPlaying;

  if (!isPlaying) {
    lastReportedLyric = '';
  }

  safeSendMessage({
    action: ACTIONS.PLAYBACK_CHANGED,
    isPlaying
  });
}

function isSpotifyPlaying() {
  const playPauseButton = document.querySelector(SELECTORS.playPauseButton);
  const ariaLabel = playPauseButton?.getAttribute('aria-label') || '';

  return ariaLabel.toLowerCase() === 'pause';
}

function findCurrentLyric() {
  const highlightedLyric = findHighlightedLyric();

  if (highlightedLyric) {
    return highlightedLyric;
  }

  const lyricLines = Array.from(document.querySelectorAll(SELECTORS.lyricLine));

  if (!lyricLines.length) {
    return '';
  }

  const viewportTop = 0;
  let bestLine = '';
  let bestDistance = Infinity;

  for (const line of lyricLines) {
    const text = getElementText(line.querySelector('div') || line);

    if (!isValidLyricText(text)) {
      continue;
    }

    const rect = line.getBoundingClientRect();

    if (rect.bottom <= viewportTop || rect.top >= window.innerHeight) {
      continue;
    }

    const distance = Math.abs(Math.max(rect.top, viewportTop));

    if (distance < bestDistance) {
      bestDistance = distance;
      bestLine = text;
    }
  }

  return bestLine;
}

function getCurrentTrackInfo() {
  try {
    const metaTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const metaDescription = document.querySelector('meta[property="og:description"]')?.content || '';
    const pageTitle = document.title || '';

    let title = metaTitle.trim();
    let artist = parseArtistFromDescription(metaDescription);

    const contextTitle = document.querySelector(SELECTORS.contextTitle);
    const contextArtist = document.querySelector(SELECTORS.contextArtist);

    title = getElementText(contextTitle) || title;
    artist = getElementText(contextArtist?.querySelector('a')) || artist;

    if (!title || !artist) {
      const parsedTitle = parseTrackFromPageTitle(pageTitle);
      title = title || parsedTitle.title;
      artist = artist || parsedTitle.artist;
    }

    if (!title || !artist) {
      const nowPlaying = parseNowPlayingHeader();
      title = title || nowPlaying.title;
      artist = artist || nowPlaying.artist;
    }

    return title && artist
      ? { title, artist, found: true }
      : { title: '', artist: '', found: false, debug: pageTitle };
  } catch (error) {
    return {
      title: '',
      artist: '',
      found: false,
      error: error.message
    };
  }
}

async function getLyricsFromSpotifyDOM() {
  if (!isSpotifyPlaying()) {
    return null;
  }

  try {
    const hasLyrics = await waitForLyrics();

    if (!hasLyrics) {
      return null;
    }

    const lines = Array.from(document.querySelectorAll(SELECTORS.lyricLine))
      .map((line) => getElementText(line.querySelector('div') || line))
      .filter(isValidLyricText);

    const lyricsText = lines.join('\n');

    if (lyricsText.length < MIN_FULL_LYRICS_LENGTH) {
      return null;
    }

    const currentLyric = findHighlightedLyric() || findCurrentLyric();
    const formattedLyrics = currentLyric
      ? `>>> 🎵 NOW PLAYING <<<\n${currentLyric}\n\n${lyricsText}`
      : lyricsText;

    if (await isLyricsDebugModeEnabled()) {
      console.groupCollapsed(`[Lyrics Debug] ${getCurrentTrackInfo().title || 'Spotify track'}`);
      console.log(formattedLyrics);
      console.groupEnd();
    }

    return formattedLyrics;
  } catch (error) {
    console.error('Error reading Spotify lyrics:', error);
    return null;
  }
}

function isLyricsDebugModeEnabled() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('lyricsDebugMode', (data) => {
      resolve(Boolean(data.lyricsDebugMode));
    });
  });
}

function waitForLyrics(maxWaitMs = LYRICS_WAIT_MS) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      if (document.querySelectorAll(SELECTORS.lyricLine).length > 0) {
        resolve(true);
        return;
      }

      if (Date.now() - startedAt >= maxWaitMs) {
        resolve(false);
        return;
      }

      setTimeout(check, LYRICS_WAIT_STEP_MS);
    };

    check();
  });
}

function findHighlightedLyric() {
  const lyricLines = Array.from(document.querySelectorAll(SELECTORS.lyricLine));
  const highlightedLine = lyricLines.find(isHighlightedLyricLine);

  if (highlightedLine) {
    return getElementText(highlightedLine.querySelector('div') || highlightedLine);
  }

  const highlightedText = Array.from(document.querySelectorAll(SELECTORS.lyricTextFallback))
    .find((line) => line.className.includes('RL7r4lsMHxMySdFr'));

  return getElementText(highlightedText);
}

function isValidLyricText(text) {
  return text === MUSIC_NOTE_TEXT || text.length >= MIN_LYRIC_LENGTH;
}

function isHighlightedLyricLine(line) {
  const ariaCurrent = line.getAttribute('aria-current');
  const ariaSelected = line.getAttribute('aria-selected');

  if (ariaCurrent === 'true' || ariaCurrent === 'step' || ariaSelected === 'true') {
    return true;
  }

  const activeClassPattern = /(active|current|highlight|selected|RL7r4lsMHxMySdFr)/i;

  if (activeClassPattern.test(line.className)) {
    return true;
  }

  const textElement = line.querySelector('div') || line;
  return activeClassPattern.test(textElement.className);
}

function parseArtistFromDescription(description) {
  return description.split(' by ')[1]?.trim() || description.trim();
}

function parseTrackFromPageTitle(pageTitle) {
  const [title = '', artist = ''] = pageTitle.split(' - ').map((part) => part.trim());
  return { title, artist };
}

function parseNowPlayingHeader() {
  const headerText = getElementText(document.querySelector(SELECTORS.nowPlayingHeader));
  const [title = '', artist = ''] = headerText.split('\n').map((line) => line.trim());

  return { title, artist };
}

function isSameTrack(trackA, trackB) {
  return Boolean(
    trackA &&
    trackB &&
    trackA.title === trackB.title &&
    trackA.artist === trackB.artist
  );
}

function getElementText(element) {
  return (element?.innerText || element?.textContent || '').trim();
}

function safeSendMessage(message) {
  if (!extensionContextActive) {
    return;
  }

  try {
    if (!chrome.runtime?.id) {
      stopSpotifyObservers();
      return;
    }

    chrome.runtime.sendMessage(message).catch(stopSpotifyObservers);
  } catch (error) {
    stopSpotifyObservers();
  }
}

function stopSpotifyObservers() {
  extensionContextActive = false;

  while (observerIntervalIds.length) {
    clearInterval(observerIntervalIds.pop());
  }
}
