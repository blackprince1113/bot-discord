// Content Script - Runs on Spotify pages.
// Reads Spotify DOM state and reports playback/lyric changes to the extension.

const ACTIONS = {
  TRACK_CHANGED: 'trackChanged',
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

const COMPLETED_LYRIC_CLASS = 'loNizikBbaCKyI9Gv8xg';

const INTERVALS = {
  lyricTrackingMs: 300,
  trackTrackingMs: 1000
};

const MIN_LYRIC_LENGTH = 2;
const MUSIC_NOTE_TEXT = '\u266a';

let lastReportedLyric = '';
let lastReportedLyrics = '';
let lastReportedTrack = null;
let extensionContextActive = true;
const observerIntervalIds = [];

startSpotifyObservers();

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

  if (!isSpotifyPlaying()) {
    return;
  }

  const lyrics = getAllLyrics();
  const currentLyric = findCurrentLyric();

  if (!currentLyric && !lyrics) {
    return;
  }

  const lyricChanged = currentLyric && currentLyric !== lastReportedLyric;
  const lyricsChanged = lyrics && lyrics !== lastReportedLyrics;

  if (!lyricChanged && !lyricsChanged) {
    return;
  }

  lastReportedLyric = currentLyric || lastReportedLyric;
  lastReportedLyrics = lyrics || lastReportedLyrics;
  safeSendMessage({
    action: ACTIONS.LYRIC_CHANGED,
    lyric: currentLyric,
    lyrics: lastReportedLyrics
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
  lastReportedLyrics = '';
  safeSendMessage({
    action: ACTIONS.TRACK_CHANGED,
    track: currentTrack
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

function getAllLyrics() {
  const lines = Array.from(document.querySelectorAll(SELECTORS.lyricLine))
    .map((line) => getElementText(line.querySelector('div') || line))
    .filter(isValidLyricText);

  return lines.join('\n');
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

function findHighlightedLyric() {
  const lyricLines = Array.from(document.querySelectorAll(SELECTORS.lyricLine));
  const highlightedLine = lyricLines.find(isHighlightedLyricLine);

  if (highlightedLine) {
    return getElementText(highlightedLine.querySelector('div') || highlightedLine);
  }

  const firstUpcomingLine = lyricLines.find((line) => {
    const textElement = line.querySelector('div') || line;
    return !isCompletedLyricLine(line) && isValidLyricText(getElementText(textElement));
  });

  if (firstUpcomingLine) {
    return getElementText(firstUpcomingLine.querySelector('div') || firstUpcomingLine);
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

function isCompletedLyricLine(line) {
  const textElement = line.querySelector('div') || line;
  return line.classList.contains(COMPLETED_LYRIC_CLASS) ||
    textElement.classList.contains(COMPLETED_LYRIC_CLASS);
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
