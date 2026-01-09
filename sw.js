const CACHE_NAME = "wordgame-v61";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./index.js",
  "./practice.html",
  "./app.js",
  "./words.json",
  "./manifest.json",
  "./snake.html",
  "./snake.js",
  "./snake.css",
  "./wordsearch.html",
  "./wordsearch.js",
  "./wordsearch.css",
  "./assets/snake/ice.svg",
  "./assets/snake/wheel.svg",
  "./assets/snake/scope.svg",
  "./assets/wordsearch/flashlight.svg",
  "./assets/wordsearch/speaker.svg",
  "./assets/wordsearch/xray.svg",
  "./assets/wordsearch/hand.svg",
  "./assets/wordsearch/bomb.svg",
  "./assets/wordsearch/radar.svg",
  "./assets/index/td.svg",
  "./assets/index/snake.svg",
  "./assets/index/search.svg",
  "./td.html",
  "./td.js",
  "./td.css",
  "./assets/pwa/icon-192.png",
  "./assets/pwa/icon-512.png",
  "./assets/pwa/apple-touch-icon.png",
  "./assets/td/fruit-pear.svg",
  "./assets/td/fruit-apple.svg",
  "./assets/td/fruit-banana.svg",
  "./assets/td/fruit-coconut.svg",
  "./assets/td/fruit-cucumber.svg",
  "./assets/td/fruit-blueberry.svg",
  "./assets/td/enemy-sheet.svg",
  "./assets/td/enemy-stack.svg",
  "./assets/td/enemy-book.svg",
  "./assets/td/bag.svg",
  "./assets/td/coin.svg",
  "./assets/td/hoe.svg",
  "./assets/td/key.svg",
  "./assets/td/horn.svg",
  "./assets/td/baton.svg",
  "./assets/td/notebook.svg",
  "./assets/td/skull.svg",
  "./audio/td/shot.wav",
  "./audio/td/error.wav",
  "./audio/td/hit1.wav",
  "./audio/td/hit2.wav",
  "./audio/td/hit3.wav",
  "./audio/td/explode.wav",
  "./audio/td/voice_fail.mp3",
  "./audio/td/voice_bag_2.mp3",
  "./audio/td/voice_bag_3.mp3",
  "./audio/td/voice_bag_1_01.mp3",
  "./audio/td/voice_bag_1_02.mp3",
  "./audio/td/voice_bag_1_03.mp3",
  "./audio/td/voice_bag_1_04.mp3",
  "./audio/td/voice_bag_1_05.mp3",
  "./audio/td/voice_bag_1_06.mp3",
  "./audio/td/voice_bag_1_07.mp3",
  "./audio/td/voice_bag_1_08.mp3",
  "./audio/td/voice_bag_1_09.mp3",
  "./audio/td/voice_bag_1_10.mp3",
  "./audio/td/voice_bag_1_11.mp3",
  "./audio/td/voice_bag_1_12.mp3",
  "./audio/td/voice_bag_1_13.mp3",
  "./audio/td/voice_bag_1_14.mp3",
  "./audio/td/voice_bag_1_15.mp3",
  "./audio/td/voice_bag_1_16.mp3",
  "./audio/td/voice_bag_1_17.mp3",
  "./audio/td/voice_bag_1_18.mp3",
  "./audio/td/voice_bag_1_19.mp3",
  "./audio/td/voice_bag_1_20.mp3",
  "./audio/td/voice_bag_1_21.mp3",
  "./audio/td/voice_bag_1_22.mp3",
  "./audio/td/voice_bag_1_23.mp3",
  "./audio/td/voice_bag_1_24.mp3",
  "./audio/td/voice_bag_1_25.mp3",
  "./audio/td/voice_bag_1_26.mp3",
];

const slugify = (text) =>
  text
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const buildAudioUrls = (words) =>
  words
    .map((item) => {
      if (!item || !item.en) {
        return null;
      }
      const slug = slugify(item.en);
      if (!slug) {
        return null;
      }
      const folder = item.kind === "phrase" ? "phrase" : "en";
      return `audio/${folder}/${slug}.mp3`;
    })
    .filter(Boolean);

async function precacheAudio(cache) {
  try {
    const response = await fetch("words.json");
    if (!response.ok) {
      return;
    }
    const words = await response.json();
    const urls = buildAudioUrls(words);
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          await cache.put(url, res.clone());
        }
      } catch (err) {
        // ignore missing audio
      }
    }
  } catch (err) {
    // ignore preload errors
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      await precacheAudio(cache);
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        return cached;
      }
      try {
        const response = await fetch(request);
        const url = new URL(request.url);
        if (response.ok && url.pathname.includes("/audio/")) {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        return cached || Response.error();
      }
    })()
  );
});
