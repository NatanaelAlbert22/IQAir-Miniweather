import axios from "axios";
import "dotenv/config";
import fs from "fs";

const HYPERBASE_URL = "https://hyperbasescyla.context.my.id";
const PROJECT_ID = "019dbdf9-e461-7e63-93b1-7db366d89d91";

const COLLECTIONS = {
  daily:   "019dbe3f-7817-7301-b498-aa37ea97bee7",
  hourly:  "019dbe43-eaa9-7580-bf62-cadddcf93f43",
  instant: "019dbe46-7f72-78e0-8afa-fdc3e2dedb28"
};

let headers = {
  "Content-Type": "application/json"
};

const tsToId = {};

async function getJWT() {
  const res = await axios.post(
    `${HYPERBASE_URL}/api/rest/auth/token-based`,
    {
      token_id: "019dbe16-b2eb-79e0-beee-a2ca23e46410",
      token: process.env.HYPERBASE_TOKEN
    }
  );
  const jwt = res.data?.data?.token;
  if (!jwt) throw new Error("Failed to get JWT");
  headers["Authorization"] = `Bearer ${jwt}`;
  console.log("✅ JWT obtained");
}

async function populateCache(collection) {
  try {
    const res = await axios.post(
      `${HYPERBASE_URL}/api/rest/project/${PROJECT_ID}/collection/${COLLECTIONS[collection]}/records`,
      {},
      { headers }
    );
    const records = res.data?.data ?? [];
    for (const r of records) {
      if (r.ts && r._id) {
        // Normalize ts format supaya cocok
        const ts = new Date(r.ts).toISOString();
        tsToId[`${collection}:${ts}`] = r._id;
      }
    }
    console.log(`✅ Cache populated [${collection}]: ${records.length} records`);
  } catch (err) {
    console.error(`Cache error [${collection}]:`, err.response?.data || err.message);
  }
}

async function upsert(collection, ts, data) {
  try {
    const res = await axios.post(
      `${HYPERBASE_URL}/api/rest/project/${PROJECT_ID}/collection/${COLLECTIONS[collection]}/record`,
      { ts, ...data },
      { headers }
    );
    const id = res.data?.data?._id;
    if (id) tsToId[`${collection}:${ts}`] = id;
  } catch (err) {
    const status = err.response?.status;
    if (status === 409 || status === 400 || status === 500) { // ← tambah 500
      const id = tsToId[`${collection}:${ts}`];
      if (id) {
        try {
          await axios.patch(
            `${HYPERBASE_URL}/api/rest/project/${PROJECT_ID}/collection/${COLLECTIONS[collection]}/record/${id}`,
            data,
            { headers }
          );
        } catch (updateErr) {
          console.error(`Update error [${collection}] ${ts}:`, updateErr.response?.data || updateErr.message);
        }
      } else {
        console.warn(`No cached ID for [${collection}] ${ts}, skipping update`);
      }
    } else {
      console.error(`Insert error [${collection}] ${ts}:`, err.response?.data || err.message);
    }
  }
}

async function main() {
  try {
    // Signin dulu untuk dapat JWT
    await getJWT();

    await populateCache("daily");
    await populateCache("hourly");
    await populateCache("instant");

    const [normalRes, validatedRes] = await Promise.all([
      axios.get(process.env.API_NORMAL),
      axios.get(process.env.API_VALIDATED)
    ]);

    const normal = normalRes.data;
    const validated = validatedRes.data;

    // Simpan hasil fetch ke file cache untuk mqtt-publish.js
    fs.writeFileSync(
      "/home/jarkom/aqi-fetcher-hyperbase/latest.json",
      JSON.stringify(normal)
    );
    console.log("📂 Cache file updated");

    // ======================
    // DAILY
    // ======================
    console.log("Processing daily...");
    for (const d of normal.historical.daily) {
      await upsert("daily", d.ts, {
        pmone: d.pm1 ?? null,
        pressure: d.pr ?? null,
        humidity: d.hm ?? null,
        temperature: d.tp ?? null,
        aqi_us: d.pm25?.aqius ?? null,
        aqi_cn: d.pm25?.aqicn ?? null,
        pmtwofive_conc: d.pm25?.conc ?? null,
        pmten_conc: d.pm10?.conc ?? null,
        source: "normal"
      });
    }
    console.log("✅ Daily done");

    // ======================
    // HOURLY - NORMAL
    // ======================
    console.log("Processing hourly normal...");
    for (const d of normal.historical.hourly) {
      await upsert("hourly", d.ts, {
        pmone: d.pm1 ?? null,
        pressure: d.pr ?? null,
        humidity: d.hm ?? null,
        temperature: d.tp ?? null,
        aqi_us: d.pm25?.aqius ?? null,
        aqi_cn: d.pm25?.aqicn ?? null,
        pmtwofive_conc: d.pm25?.conc ?? null,
        pmten_conc: d.pm10?.conc ?? null,
        source: "normal"
      });
    }
    console.log("✅ Hourly normal done");

    // ======================
    // HOURLY - VALIDATED
    // ======================
    console.log("Processing hourly validated...");
    for (const d of validated.historical.hourly) {
      await upsert("hourly", d.ts, {
        validated_aqi_us: d.aqius ?? null,
        validated_aqi_cn: d.aqicn ?? null,
        validated_pmtwofive_conc: d.pm25?.concentration ?? null
      });
    }
    console.log("✅ Hourly validated done");

    // ======================
    // INSTANT
    // ======================
    console.log("Processing instant...");
    for (const d of normal.historical.instant) {
      await upsert("instant", d.ts, {
        pmone: d.pm1 ?? null,
        pressure: d.pr ?? null,
        humidity: d.hm ?? null,
        temperature: d.tp ?? null,
        aqi_us: d.pm25?.aqius ?? null,
        aqi_cn: d.pm25?.aqicn ?? null,
        pmtwofive_conc: d.pm25?.conc ?? null,
        pmten_conc: d.pm10?.conc ?? null,
        source: "normal"
      });
    }
    console.log("✅ Instant done");

    console.log("✅ All data inserted to Hyperbase");
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  }
}

main();