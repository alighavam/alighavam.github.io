/*
 * Lab Camera — live MJPEG stream only (no SD card).
 *
 * Board: ESP32-CAM-MB + OV2640 (AI-Thinker pinout, Aideepen / similar)
 * Flash via Arduino IDE → Board: "AI Thinker ESP32-CAM", PSRAM: Enabled
 */

#include "esp_camera.h"
#include <WiFi.h>
#include "esp_http_server.h"
#include "secrets.h"

// AI-Thinker ESP32-CAM pin map (matches your Amazon board)
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

#define PART_BOUNDARY "labcam_boundary"

static const char* STREAM_CONTENT_TYPE =
  "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* STREAM_PART =
  "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

httpd_handle_t streamHttpd = NULL;

static bool tokenValid(httpd_req_t* req) {
  char query[128];
  if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
    return false;
  }

  char token[64];
  if (httpd_query_key_value(query, "token", token, sizeof(token)) != ESP_OK) {
    return false;
  }

  return strcmp(token, STREAM_TOKEN) == 0;
}

static esp_err_t sendUnauthorized(httpd_req_t* req) {
  httpd_resp_set_status(req, "401 Unauthorized");
  httpd_resp_set_type(req, "text/plain");
  return httpd_resp_send(req, "Invalid or missing token", HTTPD_RESP_USE_STRLEN);
}

static esp_err_t indexHandler(httpd_req_t* req) {
  const char* html =
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Lab Camera</title>"
    "<style>body{font-family:sans-serif;background:#111;color:#eee;"
    "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}"
    ".card{padding:24px;border:1px solid #333;border-radius:12px;max-width:420px}"
    "code{background:#222;padding:2px 6px;border-radius:4px}</style></head><body>"
    "<div class='card'><h2>Lab Camera Online</h2>"
    "<p>Stream endpoint: <code>/stream?token=...</code></p>"
    "<p>View from your website viewer page.</p></div></body></html>";

  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t streamHandler(httpd_req_t* req) {
  if (!tokenValid(req)) {
    return sendUnauthorized(req);
  }

  camera_fb_t* fb = NULL;
  esp_err_t res = ESP_OK;

  res = httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  if (res != ESP_OK) {
    return res;
  }

  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate");

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("Camera capture failed");
      res = ESP_FAIL;
      break;
    }

    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    }

    if (res == ESP_OK) {
      char partHeader[72];
      int headerLen = snprintf(partHeader, sizeof(partHeader), STREAM_PART, fb->len);
      res = httpd_resp_send_chunk(req, partHeader, headerLen);
    }

    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char*)fb->buf, fb->len);
    }

    esp_camera_fb_return(fb);

    if (res != ESP_OK) {
      break;
    }
  }

  return res;
}

static void startStreamServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.ctrl_port = 32768;
  config.max_open_sockets = 4;
  config.lru_purge_enable = true;

  httpd_uri_t indexUri = {
    .uri = "/",
    .method = HTTP_GET,
    .handler = indexHandler,
    .user_ctx = NULL
  };

  httpd_uri_t streamUri = {
    .uri = "/stream",
    .method = HTTP_GET,
    .handler = streamHandler,
    .user_ctx = NULL
  };

  if (httpd_start(&streamHttpd, &config) == ESP_OK) {
    httpd_register_uri_handler(streamHttpd, &indexUri);
    httpd_register_uri_handler(streamHttpd, &streamUri);
    Serial.println("HTTP server started on port 80");
  } else {
    Serial.println("Failed to start HTTP server");
  }
}

static bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    config.frame_size = FRAMESIZE_VGA;   // 640x480 — good for multiple viewers
    config.jpeg_quality = 12;          // lower = better quality (10-15 typical)
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    Serial.println("WARNING: PSRAM not found — using lower resolution");
    config.frame_size = FRAMESIZE_SVGA;
    config.jpeg_quality = 15;
    config.fb_count = 1;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    return false;
  }

  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);
    s->set_saturation(s, 0);
  }

  return true;
}

static const char* wifiStatusText(wl_status_t status) {
  switch (status) {
    case WL_IDLE_STATUS: return "idle";
    case WL_NO_SSID_AVAIL: return "SSID not found (wrong name, out of range, or 5 GHz only)";
    case WL_SCAN_COMPLETED: return "scan completed";
    case WL_CONNECTED: return "connected";
    case WL_CONNECT_FAILED: return "connect failed (wrong password or unsupported security)";
    case WL_CONNECTION_LOST: return "connection lost";
    case WL_DISCONNECTED: return "disconnected";
    default: return "unknown";
  }
}

static void scanNearbyNetworks() {
  Serial.println("Scanning for WiFi networks...");
  int count = WiFi.scanNetworks();
  if (count == 0) {
    Serial.println("No networks found.");
    return;
  }

  bool targetFound = false;
  for (int i = 0; i < count; i++) {
    const String ssid = WiFi.SSID(i);
    Serial.printf("  %s  (%d dBm)%s\n", ssid.c_str(), WiFi.RSSI(i),
                  ssid == WIFI_SSID ? "  <-- your SSID" : "");
    if (ssid == WIFI_SSID) {
      targetFound = true;
    }
  }

  if (!targetFound) {
    Serial.println("Your SSID was NOT seen in the scan.");
  }
}

static void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.disconnect(true);
  delay(100);

  scanNearbyNetworks();

  Serial.printf("Connecting to %s ...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint8_t attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 60) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
    Serial.print("Camera IP address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Stream URL (local): http://");
    Serial.print(WiFi.localIP());
    Serial.println("/stream?token=YOUR_TOKEN");
    return;
  }

  Serial.printf("WiFi failed. Status %d: %s\n", WiFi.status(), wifiStatusText(WiFi.status()));
  Serial.println("Check secrets.h, password, and whether the network allows IoT devices.");
}

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(false);
  delay(1000);

  Serial.println();
  Serial.println("Lab Camera starting...");

  if (!initCamera()) {
    Serial.println("Halting — fix camera wiring/board selection and reboot");
    while (true) {
      delay(1000);
    }
  }

  connectWiFi();
  startStreamServer();
}

void loop() {
  delay(10000);
}
