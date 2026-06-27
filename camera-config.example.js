// Copy this file to camera-config.js and fill in your values.
// camera-config.js is gitignored — do not commit real secrets.
//
// Generate viewerPasswordHash (run in browser console on any page):
//   async function hash(pw) {
//     const data = new TextEncoder().encode(pw);
//     const buf = await crypto.subtle.digest('SHA-256', data);
//     return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
//   }
//   hash('your-friend-password').then(console.log)

window.CAMERA_CONFIG = {
  // Public HTTPS URL from Cloudflare Tunnel (no trailing slash)
  streamBaseUrl: 'https://cam.yourdomain.com',

  // Must match STREAM_TOKEN in esp32-lab-camera/secrets.h
  streamToken: 'change-me-to-a-long-random-string',

  // SHA-256 hex hash of the shared viewer password
  viewerPasswordHash: 'paste-sha256-hex-hash-here'
};
