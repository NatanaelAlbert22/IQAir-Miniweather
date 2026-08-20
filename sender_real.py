#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Real-time Data Sender + Local Debug File
Format: STRICT 8 keys sesuai dummy sender
Interval: 5 detik
"""

import json
import time
import ssl
import sys
import os
from datetime import datetime
import paho.mqtt.client as mqtt

# ========== KONFIGURASI ==========
CACHE_FILE_PATH = "/home/jarkom/aqi-fetcher-hyperbase/latest.json"
DATAFE_FILE_PATH = "/home/jarkom/aqi-fetcher-hyperbase/datafe.json"  # 🆕 File debug lokal

MQTT_BROKER = "mqtt.context.my.id"
MQTT_PORT = 443
MQTT_PATH = "/mqtt"
MQTT_TOPIC_REAL = "/devices/30d45180-45f2-494a-ba49-6550e41b4e2a"
MQTT_CLIENT_ID = f"real-sender-{os.getpid()}"
PUBLISH_INTERVAL = 60

def read_latest_data():
    try:
        if not os.path.exists(CACHE_FILE_PATH):
            return None
        if os.path.getsize(CACHE_FILE_PATH) == 0:
            return None
        with open(CACHE_FILE_PATH, 'r') as f:
            return json.load(f)
    except json.JSONDecodeError:
        return None
    except Exception as e:
        print(f"⚠️ Gagal membaca cache: {e}")
        return None

def transform_payload(data):
    try:
        curr = data.get('current')
        if not curr:
            return None

        # Mapping STRICT hanya 8 field
        payload = {
            "data": {
                "aqi_us": curr.get('aqius'),
                "aqi_cn": curr.get('aqicn'),
                "pm1": curr.get('pm1', {}).get('conc'),
                "pm25": curr.get('pm25', {}).get('conc'),
                "pm10": curr.get('pm10', {}).get('conc'),
                "temperature": curr.get('tp'),
                "kelembapan": curr.get('hm'),
                "tekanan": curr.get('pr')
            }
        }
        return payload
    except Exception as e:
        print(f"⚠️ Error transform payload: {e}")
        return None

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"✅ [{datetime.now().strftime('%H:%M:%S')}] Terhubung ke broker")
        client.connected_flag = True
    else:
        print(f"❌ Koneksi gagal, kode: {rc}")
        client.connected_flag = False

def on_disconnect(client, userdata, rc):
    print(f"⚠️ Terputus dari broker")
    client.connected_flag = False

def main():
    print(f"🚀 Real Sender + Debug Mode aktif")
    print(f"📂 Baca: {CACHE_FILE_PATH}")
    print(f"💾 Simpan ke: {DATAFE_FILE_PATH}")
    print(f"📡 MQTT: {MQTT_TOPIC_REAL}\n")

    client = mqtt.Client(client_id=MQTT_CLIENT_ID, transport="websockets", protocol=mqtt.MQTTv311)
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.connected_flag = False

    client.tls_set(cert_reqs=ssl.CERT_NONE)
    client.tls_insecure_set(True)

    try:
        client.ws_set_options(path=MQTT_PATH)
        client.connect(MQTT_BROKER, port=MQTT_PORT, keepalive=60)
        client.loop_start()

        timeout = 10
        while not client.connected_flag and timeout > 0:
            time.sleep(1)
            timeout -= 1
        if not client.connected_flag:
            print("❌ Gagal connect ke broker"); sys.exit(1)

        print("🔄 Loop dimulai (update setiap 5 detik)...\n")
        while True:
            raw_data = read_latest_data()
            if raw_data:
                payload_obj = transform_payload(raw_data)
                if payload_obj and payload_obj.get('data'):
                    # 1️⃣ SIMPAN KE FILE LOKAL (PRETTY PRINT untuk mudah dicek)
                    try:
                        with open(DATAFE_FILE_PATH, 'w') as f:
                            json.dump(payload_obj, f, indent=2)
                    except Exception as e:
                        print(f"⚠️ Gagal tulis datafe.json: {e}")

                    # 2️⃣ KIRIM VIA MQTT (COMPACT FORMAT)
                    payload_str = json.dumps(payload_obj, separators=(',', ':'))
                    result = client.publish(MQTT_TOPIC_REAL, payload=payload_str, qos=1)

                    if result.rc == mqtt.MQTT_ERR_SUCCESS:
                        d = payload_obj['data']
                        print(f"📤 AQI:{d['aqi_us']} | PM2.5:{d['pm25']} | Suhu:{d['temperature']}°C")
                    else:
                        print(f"❌ Publish gagal: {result.rc}")
            else:
                print(f"⏳ Menunggu data dari index.js...")

            time.sleep(PUBLISH_INTERVAL)

    except KeyboardInterrupt:
        print("\n🛑 Dihentikan user")
    finally:
        client.loop_stop()
        client.disconnect()

if __name__ == "__main__":
    main()