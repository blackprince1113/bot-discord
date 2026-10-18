(() => {
  if (globalThis.__spotifyLyricsContentScriptLoaded) {
    return;
  }

  globalThis.__spotifyLyricsContentScriptLoaded = true;

  // Content Script - Runs on Spotify pages.
// Reads Spotify DOM state and reports playback/lyric changes to the extension.

const ACTIONS = {
  TRACK_CHANGED: 'trackChanged',
  LYRIC_CHANGED: 'currentLyricChanged',
  PLAYBACK_CHANGED: 'playbackChanged',
  REQUEST_LYRICS: 'requestLyrics'
};

const SELECTORS = {
  playPauseButton: '[data-testid="control-button-playpause"]',
  lyricLine: '[data-testid="lyrics-line"]',
  playbackProgress: '[data-testid="playback-progressbar"]',
  lyricTextFallback: '.WnslfFBWTgOIUgNH',
  contextArtist: '[data-testid="context-item-info-artist"]',
  contextTitle: 'h1[data-testid="context-item-info-title"]',
  nowPlayingHeader: '[data-testid="now-playing-header"]'
};

const COMPLETED_LYRIC_CLASSES = ['NToFVceZLenbhmfcDb3s', 'loNizikBbaCKyI9Gv8xg'];
const CURRENT_LYRIC_CLASSES = ['xp5WpqjB3u9hFHWKn2aE', 'dPaa_Hg0z0Ql_UBrV9uZ'];
const UPCOMING_LYRIC_CLASSES = ['tixQoLB1xUrPglVJ91J4'];

const COMPLETED_LYRIC_CLASS = COMPLETED_LYRIC_CLASSES[0];
const CURRENT_LYRIC_CLASS = CURRENT_LYRIC_CLASSES[0];
const UPCOMING_LYRIC_CLASS = UPCOMING_LYRIC_CLASSES[0];

const INTERVALS = {
  lyricTrackingMs: 300,
  trackTrackingMs: 1000
};

const MIN_LYRIC_LENGTH = 2;
const MUSIC_NOTE_TEXT = '\u266a';

let lastReportedLyric = '';
let lastReportedLyrics = '';
let lastReportedTrack = null;
let lastReportedPlayingState = null;
let extensionContextActive = true;
const observerIntervalIds = [];

startSpotifyObservers();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action !== ACTIONS.REQUEST_LYRICS) {
    return false;
  }

  const snapshot = collectLyricsSnapshot();
  sendResponse(snapshot);
  return false;
});

function startSpotifyObservers() {
  observerIntervalIds.push(
    setInterval(reportCurrentLyricIfChanged, INTERVALS.lyricTrackingMs),
    setInterval(reportCurrentTrackIfChanged, INTERVALS.trackTrackingMs)
  );
}

function reportCurrentLyricIfChanged() {
  if (!extensionContextActive) {
    return;
  }

  const playing = isSpotifyPlaying();
  const snapshot = collectLyricsSnapshot();
  const finished = !playing && isLyricsFinished(snapshot);

  if (!playing && !finished && playing !== lastReportedPlayingState) {
    lastReportedPlayingState = playing;
    safeSendMessage({
      action: ACTIONS.PLAYBACK_CHANGED,
      playing
    });
  }

  if (!playing && !finished) {
    return;
  }

  const { lyrics, currentLyric } = snapshot;
  const lyricToReport = currentLyric || (lyrics ? MUSIC_NOTE_TEXT : '');

  if (!lyricToReport && !lyrics) {
    return;
  }

  const lyricChanged = lyricToReport && lyricToReport !== lastReportedLyric;
  const lyricsChanged = lyrics && lyrics !== lastReportedLyrics;

  if (!lyricChanged && !lyricsChanged) {
    return;
  }

  lastReportedLyric = lyricToReport || lastReportedLyric;
  lastReportedLyrics = lyrics || lastReportedLyrics;
  safeSendMessage({
    action: ACTIONS.LYRIC_CHANGED,
    lyric: lyricToReport,
    lyrics: lastReportedLyrics
  });
}

function isLyricsFinished(snapshot) {
  const lyricLines = Array.from(document.querySelectorAll(SELECTORS.lyricLine))
    .filter((line) => isValidLyricText(getElementText(line.querySelector('div') || line)));

  if (!lyricLines.length) {
    return false;
  }

  const allLinesCompleted = lyricLines.every(isCompletedLyricLine);
  const progressBar = document.querySelector(SELECTORS.playbackProgress);
  const currentTime = Number(progressBar?.getAttribute('aria-valuenow'));
  const duration = Number(progressBar?.getAttribute('aria-valuemax'));
  const progressAtEnd = Number.isFinite(currentTime) &&
    Number.isFinite(duration) &&
    duration > 0 &&
    currentTime >= duration - 1;

  return allLinesCompleted || progressAtEnd;
}

function collectLyricsSnapshot() {
  const lyricLines = Array.from(document.querySelectorAll(SELECTORS.lyricLine));
  const fallbackLines = Array.from(document.querySelectorAll(SELECTORS.lyricTextFallback));
  const lyrics = lyricLines
    .map((line) => getElementText(line.querySelector('div') || line))
    .filter(isValidLyricText)
    .join('\n');
  const currentLyric = findCurrentLyric();

  return {
    lyrics,
    currentLyric,
  };
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
  lastReportedLyrics = '';
  safeSendMessage({
    action: ACTIONS.TRACK_CHANGED,
    track: currentTrack
  });
}

function isSpotifyPlaying() {
  const playPauseButton = document.querySelector(SELECTORS.playPauseButton);
  const ariaLabel = playPauseButton?.getAttribute('aria-label') || '';
  const normalizedLabel = ariaLabel.toLowerCase();

  if (normalizedLabel.includes('pause') || normalizedLabel.includes('\u0e2b\u0e22\u0e38\u0e14')) {
    return true;
  }

  if (normalizedLabel.includes('play') || normalizedLabel.includes('\u0e40\u0e25\u0e48\u0e19')) {
    return false;
  }

  return Boolean(document.querySelector(SELECTORS.lyricLine));
}

function findCurrentLyric() {
  const highlightedLyric = findHighlightedLyric();

  if (highlightedLyric) {
    return highlightedLyric;
  }

  return '';
}

function getAllLyrics() {
  return collectLyricsSnapshot().lyrics;
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

    const track = title && artist
      ? { title, artist, found: true }
      : { title: '', artist: '', found: false };
    return track;
  } catch (error) {
    return {
      title: '',
      artist: '',
      found: false,
      error: error.message
    };
  }
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

  const activeClassPattern = /(active|current|highlight|selected|RL7r4lsMHxMySdFr|xp5WpqjB3u9hFHWKn2aE|dPaa_Hg0z0Ql_UBrV9uZ)/i;

  if (activeClassPattern.test(line.className)) {
    return true;
  }

  if (CURRENT_LYRIC_CLASSES.some((cls) => line.classList.contains(cls))) {
    return true;
  }

  const textElement = line.querySelector('div') || line;
  return activeClassPattern.test(textElement.className);
}

function isCompletedLyricLine(line) {
  const textElement = line.querySelector('div') || line;
  return COMPLETED_LYRIC_CLASSES.some((cls) =>
    line.classList.contains(cls) || textElement.classList.contains(cls)
  );
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
})();
