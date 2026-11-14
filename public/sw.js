// DrivePulse Desktop & Harness Bridge Auto-Update Service Worker
let activeVersion = '2.5.0';
let activeBuildHash = 'build-250-initial';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING' || data.type === 'APPLY_OTA_UPDATE') {
    if (data.version) activeVersion = String(data.version);
    if (data.buildHash) activeBuildHash = String(data.buildHash);

    self.skipWaiting();
    event.waitUntil(
      (async () => {
        // Clear any outdated runtime cache buckets on OTA version bump
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((k) => k.startsWith('drivepulse-ota-') && !k.endsWith(activeBuildHash))
              .map((k) => caches.delete(k))
          );
        }
        const allClients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const client of allClients) {
          client.postMessage({
            type: 'SW_OTA_APPLIED',
            version: activeVersion,
            buildHash: activeBuildHash,
            appliedAt: new Date().toISOString(),
          });
        }
      })()
    );
  }
});
