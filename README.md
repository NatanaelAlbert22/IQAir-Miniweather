# AQI Fetcher & MQTT Real-Time Sender

Sistem pengambilan, penyimpanan, dan pengiriman data kualitas udara secara real-time.

Sistem ini terdiri dari dua komponen utama:

1. **`index.js`** — mengambil data kualitas udara dari API, menyimpannya ke Hyperbase, dan membuat file cache lokal.
2. **`sender_real.py`** — membaca data terbaru dari cache, melakukan transformasi payload, menyimpan data debug lokal, kemudian mengirimkannya ke MQTT Broker.

## Architecture

```text
                    ┌─────────────────────┐
                    │     AQI API         │
                    │                     │
                    │ API_NORMAL          │
                    │ API_VALIDATED       │
                    └──────────┬──────────┘
                               │
                               │ HTTP GET
                               ▼
                    ┌─────────────────────┐
                    │      index.js       │
                    │   Node.js Fetcher   │
                    └──────────┬──────────┘
                               │
                 ┌─────────────┴─────────────┐
                 │                           │
                 ▼                           ▼
       ┌───────────────────┐       ┌───────────────────┐
       │     Hyperbase     │       │   latest.json     │
       │                   │       │                   │
       │ daily             │       │ Latest API data  │
       │ hourly            │       │                   │
       │ instant           │       └─────────┬─────────┘
       └───────────────────┘                 │
                                             │ Read
                                             ▼
                                  ┌─────────────────────┐
                                  │   sender_real.py    │
                                  │   Python MQTT       │
                                  └──────────┬──────────┘
                                             │
                              ┌──────────────┴──────────────┐
                              │                             │
                              ▼                             ▼
                   ┌──────────────────┐          ┌──────────────────┐
                   │    datafe.json   │          │   MQTT Broker    │
                   │   Local Debug    │          │                  │
                   └──────────────────┘          │ mqtt.context... │
                                                  └────────┬─────────┘
                                                           │
                                                           ▼
                                                    MQTT Subscriber
```

## Features

* Mengambil data AQI dari dua API:

  * Normal data
  * Validated data
* Menyimpan historical data ke Hyperbase.
* Menggunakan tiga collection Hyperbase:

  * `daily`
  * `hourly`
  * `instant`
* Menggabungkan data normal dan validated pada collection `hourly`.
* Membuat cache lokal `latest.json`.
* Mengubah data current AQI menjadi payload dengan **8 field**.
* Mengirim data melalui MQTT menggunakan WebSocket.
* Interval pengiriman MQTT setiap **5 detik**.
* Menyediakan file `datafe.json` untuk debugging.
* Menggunakan MQTT QoS 1.

---

# 1. Requirements

## Node.js

Komponen `index.js` membutuhkan:

* Node.js
* npm
* `axios`
* `dotenv`

Install dependency:

```bash
npm install axios dotenv
```

`index.js` menggunakan `axios` untuk komunikasi HTTP dan `dotenv` untuk membaca environment variable.

## Python

Komponen `sender_real.py` membutuhkan:

* Python 3
* `paho-mqtt`

Install dependency:

```bash
pip install paho-mqtt
```

---

# 2. File Structure

Contoh struktur direktori:

```text
aqi-fetcher-hyperbase/
├── index.js
├── sender_real.py
├── latest.json
├── datafe.json
├── .env
├── package.json
└── README.md
```

`latest.json` digunakan sebagai cache antara `index.js` dan `sender_real.py`, sedangkan `datafe.json` digunakan sebagai file debug lokal.

---

# 3. Environment Variables

Buat file `.env`:

```env
HYPERBASE_TOKEN=YOUR_HYPERBASE_TOKEN

API_NORMAL=YOUR_NORMAL_API_URL

API_VALIDATED=YOUR_VALIDATED_API_URL
```

## Environment Variables

| Variable          | Description                          |
| ----------------- | ------------------------------------ |
| `HYPERBASE_TOKEN` | Token untuk autentikasi ke Hyperbase |
| `API_NORMAL`      | Endpoint API data AQI normal         |
| `API_VALIDATED`   | Endpoint API data AQI validated      |

**Jangan commit `.env` ke repository.**

Tambahkan:

```gitignore
.env
```

---

# 4. `index.js`

`index.js` bertanggung jawab atas proses pengambilan dan penyimpanan data.

## 4.1 Authentication

Program melakukan autentikasi ke Hyperbase menggunakan token-based authentication.

```text
HYPERBASE_TOKEN
       │
       ▼
Hyperbase Token Authentication
       │
       ▼
JWT
       │
       ▼
Authorization: Bearer <JWT>
```

JWT yang diperoleh kemudian digunakan pada request berikutnya.

---

# 5. Hyperbase Collections

Program menggunakan tiga collection:

| Collection | ID                                     | Data               |
| ---------- | -------------------------------------- | ------------------ |
| `daily`    | `019dbe3f-7817-7301-b498-aa37ea97bee7` | Historical daily   |
| `hourly`   | `019dbe43-eaa9-7580-bf62-cadddcf93f43` | Historical hourly  |
| `instant`  | `019dbe46-7f72-78e0-8afa-fdc3e2dedb28` | Historical instant |

Collection tersebut didefinisikan langsung di `index.js`.

---

# 6. Data Processing

## Daily

Data `normal.historical.daily` diproses dan disimpan ke collection `daily`.

Field yang disimpan:

```text
ts
pmone
pressure
humidity
temperature
aqi_us
aqi_cn
pmtwofive_conc
pmten_conc
source
```

Mapping dilakukan dari data API seperti:

```text
pm1      → pmone
pr       → pressure
hm       → humidity
tp       → temperature
pm25.aqius → aqi_us
pm25.aqicn → aqi_cn
pm25.conc  → pmtwofive_conc
pm10.conc  → pmten_conc
```

## Hourly Normal

Data `normal.historical.hourly` disimpan ke collection `hourly`.

Data normal menggunakan field yang sama seperti daily:

```text
pmone
pressure
humidity
temperature
aqi_us
aqi_cn
pmtwofive_conc
pmten_conc
source
```

## Hourly Validated

Data validated juga dimasukkan ke collection `hourly`.

Field validated:

```text
validated_aqi_us
validated_aqi_cn
validated_pmtwofive_conc
```

Dengan demikian, collection `hourly` dapat berisi data normal sekaligus validated untuk timestamp yang sama.

## Instant

Data `normal.historical.instant` disimpan ke collection `instant` menggunakan mapping yang sama dengan data normal.

---

# 7. Upsert Mechanism

Program menggunakan fungsi `upsert()` untuk memasukkan data.

Secara umum:

```text
Insert Record
     │
     ├── Success → Simpan ID ke cache
     │
     └── Error 409/400/500
                │
                ▼
          Cari ID dari cache
                │
                ▼
             PATCH
```

ID record disimpan berdasarkan kombinasi:

```text
collection + timestamp
```

Contoh:

```text
hourly:2026-08-15T10:00:00.000Z
```

Jika insert mengalami status `409`, `400`, atau `500`, program mencoba menggunakan ID yang telah ada untuk melakukan update melalui PATCH.

---

# 8. Local Cache

Setelah mengambil data dari API, `index.js` menyimpan response normal ke:

```text
/home/jarkom/aqi-fetcher-hyperbase/latest.json
```

File ini digunakan sebagai sumber data oleh `sender_real.py`.

Alurnya:

```text
API_NORMAL
    │
    ▼
index.js
    │
    ▼
latest.json
    │
    ▼
sender_real.py
```

---

# 9. `sender_real.py`

`sender_real.py` bertugas sebagai real-time MQTT sender.

Program berjalan dengan interval:

```text
5 detik
```

Konfigurasi tersebut ditentukan melalui:

```python
PUBLISH_INTERVAL = 5
```

---

# 10. Reading Cache

Setiap siklus, program membaca:

```text
/home/jarkom/aqi-fetcher-hyperbase/latest.json
```

Jika file tidak tersedia, kosong, atau JSON tidak valid, program tidak mengirimkan data dan akan menunggu siklus berikutnya.

---

# 11. MQTT Payload

Program hanya mengirim **8 field data**.

Format payload:

```json
{
  "data": {
    "aqi_us": 0,
    "aqi_cn": 0,
    "pm1": 0,
    "pm25": 0,
    "pm10": 0,
    "temperature": 0,
    "kelembapan": 0,
    "tekanan": 0
  }
}
```

Mapping:

| Payload       | Source              |
| ------------- | ------------------- |
| `aqi_us`      | `current.aqius`     |
| `aqi_cn`      | `current.aqicn`     |
| `pm1`         | `current.pm1.conc`  |
| `pm25`        | `current.pm25.conc` |
| `pm10`        | `current.pm10.conc` |
| `temperature` | `current.tp`        |
| `kelembapan`  | `current.hm`        |
| `tekanan`     | `current.pr`        |

Mapping ini diterapkan secara strict oleh fungsi `transform_payload()`.

---

# 12. MQTT Configuration

Konfigurasi MQTT yang digunakan:

```text
Broker   : mqtt.context.my.id
Port     : 443
Transport: WebSockets
Path     : /mqtt
Protocol : MQTT v3.1.1
QoS      : 1
```

Topic:

```text
/devices/30d45180-45f2-494a-ba49-6550e41b4e2a
```

Konfigurasi tersebut terdapat pada `sender_real.py`.

---

# 13. MQTT Connection

Koneksi MQTT menggunakan WebSocket:

```python
mqtt.Client(
    client_id=MQTT_CLIENT_ID,
    transport="websockets",
    protocol=mqtt.MQTTv311
)
```

WebSocket menggunakan path:

```text
/mqtt
```

dan koneksi dilakukan ke port `443`.

Program menunggu maksimal **10 detik** untuk mendapatkan koneksi sebelum dianggap gagal.

---

# 14. Local Debug File

Selain mengirim data melalui MQTT, program juga menyimpan payload yang telah ditransformasi ke:

```text
/home/jarkom/aqi-fetcher-hyperbase/datafe.json
```

File ini menggunakan pretty-print JSON sehingga mudah diperiksa secara manual.

Contoh:

```json
{
  "data": {
    "aqi_us": 45,
    "aqi_cn": 50,
    "pm1": 12,
    "pm25": 20,
    "pm10": 30,
    "temperature": 28,
    "kelembapan": 75,
    "tekanan": 1008
  }
}
```

---

# 15. Running the System

## Step 1 — Install Node.js dependencies

```bash
npm install
```

## Step 2 — Configure `.env`

```env
HYPERBASE_TOKEN=YOUR_TOKEN
API_NORMAL=YOUR_NORMAL_API
API_VALIDATED=YOUR_VALIDATED_API
```

## Step 3 — Jalankan data fetcher

```bash
node index.js
```

Program akan:

1. Mendapatkan JWT Hyperbase.
2. Populate cache ID record Hyperbase.
3. Mengambil API normal.
4. Mengambil API validated.
5. Membuat/update `latest.json`.
6. Memproses daily.
7. Memproses hourly normal.
8. Memproses hourly validated.
9. Memproses instant.
10. Menyimpan data ke Hyperbase.

---

## Step 4 — Jalankan MQTT sender

Pada terminal lain:

```bash
python3 sender_real.py
```

Program kemudian:

```text
Read latest.json
      │
      ▼
Transform payload
      │
      ├───────────────┐
      ▼               ▼
datafe.json       MQTT Publish
```

Pengiriman dilakukan setiap 5 detik.

---

# 16. Expected Console Output

Ketika koneksi berhasil:

```text
🚀 Real Sender + Debug Mode aktif
📂 Baca: /home/jarkom/aqi-fetcher-hyperbase/latest.json
💾 Simpan ke: /home/jarkom/aqi-fetcher-hyperbase/datafe.json
📡 MQTT: /devices/30d45180-45f2-494a-ba49-6550e41b4e2a

✅ [12:00:00] Terhubung ke broker
🔄 Loop dimulai (update setiap 5 detik)...

📤 AQI:45 | PM2.5:20 | Suhu:28°C
```

Output tersebut mengikuti logging yang terdapat di `sender_real.py`.

---

# 17. Troubleshooting

## `latest.json` tidak tersedia

Pastikan `index.js` telah dijalankan terlebih dahulu.

```bash
node index.js
```

Periksa:

```text
/home/jarkom/aqi-fetcher-hyperbase/latest.json
```

Jika file belum tersedia, `sender_real.py` akan menampilkan:

```text
⏳ Menunggu data dari index.js...
```

## MQTT gagal terhubung

Periksa:

* Broker
* Port `443`
* WebSocket path `/mqtt`
* Koneksi internet
* MQTT topic
* Status MQTT broker

## API tidak menghasilkan data

Periksa environment variables:

```env
API_NORMAL=
API_VALIDATED=
```

dan pastikan endpoint dapat diakses.

## Hyperbase authentication gagal

Periksa:

```env
HYPERBASE_TOKEN=
```

`index.js` akan menghentikan proses apabila JWT tidak berhasil diperoleh.

---

# 18. Security Notes

Jangan menyimpan credential secara langsung di repository.

Gunakan:

```env
HYPERBASE_TOKEN=...
```

dan masukkan `.env` ke `.gitignore`:

```gitignore
.env
```

Selain itu, `sender_real.py` saat ini menggunakan:

```python
client.tls_set(cert_reqs=ssl.CERT_NONE)
client.tls_insecure_set(True)
```

Artinya verifikasi sertifikat TLS dinonaktifkan.

Konfigurasi ini perlu diperhatikan apabila sistem digunakan pada production environment.

---

# 19. Data Flow Summary

```text
┌─────────────┐
│   AQI API   │
└──────┬──────┘
       │
       │ HTTP GET
       ▼
┌─────────────┐
│  index.js   │
└──────┬──────┘
       │
       ├───────────────► Hyperbase
       │                  ├── daily
       │                  ├── hourly
       │                  └── instant
       │
       ▼
 latest.json
       │
       ▼
┌─────────────────┐
│ sender_real.py  │
└────────┬────────┘
         │
         ├──────────────► datafe.json
         │
         ▼
    MQTT Broker
         │
         ▼
      Subscriber
```

## Summary

| Component        | Function                                        |
| ---------------- | ----------------------------------------------- |
| `index.js`       | Fetch API dan menyimpan data                    |
| Hyperbase        | Penyimpanan historical data                     |
| `latest.json`    | Cache data API terbaru                          |
| `sender_real.py` | Transform dan publish data                      |
| `datafe.json`    | Local debug payload                             |
| MQTT Broker      | Distribusi data real-time                       |
| MQTT Topic       | `/devices/30d45180-45f2-494a-ba49-6550e41b4e2a` |

Sistem secara keseluruhan memisahkan **historical data processing** (`index.js` + Hyperbase) dari **real-time data publishing** (`sender_real.py` + MQTT).
